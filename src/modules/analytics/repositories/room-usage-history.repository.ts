import { filterValues, type FilterSelection } from '../../../common/utils/filter-selection.js';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface RoomUsageHistoryParams {
  from: string;
  to: string;
  scopeRoomIds: string[] | null;
  roomId?: string;
  siteName?: FilterSelection<string>;
  areaName?: string;
}

export interface RawSessionRow {
  room_id: string;
  room_name: string;
  meeting_id: string;
  meeting_title: string;
  host_name: string;
  reserved_start_time: Date;
  reserved_end_time: Date;
  actual_start_time: Date | null;
  actual_end_time: Date | null;
  booking_status: string;
  booking_updated_at: Date;
  usage_status: string | null;
}

@Injectable()
export class RoomUsageHistoryRepository {
  private readonly logger = new Logger(RoomUsageHistoryRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  private buildWhere(
    params: RoomUsageHistoryParams,
    startIdx: number,
  ): { clause: string; values: unknown[] } {
    const values: unknown[] = [];
    let idx = startIdx;
    const conditions: string[] = [];

    if (params.scopeRoomIds !== null) {
      if (params.scopeRoomIds.length === 0) {
        return { clause: 'FALSE', values: [] };
      }
      conditions.push(`rb.room_id = ANY($${idx}::uuid[])`);
      values.push(params.scopeRoomIds);
      idx++;
    }
    if (params.roomId) {
      conditions.push(`rb.room_id = $${idx}`);
      values.push(params.roomId);
      idx++;
    }
    if (params.siteName) {
      conditions.push(`r.site_name = ANY($${idx}::text[])`);
      values.push(filterValues(params.siteName));
      idx++;
    }
    if (params.areaName) {
      conditions.push(`r.area_name = $${idx}`);
      values.push(params.areaName);
      idx++;
    }

    return {
      clause: conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '',
      values,
    };
  }

  /**
   * FR-013/FR-014: nếu scopeRoomIds !== null && length === 0 (Manager không
   * quản lý phòng nào trong kỳ), trả rỗng ngay không query.
   */
  async getSessionsPage(
    params: RoomUsageHistoryParams,
    sortBy: 'reservedStartTime' | 'sessionStatus',
    sortOrder: 'asc' | 'desc',
    page: number,
    limit: number,
  ): Promise<RawSessionRow[]> {
    if (params.scopeRoomIds !== null && params.scopeRoomIds.length === 0) {
      return [];
    }

    const { clause, values } = this.buildWhere(params, 3);
    const offset = (page - 1) * limit;

    // sessionStatus phụ thuộc booking_status/usage_status — sort theo cột SQL
    // gần nhất (usage_status), sessionStatus thật được derive ở service layer.
    const orderColumn =
      sortBy === 'sessionStatus' ? 'rb.status' : 'rb.reserved_start_time';

    const sql = `
      SELECT
        rb.room_id, r.room_name,
        m.id AS meeting_id, m.title AS meeting_title,
        COALESCE(hu.full_name, ou.full_name) AS host_name,
        rb.reserved_start_time, rb.reserved_end_time,
        rbu.actual_start_time, rbu.actual_end_time,
        rb.status AS booking_status, rb.updated_at AS booking_updated_at,
        rbu.usage_status
      FROM room_bookings rb
      JOIN rooms r ON r.id = rb.room_id
      JOIN meetings m ON m.id = rb.meeting_id
      LEFT JOIN users hu ON hu.id = m.host_id
      LEFT JOIN users ou ON ou.id = m.organizer_id
      LEFT JOIN room_booking_usages rbu ON rbu.booking_id = rb.id
      WHERE m.deleted_at IS NULL
        AND rb.reserved_start_time < ($2 || ' 23:59:59.999+07')::timestamptz
        AND rb.reserved_end_time > ($1 || ' 00:00:00+07')::timestamptz
        ${clause}
      ORDER BY ${orderColumn} ${sortOrder === 'asc' ? 'ASC' : 'DESC'}
      LIMIT $${values.length + 3} OFFSET $${values.length + 4}
    `;

    return this.dataSource.query(sql, [
      params.from,
      params.to,
      ...values,
      limit,
      offset,
    ]);
  }

  /** Số phòng active trong scope — dùng để tính availableHours (FR-032). */
  async getActiveRoomCount(params: RoomUsageHistoryParams): Promise<number> {
    if (params.scopeRoomIds !== null && params.scopeRoomIds.length === 0) {
      return 0;
    }
    const values: unknown[] = [];
    let idx = 1;
    const conditions: string[] = ['r.is_active = true', 'r.deleted_at IS NULL'];

    if (params.scopeRoomIds !== null) {
      conditions.push(`r.id = ANY($${idx}::uuid[])`);
      values.push(params.scopeRoomIds);
      idx++;
    }
    if (params.roomId) {
      conditions.push(`r.id = $${idx}`);
      values.push(params.roomId);
      idx++;
    }
    if (params.siteName) {
      conditions.push(`r.site_name = ANY($${idx}::text[])`);
      values.push(filterValues(params.siteName));
      idx++;
    }
    if (params.areaName) {
      conditions.push(`r.area_name = $${idx}`);
      values.push(params.areaName);
      idx++;
    }

    const rows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT r.id)::text AS count FROM rooms r WHERE ${conditions.join(' AND ')}`,
      values,
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  async getSessionsCount(params: RoomUsageHistoryParams): Promise<number> {
    if (params.scopeRoomIds !== null && params.scopeRoomIds.length === 0) {
      return 0;
    }
    const { clause, values } = this.buildWhere(params, 3);
    const rows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(rb.id)::text AS count
         FROM room_bookings rb
         JOIN rooms r ON r.id = rb.room_id
         JOIN meetings m ON m.id = rb.meeting_id
        WHERE m.deleted_at IS NULL
          AND rb.reserved_start_time < ($2 || ' 23:59:59.999+07')::timestamptz
          AND rb.reserved_end_time > ($1 || ' 00:00:00+07')::timestamptz
          ${clause}`,
      [params.from, params.to, ...values],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  /**
   * Summary tách biệt hoàn toàn khỏi phân trang (NFR-005) — tính trên TOÀN
   * BỘ tập kết quả khớp scope+filter, không giới hạn page/limit.
   * FR-029: totalReservedHours KHÔNG loại trừ status=cancelled (khác UC-AA-02).
   */
  async getSummaryAggregate(params: RoomUsageHistoryParams): Promise<{
    totalReservedHours: number;
    totalActualHours: number | null;
    noShowCount: number;
  }> {
    if (params.scopeRoomIds !== null && params.scopeRoomIds.length === 0) {
      return { totalReservedHours: 0, totalActualHours: null, noShowCount: 0 };
    }
    const { clause, values } = this.buildWhere(params, 3);

    const rows: {
      total_reserved_hours: string;
      total_actual_hours: string | null;
      no_show_count: string;
      has_actual_data: boolean;
    }[] = await this.dataSource.query(
      `SELECT
          COALESCE(SUM(EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time)) / 3600), 0)::text AS total_reserved_hours,
          SUM(
            CASE
              WHEN rbu.actual_start_time IS NOT NULL AND rbu.actual_end_time IS NOT NULL
                THEN GREATEST(0, EXTRACT(EPOCH FROM (
                       LEAST(rbu.actual_end_time, rbu.reserved_end_time)
                       - GREATEST(rbu.actual_start_time, rbu.reserved_start_time)
                     )) / 3600)
              WHEN rbu.first_presence_at IS NOT NULL AND rbu.last_presence_at IS NOT NULL
                THEN GREATEST(0, EXTRACT(EPOCH FROM (
                       LEAST(rbu.last_presence_at, rbu.reserved_end_time)
                       - GREATEST(rbu.first_presence_at, rbu.reserved_start_time)
                     )) / 3600)
              ELSE NULL
            END
          )::text AS total_actual_hours,
          COUNT(*) FILTER (WHERE rbu.usage_status = 'no_show')::text AS no_show_count,
          bool_or(rbu.actual_start_time IS NOT NULL OR rbu.first_presence_at IS NOT NULL) AS has_actual_data
        FROM room_bookings rb
        JOIN rooms r ON r.id = rb.room_id
        JOIN meetings m ON m.id = rb.meeting_id
        LEFT JOIN room_booking_usages rbu ON rbu.booking_id = rb.id
       WHERE m.deleted_at IS NULL
         AND rb.reserved_start_time < ($2 || ' 23:59:59.999+07')::timestamptz
         AND rb.reserved_end_time > ($1 || ' 00:00:00+07')::timestamptz
         ${clause}`,
      [params.from, params.to, ...values],
    );

    const row = rows[0];
    if (!row) {
      return { totalReservedHours: 0, totalActualHours: null, noShowCount: 0 };
    }

    return {
      totalReservedHours:
        Math.round(parseFloat(row.total_reserved_hours) * 10) / 10,
      totalActualHours: row.has_actual_data
        ? Math.round(parseFloat(row.total_actual_hours ?? '0') * 10) / 10
        : null,
      noShowCount: parseInt(row.no_show_count ?? '0', 10),
    };
  }
}
