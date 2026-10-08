import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  SystemConfigEntity,
  SystemConfigValueType,
} from '../../administration/entities/system-config.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuditLogSeverity } from '../../administration/entities/audit-log.entity.js';

const CONFIG_KEY = 'security_alerts.auto_resolve_timeout_minutes';
const CONFIG_ENV = 'SECURITY_ALERTS_AUTO_RESOLVE_TIMEOUT_MINUTES';
const CONFIG_DEFAULT = 15;
const CONFIG_MIN = 1;

/**
 * [FIX 2026-08-11] Chống thổi phồng `occurrence_count`/`occurrences` khi CÙNG userId
 * kích hoạt lặp lại trong thời gian ngắn (camera bắn nhiều `appear` gần-trùng-giờ cho 1
 * lần đứng yên — xem AlertsService.bumpOccurrence()). Namespace RIÊNG với
 * `no_show.presence_*` (rooms module) dù cùng đơn vị giây — khác domain nghiệp vụ, không
 * dùng chung theo đúng bài học đã rút ra (mixing config field giữa 2 domain từng gây bug
 * production ở no-show). `min: 0` = tắt debounce (mọi occurrence đều append).
 */
const DEBOUNCE_CONFIG_KEY = 'security_alerts.occurrence_debounce_seconds';
const DEBOUNCE_CONFIG_ENV = 'SECURITY_ALERT_OCCURRENCE_DEBOUNCE_SECONDS';
const DEBOUNCE_CONFIG_DEFAULT = 5;
const DEBOUNCE_CONFIG_MIN = 0;

/** getDebounceSeconds() bị gọi ở MỖI lần cộng dồn alert → cache; update() xoá ngay. */
const DEBOUNCE_CACHE_MS = 60_000;

export interface UpdateSecurityAlertConfigInput {
  autoResolveTimeoutMinutes?: number;
  occurrenceDebounceSeconds?: number;
}

/**
 * SecurityAlertConfigService — đọc/ghi ngưỡng auto-resolve alert vào
 * system_configs. Mirror NoShowConfigService (rooms module).
 *
 * Whitelist đúng 1 key (không cho ghi key tùy ý). Precedence đọc:
 * system_configs → env → default (15 phút — an toàn, không quá ngắn gây tách
 * vụ ảo, không quá dài gây gộp nhầm).
 */
@Injectable()
export class SecurityAlertConfigService {
  private readonly logger = new Logger(SecurityAlertConfigService.name);
  private debounceCache: { value: number; expiresAt: number } | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /** Đọc giá trị hiệu lực theo precedence system_configs → env → default. */
  async getEffectiveTimeoutMinutes(): Promise<{
    value: number;
    source: 'system_configs' | 'env' | 'default';
  }> {
    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const row = await repo.findOne({
      where: { configKey: CONFIG_KEY, isActive: true },
    });
    if (row?.configValue != null) {
      const n = parseInt(row.configValue, 10);
      if (Number.isInteger(n) && n >= CONFIG_MIN) {
        return { value: n, source: 'system_configs' };
      }
    }
    const envVal = this.configService.get<number>(CONFIG_ENV);
    if (envVal != null) {
      const n = Number(envVal);
      if (Number.isInteger(n) && n >= CONFIG_MIN)
        return { value: n, source: 'env' };
    }
    return { value: CONFIG_DEFAULT, source: 'default' };
  }

  /** Mirror getEffectiveTimeoutMinutes() — cùng precedence, key/env/default/min riêng. */
  async getEffectiveDebounceSeconds(): Promise<{
    value: number;
    source: 'system_configs' | 'env' | 'default';
  }> {
    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const row = await repo.findOne({
      where: { configKey: DEBOUNCE_CONFIG_KEY, isActive: true },
    });
    if (row?.configValue != null) {
      const n = parseInt(row.configValue, 10);
      if (Number.isInteger(n) && n >= DEBOUNCE_CONFIG_MIN) {
        return { value: n, source: 'system_configs' };
      }
    }
    const envVal = this.configService.get<number>(DEBOUNCE_CONFIG_ENV);
    if (envVal != null) {
      const n = Number(envVal);
      if (Number.isInteger(n) && n >= DEBOUNCE_CONFIG_MIN)
        return { value: n, source: 'env' };
    }
    return { value: DEBOUNCE_CONFIG_DEFAULT, source: 'default' };
  }

  /** GET API. */
  async getAll(): Promise<{
    autoResolveTimeoutMinutes: { value: number; source: string };
    occurrenceDebounceSeconds: { value: number; source: string };
  }> {
    const [autoResolveTimeoutMinutes, occurrenceDebounceSeconds] =
      await Promise.all([
        this.getEffectiveTimeoutMinutes(),
        this.getEffectiveDebounceSeconds(),
      ]);
    return { autoResolveTimeoutMinutes, occurrenceDebounceSeconds };
  }

  /** Đọc gọn dạng number (cron dùng). */
  async getTimeoutMinutes(): Promise<number> {
    const { value } = await this.getEffectiveTimeoutMinutes();
    return value;
  }

  /** Đọc gọn dạng number (AlertsService.bumpOccurrence() dùng). */
  async getDebounceSeconds(): Promise<number> {
    const now = Date.now();
    if (this.debounceCache && this.debounceCache.expiresAt > now) {
      return this.debounceCache.value;
    }
    const { value } = await this.getEffectiveDebounceSeconds();
    this.debounceCache = { value, expiresAt: now + DEBOUNCE_CACHE_MS };
    return value;
  }

  /** PUT API: upsert ≥1 trong 2 key. version_no++ khi update. */
  async update(
    input: UpdateSecurityAlertConfigInput,
    adminId: string | null,
  ): Promise<{
    autoResolveTimeoutMinutes: { value: number; source: string };
    occurrenceDebounceSeconds: { value: number; source: string };
  }> {
    if (
      input.autoResolveTimeoutMinutes === undefined &&
      input.occurrenceDebounceSeconds === undefined
    ) {
      throw new BadRequestException({
        code: 'NO_CONFIG_FIELDS',
        message:
          'At least one of autoResolveTimeoutMinutes/occurrenceDebounceSeconds is required.',
      });
    }

    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const changed: Record<string, number> = {};

    if (input.autoResolveTimeoutMinutes !== undefined) {
      const val = input.autoResolveTimeoutMinutes;
      if (!Number.isInteger(val) || val < CONFIG_MIN) {
        throw new BadRequestException({
          code: 'INVALID_CONFIG_VALUE',
          message: `${CONFIG_KEY} must be an integer >= ${CONFIG_MIN}.`,
        });
      }
      await this.upsertConfig(repo, CONFIG_KEY, val, adminId);
      changed[CONFIG_KEY] = val;
    }

    if (input.occurrenceDebounceSeconds !== undefined) {
      const val = input.occurrenceDebounceSeconds;
      if (!Number.isInteger(val) || val < DEBOUNCE_CONFIG_MIN) {
        throw new BadRequestException({
          code: 'INVALID_CONFIG_VALUE',
          message: `${DEBOUNCE_CONFIG_KEY} must be an integer >= ${DEBOUNCE_CONFIG_MIN}.`,
        });
      }
      await this.upsertConfig(repo, DEBOUNCE_CONFIG_KEY, val, adminId);
      this.debounceCache = null;
      changed[DEBOUNCE_CONFIG_KEY] = val;
    }

    await this.auditLogsService.logAction({
      userId: adminId ?? undefined,
      actionType: 'security_alert_config_update',
      entityType: 'system_configs',
      severity: AuditLogSeverity.WARNING,
      metadataJson: { changed },
    });

    return this.getAll();
  }

  /** Upsert dùng chung cho cả 2 key số — mirror thân if/else trước khi tách. */
  private async upsertConfig(
    repo: Repository<SystemConfigEntity>,
    key: string,
    val: number,
    adminId: string | null,
  ): Promise<void> {
    const existing = await repo.findOne({ where: { configKey: key } });
    if (existing) {
      existing.configValue = String(val);
      existing.valueType = SystemConfigValueType.NUMBER;
      existing.configGroup = 'security_alerts';
      existing.isActive = true;
      existing.updatedBy = adminId;
      existing.versionNo = (existing.versionNo ?? 1) + 1;
      await repo.save(existing);
    } else {
      await repo.save(
        repo.create({
          configKey: key,
          configValue: String(val),
          valueType: SystemConfigValueType.NUMBER,
          configGroup: 'security_alerts',
          isSensitive: false,
          isActive: true,
          versionNo: 1,
          updatedBy: adminId,
        }),
      );
    }
  }
}
