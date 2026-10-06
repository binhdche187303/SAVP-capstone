import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { normalizePlate } from '../utils/normalize-plate.js';
import type { ListVehicleHistoryQueryDto } from '../dto/list-vehicle-history-query.dto.js';
import {
  CONTROL_LIST_FLAG_COLUMNS,
  CONTROL_LIST_FLAG_JOIN,
} from '../utils/control-list-flag.sql.js';

interface HistoryRow {
  id: string;
  plate_number: string | null;
  channel_id: number | null;
  direction: string | null;
  match_state: string | null;
  event_time: Date;
  utc: string | null;
  is_blacklisted: boolean;
  list_type: string | null;
  user_id?: string | null;
  owner_id?: string | null;
  owner_full_name?: string | null;
  owner_avatar_url?: string | null;
  owner_email?: string | null;
  owner_department?: string | null;
}
interface CountRow {
  total: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface VehicleHistoryItem {
  /** iot_device_events.id — FE dùng để gọi GET ivss/device-events/:id/snapshot (404 nếu không có ảnh). */
  id: string;
  plateNumber: string | null;
  channelId: number | null;
  direction: string | null;
  matchState: string | null;
  eventTime: Date;
  utc: string | null;
  /**
   * STT 19: true nếu biển nằm trong vehicle_control_list (active) TẠI thời điểm xe qua —
   * xem utils/control-list-flag.sql.ts (thay JOIN security_alerts cũ, vốn sai cho lượt sau).
   */
  isBlacklisted: boolean;
  /** vehicle_control_list.list_type ('blocklist' ưu tiên | 'watchlist'); null nếu isBlacklisted=false. */
  listType: string | null;
  userId?: string | null; // CHỈ admin (listAll)
  /**
   * Thông tin đầy đủ chủ xe (yêu cầu FE 2026-08-08) — CHỈ admin (listAll), LEFT JOIN
   * users/departments qua payload_json->>'userId'. null nếu unmatched (chưa xác định
   * chủ xe) hoặc user đã bị xóa khỏi bảng users. KHÔNG có ở listForUser (privacy-by-
   * design — xem comment userId, và DTO ownerName).
   */
  owner?: VehicleOwnerInfo | null;
}

export interface VehicleOwnerInfo {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  email: string;
  /** departments.department_name qua users.department_id; null nếu chưa gán phòng ban. */
  department: string | null;
}

const EVENT_TYPE = 'ivss_vehicle_event';

/**
 * VehicleHistoryService (VHI-001 / UC7) — lịch sử ra/vào cổng (read-only).
 *
 * 2 method: listForUser (xe CỦA MÌNH, payload_json->>'userId'=current) / listAll (admin, tất cả).
 * Raw SQL mirror UC6 (bind index động + COUNT). DATA-01 C1-isolation: CHỈ event_type='ivss_vehicle_event'.
 * Ràng buộc: plateNumber filter qua normalizePlate (UC1) TRƯỚC khi so (DB lưu đã normalize).
 * SEC-03 bind tham số. KHÔNG dùng VehicleRegistrationService.
 *
 * isBlacklisted/listType (STT 19, 2026-10-08): LATERAL vehicle_control_list theo biển +
 * thời điểm (utils/control-list-flag.sql.ts) — thay LEFT JOIN security_alerts cũ (chỉ đúng
 * cho lượt ĐẦU của mỗi alert mở, do bumpOccurrence gộp lượt sau). KHÔNG đụng luồng ghi.
 * LATERAL chỉ có ở rows query (KHÔNG cần ở COUNT — isBlacklisted không phải filter).
 *
 * owner/ownerName (yêu cầu FE 2026-08-08): LEFT JOIN users/departments qua
 * payload_json->>'userId', CHỈ khi includeUserId=true (listAll — mirror lý do privacy
 * của userId, xem VehicleHistoryItem.owner). KHÁC control-list — JOIN users PHẢI có ở
 * CẢ COUNT lẫn rows, vì `where` có thể tham chiếu u.full_name (filter ownerName).
 *
 * `iot_device_events.` prefix BẮT BUỘC trên MỌI cột (KHÔNG chỉ để rõ ràng) — sau khi
 * JOIN, users CÓ cột `id` trùng tên; để trần sẽ ném lỗi
 * Postgres "column reference is ambiguous". `where` dùng chung cho COUNT lẫn rows nên
 * PHẢI qualify nhất quán ở mọi nơi build `where` (kể cả event_type/event_time, dù 2 cột
 * đó hiện chưa trùng tên với bảng nào khác — giữ prefix để an toàn nếu JOIN thêm sau này).
 */
@Injectable()
export class VehicleHistoryService {
  constructor(private readonly dataSource: DataSource) {}

  /** USER: chỉ event matched của current user. Output KHÔNG userId. */
  async listForUser(
    userId: string,
    query: ListVehicleHistoryQueryDto,
  ): Promise<{ items: VehicleHistoryItem[]; meta: PaginationMeta }> {
    const params: unknown[] = [userId];
    let where = `iot_device_events.event_type = '${EVENT_TYPE}' AND iot_device_events.payload_json->>'userId' = $1`;
    where = this.applyFilters(query, params, where);
    return this.paginate(where, params, query, false);
  }

  /** ADMIN: tất cả event vehicle (matched + unmatched). Output CÓ userId. */
  async listAll(
    query: ListVehicleHistoryQueryDto,
  ): Promise<{ items: VehicleHistoryItem[]; meta: PaginationMeta }> {
    const params: unknown[] = [];
    let where = `iot_device_events.event_type = '${EVENT_TYPE}'`;
    if (query.matchState) {
      params.push(query.matchState);
      where += ` AND iot_device_events.payload_json->>'matchState' = $${params.length}`;
    }
    // ownerName (yêu cầu FE 2026-08-08): lọc theo users.full_name — CHỈ khả dụng ở
    // listAll vì `where` này CHỈ dùng cho query có JOIN users (paginate() JOIN users
    // khi includeUserId=true). listForUser KHÔNG gọi nhánh này (DTO field bị bỏ qua).
    if (query.ownerName) {
      params.push(`%${query.ownerName}%`);
      where += ` AND u.full_name ILIKE $${params.length}`;
    }
    where = this.applyFilters(query, params, where);
    return this.paginate(where, params, query, true);
  }

  /** Filter động (mutate params): from/to/direction/plateNumber(normalized). Bind index tiếp nối. */
  private applyFilters(
    query: ListVehicleHistoryQueryDto,
    params: unknown[],
    where: string,
  ): string {
    if (query.from) {
      params.push(query.from);
      where += ` AND iot_device_events.event_time >= $${params.length}`;
    }
    if (query.to) {
      params.push(query.to);
      where += ` AND iot_device_events.event_time <= $${params.length}`;
    }
    if (query.direction) {
      params.push(query.direction);
      where += ` AND iot_device_events.payload_json->>'direction' = $${params.length}`;
    }
    if (query.plateNumber) {
      // Ràng buộc: normalize TRƯỚC khi so (DB lưu đã normalize từ UC4/UC5).
      params.push(normalizePlate(query.plateNumber));
      where += ` AND iot_device_events.payload_json->>'plateNumber' = $${params.length}`;
    }
    return where;
  }

  private async paginate(
    where: string,
    params: unknown[],
    query: ListVehicleHistoryQueryDto,
    includeUserId: boolean,
  ): Promise<{ items: VehicleHistoryItem[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    // owner (yêu cầu FE 2026-08-08): LEFT JOIN qua PRIMARY KEY (users.id) → KHÔNG BAO
    // GIỜ nhân dòng, COUNT(*)/rows không đổi số lượng dù có JOIN hay không. CHỈ JOIN khi
    // includeUserId=true (mirror userId — cùng lý do privacy, xem VehicleHistoryItem.owner).
    // Cast (...)::uuid AN TOÀN vì payload_json->>'userId' LUÔN là null hoặc uuid hợp lệ
    // (nguồn: vehicle_registrations.user_id, cột uuid — xem vehicle-resolve.service.ts
    // resolveUserByPlate/onVehicleEvent — KHÔNG phải input người dùng tự do, không cần
    // guard định dạng ở tầng boundary).
    const ownerJoin = includeUserId
      ? `LEFT JOIN users u ON u.id = (iot_device_events.payload_json->>'userId')::uuid`
      : '';
    const departmentJoin = includeUserId
      ? `LEFT JOIN departments d ON d.id = u.department_id`
      : '';

    // total: COUNT cùng WHERE (KHÔNG limit/offset). Cần CÙNG JOIN users như rows query
    // vì `where` có thể tham chiếu u.full_name (filter ownerName, chỉ listAll truyền).
    const countRows: CountRow[] = await this.dataSource.manager.query(
      `SELECT COUNT(*)::int AS total FROM iot_device_events ${ownerJoin} WHERE ${where}`,
      params,
    );
    const total = countRows[0]?.total ?? 0;

    // rows: limit/offset SAU filter params → bind index liên tục.
    // STT 19: cờ danh sách đen qua CONTROL_LIST_FLAG_JOIN (LATERAL vehicle_control_list).
    // `iot_device_events.` prefix BẮT BUỘC trên id/payload_json — users CŨNG có cột id,
    // để trần sẽ ném lỗi "column reference is ambiguous" khi đã JOIN (u.id BẮT BUỘC).
    const userIdCol = includeUserId
      ? `, iot_device_events.payload_json->>'userId' AS user_id`
      : '';
    const ownerCols = includeUserId
      ? `, u.id                 AS owner_id,
              u.full_name       AS owner_full_name,
              u.avatar_url      AS owner_avatar_url,
              u.email           AS owner_email,
              d.department_name AS owner_department`
      : '';
    const rows: HistoryRow[] = await this.dataSource.manager.query(
      `SELECT iot_device_events.id,
              iot_device_events.payload_json->>'plateNumber'        AS plate_number,
              (iot_device_events.payload_json->>'channelId')::int   AS channel_id,
              -- [FIX 2026-08-11, B4] Ưu tiên gateDirection (channel_direction_map, giá trị
              -- ĐÚNG dùng ghi gate_access_logs) — fallback direction (raw, eventAction) cho
              -- dữ liệu CŨ ghi trước fix này (chưa có key gateDirection → ->>'gateDirection'
              -- trả NULL → COALESCE rơi xuống direction, KHÔNG lỗi/KHÔNG trống).
              COALESCE(
                iot_device_events.payload_json->>'gateDirection',
                iot_device_events.payload_json->>'direction'
              )                                                     AS direction,
              iot_device_events.payload_json->>'matchState'         AS match_state,
              iot_device_events.event_time,
              iot_device_events.payload_json->>'utc'                AS utc,
              ${CONTROL_LIST_FLAG_COLUMNS}${userIdCol}${ownerCols}
         FROM iot_device_events
         ${CONTROL_LIST_FLAG_JOIN}
         ${ownerJoin}
         ${departmentJoin}
        WHERE ${where}
        ORDER BY iot_device_events.event_time DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    return {
      items: rows.map((r) => {
        const item: VehicleHistoryItem = {
          id: r.id,
          plateNumber: r.plate_number,
          channelId: r.channel_id,
          direction: r.direction,
          matchState: r.match_state,
          eventTime: r.event_time,
          utc: r.utc,
          isBlacklisted: r.is_blacklisted,
          listType: r.list_type,
        };
        if (includeUserId) {
          item.userId = r.user_id ?? null;
          item.owner = r.owner_id
            ? {
                id: r.owner_id,
                fullName: r.owner_full_name ?? '',
                avatarUrl: r.owner_avatar_url ?? null,
                email: r.owner_email ?? '',
                department: r.owner_department ?? null,
              }
            : null;
        }
        return item;
      }),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
