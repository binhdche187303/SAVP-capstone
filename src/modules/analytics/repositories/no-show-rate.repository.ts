import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface NoShowRateParams {
  from: string;
  to: string;
  scopeDepartmentIds: string[] | null;
  scopeRoomIds: string[] | null;
  departmentIds?: string[];
  roomId?: string;
  organizerId?: string;
}

export interface KpiAggregateResult {
  totalBookings: number;
  noShowCount: number;
}

export interface RankingDbItem {
  id: string;
  name: string;
  email?: string;
  totalBookings: number;
  noShowCount: number;
  fullCount: number;
}

@Injectable()
export class NoShowRateRepository {
  private readonly logger = new Logger(NoShowRateRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  async getManagerDepartmentIds(userId: string): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL)) AND is_active = true`,
      [userId],
    );
    return rows.map((r: { id: string }) => r.id);
  }

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

  async findUserIdByEmail(email: string): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );
    return rows?.[0]?.id ?? null;
  }

  private buildScopeWhere(
    params: NoShowRateParams,
    rbAlias: string,
    mAlias: string,
  ): { clause: string; values: unknown[] } {
    const values: unknown[] = [];
    let idx = 1;
    const conditions: string[] = [];

    // Enforce Manager Department Scope
    if (params.scopeDepartmentIds !== null) {
      if (params.scopeDepartmentIds.length === 0) {
        return { clause: 'FALSE', values: [] };
      }
      conditions.push(
        `${mAlias}.organizer_id IN (SELECT u.id FROM users u WHERE u.department_id = ANY($${idx}::uuid[]))`,
      );
      values.push(params.scopeDepartmentIds);
      idx++;
    }

    // Enforce Manager Room Scope
    if (params.scopeRoomIds !== null) {
      if (params.scopeRoomIds.length === 0) {
        return { clause: 'FALSE', values: [] };
      }
      conditions.push(`${rbAlias}.room_id = ANY($${idx}::uuid[])`);
      values.push(params.scopeRoomIds);
      idx++;
    }

    // Filter departmentIds (multi-select)
    if (params.departmentIds && params.departmentIds.length > 0) {
      conditions.push(
        `${mAlias}.organizer_id IN (SELECT u2.id FROM users u2 WHERE u2.department_id = ANY($${idx}::uuid[]))`,
      );
      values.push(params.departmentIds);
      idx++;
    }

    // Filter roomId
    if (params.roomId) {
      conditions.push(`${rbAlias}.room_id = $${idx}`);
      values.push(params.roomId);
      idx++;
    }

    // Filter organizerId
    if (params.organizerId) {
      conditions.push(`${mAlias}.organizer_id = $${idx}`);
      values.push(params.organizerId);
      idx++;
    }

    const clause = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
    return { clause, values };
  }

  async getKpiAggregate(params: NoShowRateParams): Promise<KpiAggregateResult> {
    const scope = this.buildScopeWhere(params, 'rb', 'm');
    const pIdx = scope.values.length + 1;

    const sql = `
      SELECT
        COUNT(DISTINCT rb.id)::int AS "totalBookings",
        COUNT(DISTINCT nsc.id) FILTER (WHERE nsc.detection_status IN ('confirmed', 'released'))::int AS "noShowCount"
      FROM room_bookings rb
      INNER JOIN meetings m ON m.id = rb.meeting_id
      LEFT JOIN no_show_cases nsc ON nsc.booking_id = rb.id
      WHERE rb.status IN ('approved', 'active', 'completed', 'released')
        AND m.deleted_at IS NULL
        AND rb.reserved_start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND rb.reserved_start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND ${scope.clause}
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);

    return {
      totalBookings: rows?.[0]?.totalBookings ?? 0,
      noShowCount: rows?.[0]?.noShowCount ?? 0,
    };
  }

  async getDailyTrend(
    params: NoShowRateParams,
  ): Promise<
    Array<{ date: string; noShowCount: number; totalBookings: number }>
  > {
    const scope = this.buildScopeWhere(params, 'rb', 'm');
    const pIdx = scope.values.length + 1;

    const sql = `
      SELECT
        (rb.reserved_start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS date,
        COUNT(DISTINCT rb.id)::int AS "totalBookings",
        COUNT(DISTINCT nsc.id) FILTER (WHERE nsc.detection_status IN ('confirmed', 'released'))::int AS "noShowCount"
      FROM room_bookings rb
      INNER JOIN meetings m ON m.id = rb.meeting_id
      LEFT JOIN no_show_cases nsc ON nsc.booking_id = rb.id
      WHERE rb.status IN ('approved', 'active', 'completed', 'released')
        AND m.deleted_at IS NULL
        AND rb.reserved_start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND rb.reserved_start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND ${scope.clause}
      GROUP BY (rb.reserved_start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      ORDER BY date ASC
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
    ]);

    return rows.map((r: any) => ({
      date: r.date,
      noShowCount: r.noShowCount,
      totalBookings: r.totalBookings,
    }));
  }

  async getRoomRanking(
    params: NoShowRateParams,
    page: number,
    limit: number,
  ): Promise<RankingDbItem[]> {
    const scope = this.buildScopeWhere(params, 'rb', 'm');
    const pIdx = scope.values.length + 1;
    const limitIdx = pIdx + 2;
    const offsetIdx = pIdx + 3;

    const sql = `
      SELECT
        r.id AS id,
        r.room_name AS name,
        COUNT(DISTINCT rb.id)::int AS "totalBookings",
        COUNT(DISTINCT nsc.id) FILTER (WHERE nsc.detection_status IN ('confirmed', 'released'))::int AS "noShowCount",
        COUNT(*) OVER()::int AS "fullCount"
      FROM room_bookings rb
      INNER JOIN meetings m ON m.id = rb.meeting_id
      INNER JOIN rooms r ON r.id = rb.room_id
      LEFT JOIN no_show_cases nsc ON nsc.booking_id = rb.id
      WHERE rb.status IN ('approved', 'active', 'completed', 'released')
        AND m.deleted_at IS NULL
        AND rb.reserved_start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND rb.reserved_start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND ${scope.clause}
      GROUP BY r.id, r.room_name
      ORDER BY "noShowCount" DESC, (COUNT(DISTINCT nsc.id) FILTER (WHERE nsc.detection_status IN ('confirmed', 'released'))::double precision / NULLIF(COUNT(DISTINCT rb.id), 0)) DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    return this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
      limit,
      (page - 1) * limit,
    ]);
  }

  async getDepartmentRanking(
    params: NoShowRateParams,
    page: number,
    limit: number,
  ): Promise<RankingDbItem[]> {
    const scope = this.buildScopeWhere(params, 'rb', 'm');
    const pIdx = scope.values.length + 1;
    const limitIdx = pIdx + 2;
    const offsetIdx = pIdx + 3;

    const sql = `
      SELECT
        d.id AS id,
        d.department_name AS name,
        COUNT(DISTINCT rb.id)::int AS "totalBookings",
        COUNT(DISTINCT nsc.id) FILTER (WHERE nsc.detection_status IN ('confirmed', 'released'))::int AS "noShowCount",
        COUNT(*) OVER()::int AS "fullCount"
      FROM room_bookings rb
      INNER JOIN meetings m ON m.id = rb.meeting_id
      INNER JOIN users u ON u.id = m.organizer_id
      INNER JOIN departments d ON d.id = u.department_id
      LEFT JOIN no_show_cases nsc ON nsc.booking_id = rb.id
      WHERE rb.status IN ('approved', 'active', 'completed', 'released')
        AND m.deleted_at IS NULL
        AND rb.reserved_start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND rb.reserved_start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND ${scope.clause}
      GROUP BY d.id, d.department_name
      ORDER BY (COUNT(DISTINCT nsc.id) FILTER (WHERE nsc.detection_status IN ('confirmed', 'released'))::double precision / NULLIF(COUNT(DISTINCT rb.id), 0)) DESC, "noShowCount" DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    return this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
      limit,
      (page - 1) * limit,
    ]);
  }

  async getOrganizerRanking(
    params: NoShowRateParams,
    page: number,
    limit: number,
  ): Promise<RankingDbItem[]> {
    const scope = this.buildScopeWhere(params, 'rb', 'm');
    const pIdx = scope.values.length + 1;
    const limitIdx = pIdx + 2;
    const offsetIdx = pIdx + 3;

    const sql = `
      SELECT
        u.id AS id,
        u.full_name AS name,
        u.email AS email,
        COUNT(DISTINCT rb.id)::int AS "totalBookings",
        COUNT(DISTINCT nsc.id) FILTER (WHERE nsc.detection_status IN ('confirmed', 'released'))::int AS "noShowCount",
        COUNT(*) OVER()::int AS "fullCount"
      FROM room_bookings rb
      INNER JOIN meetings m ON m.id = rb.meeting_id
      INNER JOIN users u ON u.id = m.organizer_id
      LEFT JOIN no_show_cases nsc ON nsc.booking_id = rb.id
      WHERE rb.status IN ('approved', 'active', 'completed', 'released')
        AND m.deleted_at IS NULL
        AND rb.reserved_start_time >= ($${pIdx} || ' 00:00:00+07')::timestamptz
        AND rb.reserved_start_time <= ($${pIdx + 1} || ' 23:59:59.999+07')::timestamptz
        AND ${scope.clause}
      GROUP BY u.id, u.full_name, u.email
      ORDER BY "noShowCount" DESC, (COUNT(DISTINCT nsc.id) FILTER (WHERE nsc.detection_status IN ('confirmed', 'released'))::double precision / NULLIF(COUNT(DISTINCT rb.id), 0)) DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    return this.dataSource.query(sql, [
      ...scope.values,
      params.from,
      params.to,
      limit,
      (page - 1) * limit,
    ]);
  }
}
