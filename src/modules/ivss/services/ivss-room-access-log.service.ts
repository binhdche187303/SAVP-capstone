import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  RoomAccessLogEventDto,
  RoomAccessLogResponseDto,
} from '../dto/room-access-log-response.dto.js';

interface AccessLogRow {
  id: string;
  event_time: Date | string;
  user_id: string | null;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  department_name: string | null;
  room_id: string | null;
  room_name: string | null;
  direction: string | null;
  match_state: string | null;
  similarity: string | null;
  meeting_id: string | null;
}

interface RoomRow {
  room_name: string;
}

interface CountRow {
  total: string;
  matched: string;
  unmatched: string;
}

export interface RoomAccessLogQueryOptions {
  date?: string;
  meetingId?: string;
  page?: number;
  limit?: number;
  search?: string;
}

const FACE_EVENT_TYPES = ['camera_face_event', 'ivss_face_event'];
/** Múi giờ nghiệp vụ — dùng cho CẢ mặc định `date` lẫn biên ngày trong SQL. */
const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/**
 * IvssRoomAccessLogService (RAL-001 / Màn 2) — nhật ký ra/vào theo NGÀY, cho MỘT PHÒNG
 * hoặc TOÀN HỆ THỐNG (ALS-002: `roomId` null → không lọc phòng).
 *
 * Khác Màn 1 (`IvssPresenceQueryService`, góc nhìn theo CUỘC HỌP): ở đây lấy MỌI
 * event nhận diện khuôn mặt trong ngày, KỂ CẢ người không dự họp nào và event chưa
 * khớp danh tính — phục vụ giám sát an ninh.
 *
 * 100% READ-ONLY: không ghi DB, không gọi bridge, không emit WS.
 * SEC-03 bind tham số. SEC-01 KHÔNG lộ ảnh (payload chỉ metadata).
 */
@Injectable()
export class IvssRoomAccessLogService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * YYYY-MM-DD của HÔM NAY THEO GIỜ VIỆT NAM — dùng khi client không truyền `date`.
   *
   * ⚠ KHÔNG dùng getFullYear/getMonth/getDate: chúng theo timezone TIẾN TRÌNH NODE.
   * EC2 chạy UTC ⇒ trong khoảng 00:00–07:00 giờ VN, bản cũ trả về NGÀY HÔM QUA.
   * Cùng bản chất lỗi timezone đã sửa ở biên ngày SQL bên dưới.
   *
   * Dùng Intl.DateTimeFormat('en-CA') — 'en-CA' cho ra sẵn dạng YYYY-MM-DD. Mirror
   * pattern có sẵn ở room-usage-dashboard.service.ts:285 và facegate-time.util.ts:13
   * (tránh cộng tay +7h, vốn sai với code DST-aware).
   */
  private todayStr(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  /**
   * [ALS-002] "Người lạ" = KHÔNG nhận diện được danh tính (userId null) —
   * KHÔNG phải "vào phòng không có lịch" (unmatched_location vẫn CÓ userId,
   * chỉ sai phòng/ngoài giờ họp, người quen chứ không lạ).
   */
  private isStranger(userId: string | null): boolean {
    return userId === null;
  }

  /**
   * [ALS-002] Ngữ nghĩa CŨ của isStranger — giữ lại dưới tên `isUnmatched` để FE
   * đang đọc field cũ không vỡ. Xem doc trong room-access-log-response.dto.ts.
   */
  private isUnmatched(matchState: string | null): boolean {
    return typeof matchState === 'string' && matchState.startsWith('unmatched');
  }

  /**
   * @param roomId null → toàn hệ thống (GET /ivss/access-log); có giá trị → 1 phòng
   *               (GET /ivss/rooms/:roomId/access-log, kiểm tồn tại trước).
   */
  async getRoomAccessLog(
    roomId: string | null,
    options: RoomAccessLogQueryOptions = {},
  ): Promise<RoomAccessLogResponseDto> {
    const day = options.date ?? this.todayStr();
    const meetingId = options.meetingId ?? null;
    const page = options.page ?? DEFAULT_PAGE;
    const limit = options.limit ?? DEFAULT_LIMIT;
    const search = options.search?.trim() ? options.search.trim() : null;
    const offset = (page - 1) * limit;

    let roomName: string | null = null;
    if (roomId) {
      // Phòng phải tồn tại (loại soft-delete) — mirror cách RoomStatusService kiểm.
      const rooms: RoomRow[] = await this.dataSource.manager.query(
        `SELECT room_name FROM rooms WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [roomId],
      );
      if (!rooms[0]) {
        throw new NotFoundException({
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found.',
        });
      }
      roomName = rooms[0].room_name ?? null;
    }

    // LEFT JOIN users: event chưa khớp danh tính có payload_json->>'userId' = NULL
    // (hoặc uid lạ) → full_name null, KHÔNG loại dòng khỏi kết quả (trừ khi có `search`,
    // vì lọc theo tên thì dòng không có tên hiển nhiên không khớp).
    //
    // Biên ngày: [00:00, 24:00) GIỜ VIỆT NAM, KHÔNG phụ thuộc timezone phiên DB.
    // ⚠ RDS production chạy UTC. Để `$2::date` trần thì "ngày 28/7" bị hiểu là
    // 00:00→24:00 UTC = 07:00 sáng 28 → 07:00 sáng 29 giờ VN ⇒ event buổi tối giờ VN
    // rơi nhầm sang ngày hôm sau.
    //
    // ⚠⚠ BẮT BUỘC có `::timestamp` trước `AT TIME ZONE`. Thiếu nó, Postgres ép
    // `date` → `timestamptz` rồi `AT TIME ZONE` chạy CHIỀU NGƯỢC (timestamptz →
    // wall-time), trả `timestamp without time zone` = '2026-07-29 07:00:00' ⇒ biên
    // lệch +7h SAI HƯỚNG, còn tệ hơn bản gốc. Có `::timestamp` thì phép đổi đúng
    // chiều: '00:00 ngày đó giờ VN' → timestamptz '2026-07-28 17:00:00+00'.
    // Đã nghiệm thu bằng psql với SET TIME ZONE 'UTC'.
    const whereSql = `
        WHERE e.event_type = ANY($1::text[])
          AND e.event_time >= ($2::date::timestamp AT TIME ZONE '${BUSINESS_TIMEZONE}')
          AND e.event_time <  (($2::date + interval '1 day')::timestamp AT TIME ZONE '${BUSINESS_TIMEZONE}')
          AND ($3::uuid IS NULL OR e.room_id = $3::uuid)
          AND ($4::text IS NULL OR u.full_name ILIKE '%' || $4::text || '%')
          AND ($5::uuid IS NULL OR e.meeting_id = $5::uuid)`;
    // [FE-2026-08-09] LEFT JOIN departments cho department_name — dùng chung điều kiện
    // JOIN users u đã có sẵn, KHÔNG thêm round-trip/N+1 (vẫn 1 query phẳng cho cả trang).
    const fromSql = `
         FROM iot_device_events e
         LEFT JOIN users u
                ON u.id = NULLIF(e.payload_json->>'userId', '')::uuid
         LEFT JOIN departments d ON d.id = u.department_id
         LEFT JOIN rooms r ON r.id = e.room_id`;
    const filterParams = [FACE_EVENT_TYPES, day, roomId, search, meetingId];

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
              e.room_id                     AS room_id,
              r.room_name                   AS room_name,
              e.payload_json->>'direction'  AS direction,
              e.payload_json->>'matchState' AS match_state,
              e.payload_json->>'similarity' AS similarity,
              e.meeting_id                  AS meeting_id
         ${fromSql}
         ${whereSql}
        ORDER BY e.event_time DESC
        LIMIT $6 OFFSET $7`,
      [...filterParams, limit, offset],
    );

    const events: RoomAccessLogEventDto[] = rows.map((r) => {
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
        roomId: r.room_id ?? null,
        roomName: r.room_name ?? null,
        direction: r.direction ?? null,
        matchState: r.match_state ?? null,
        similarity: Number.isFinite(similarity) ? similarity : null,
        meetingId: r.meeting_id ?? null,
        isStranger: this.isStranger(r.user_id),
        isUnmatched: this.isUnmatched(r.match_state),
      };
    });

    return {
      roomId,
      roomName,
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
