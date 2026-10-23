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
  ): Promise<{ items: UnknownVehicleItem[]; meta: PaginationMeta }> {
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

    // total: COUNT cùng WHERE (KHÔNG limit/offset).
    const countRows: CountRow[] = await this.dataSource.manager.query(
      `SELECT COUNT(*)::int AS total FROM iot_device_events WHERE ${where}`,
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
         LEFT JOIN iot_devices anpr_device ON anpr_device.id = iot_device_events.device_id
         LEFT JOIN zones event_zone ON event_zone.id = iot_device_events.zone_id
                                   AND event_zone.deleted_at IS NULL
        WHERE ${where}
        ORDER BY iot_device_events.event_time DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset],
    );

    return {
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
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
