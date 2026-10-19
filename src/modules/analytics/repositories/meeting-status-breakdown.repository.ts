import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface StatusBreakdownParams {
  from: string;
  to: string;
  scopeDepartmentIds: string[] | null;
  departmentIds?: string[];
}

@Injectable()
export class MeetingStatusBreakdownRepository {
  private readonly logger = new Logger(MeetingStatusBreakdownRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  async getManagerDepartmentIds(userId: string): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL)) AND is_active = true`,
      [userId],
    );
    return rows.map((r: { id: string }) => r.id);
  }

  private buildScopeWhere(
    params: StatusBreakdownParams,
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

    const clause = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
    return { clause, values };
  }

  async getStatusCounts(
    params: StatusBreakdownParams,
  ): Promise<Map<'scheduled' | 'completed' | 'cancelled' | 'no_show', number>> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;

    const sql = `
      WITH classified_meetings AS (
        SELECT
          m.id,
          CASE
            WHEN m.status = 'cancelled' THEN 'cancelled'
            WHEN COUNT(nsc.id) FILTER (WHERE nsc.detection_status IN ('confirmed', 'released')) > 0 THEN 'no_show'
            WHEN m.status = 'completed' THEN 'completed'
            WHEN m.status = 'scheduled' THEN 'scheduled'
            ELSE NULL
          END AS classified_status
        FROM meetings m
        LEFT JOIN room_bookings rb ON rb.meeting_id = m.id
        LEFT JOIN no_show_cases nsc ON nsc.booking_id = rb.id
        WHERE m.deleted_at IS NULL
          AND m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
          AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
          AND ${scope.clause}
        GROUP BY m.id, m.status
      )
      SELECT
        classified_status,
        COUNT(*)::int AS cnt
      FROM classified_meetings
      WHERE classified_status IS NOT NULL
      GROUP BY classified_status
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);

    const result = new Map<
      'scheduled' | 'completed' | 'cancelled' | 'no_show',
      number
    >();
    // Pre-populate with 0 to ensure we have entries, though the service will do this too.
    result.set('scheduled', 0);
    result.set('completed', 0);
    result.set('cancelled', 0);
    result.set('no_show', 0);

    for (const row of rows) {
      if (
        row.classified_status === 'scheduled' ||
        row.classified_status === 'completed' ||
        row.classified_status === 'cancelled' ||
        row.classified_status === 'no_show'
      ) {
        result.set(row.classified_status, row.cnt ?? 0);
      }
    }

    return result;
  }
}
