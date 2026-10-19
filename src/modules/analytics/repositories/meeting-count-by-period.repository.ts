import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface CountByPeriodParams {
  from: string;
  to: string;
  scopeDepartmentIds: string[] | null;
  departmentId?: string;
  roomId?: string;
  meetingType?: string;
  granularity?: string;
}

@Injectable()
export class MeetingCountByPeriodRepository {
  private readonly logger = new Logger(MeetingCountByPeriodRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  async getManagerDepartmentIds(userId: string): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL)) AND is_active = true`,
      [userId],
    );
    return rows.map((r: { id: string }) => r.id);
  }

  private buildScopeWhere(
    params: CountByPeriodParams,
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

    // Filter departmentId
    if (params.departmentId) {
      conditions.push(
        `${alias}.organizer_id IN (SELECT u2.id FROM users u2 WHERE u2.department_id = $${idx}::uuid)`,
      );
      values.push(params.departmentId);
      idx++;
    }

    // Filter roomId
    if (params.roomId) {
      conditions.push(`${alias}.room_id = $${idx}`);
      values.push(params.roomId);
      idx++;
    }

    // Filter meetingType
    if (params.meetingType) {
      conditions.push(`${alias}.meeting_type = $${idx}`);
      values.push(params.meetingType);
      idx++;
    }

    const clause = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
    return { clause, values };
  }

  private getFormatPattern(granularity: string): string {
    switch (granularity) {
      case 'month':
        return 'YYYY-MM';
      case 'week':
      default:
        return 'IYYY-"W"IW';
    }
  }

  async countMeetingsByBucket(
    params: CountByPeriodParams,
  ): Promise<Map<string, number>> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;
    const formatPattern = this.getFormatPattern(params.granularity || 'week');

    const sql = `
      SELECT
        TO_CHAR(m.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh', '${formatPattern}') AS period,
        COUNT(*)::int AS cnt
      FROM meetings m
      WHERE m.status IN ('completed', 'scheduled')
        AND m.deleted_at IS NULL
        AND m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND ${scope.clause}
      GROUP BY period
      ORDER BY period ASC
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);

    const result = new Map<string, number>();
    for (const row of rows) {
      result.set(row.period, row.cnt ?? 0);
    }
    return result;
  }
}
