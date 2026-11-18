import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CHANNEL_MAP_CONFIG_ENTRIES,
  findChannelMapConfigEntry,
  type ChannelMapConfigEntry,
} from '../constants/channel-map-config.constant.js';
import { ChannelMapConfigItemDto } from '../dto/channel-map-config-response.dto.js';
import { SystemConfigValueType } from '../entities/system-config.entity.js';
import { AuditLogsService } from './audit-logs.service.js';
import { AuditLogSeverity } from '../entities/audit-log.entity.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL_ID_RE = /^\d+$/;
const DIRECTIONS = ['enter', 'leave', 'seen'];

interface ConfigRow {
  config_value: string | null;
  config_json: Record<string, unknown> | null;
  updated_at: Date;
}

/**
 * ChannelMapConfigService (F7, recon R4/R5) — GET/PATCH cho 7 key `system_configs`
 * dạng chấm (4 channel-map JSON + 3 ngưỡng NUMBER) mà trước đây chỉ set được qua seed
 * DB. Endpoint TÁCH RIÊNG khỏi SystemConfigController/Service (allowlist 9 key phẳng) —
 * xem đầu file `constants/channel-map-config.constant.ts` để biết lý do không gộp.
 *
 * KHÔNG đổi cơ chế ĐỌC của bất kỳ service nào (ivss/gate-access/face-access) — chỉ mở
 * đường GHI, cùng cột (`config_value`/`config_json`) + cùng `config_key` mà các service
 * đó đã đọc từ trước.
 */
@Injectable()
export class ChannelMapConfigService {
  private readonly logger = new Logger(ChannelMapConfigService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async list(): Promise<ChannelMapConfigItemDto[]> {
    const rows: Array<{
      config_key: string;
      config_value: string | null;
      config_json: Record<string, unknown> | null;
      updated_at: Date;
    }> = await this.dataSource.manager.query(
      `SELECT config_key, config_value, config_json, updated_at
       FROM system_configs
       WHERE config_key = ANY($1::text[]) AND is_active = true`,
      [CHANNEL_MAP_CONFIG_ENTRIES.map((e) => e.key)],
    );
    const byKey = new Map(rows.map((r) => [r.config_key, r]));

    return CHANNEL_MAP_CONFIG_ENTRIES.map((entry) => {
      const row = byKey.get(entry.key);
      let value: Record<string, string> | number | null = null;
      if (row) {
        if (entry.kind === 'threshold') {
          const n = row.config_value != null ? Number(row.config_value) : NaN;
          value = Number.isFinite(n) ? n : null;
        } else {
          value = (row.config_json as Record<string, string>) ?? null;
        }
      }
      return {
        key: entry.key,
        kind: entry.kind,
        value,
        configGroup: entry.configGroup,
        description: entry.description,
        updatedAt: row?.updated_at ?? null,
      };
    });
  }

  async upsert(
    key: string,
    value: unknown,
    userId: string | undefined,
  ): Promise<ChannelMapConfigItemDto> {
    const entry = findChannelMapConfigEntry(key);
    if (!entry) {
      throw new BadRequestException({
        success: false,
        message: `Key cấu hình '${key}' không nằm trong danh sách channel-map.`,
        error: { code: 'CHANNEL_MAP_KEY_NOT_ALLOWED', details: { key } },
      });
    }

    const { configValue, configJson } = await this.validateAndNormalize(
      entry,
      value,
    );

    let result: ConfigRow & { config_key: string };

    await this.dataSource.transaction(async (em) => {
      // Mirror SystemConfigService.upsert: config_key KHÔNG có unique index trên RDS
      // thật → SELECT FOR UPDATE thủ công thay vì ON CONFLICT.
      const rows: Array<{ id: string; updated_at: Date }> = await em.query(
        `SELECT id, updated_at FROM system_configs WHERE config_key = $1 FOR UPDATE`,
        [key],
      );

      if (rows.length > 1) {
        this.logger.warn(
          `system_configs.config_key='${key}' có ${rows.length} dòng trùng (thiếu unique index) — cập nhật dòng mới nhất, không tạo thêm.`,
        );
      }

      const target =
        rows.length > 0
          ? rows.reduce((latest, r) =>
              r.updated_at > latest.updated_at ? r : latest,
            )
          : null;

      const valueType =
        entry.kind === 'map'
          ? SystemConfigValueType.JSON
          : SystemConfigValueType.NUMBER;

      if (target) {
        const updated: Array<{
          config_key: string;
          config_value: string | null;
          config_json: Record<string, unknown> | null;
          updated_at: Date;
        }> = await em.query(
          `UPDATE system_configs
             SET config_value = $2, config_json = $3::jsonb, value_type = $4,
                 config_group = $5, description = $6, is_active = true,
                 updated_by = $7, version_no = COALESCE(version_no, 1) + 1
           WHERE id = $1
           RETURNING config_key, config_value, config_json, updated_at`,
          [
            target.id,
            configValue,
            configJson ? JSON.stringify(configJson) : null,
            valueType,
            entry.configGroup,
            entry.description,
            userId ?? null,
          ],
        );
        result = updated[0];
      } else {
        const inserted: Array<{
          config_key: string;
          config_value: string | null;
          config_json: Record<string, unknown> | null;
          updated_at: Date;
        }> = await em.query(
          `INSERT INTO system_configs
             (config_key, config_value, config_json, value_type, config_group,
              description, is_sensitive, is_active, version_no, updated_by)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, false, true, 1, $7)
           RETURNING config_key, config_value, config_json, updated_at`,
          [
            key,
            configValue,
            configJson ? JSON.stringify(configJson) : null,
            valueType,
            entry.configGroup,
            entry.description,
            userId ?? null,
          ],
        );
        result = inserted[0];
      }
    });

    await this.auditLogsService.logAction({
      userId,
      actionType: 'channel_map_config_update',
      entityType: 'system_configs',
      severity: AuditLogSeverity.WARNING,
      metadataJson: { key, value },
    });

    return {
      key: entry.key,
      kind: entry.kind,
      value:
        entry.kind === 'threshold'
          ? Number(result!.config_value)
          : ((result!.config_json as Record<string, string>) ?? null),
      configGroup: entry.configGroup,
      description: entry.description,
      updatedAt: result!.updated_at,
    };
  }

  private async validateAndNormalize(
    entry: ChannelMapConfigEntry,
    value: unknown,
  ): Promise<{
    configValue: string | null;
    configJson: Record<string, string> | null;
  }> {
    if (entry.kind === 'threshold') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new BadRequestException({
          success: false,
          message: `Value cho key '${entry.key}' phải là số nguyên dương (>0).`,
          error: {
            code: 'INVALID_CHANNEL_MAP_VALUE',
            details: { key: entry.key, field: 'value', value },
          },
        });
      }
      return { configValue: String(value), configJson: null };
    }

    // kind === 'map'
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException({
        success: false,
        message: `Value cho key '${entry.key}' phải là object dạng {"<channelId số>": "<giá trị>"}.`,
        error: {
          code: 'INVALID_CHANNEL_MAP_VALUE',
          details: { key: entry.key, field: 'value' },
        },
      });
    }

    const obj = value as Record<string, unknown>;
    const normalized: Record<string, string> = {};

    for (const [channelIdStr, entryValue] of Object.entries(obj)) {
      if (!CHANNEL_ID_RE.test(channelIdStr)) {
        throw new BadRequestException({
          success: false,
          message: `Key cấu hình '${entry.key}': channelId '${channelIdStr}' phải là số.`,
          error: {
            code: 'INVALID_CHANNEL_MAP_VALUE',
            details: { key: entry.key, field: `value.${channelIdStr}` },
          },
        });
      }
      if (typeof entryValue !== 'string' || entryValue.length === 0) {
        throw new BadRequestException({
          success: false,
          message: `Key cấu hình '${entry.key}': value cho channel '${channelIdStr}' phải là chuỗi.`,
          error: {
            code: 'INVALID_CHANNEL_MAP_VALUE',
            details: { key: entry.key, field: `value.${channelIdStr}` },
          },
        });
      }

      if (entry.mapEntryKind === 'direction') {
        if (!DIRECTIONS.includes(entryValue)) {
          throw new BadRequestException({
            success: false,
            message: `Key cấu hình '${entry.key}': direction cho channel '${channelIdStr}' phải là enter/leave/seen.`,
            error: {
              code: 'INVALID_CHANNEL_MAP_VALUE',
              details: { key: entry.key, field: `value.${channelIdStr}` },
            },
          });
        }
      } else {
        if (!UUID_RE.test(entryValue)) {
          throw new BadRequestException({
            success: false,
            message: `Key cấu hình '${entry.key}': value cho channel '${channelIdStr}' phải là UUID hợp lệ.`,
            error: {
              code: 'INVALID_CHANNEL_MAP_VALUE',
              details: { key: entry.key, field: `value.${channelIdStr}` },
            },
          });
        }
      }

      normalized[channelIdStr] = entryValue;
    }

    if (
      entry.mapEntryKind === 'room_uuid' ||
      entry.mapEntryKind === 'zone_uuid'
    ) {
      await this.validateEntitiesExist(entry, normalized);
    }

    await this.assertNoRoleConflict(entry, normalized);

    return { configValue: null, configJson: normalized };
  }

  /**
   * [FIX 2026-08-11] Chặn LƯU nếu 1 channel bị gán trùng vai — CÙNG channelId xuất hiện ở
   * CẢ `entry.key` (map sắp ghi) lẫn `entry.conflictsWithKey` (map đối nghịch, đọc TRỰC
   * TIẾP từ `system_configs` vì PATCH chỉ ghi 1 key/request — payload đang gửi KHÔNG chứa
   * map kia). CHỈ chạy khi `entry.conflictsWithKey` có giá trị (room_map ↔
   * presence_zone_map) — 5 key còn lại (zone_map/direction_map/3 threshold) bỏ qua hoàn
   * toàn, không query gì thêm.
   *
   * So `normalized` (map SẮP được lưu, không phải map cũ) với map đối nghịch HIỆN CÓ
   * trong DB — đúng trạng thái sẽ tồn tại NẾU request này thành công.
   */
  private async assertNoRoleConflict(
    entry: ChannelMapConfigEntry,
    normalized: Record<string, string>,
  ): Promise<void> {
    if (!entry.conflictsWithKey) return;

    const rows: Array<{ config_json: Record<string, unknown> | null }> =
      await this.dataSource.manager.query(
        `SELECT config_json FROM system_configs WHERE config_key = $1 AND is_active = true LIMIT 1`,
        [entry.conflictsWithKey],
      );
    const otherMap = rows[0]?.config_json ?? {};
    const conflictChannelIds = Object.keys(normalized).filter((chId) =>
      Object.prototype.hasOwnProperty.call(otherMap, chId),
    );

    if (conflictChannelIds.length > 0) {
      throw new BadRequestException({
        success: false,
        message: `Channel ${conflictChannelIds.join(', ')} đã được gán cho '${entry.conflictsWithKey}' — 1 camera chỉ nên đóng 1 vai (phòng họp HOẶC khu vực hiện diện), không thể gán cả 2. Gỡ channel khỏi 1 trong 2 map trước khi lưu.`,
        error: {
          code: 'CHANNEL_MAP_ROLE_CONFLICT',
          details: {
            key: entry.key,
            conflictsWithKey: entry.conflictsWithKey,
            channelIds: conflictChannelIds,
          },
        },
      });
    }
  }

  /** Kiểm room_id/zone_id tồn tại (chưa xóa mềm) trước khi cho ghi map. */
  private async validateEntitiesExist(
    entry: ChannelMapConfigEntry,
    normalized: Record<string, string>,
  ): Promise<void> {
    const ids = [...new Set(Object.values(normalized))];
    if (ids.length === 0) return;

    const rows: Array<{ id: string }> =
      entry.mapEntryKind === 'room_uuid'
        ? await this.dataSource.manager.query(
            `SELECT id FROM rooms WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
            [ids],
          )
        : await this.dataSource.manager.query(
            `SELECT id FROM zones WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
            [ids],
          );
    const found = new Set(rows.map((r) => r.id));
    const entityLabel = entry.mapEntryKind === 'room_uuid' ? 'room' : 'zone';

    for (const [channelIdStr, id] of Object.entries(normalized)) {
      if (!found.has(id)) {
        throw new BadRequestException({
          success: false,
          message: `Key cấu hình '${entry.key}': ${entityLabel} '${id}' (channel '${channelIdStr}') không tồn tại hoặc đã xóa.`,
          error: {
            code: 'CHANNEL_MAP_ENTITY_NOT_FOUND',
            details: { key: entry.key, field: `value.${channelIdStr}`, id },
          },
        });
      }
    }
  }
}
