import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class RoomUtilizationRateRepository {
  private readonly logger = new Logger(RoomUtilizationRateRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  async getManagerRoomIds(
    userId: string,
    from: string,
    to: string,
  ): Promise<string[]> {
    const sql = `
      SELECT DISTINCT rb.room_id AS room_id
      FROM room_bookings rb
      INNER JOIN meetings m ON m.id = rb.meeting_id
      INNER JOIN users u ON u.id = m.organizer_id
      WHERE u.department_id IN (
        SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL)) AND is_active = true
      )
      AND rb.reserved_start_time >= ($2 || ' 00:00:00+07')::timestamptz
      AND rb.reserved_start_time <= ($3 || ' 23:59:59.999+07')::timestamptz
      AND rb.status IN ('approved', 'active', 'completed', 'released')
      AND m.deleted_at IS NULL
    `;
    const rows = await this.dataSource.query(sql, [userId, from, to]);
    return rows.map((r: { room_id: string }) => r.room_id);
  }

  async getRoom(
    roomId: string,
  ): Promise<{ id: string; roomName: string } | null> {
    const rows = await this.dataSource.query(
      `SELECT id, room_name AS "roomName" FROM rooms WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [roomId],
    );
    if (!rows || rows.length === 0) return null;
    return rows[0];
  }

  async getActiveRoomCount(
    scopeRoomIds: string[] | null,
    roomIdFilter?: string,
  ): Promise<number> {
    const conditions: string[] = ['is_active = true', 'deleted_at IS NULL'];
    const values: unknown[] = [];
    let idx = 1;

    if (scopeRoomIds !== null) {
      if (scopeRoomIds.length === 0) return 0;
      conditions.push(`id = ANY($${idx}::uuid[])`);
      values.push(scopeRoomIds);
      idx++;
    }

    if (roomIdFilter) {
      conditions.push(`id = $${idx}`);
      values.push(roomIdFilter);
      idx++;
    }

    const sql = `SELECT COUNT(*)::int AS cnt FROM rooms WHERE ${conditions.join(' AND ')}`;
    const rows = await this.dataSource.query(sql, values);
    return rows?.[0]?.cnt ?? 0;
  }

  async getPeriodAggregate(
    scopeRoomIds: string[] | null,
    roomIdFilter: string | undefined,
    from: string,
    to: string,
  ): Promise<{
    bookedMinutesSum: number;
    actualMinutesSum: number;
    hasActualData: boolean;
    activeRoomCount: number;
  }> {
    const activeRoomCount = await this.getActiveRoomCount(
      scopeRoomIds,
      roomIdFilter,
    );

    if (activeRoomCount === 0) {
      return {
        bookedMinutesSum: 0,
        actualMinutesSum: 0,
        hasActualData: false,
        activeRoomCount: 0,
      };
    }

    const conditions: string[] = [
      "rb.status IN ('approved', 'active', 'completed', 'released')",
      'm.deleted_at IS NULL',
    ];
    const values: unknown[] = [];
    let idx = 1;

    if (scopeRoomIds !== null) {
      conditions.push(`rb.room_id = ANY($${idx}::uuid[])`);
      values.push(scopeRoomIds);
      idx++;
    }

    if (roomIdFilter) {
      conditions.push(`rb.room_id = $${idx}`);
      values.push(roomIdFilter);
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

    const bookedSql = `
      SELECT SUM(EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time)) / 60)::double precision AS booked_minutes
      FROM room_bookings rb
      INNER JOIN meetings m ON m.id = rb.meeting_id
      WHERE ${conditions.join(' AND ')}
    `;
    const bookedRows = await this.dataSource.query(bookedSql, values);
    const bookedMinutesSum = bookedRows?.[0]?.booked_minutes ?? 0;

    const actualSql = `
      SELECT SUM(
        CASE
          WHEN rbu.actual_start_time IS NOT NULL AND rbu.actual_end_time IS NOT NULL
            THEN GREATEST(0, EXTRACT(EPOCH FROM (
                   LEAST(rbu.actual_end_time, rbu.reserved_end_time)
                   - GREATEST(rbu.actual_start_time, rbu.reserved_start_time)
                 )) / 60)
          WHEN rbu.first_presence_at IS NOT NULL AND rbu.last_presence_at IS NOT NULL
            THEN GREATEST(0, EXTRACT(EPOCH FROM (
                   LEAST(rbu.last_presence_at, rbu.reserved_end_time)
                   - GREATEST(rbu.first_presence_at, rbu.reserved_start_time)
                 )) / 60)
          ELSE NULL
        END
      )::double precision AS actual_minutes
      FROM room_booking_usages rbu
      INNER JOIN room_bookings rb ON rb.id = rbu.booking_id
      INNER JOIN meetings m ON m.id = rb.meeting_id
      WHERE ${conditions.join(' AND ')}
        AND (
          (rbu.actual_start_time IS NOT NULL AND rbu.actual_end_time IS NOT NULL) OR
          (rbu.first_presence_at IS NOT NULL AND rbu.last_presence_at IS NOT NULL)
        )
    `;
    const actualRows = await this.dataSource.query(actualSql, values);
    const actualMinutesSum = actualRows?.[0]?.actual_minutes ?? 0;

    const hasActualData = actualRows?.[0]?.actual_minutes !== null;

    return {
      bookedMinutesSum,
      actualMinutesSum,
      hasActualData,
      activeRoomCount,
    };
  }

  async getNoShowAggregate(
    scopeRoomIds: string[] | null,
    roomIdFilter: string | undefined,
    from: string,
    to: string,
  ): Promise<{ totalBookings: number; noShowCount: number }> {
    const conditions: string[] = [
      "rb.status IN ('approved', 'active', 'completed', 'released')",
      'm.deleted_at IS NULL',
    ];
    const values: unknown[] = [];
    let idx = 1;

    if (scopeRoomIds !== null) {
      if (scopeRoomIds.length === 0) {
        return { totalBookings: 0, noShowCount: 0 };
      }
      conditions.push(`rb.room_id = ANY($${idx}::uuid[])`);
      values.push(scopeRoomIds);
      idx++;
    }

    if (roomIdFilter) {
      conditions.push(`rb.room_id = $${idx}`);
      values.push(roomIdFilter);
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
        COUNT(DISTINCT rb.id)::int AS total_bookings,
        COUNT(DISTINCT nsc.id) FILTER (WHERE nsc.detection_status IN ('confirmed', 'released'))::int AS no_show_count
      FROM room_bookings rb
      INNER JOIN meetings m ON m.id = rb.meeting_id
      LEFT JOIN no_show_cases nsc ON nsc.booking_id = rb.id
      WHERE ${conditions.join(' AND ')}
    `;
    const rows = await this.dataSource.query(sql, values);

    return {
      totalBookings: rows?.[0]?.total_bookings ?? 0,
      noShowCount: rows?.[0]?.no_show_count ?? 0,
    };
  }
}
