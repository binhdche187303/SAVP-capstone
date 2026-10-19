import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface RoomUsageQueryParams {
  from: string;
  to: string;
  scopeRoomIds: string[] | null;
  roomId?: string;
  siteName?: string;
}

@Injectable()
export class RoomUsageDashboardRepository {
  private readonly logger = new Logger(RoomUsageDashboardRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  async getManagerRoomIds(
    userId: string,
    from: string,
    to: string,
  ): Promise<string[]> {
    // Overlap: booking overlaps period if start < period_end AND end > period_start
    const sql = `
      SELECT DISTINCT rb.room_id AS room_id
      FROM room_bookings rb
      INNER JOIN meetings m ON m.id = rb.meeting_id
      INNER JOIN users u ON u.id = m.organizer_id
      WHERE u.department_id IN (
        SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL)) AND is_active = true
      )
      AND rb.reserved_start_time < ($3 || ' 23:59:59.999+07')::timestamptz
      AND rb.reserved_end_time > ($2 || ' 00:00:00+07')::timestamptz
      AND rb.status IN ('approved', 'active', 'completed', 'released')
      AND m.deleted_at IS NULL
    `;
    const rows = await this.dataSource.query(sql, [userId, from, to]);
    return rows.map((r: { room_id: string }) => r.room_id);
  }

  async getRoom(roomId: string): Promise<{
    id: string;
    roomName: string;
    siteName: string | null;
    areaName: string | null;
    capacity: number;
  } | null> {
    const rows = await this.dataSource.query(
      `SELECT id, room_name AS "roomName", site_name AS "siteName", area_name AS "areaName", capacity
       FROM rooms WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [roomId],
    );
    if (!rows || rows.length === 0) return null;
    return rows[0];
  }

  private buildScopeWhere(
    params: RoomUsageQueryParams,
    rbAlias: string,
    rAlias: string,
  ): { clause: string; values: unknown[] } {
    const values: unknown[] = [];
    let idx = 1;
    const conditions: string[] = [];

    // Enforce Manager Room Scope
    if (params.scopeRoomIds !== null) {
      if (params.scopeRoomIds.length === 0) {
        return { clause: 'FALSE', values: [] };
      }
      conditions.push(`${rbAlias}.room_id = ANY($${idx}::uuid[])`);
      values.push(params.scopeRoomIds);
      idx++;
    }

    // Filter roomId
    if (params.roomId) {
      conditions.push(`${rbAlias}.room_id = $${idx}`);
      values.push(params.roomId);
      idx++;
    }

    // Filter siteName
    if (params.siteName) {
      conditions.push(`${rAlias}.site_name = $${idx}`);
      values.push(params.siteName);
      idx++;
    }

    const clause = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
    return { clause, values };
  }

  async getBookedAggregate(
    params: RoomUsageQueryParams,
  ): Promise<Map<string, number>> {
    const scope = this.buildScopeWhere(params, 'rb', 'r');
    const fromIdx = scope.values.length + 1;
    const toIdx = scope.values.length + 2;

    // Overlap: booking contributes if it overlaps [from, to] period
    const sql = `
      SELECT
        rb.room_id AS room_id,
        SUM(EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time)) / 60)::double precision AS booked_minutes
      FROM room_bookings rb
      INNER JOIN rooms r ON r.id = rb.room_id
      INNER JOIN meetings m ON m.id = rb.meeting_id
      WHERE rb.status IN ('approved', 'active', 'completed', 'released')
        AND m.deleted_at IS NULL
        AND rb.reserved_start_time < ($${toIdx} || ' 23:59:59.999+07')::timestamptz
        AND rb.reserved_end_time > ($${fromIdx} || ' 00:00:00+07')::timestamptz
        AND ${scope.clause}
      GROUP BY rb.room_id
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);

    const result = new Map<string, number>();
    for (const row of rows) {
      result.set(row.room_id, row.booked_minutes);
    }
    return result;
  }

  async getActualAggregate(
    params: RoomUsageQueryParams,
  ): Promise<Map<string, { actualMinutes: number; hasActualData: boolean }>> {
    const scope = this.buildScopeWhere(params, 'rb', 'r');
    const fromIdx = scope.values.length + 1;
    const toIdx = scope.values.length + 2;

    // Overlap: booking_usage contributes if its parent booking overlaps [from, to] period
    const sql = `
      SELECT
        rb.room_id AS room_id,
        SUM(
          CASE
            WHEN rbu.actual_start_time IS NOT NULL AND rbu.actual_end_time IS NOT NULL
              THEN GREATEST(0, EXTRACT(EPOCH FROM (
                     LEAST(rbu.actual_end_time, rbu.reserved_end_time)
                     - GREATEST(rbu.actual_start_time, rbu.reserved_start_time)
                   )) / 60)
            ELSE GREATEST(0, EXTRACT(EPOCH FROM (
                     LEAST(rbu.last_presence_at, rbu.reserved_end_time)
                     - GREATEST(rbu.first_presence_at, rbu.reserved_start_time)
                   )) / 60)
          END
        )::double precision AS actual_minutes
      FROM room_booking_usages rbu
      INNER JOIN room_bookings rb ON rb.id = rbu.booking_id
      INNER JOIN rooms r ON r.id = rb.room_id
      INNER JOIN meetings m ON m.id = rb.meeting_id
      WHERE rb.status IN ('approved', 'active', 'completed', 'released')
        AND m.deleted_at IS NULL
        AND (
          (rbu.actual_start_time IS NOT NULL AND rbu.actual_end_time IS NOT NULL) OR
          (rbu.first_presence_at IS NOT NULL AND rbu.last_presence_at IS NOT NULL)
        )
        AND rb.reserved_start_time < ($${toIdx} || ' 23:59:59.999+07')::timestamptz
        AND rb.reserved_end_time > ($${fromIdx} || ' 00:00:00+07')::timestamptz
        AND ${scope.clause}
      GROUP BY rb.room_id
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);

    const result = new Map<
      string,
      { actualMinutes: number; hasActualData: boolean }
    >();
    for (const row of rows) {
      result.set(row.room_id, {
        actualMinutes: row.actual_minutes,
        hasActualData: true,
      });
    }
    return result;
  }

  async listRoomsForComparison(
    params: RoomUsageQueryParams,
  ): Promise<Array<{ id: string; roomName: string }>> {
    const values: unknown[] = [];
    let idx = 1;
    const conditions: string[] = ['r.is_active = true', 'r.deleted_at IS NULL'];

    if (params.scopeRoomIds !== null) {
      if (params.scopeRoomIds.length === 0) {
        return [];
      }
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
      conditions.push(`r.site_name = $${idx}`);
      values.push(params.siteName);
      idx++;
    }

    const whereClause = conditions.join(' AND ');
    const sql = `
      SELECT r.id AS id, r.room_name AS room_name
      FROM rooms r
      WHERE ${whereClause}
      ORDER BY r.room_name ASC
    `;

    const rows = await this.dataSource.query(sql, values);
    return rows.map((r: any) => ({
      id: r.id,
      roomName: r.room_name,
    }));
  }

  async getRoomMeetingsList(
    roomId: string,
    from: string,
    to: string,
  ): Promise<any[]> {
    // Overlap: include meetings whose booking overlaps the period [from, to]
    const sql = `
      SELECT
        m.id AS "meetingId",
        m.title AS title,
        u.full_name AS "organizerName",
        rb.reserved_start_time AS "reservedStartTime",
        rb.reserved_end_time AS "reservedEndTime",
        rbu.actual_start_time AS "actualStartTime",
        rbu.actual_end_time AS "actualEndTime",
        m.status AS status,
        (SELECT COUNT(*)::int FROM meeting_participants mp
          WHERE mp.meeting_id = m.id
            AND mp.attendance_status IN ('present', 'late', 'left_early')) AS "attendeeCount",
        (SELECT COUNT(*)::int FROM meeting_participants mp
          WHERE mp.meeting_id = m.id
            AND mp.attendance_status = 'absent') AS "noShowCount"
      FROM room_bookings rb
      INNER JOIN meetings m ON m.id = rb.meeting_id
      INNER JOIN users u ON u.id = m.organizer_id
      LEFT JOIN room_booking_usages rbu ON rbu.booking_id = rb.id
      WHERE rb.room_id = $1
        AND rb.status IN ('approved', 'active', 'completed', 'released')
        AND m.deleted_at IS NULL
        AND rb.reserved_start_time < ($3 || ' 23:59:59.999+07')::timestamptz
        AND rb.reserved_end_time > ($2 || ' 00:00:00+07')::timestamptz
      ORDER BY rb.reserved_start_time ASC
    `;
    return this.dataSource.query(sql, [roomId, from, to]);
  }

  async getRoomTrend(
    from: string,
    to: string,
    scopeRoomIds: string[] | null,
  ): Promise<
    Array<{ date: string; meetingCount: number; bookedMinutes: number }>
  > {
    const conditions: string[] = [
      "rb.status IN ('approved', 'active', 'completed', 'released')",
      'm.deleted_at IS NULL',
    ];
    const values: unknown[] = [];
    let idx = 1;

    if (scopeRoomIds !== null) {
      if (scopeRoomIds.length === 0) {
        return [];
      }
      conditions.push(`rb.room_id = ANY($${idx}::uuid[])`);
      values.push(scopeRoomIds);
      idx++;
    }

    const fromIdx = idx;
    const toIdx = idx + 1;
    conditions.push(
      `rb.reserved_start_time >= ($${fromIdx} || ' 00:00:00+07')::timestamptz`,
    );
    conditions.push(
      `rb.reserved_start_time <= ($${toIdx} || ' 23:59:59.999+07')::timestamptz`,
    );
    values.push(from, to);

    const sql = `
      SELECT
        (rb.reserved_start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS date,
        COUNT(DISTINCT m.id)::int AS meeting_count,
        SUM(EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time)) / 60)::double precision AS booked_minutes
      FROM room_bookings rb
      INNER JOIN meetings m ON m.id = rb.meeting_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY (rb.reserved_start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      ORDER BY date ASC
    `;

    const rows = await this.dataSource.query(sql, values);
    return rows.map((r: any) => ({
      date: r.date,
      meetingCount: r.meeting_count,
      bookedMinutes: r.booked_minutes ?? 0,
    }));
  }

  async getRoomUsagesRaw(
    roomId: string,
    from: string,
    to: string,
  ): Promise<any[]> {
    // Overlap: include usages whose parent booking overlaps the period [from, to]
    const sql = `
      SELECT
        CASE WHEN rbu.actual_start_time IS NOT NULL AND rbu.actual_end_time IS NOT NULL
             THEN GREATEST(rbu.actual_start_time, rbu.reserved_start_time) END AS "actualStartTime",
        CASE WHEN rbu.actual_start_time IS NOT NULL AND rbu.actual_end_time IS NOT NULL
             THEN LEAST(rbu.actual_end_time, rbu.reserved_end_time) END AS "actualEndTime",
        CASE WHEN rbu.first_presence_at IS NOT NULL AND rbu.last_presence_at IS NOT NULL
             THEN GREATEST(rbu.first_presence_at, rbu.reserved_start_time) END AS "firstPresenceAt",
        CASE WHEN rbu.first_presence_at IS NOT NULL AND rbu.last_presence_at IS NOT NULL
             THEN LEAST(rbu.last_presence_at, rbu.reserved_end_time) END AS "lastPresenceAt"
      FROM room_booking_usages rbu
      INNER JOIN room_bookings rb ON rb.id = rbu.booking_id
      INNER JOIN meetings m ON m.id = rb.meeting_id
      WHERE rb.room_id = $1
        AND rb.status IN ('approved', 'active', 'completed', 'released')
        AND m.deleted_at IS NULL
        AND (
          (rbu.actual_start_time IS NOT NULL AND rbu.actual_end_time IS NOT NULL) OR
          (rbu.first_presence_at IS NOT NULL AND rbu.last_presence_at IS NOT NULL)
        )
        AND rb.reserved_start_time < ($3 || ' 23:59:59.999+07')::timestamptz
        AND rb.reserved_end_time > ($2 || ' 00:00:00+07')::timestamptz
    `;
    return this.dataSource.query(sql, [roomId, from, to]);
  }
}
