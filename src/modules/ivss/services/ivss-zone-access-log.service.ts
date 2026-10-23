import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  ZoneAccessLogEventDto,
  ZoneAccessLogResponseDto,
} from '../dto/zone-access-log-response.dto.js';

interface AccessLogRow {
  id: string;
  event_time: Date | string;
  user_id: string | null;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  department_name: string | null;
  direction: string | null;
  match_state: string | null;
  similarity: string | null;
  device_id: string | null;
  device_code: string | null;
  device_name: string | null;
  group_names: string[] | null;
}

interface ZoneRow {
  zone_name: string;
}

interface CountRow {
  total: string;
  matched: string;
  unmatched: string;
}

export interface ZoneAccessLogQueryOptions {
  date?: string;
  page?: number;
  limit?: number;
  search?: string;
}

const FACE_EVENT_TYPE = 'ivss_face_event';
/** Múi giờ nghiệp vụ — dùng cho CẢ mặc định `date` lẫn biên ngày trong SQL. */
const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/**
 * IvssZoneAccessLogService (Zone Access Log — đường B, FIX 2026-08-11) — nhật ký ra/vào
 * theo NGÀY, cho MỘT zone khu vực. Mirror gần như 1:1 `IvssRoomAccessLogService` (RAL-001 /
 * Màn 2) — đổi `room_id`→`zone_id`, `room_name`→`zone_name`, JOIN `rooms`→JOIN `zones`.
 *
 * Khác bản room: (1) KHÔNG có route "toàn hệ thống" (`zoneId` luôn bắt buộc — chỉ 1
 * endpoint theo yêu cầu, không cần nhánh room_id=null); (2) KHÔNG có filter `meetingId`
 * (zone khu vực không gắn cuộc họp — khác room).
 *
 * Đọc TRỰC TIẾP `iot_device_events.zone_id` (mới populate — xem
 * `ivss-presence-ingestion.service.ts`, INSERT `onFaceEvent()`) — CHỦ Ý KHÔNG đụng
 * `zone_presence_events`/`writeAppearEvent()`/`restricted-zone-intrusion` (đường A đã
 * recon riêng, có hệ quả nhiễu cảnh báo cần quyết định sản phẩm — ngoài phạm vi việc này).
 * `iot_device_events` vốn đã ghi CẢ người lạ (`payload_json->>'userId'` NULL) từ trước,
 * độc lập hoàn toàn với `zone_presence_events` — nên "hiển thị cả người quen lẫn người lạ"
 * đạt được ngay mà KHÔNG cần mở `user_id` NULL cho `zone_presence_events`.
 *
 * 100% READ-ONLY: không ghi DB, không gọi bridge, không emit WS.
 * SEC-03 bind tham số. SEC-01 KHÔNG lộ ảnh (payload chỉ metadata).
 */
@Injectable()
export class IvssZoneAccessLogService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * YYYY-MM-DD của HÔM NAY THEO GIỜ VIỆT NAM — dùng khi client không truyền `date`.
   * Mirror `IvssRoomAccessLogService.todayStr()` — Intl.DateTimeFormat('en-CA'), KHÔNG
   * getFullYear/getMonth/getDate (sai timezone trên EC2 chạy UTC).
   */
  private todayStr(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  /** "Người lạ" = KHÔNG nhận diện được danh tính (userId null) — mirror RAL-001/ALS-002. */
  private isStranger(userId: string | null): boolean {
    return userId === null;
  }

  /** Ngữ nghĩa `isUnmatched` — matchState bắt đầu bằng 'unmatched'. Mirror RAL-001/ALS-002. */
  private isUnmatched(matchState: string | null): boolean {
    return typeof matchState === 'string' && matchState.startsWith('unmatched');
  }

  async getZoneAccessLog(
    zoneId: string,
    options: ZoneAccessLogQueryOptions = {},
  ): Promise<ZoneAccessLogResponseDto> {
    const day = options.date ?? this.todayStr();
    const page = options.page ?? DEFAULT_PAGE;
    const limit = options.limit ?? DEFAULT_LIMIT;
    const search = options.search?.trim() ? options.search.trim() : null;
    const offset = (page - 1) * limit;

    // Zone phải tồn tại (loại soft-delete) — mirror cách RoomAccessLogService kiểm.
    const zones: ZoneRow[] = await this.dataSource.manager.query(
      `SELECT zone_name FROM zones WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [zoneId],
    );
    if (!zones[0]) {
      throw new NotFoundException({
        code: 'ZONE_NOT_FOUND',
        message: 'Zone not found.',
      });
    }
    const zoneName = zones[0].zone_name ?? null;

    // LEFT JOIN users: event chưa khớp danh tính có payload_json->>'userId' = NULL (hoặc
    // uid lạ) → full_name null, KHÔNG loại dòng khỏi kết quả (trừ khi có `search`).
    //
    // Biên ngày: [00:00, 24:00) GIỜ VIỆT NAM — mirror chính xác RAL-001 (đã nghiệm thu
    // bằng psql với SET TIME ZONE 'UTC', xem comment gốc ivss-room-access-log.service.ts).
    const whereSql = `
        WHERE e.event_type = $1
          AND e.event_time >= ($2::date::timestamp AT TIME ZONE '${BUSINESS_TIMEZONE}')
          AND e.event_time <  (($2::date + interval '1 day')::timestamp AT TIME ZONE '${BUSINESS_TIMEZONE}')
          AND e.zone_id = $3::uuid
          AND ($4::text IS NULL OR u.full_name ILIKE '%' || $4::text || '%')`;
    const fromSql = `
         FROM iot_device_events e
         LEFT JOIN users u
                ON u.id = NULLIF(e.payload_json->>'userId', '')::uuid
         LEFT JOIN departments d ON d.id = u.department_id
         LEFT JOIN iot_devices dv ON dv.id = e.device_id`;
    const filterParams = [FACE_EVENT_TYPE, day, zoneId, search];

    // Đếm trên TOÀN BỘ kết quả lọc (không chỉ trang hiện tại) — matched/unmatched phải
    // phản ánh cả ngày, nếu đếm trong trang thì số liệu vô nghĩa khi phân trang.
    const countRows: CountRow[] = await this.dataSource.manager.query(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (
                WHERE e.payload_json->>'matchState' = 'matched'
              )::text AS matched,
              COUNT(*) FILTER (
                WHERE e.payload_json->>'matchState' LIKE 'unmatched%'
              )::text AS unmatched
         ${fromSql}
         ${whereSql}`,
      filterParams,
    );
    const total = parseInt(countRows[0]?.total ?? '0', 10);
    const matchedCount = parseInt(countRows[0]?.matched ?? '0', 10);
    const unmatchedCount = parseInt(countRows[0]?.unmatched ?? '0', 10);

    const rows: AccessLogRow[] = await this.dataSource.manager.query(
      `SELECT e.id,
              e.event_time,
              e.payload_json->>'userId'     AS user_id,
              u.full_name                   AS full_name,
              u.avatar_url                  AS avatar_url,
              u.email                       AS email,
              d.department_name             AS department_name,
              e.payload_json->>'direction'  AS direction,
              e.payload_json->>'matchState' AS match_state,
              e.payload_json->>'similarity' AS similarity,
              e.device_id                   AS device_id,
              dv.device_code                AS device_code,
              dv.device_name                AS device_name,
              (SELECT array_agg(cg.group_name ORDER BY cg.group_name)
                 FROM camera_group_members cgm JOIN camera_groups cg ON cg.id = cgm.group_id
                WHERE cgm.device_id = e.device_id) AS group_names
         ${fromSql}
         ${whereSql}
        ORDER BY e.event_time DESC
        LIMIT $5 OFFSET $6`,
      [...filterParams, limit, offset],
    );

    const events: ZoneAccessLogEventDto[] = rows.map((r) => {
      const similarity = r.similarity === null ? null : Number(r.similarity);
      return {
        id: r.id,
        eventTime: new Date(r.event_time).toISOString(),
        userId: r.user_id ?? null,
        fullName: r.full_name ?? null,
        user: r.user_id
          ? {
              avatarUrl: r.avatar_url ?? null,
              email: r.email ?? null,
              department: r.department_name ?? null,
            }
          : null,
        zoneId,
        zoneName,
        direction: r.direction ?? null,
        matchState: r.match_state ?? null,
        similarity: Number.isFinite(similarity) ? similarity : null,
        deviceId: r.device_id ?? null,
        deviceCode: r.device_code ?? null,
        deviceName: r.device_name ?? null,
        groupNames: r.group_names ?? [],
        isStranger: this.isStranger(r.user_id),
        isUnmatched: this.isUnmatched(r.match_state),
      };
    });

    return {
      zoneId,
      zoneName,
      date: day,
      totalEvents: total,
      matchedCount,
      unmatchedCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
      },
      events,
    };
  }
}
