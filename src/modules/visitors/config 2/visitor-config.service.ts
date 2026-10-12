import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type ApproverMode = 'host_or_manager' | 'manager_only';
export type RateLimitRule = [count: number, windowSeconds: number];

export interface VisitorConfig {
  faceMatchThreshold: number;
  accessBufferMinutes: number;
  maxVisitDays: number;
  overstayEscalateMinutes: number;
  approverMode: ApproverMode;
  defaultZoneCodes: string[];
  purposes: string[];
  photoRetentionDays: number;
  publicRateLimit: { register: RateLimitRule; lookup: RateLimitRule; hosts: RateLimitRule };
  notifyHostEmail: boolean;
  publicHostSearchEnabled: boolean;
}

/** Mặc định = giả định của mockup (spec §6). */
export const VISITOR_CONFIG_DEFAULTS: VisitorConfig = {
  faceMatchThreshold: 0.8,
  accessBufferMinutes: 30,
  maxVisitDays: 7,
  overstayEscalateMinutes: 30,
  approverMode: 'host_or_manager',
  defaultZoneCodes: [],
  purposes: [
    'Làm việc với đơn vị',
    'Hợp tác doanh nghiệp',
    'Giảng viên thỉnh giảng',
    'Phụ huynh liên hệ',
    'Nhà thầu - bảo trì',
    'Giao nhận hồ sơ',
    'Phỏng vấn tuyển dụng',
    'Tham quan - khảo sát',
  ],
  photoRetentionDays: 30,
  publicRateLimit: { register: [5, 600], lookup: [30, 600], hosts: [60, 600] },
  notifyHostEmail: true,
  publicHostSearchEnabled: true,
};

interface ConfigRow {
  config_key: string;
  config_value: string | null;
  config_json: unknown;
}

const CACHE_MS = 30_000;
const positiveNumber = (raw: unknown, fallback: number, allowZero = false): number => {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && (allowZero ? n >= 0 : n > 0) ? n : fallback;
};
const asBool = (raw: unknown, fallback: boolean): boolean => {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
};
const asRule = (raw: unknown, fallback: RateLimitRule): RateLimitRule =>
  Array.isArray(raw) && raw.length === 2 && positiveNumber(raw[0], 0) > 0 && positiveNumber(raw[1], 0) > 0
    ? [Number(raw[0]), Number(raw[1])]
    : fallback;
const asStringArray = (raw: unknown, fallback: string[], allowEmpty = false): string[] =>
  Array.isArray(raw) && raw.every((x) => typeof x === 'string') && (allowEmpty || raw.length > 0) ? (raw as string[]) : fallback;

/**
 * VisitorConfigService — đọc `system_configs` nhóm `visitor`, nhớ đệm 30 giây.
 * Thiếu khóa, sai kiểu hoặc lỗi DB → dùng mặc định, KHÔNG ném (nghiệp vụ khách không được chết vì cấu hình).
 */
@Injectable()
export class VisitorConfigService {
  private readonly logger = new Logger(VisitorConfigService.name);
  private cache: { at: number; value: VisitorConfig } | null = null;

  constructor(private readonly dataSource: DataSource) {}

  async get(): Promise<VisitorConfig> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    let value = VISITOR_CONFIG_DEFAULTS;
    try {
      const rows: ConfigRow[] = await this.dataSource.query(
        `SELECT config_key, config_value, config_json FROM system_configs
          WHERE config_key LIKE 'visitor.%' AND is_active = true`,
      );
      value = this.build(rows);
    } catch (e) {
      this.logger.warn(`Không đọc được cấu hình visitor, dùng mặc định: ${e instanceof Error ? e.message : 'unknown'}`);
    }
    this.cache = { at: Date.now(), value };
    return value;
  }

  invalidate(): void {
    this.cache = null;
  }

  private build(rows: ConfigRow[]): VisitorConfig {
    const raw = new Map<string, unknown>();
    for (const r of rows) raw.set(r.config_key, r.config_json ?? r.config_value);
    const d = VISITOR_CONFIG_DEFAULTS;
    const get = (k: string) => raw.get(`visitor.${k}`);
    const rl = (get('public_rate_limit') ?? {}) as Record<string, unknown>;
    const mode = get('approver_mode');
    const bad = (k: string, v: unknown) => v !== undefined && this.logger.warn(`visitor.${k} sai kiểu, dùng mặc định`);

    const cfg: VisitorConfig = {
      faceMatchThreshold: positiveNumber(get('face_match_threshold'), d.faceMatchThreshold),
      accessBufferMinutes: positiveNumber(get('access_buffer_minutes'), d.accessBufferMinutes, true),
      maxVisitDays: positiveNumber(get('max_visit_days'), d.maxVisitDays),
      overstayEscalateMinutes: positiveNumber(get('overstay_escalate_minutes'), d.overstayEscalateMinutes),
      approverMode: mode === 'manager_only' || mode === 'host_or_manager' ? mode : d.approverMode,
      defaultZoneCodes: asStringArray(get('default_zone_codes'), d.defaultZoneCodes, true),
      purposes: asStringArray(get('purposes'), d.purposes),
      photoRetentionDays: positiveNumber(get('photo_retention_days'), d.photoRetentionDays),
      publicRateLimit: {
        register: asRule(rl.register, d.publicRateLimit.register),
        lookup: asRule(rl.lookup, d.publicRateLimit.lookup),
        hosts: asRule(rl.hosts, d.publicRateLimit.hosts),
      },
      notifyHostEmail: asBool(get('notify_host_email'), d.notifyHostEmail),
      publicHostSearchEnabled: asBool(get('public_host_search_enabled'), d.publicHostSearchEnabled),
    };
    if (cfg.approverMode === d.approverMode) bad('approver_mode', mode === d.approverMode ? undefined : mode);
    return cfg;
  }
}
