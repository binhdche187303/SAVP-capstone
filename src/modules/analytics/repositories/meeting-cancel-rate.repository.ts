import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface CancelRateParams {
  from: string;
  to: string;
  scopeDepartmentIds: string[] | null;
  departmentIds?: string[];
  roomId?: string;
  organizerId?: string;
  granularity?: string;
}

export interface CancelRateSummaryResult {
  totalMeetingCount: number;
  cancelledCount: number;
}

export interface TopOrganizerResult {
  userId: string;
  email: string;
  fullName: string;
  organizedCount: number;
  cancelledCount: number;
}

export interface TopDepartmentResult {
  departmentId: string;
  departmentName: string;
  organizedCount: number;
  cancelledCount: number;
}

@Injectable()
export class MeetingCancelRateRepository {
  private readonly logger = new Logger(MeetingCancelRateRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  async getManagerDepartmentIds(userId: string): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL)) AND is_active = true`,
      [userId],
    );
    return rows.map((r: { id: string }) => r.id);
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );
    return rows?.[0]?.id ?? null;
  }

  private buildScopeWhere(
    params: CancelRateParams,
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

    // Filter organizerId
    if (params.organizerId) {
      conditions.push(`${alias}.organizer_id = $${idx}`);
      values.push(params.organizerId);
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

  async getCancelRateSummary(
    params: CancelRateParams,
  ): Promise<CancelRateSummaryResult> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;

    const sql = `
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE m.status = 'cancelled')::int AS cancelled_count
      FROM meetings m
      WHERE m.status <> 'draft'
        AND m.deleted_at IS NULL
        AND m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND ${scope.clause}
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);

    return {
      totalMeetingCount: rows?.[0]?.total_count ?? 0,
      cancelledCount: rows?.[0]?.cancelled_count ?? 0,
    };
  }

  async getCancelRateSeries(
    params: CancelRateParams,
  ): Promise<Map<string, { totalCount: number; cancelledCount: number }>> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;
    const formatPattern = this.getFormatPattern(params.granularity || 'week');

    const sql = `
      SELECT
        TO_CHAR(m.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh', '${formatPattern}') AS period,
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE m.status = 'cancelled')::int AS cancelled_count
      FROM meetings m
      WHERE m.status <> 'draft'
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

    const result = new Map<
      string,
      { totalCount: number; cancelledCount: number }
    >();
    for (const row of rows) {
      result.set(row.period, {
        totalCount: row.total_count ?? 0,
        cancelledCount: row.cancelled_count ?? 0,
      });
    }
    return result;
  }

  async getTopOrganizers(
    params: CancelRateParams,
  ): Promise<TopOrganizerResult[]> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;

    const sql = `
      SELECT
        m.organizer_id AS user_id,
        u.email,
        u.full_name AS full_name,
        COUNT(*)::int AS organized_count,
        COUNT(*) FILTER (WHERE m.status = 'cancelled')::int AS cancelled_count
      FROM meetings m
      INNER JOIN users u ON u.id = m.organizer_id
      WHERE m.status <> 'draft'
        AND m.deleted_at IS NULL
        AND m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND ${scope.clause}
      GROUP BY m.organizer_id, u.email, u.full_name
      HAVING COUNT(*) >= 3
      ORDER BY cancelled_count DESC, (COUNT(*) FILTER (WHERE m.status = 'cancelled')::double precision / COUNT(*)) DESC
      LIMIT 10
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);

    return rows.map((r: any) => ({
      userId: r.user_id,
      email: r.email,
      fullName: r.full_name,
      organizedCount: r.organized_count,
      cancelledCount: r.cancelled_count,
    }));
  }

  async getTopDepartments(
    params: CancelRateParams,
  ): Promise<TopDepartmentResult[]> {
    const scope = this.buildScopeWhere(params, 'm');
    const pIdx = scope.values.length + 1;

    const sql = `
      SELECT
        u.department_id AS department_id,
        d.department_name AS department_name,
        COUNT(*)::int AS organized_count,
        COUNT(*) FILTER (WHERE m.status = 'cancelled')::int AS cancelled_count
      FROM meetings m
      INNER JOIN users u ON u.id = m.organizer_id
      INNER JOIN departments d ON d.id = u.department_id
      WHERE m.status <> 'draft'
        AND m.deleted_at IS NULL
        AND m.start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND ${scope.clause}
      GROUP BY u.department_id, d.department_name
      HAVING COUNT(*) >= 3
      ORDER BY cancelled_count DESC, (COUNT(*) FILTER (WHERE m.status = 'cancelled')::double precision / COUNT(*)) DESC
      LIMIT 10
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);

    return rows.map((r: any) => ({
      departmentId: r.department_id,
      departmentName: r.department_name,
      organizedCount: r.organized_count,
      cancelledCount: r.cancelled_count,
    }));
  }
}
