import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ListUnknownVehiclesQueryDto } from '../dto/list-unknown-vehicles-query.dto.js';
import {
  CONTROL_LIST_FLAG_COLUMNS,
  CONTROL_LIST_FLAG_JOIN,
} from '../utils/control-list-flag.sql.js';

interface UnknownRow {
  id: string;
  plate_number: string | null;
  channel_id: number | null;
  direction: string | null;
  event_time: Date;
  utc: string | null;
  plate_color: string | null;
  vehicle_type: string | null;
  is_blacklisted: boolean;
  list_type: string | null;
  zone_name: string | null;
  camera_name: string | null;
  sighting_count?: number | null;
}
interface CountRow {
  total: number;
}

const VEHICLE_EVENT_TYPES = ['ivss_vehicle_event', 'camera_vehicle_event'];
const VEHICLE_EVENT_TYPE_SQL = VEHICLE_EVENT_TYPES.map(
  (_, idx) => `$${idx + 1}`,
).join(', ');

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Số liệu tổng hợp theo bộ lọc hiện tại (không tính bộ lọc danh sách kiểm soát). */
export interface UnknownVehicleStats {
  total: number;
  controlled: number;
  distinctPlates: number;
  repeatPlates: number;
}

/** Số đếm cạnh từng lựa chọn của các ô lọc (mỗi ô bỏ qua chính bộ lọc của nó). */
export interface UnknownVehicleFacets {
  direction: { all: number; in: number; out: number };
  flag: { all: number; controlled: number; normal: number };
  view: { all: number; distinct: number; repeat: number };
}

// Hướng vào/ra: dữ liệu có thể là gateDirection (in/out) hoặc direction thô (enter/leave, ENTRY/EXIT).
const DIRECTION_SQL = `LOWER(COALESCE(iot_device_events.payload_json->>'gateDirection', iot_device_events.payload_json->>'direction'))`;
const DIRECTION_VALUES: Record<'in' | 'out', string[]> = {
  in: ['in', 'enter', 'entry'],
  out: ['out', 'leave', 'exit'],
};

export interface UnknownVehicleItem {
  /** iot_device_events.id — FE dùng để gọi GET ivss/device-events/:id/snapshot (404 nếu không có ảnh). */
  id: string;
  plateNumber: string | null;
  channelId: number | null;
  direction: string | null;
  eventTime: Date;
  utc: string | null;
  plateColor: string | null;
  vehicleType: string | null;
  /**
   * STT 19: true nếu biển nằm trong vehicle_control_list (active) TẠI thời điểm xe qua —
   * xem utils/control-list-flag.sql.ts (thay JOIN security_alerts cũ, vốn sai cho lượt sau).
   */
  isBlacklisted: boolean;
  /** vehicle_control_list.list_type ('blocklist' ưu tiên | 'watchlist'); null nếu isBlacklisted=false. */
  listType: string | null;
  zoneName: string | null;
  cameraName: string | null;
  /** Chỉ có khi gom theo biển (view=distinct|repeat): số lần biển xuất hiện trong phạm vi lọc. */
  sightingCount?: number;
}

/**
 * VehicleUnknownService (VUN-001 / UC6) — admin xem danh sách biển lạ (unmatched) đã ghi bởi UC5.
 *
 * Read-only: query iot_device_events (raw SQL, mirror face unmapped-review).
 * DATA-01 C1-isolation: CHỈ event_type='ivss_vehicle_event' AND payload_json->>'matchState'='unmatched'
 *   → KHÔNG nhiễm face. JSON path TOP-LEVEL (UC5 lưu top-level, KHÁC face extracted_fields).
 * SEC-03: bind tham số (from/to/limit/offset). SEC-01: KHÔNG imageBase64 (UC5 vốn không lưu).
 * KHÔNG dùng VehicleRegistrationService (raw query riêng).
 *
 * isBlacklisted/listType (STT 19, 2026-10-08): LATERAL vehicle_control_list theo biển +
 * thời điểm — fragment dùng chung với VehicleHistoryService (utils/control-list-flag.sql.ts).
 * KHÔNG đụng luồng ghi (onVehicleEvent()/evaluate()).
 */
@Injectable()
export class VehicleUnknownService {
  constructor(private readonly dataSource: DataSource) {}

  async listUnknown(
    query: ListUnknownVehiclesQueryDto,
  ): Promise<{
    items: UnknownVehicleItem[];
    meta: PaginationMeta;
    stats: UnknownVehicleStats;
    facets: UnknownVehicleFacets;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    // WHERE base = literal (KHÔNG user input). Time-range build động → bind ($1, $2...).
    // `iot_device_events.` prefix BẮT BUỘC (KHÔNG chỉ để rõ ràng) — dùng chung cho cả
    // COUNT (không JOIN) lẫn rows (có LATERAL vehicle_control_list tham chiếu thẳng
    // iot_device_events.*). Xem VehicleHistoryService cho lý do đầy đủ.
    const params: unknown[] = [...VEHICLE_EVENT_TYPES];
    let where = `iot_device_events.event_type IN (${VEHICLE_EVENT_TYPE_SQL}) AND iot_device_events.payload_json->>'matchState' = 'unmatched'`;
    if (query.from) {
      params.push(query.from);
      where += ` AND iot_device_events.event_time >= $${params.length}`;
    }
    if (query.to) {
      params.push(query.to);
      where += ` AND iot_device_events.event_time <= $${params.length}`;
    }
    const plateQuery = (query.q ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (plateQuery) {
      params.push(`%${plateQuery}%`);
      where += ` AND REGEXP_REPLACE(UPPER(COALESCE(iot_device_events.payload_json->>'plateNumber', '')), '[^A-Z0-9]', '', 'g') LIKE $${params.length}`;
    }
    // Điều kiện trước bộ lọc hướng — dùng đếm số lượt theo từng hướng (faceted count).
    const preDirectionWhere = where;
    const preDirectionParams = [...params];
    if (query.direction) {
      params.push(DIRECTION_VALUES[query.direction]);
      where += ` AND ${DIRECTION_SQL} = ANY($${params.length}::text[])`;
    }
    // Số liệu thống kê tính trên bộ lọc cơ bản (trước bộ lọc danh sách kiểm soát) để thẻ
    // "Thuộc danh sách kiểm soát" luôn cho thấy tỷ lệ trên tổng.
    const baseWhere = where;
    const baseParams = [...params];
    // Bộ lọc danh sách kiểm soát cần JOIN vehicle_control_list (cột vcl.list_type).
    const needsFlagJoin = !!query.flag;
    const flagCondition =
      query.flag === 'controlled' ? ' AND vcl.list_type IS NOT NULL'
        : query.flag === 'normal' ? ' AND vcl.list_type IS NULL'
          : '';
    where += flagCondition;

    // Chế độ gom theo biển (thẻ "Biển số khác nhau" / "Xuất hiện nhiều lần"): mỗi biển 1 dòng —
    // lần xuất hiện gần nhất — kèm tổng số lần xuất hiện trong phạm vi bộ lọc hiện tại.
    const view = query.view;
    const pickJoin = view
      ? `JOIN (
           SELECT DISTINCT ON (scoped.plate) scoped.id, scoped.sighting_count
             FROM (
               SELECT iot_device_events.id,
                      iot_device_events.payload_json->>'plateNumber' AS plate,
                      iot_device_events.event_time,
                      COUNT(*) OVER (PARTITION BY iot_device_events.payload_json->>'plateNumber') AS sighting_count
                 FROM iot_device_events
                 ${needsFlagJoin ? CONTROL_LIST_FLAG_JOIN : ''}
                WHERE ${where}
             ) scoped
            ${view === 'repeat' ? 'WHERE scoped.sighting_count > 1' : ''}
            ORDER BY scoped.plate, scoped.event_time DESC
         ) pick ON pick.id = iot_device_events.id`
      : '';

    // total: COUNT cùng WHERE (KHÔNG limit/offset).
    const countRows: CountRow[] = await this.dataSource.manager.query(
      `SELECT COUNT(*)::int AS total FROM iot_device_events ${needsFlagJoin ? CONTROL_LIST_FLAG_JOIN : ''} ${pickJoin} WHERE ${where}`,
      params,
    );
    const total = countRows[0]?.total ?? 0;

    // rows: thêm limit/offset SAU params động → bind index liên tục.
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const rows: UnknownRow[] = await this.dataSource.manager.query(
      `SELECT iot_device_events.id,
              iot_device_events.payload_json->>'plateNumber'        AS plate_number,
              (iot_device_events.payload_json->>'channelId')::int   AS channel_id,
              -- [FIX 2026-08-11, B4] Ưu tiên gateDirection (channel_direction_map, giá trị
              -- ĐÚNG dùng ghi gate_access_logs) — fallback direction (raw, eventAction) cho
              -- dữ liệu CŨ ghi trước fix này (mirror VehicleHistoryService).
              COALESCE(
                iot_device_events.payload_json->>'gateDirection',
                iot_device_events.payload_json->>'direction'
              )                                                     AS direction,
              iot_device_events.event_time,
              iot_device_events.payload_json->>'utc'                AS utc,
              iot_device_events.payload_json->>'plateColor'         AS plate_color,
              iot_device_events.payload_json->>'vehicleType'        AS vehicle_type,
              ${CONTROL_LIST_FLAG_COLUMNS}
              ,${view ? 'pick.sighting_count::int' : 'NULL::int'} AS sighting_count
              ,COALESCE(event_zone.zone_name, (SELECT z.zone_name
                  FROM system_configs sc
                  JOIN zones z ON z.id::text = sc.config_json->>(iot_device_events.payload_json->>'channelId')
                 WHERE sc.config_key = 'ivss.channel_zone_map'
                   AND sc.is_active = true
                   AND z.deleted_at IS NULL
                 LIMIT 1)) AS zone_name
              ,COALESCE((SELECT camera.camera_name
                  FROM system_configs sc
                  CROSS JOIN LATERAL jsonb_each_text(COALESCE(sc.config_json, '{}'::jsonb)) camera(camera_name, mapped_channel)
                 WHERE sc.config_key = 'hgvision.camera_channel_map'
                   AND sc.is_active = true
                   AND camera.mapped_channel = iot_device_events.payload_json->>'channelId'
                 LIMIT 1), NULLIF(anpr_device.device_name, '')) AS camera_name
         FROM iot_device_events
         ${CONTROL_LIST_FLAG_JOIN}
         ${pickJoin}
         LEFT JOIN iot_devices anpr_device ON anpr_device.id = iot_device_events.device_id
         LEFT JOIN zones event_zone ON event_zone.id = iot_device_events.zone_id
                                   AND event_zone.deleted_at IS NULL
        WHERE ${where}
        ORDER BY iot_device_events.event_time DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset],
    );

    // Thẻ số liệu: tổng lượt, lượt thuộc danh sách kiểm soát, số biển khác nhau, số biển lặp lại.
    const statRows: Array<Record<string, number | string | null>> = await this.dataSource.manager.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE base.list_type IS NOT NULL)::int AS controlled,
              COUNT(DISTINCT base.plate)::int AS distinct_plates,
              COUNT(DISTINCT base.plate) FILTER (WHERE base.plate_count > 1)::int AS repeat_plates
         FROM (
           SELECT iot_device_events.payload_json->>'plateNumber' AS plate,
                  vcl.list_type,
                  COUNT(*) OVER (PARTITION BY iot_device_events.payload_json->>'plateNumber') AS plate_count
             FROM iot_device_events
             ${CONTROL_LIST_FLAG_JOIN}
            WHERE ${baseWhere}
         ) base`,
      baseParams,
    );
    const stat = statRows[0] ?? {};
    const stats: UnknownVehicleStats = {
      total: Number(stat.total ?? 0),
      controlled: Number(stat.controlled ?? 0),
      distinctPlates: Number(stat.distinct_plates ?? 0),
      repeatPlates: Number(stat.repeat_plates ?? 0),
    };

    // Số đếm cạnh từng lựa chọn của bộ lọc (faceted): mỗi ô đếm theo các bộ lọc KHÁC, bỏ qua chính nó.
    // Mảng hướng là hằng số trong code (không phải dữ liệu người dùng).
    const inValues = DIRECTION_VALUES.in.map((v) => `'${v}'`).join(', ');
    const outValues = DIRECTION_VALUES.out.map((v) => `'${v}'`).join(', ');
    const directionRows: Array<Record<string, number | null>> = await this.dataSource.manager.query(
      `SELECT COUNT(*)::int AS dir_all,
              COUNT(*) FILTER (WHERE ${DIRECTION_SQL} IN (${inValues}))::int AS dir_in,
              COUNT(*) FILTER (WHERE ${DIRECTION_SQL} IN (${outValues}))::int AS dir_out
         FROM iot_device_events
         ${needsFlagJoin ? CONTROL_LIST_FLAG_JOIN : ''}
        WHERE ${preDirectionWhere}${flagCondition}`,
      preDirectionParams,
    );
    const viewRows: Array<Record<string, number | null>> = await this.dataSource.manager.query(
      `SELECT COUNT(*)::int AS view_all,
              COUNT(DISTINCT scoped.plate)::int AS view_distinct,
              COUNT(DISTINCT scoped.plate) FILTER (WHERE scoped.plate_count > 1)::int AS view_repeat
         FROM (
           SELECT iot_device_events.payload_json->>'plateNumber' AS plate,
                  COUNT(*) OVER (PARTITION BY iot_device_events.payload_json->>'plateNumber') AS plate_count
             FROM iot_device_events
             ${needsFlagJoin ? CONTROL_LIST_FLAG_JOIN : ''}
            WHERE ${where}
         ) scoped`,
      params,
    );
    const dir = directionRows[0] ?? {};
    const vw = viewRows[0] ?? {};
    const facets: UnknownVehicleFacets = {
      direction: { all: Number(dir.dir_all ?? 0), in: Number(dir.dir_in ?? 0), out: Number(dir.dir_out ?? 0) },
      flag: { all: stats.total, controlled: stats.controlled, normal: Math.max(0, stats.total - stats.controlled) },
      view: { all: Number(vw.view_all ?? 0), distinct: Number(vw.view_distinct ?? 0), repeat: Number(vw.view_repeat ?? 0) },
    };

    return {
      stats,
      facets,
      items: rows.map((r) => ({
        id: r.id,
        plateNumber: r.plate_number,
        channelId: r.channel_id,
        direction: r.direction,
        eventTime: r.event_time,
        utc: r.utc,
        plateColor: r.plate_color,
        vehicleType: r.vehicle_type,
        isBlacklisted: r.is_blacklisted,
        listType: r.list_type,
        zoneName: r.zone_name,
        cameraName: r.camera_name,
        ...(view ? { sightingCount: Number(r.sighting_count ?? 1) } : {}),
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
