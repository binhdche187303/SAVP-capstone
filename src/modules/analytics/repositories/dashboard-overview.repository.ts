import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface AggregateParams {
  from: string;
  to: string;
  scopeDepartmentIds: string[] | null;
  departmentId?: string;
  roomId?: string;
}

export interface UtilizationAggregate {
  actualMinutesSum: number;
  reservedMinutesSum: number;
}

export interface NoShowAggregate {
  noShowCount: number;
  bookingCount: number;
}

export interface AttendanceAggregate {
  onTimeCount: number;
  totalCount: number;
}

export interface DailyTrendRow {
  date: string;
  meetingCount: number;
  actualMinutesSum: number;
  reservedMinutesSum: number;
}

/**
 * DashboardOverviewRepository -- raw parameterized SQL aggregate for each KPI + trend.
 * All methods are pure reads; no writes/mutations.
 */
@Injectable()
export class DashboardOverviewRepository {
  private readonly logger = new Logger(DashboardOverviewRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  // -- helpers --

  async getManagerDepartmentIds(userId: string): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL)) AND is_active = true`,
      [userId],
    );
    return rows.map((r: { id: string }) => r.id);
  }

  private buildScopeWhere(
    params: AggregateParams,
    alias: string,
  ): { clause: string; values: unknown[] } {
    const values: unknown[] = [];
    let idx = 1;
    const conditions: string[] = [];

    if (params.scopeDepartmentIds !== null) {
      if (params.scopeDepartmentIds.length === 0) {
        return { clause: 'FALSE', values: [] };
      }
      conditions.push(
        `${alias}.organizer_id IN (SELECT u.id FROM users u WHERE u.department_id = ANY($${idx}::uuid[]))`,
      );
      values.push(params.scopeDepartmentIds);
      idx++;
    }

    if (params.departmentId) {
      conditions.push(
        `${alias}.organizer_id IN (SELECT u2.id FROM users u2 WHERE u2.department_id = $${idx})`,
      );
      values.push(params.departmentId);
      idx++;
    }

    if (params.roomId) {
      conditions.push(`${alias}.room_id = $${idx}`);
      values.push(params.roomId);
      idx++;
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
    return { clause: where, values };
  }

  // -- aggregate methods --

  async countMeetings(params: AggregateParams): Promise<number> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;
    const sql = `
      SELECT COUNT(*)::int AS cnt
      FROM meetings m
      WHERE m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND m.status <> 'draft'
        AND m.deleted_at IS NULL
        AND ${scope.clause}
    `;
    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);
    return rows?.[0]?.cnt ?? 0;
  }

  async countActiveRooms(params: AggregateParams): Promise<number> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;
    const sql = `
      SELECT COUNT(DISTINCT rb.room_id)::int AS cnt
      FROM room_bookings rb
      INNER JOIN meetings m ON m.id = rb.meeting_id
      WHERE m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND m.status <> 'draft'
        AND m.deleted_at IS NULL
        AND rb.status IN ('approved','active','completed','released')
        AND ${scope.clause}
    `;
    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);
    return rows?.[0]?.cnt ?? 0;
  }

  async getUtilizationAggregate(
    params: AggregateParams,
  ): Promise<UtilizationAggregate> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;
    const sql = `
      SELECT
        COALESCE(SUM(
          CASE
            WHEN rbu.actual_end_time IS NOT NULL AND rbu.actual_start_time IS NOT NULL
              THEN GREATEST(0, EXTRACT(EPOCH FROM (
                     LEAST(rbu.actual_end_time, rbu.reserved_end_time)
                     - GREATEST(rbu.actual_start_time, rbu.reserved_start_time)
                   )) / 60)
            WHEN rbu.last_presence_at IS NOT NULL AND rbu.first_presence_at IS NOT NULL
              THEN GREATEST(0, EXTRACT(EPOCH FROM (
                     LEAST(rbu.last_presence_at, rbu.reserved_end_time)
                     - GREATEST(rbu.first_presence_at, rbu.reserved_start_time)
                   )) / 60)
            ELSE 0
          END
        ), 0)::numeric AS actual_minutes_sum,
        COALESCE(SUM(
          EXTRACT(EPOCH FROM (rbu.reserved_end_time - rbu.reserved_start_time)) / 60
        ), 0)::numeric AS reserved_minutes_sum
      FROM room_booking_usages rbu
      INNER JOIN meetings m ON m.id = rbu.meeting_id
      WHERE m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND m.status <> 'draft'
        AND m.deleted_at IS NULL
        AND ${scope.clause}
    `;
    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);
    return {
      actualMinutesSum: Number(rows?.[0]?.actual_minutes_sum ?? 0),
      reservedMinutesSum: Number(rows?.[0]?.reserved_minutes_sum ?? 0),
    };
  }

  async getNoShowAggregate(params: AggregateParams): Promise<NoShowAggregate> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;
    const sql = `
      SELECT
        (SELECT COUNT(*)::int FROM no_show_cases nsc
          INNER JOIN meetings m ON m.id = nsc.meeting_id
          WHERE m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
            AND m.status <> 'draft' AND m.deleted_at IS NULL
            AND nsc.detection_status IN ('confirmed','released')
            AND ${scope.clause}
        ) AS no_show_count,
        (SELECT COUNT(*)::int FROM room_bookings rb
          INNER JOIN meetings m ON m.id = rb.meeting_id
          WHERE m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
            AND m.status <> 'draft' AND m.deleted_at IS NULL
            AND rb.status IN ('approved','active','completed','released')
            AND ${scope.clause}
        ) AS booking_count
    `;
    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);
    return {
      noShowCount: rows?.[0]?.no_show_count ?? 0,
      bookingCount: rows?.[0]?.booking_count ?? 0,
    };
  }

  async getAttendanceAggregate(
    params: AggregateParams,
  ): Promise<AttendanceAggregate> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;
    const sql = `
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE ar.is_present = true AND ar.is_late = false)::int AS on_time_count
      FROM attendance_records ar
      INNER JOIN meetings m ON m.id = ar.meeting_id
      WHERE m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND m.status <> 'draft'
        AND m.deleted_at IS NULL
        AND ar.attendance_status IN ('present','late')
        AND ${scope.clause}
    `;
    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);
    return {
      onTimeCount: rows?.[0]?.on_time_count ?? 0,
      totalCount: rows?.[0]?.total_count ?? 0,
    };
  }

  async countActiveUsers(params: AggregateParams): Promise<number> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;
    const sql = `
      SELECT COUNT(DISTINCT uid)::int AS cnt
      FROM (
        SELECT m.organizer_id AS uid
        FROM meetings m
        WHERE m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
          AND m.status <> 'draft' AND m.deleted_at IS NULL
          AND ${scope.clause}
        UNION
        SELECT mp.user_id AS uid
        FROM meeting_participants mp
        INNER JOIN meetings m ON m.id = mp.meeting_id
        WHERE m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
          AND m.status <> 'draft' AND m.deleted_at IS NULL
          AND mp.invitation_status <> 'declined'
          AND ${scope.clause}
      ) u
    `;
    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);
    return rows?.[0]?.cnt ?? 0;
  }

  async countRecordingSessions(params: AggregateParams): Promise<number> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;
    const sql = `
      SELECT COUNT(*)::int AS cnt
      FROM recording_sessions rs
      INNER JOIN meetings m ON m.id = rs.meeting_id
      WHERE rs.started_at >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND rs.started_at <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND m.status <> 'draft'
        AND m.deleted_at IS NULL
        AND ${scope.clause}
    `;
    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);
    return rows?.[0]?.cnt ?? 0;
  }

  async getDailyTrend(params: AggregateParams): Promise<DailyTrendRow[]> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;
    const sql = `
      WITH days AS (
        SELECT gs::date AS day
        FROM generate_series(
          $${pIdx}::date,
          $${pIdx + 1}::date,
          '1 day'
        ) gs
      )
      SELECT
        d.day::text AS date,
        COUNT(DISTINCT m.id)::int AS meeting_count,
        COALESCE(SUM(
          CASE
            WHEN rbu.actual_end_time IS NOT NULL AND rbu.actual_start_time IS NOT NULL
              THEN GREATEST(0, EXTRACT(EPOCH FROM (
                     LEAST(rbu.actual_end_time, rbu.reserved_end_time)
                     - GREATEST(rbu.actual_start_time, rbu.reserved_start_time)
                   )) / 60)
            WHEN rbu.last_presence_at IS NOT NULL AND rbu.first_presence_at IS NOT NULL
              THEN GREATEST(0, EXTRACT(EPOCH FROM (
                     LEAST(rbu.last_presence_at, rbu.reserved_end_time)
                     - GREATEST(rbu.first_presence_at, rbu.reserved_start_time)
                   )) / 60)
            ELSE 0
          END
        ), 0)::numeric AS actual_minutes_sum,
        COALESCE(SUM(
          EXTRACT(EPOCH FROM (rbu.reserved_end_time - rbu.reserved_start_time)) / 60
        ), 0)::numeric AS reserved_minutes_sum
      FROM days d
      LEFT JOIN meetings m
        ON (m.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = d.day
        AND m.status <> 'draft' AND m.deleted_at IS NULL
        AND ${scope.clause}
      LEFT JOIN room_booking_usages rbu ON rbu.meeting_id = m.id
      GROUP BY d.day
      ORDER BY d.day
    `;
    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);
    return rows.map((r: Record<string, unknown>) => ({
      date: r.date as string,
      meetingCount: (r.meeting_count as number) ?? 0,
      actualMinutesSum: Number(r.actual_minutes_sum ?? 0),
      reservedMinutesSum: Number(r.reserved_minutes_sum ?? 0),
    }));
  }
}
