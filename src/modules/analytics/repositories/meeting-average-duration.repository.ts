import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface AverageDurationParams {
  from: string;
  to: string;
  scopeDepartmentIds: string[] | null;
  departmentIds?: string[];
  roomId?: string;
  granularity?: string;
}

@Injectable()
export class MeetingAverageDurationRepository {
  private readonly logger = new Logger(MeetingAverageDurationRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  async getManagerDepartmentIds(userId: string): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL)) AND is_active = true`,
      [userId],
    );
    return rows.map((r: { id: string }) => r.id);
  }

  private buildScopeWhere(
    params: AverageDurationParams,
    alias: string,
  ): { clause: string; values: unknown[] } {
    const values: unknown[] = [];
    let idx = 1;
    const conditions: string[] = [];

    // Enforce scope
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

    // Filter departmentIds (multi-select)
    if (params.departmentIds && params.departmentIds.length > 0) {
      conditions.push(
        `${alias}.organizer_id IN (SELECT u2.id FROM users u2 WHERE u2.department_id = ANY($${idx}::uuid[]))`,
      );
      values.push(params.departmentIds);
      idx++;
    }

    // Filter roomId
    if (params.roomId) {
      conditions.push(`${alias}.room_id = $${idx}`);
      values.push(params.roomId);
      idx++;
    }

    const clause = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
    return { clause, values };
  }

  private getFormatPattern(granularity: string): string {
    switch (granularity) {
      case 'day':
        return 'YYYY-MM-DD';
      case 'week':
        return 'IYYY-"W"IW';
      case 'month':
        return 'YYYY-MM';
      case 'quarter':
        return 'YYYY-"Q"Q';
      default:
        return 'IYYY-"W"IW';
    }
  }

  async getAverageDurationByBucket(
    params: AverageDurationParams,
  ): Promise<
    Map<
      string,
      { plannedAvg: number | null; actualAvg: number | null; count: number }
    >
  > {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;
    const formatPattern = this.getFormatPattern(params.granularity || 'week');

    const sql = `
      SELECT
        TO_CHAR(m.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh', '${formatPattern}') AS period,
        AVG(EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time)) / 60)::numeric AS planned_avg,
        AVG(
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
        )::numeric AS actual_avg,
        COUNT(*)::int AS cnt
      FROM meetings m
      INNER JOIN room_bookings rb ON rb.meeting_id = m.id
      LEFT JOIN room_booking_usages rbu ON rbu.meeting_id = m.id
      WHERE m.status = 'completed'
        AND m.deleted_at IS NULL
        AND m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND (
          (rbu.actual_end_time IS NOT NULL AND rbu.actual_start_time IS NOT NULL) OR
          (rbu.last_presence_at IS NOT NULL AND rbu.first_presence_at IS NOT NULL)
        )
        AND ${scope.clause}
      GROUP BY period
      ORDER BY period ASC
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);

    const result = new Map<
      string,
      { plannedAvg: number | null; actualAvg: number | null; count: number }
    >();
    for (const row of rows) {
      result.set(row.period, {
        plannedAvg:
          row.planned_avg !== null && row.planned_avg !== undefined
            ? Number(row.planned_avg)
            : null,
        actualAvg:
          row.actual_avg !== null && row.actual_avg !== undefined
            ? Number(row.actual_avg)
            : null,
        count: row.cnt,
      });
    }
    return result;
  }

  async getAverageDurationSummary(params: AverageDurationParams): Promise<{
    plannedAvg: number | null;
    actualAvg: number | null;
    count: number;
  }> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;

    const sql = `
      SELECT
        AVG(EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time)) / 60)::numeric AS planned_avg,
        AVG(
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
        )::numeric AS actual_avg,
        COUNT(*)::int AS cnt
      FROM meetings m
      INNER JOIN room_bookings rb ON rb.meeting_id = m.id
      LEFT JOIN room_booking_usages rbu ON rbu.meeting_id = m.id
      WHERE m.status = 'completed'
        AND m.deleted_at IS NULL
        AND m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND (
          (rbu.actual_end_time IS NOT NULL AND rbu.actual_start_time IS NOT NULL) OR
          (rbu.last_presence_at IS NOT NULL AND rbu.first_presence_at IS NOT NULL)
        )
        AND ${scope.clause}
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);

    const row = rows?.[0];
    return {
      plannedAvg:
        row?.planned_avg !== null && row?.planned_avg !== undefined
          ? Number(row.planned_avg)
          : null,
      actualAvg:
        row?.actual_avg !== null && row?.actual_avg !== undefined
          ? Number(row.actual_avg)
          : null,
      count: row?.cnt ?? 0,
    };
  }
}
