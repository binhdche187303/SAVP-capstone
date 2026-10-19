import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface OnTimeRateQueryParams {
  from: string;
  to: string;
  scopeDepartmentIds: string[] | null;
  departmentId?: string;
  meetingId?: string;
  search?: string;
  graceMinutes: number;
}

export interface UserLateStatRow {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  employeeCode: string | null;
  departmentId: string | null;
  departmentName: string | null;
  lateCount: number | string;
  onTimeCount: number | string;
  absentCount: number | string;
  totalRequired: number | string;
  lateRate: number | string;
  totalCount: number | string;
}

@Injectable()
export class OnTimeRateRepository {
  private readonly logger = new Logger(OnTimeRateRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  async getManagerDepartmentIds(userId: string): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL)) AND is_active = true`,
      [userId],
    );
    return rows.map((r: { id: string }) => r.id);
  }

  async getUserDetails(userId: string): Promise<{
    id: string;
    fullName: string;
    email: string;
    departmentId: string;
  } | null> {
    const rows = await this.dataSource.query(
      `SELECT id, full_name AS "fullName", email, department_id AS "departmentId" FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    if (!rows || rows.length === 0) return null;
    return rows[0];
  }

  private buildScopeWhere(params: OnTimeRateQueryParams): {
    clause: string;
    values: unknown[];
  } {
    const values: unknown[] = [];
    let idx = 1;
    const conditions: string[] = [];

    // Enforce Manager Department Scope (filters u.department_id!)
    if (params.scopeDepartmentIds !== null) {
      if (params.scopeDepartmentIds.length === 0) {
        return { clause: 'FALSE', values: [] };
      }
      conditions.push(`u.department_id = ANY($${idx}::uuid[])`);
      values.push(params.scopeDepartmentIds);
      idx++;
    }

    // Filter departmentId
    if (params.departmentId) {
      conditions.push(`u.department_id = $${idx}`);
      values.push(params.departmentId);
      idx++;
    }

    // Filter meetingId
    if (params.meetingId) {
      conditions.push(`m.id = $${idx}`);
      values.push(params.meetingId);
      idx++;
    }

    // Filter search
    if (params.search) {
      conditions.push(
        `(u.full_name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.employee_code ILIKE $${idx})`,
      );
      values.push(`%${params.search}%`);
      idx++;
    }

    const clause = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
    return { clause, values };
  }

  async getKpiTotals(params: OnTimeRateQueryParams): Promise<{
    onTimeCount: number;
    lateCount: number;
    absentCount: number;
    totalRequiredParticipants: number;
  }> {
    const scope = this.buildScopeWhere(params);
    const graceIdx = scope.values.length + 1;
    const fromIdx = graceIdx + 1;
    const toIdx = graceIdx + 2;

    const sql = `
      WITH classified AS (
        SELECT
          CASE
            WHEN ar.id IS NULL OR ar.attendance_status = 'absent' OR NOT ar.is_present THEN 'absent'
            WHEN $${graceIdx} = 0 THEN
              CASE WHEN NOT ar.is_late THEN 'on_time' ELSE 'late' END
            ELSE
              CASE WHEN ar.late_minutes IS NULL OR ar.late_minutes <= $${graceIdx} THEN 'on_time' ELSE 'late' END
          END AS status_bucket
        FROM meeting_participants mp
        INNER JOIN meetings m ON m.id = mp.meeting_id
        INNER JOIN users u ON u.id = mp.user_id
        LEFT JOIN attendance_records ar ON ar.meeting_id = m.id AND ar.user_id = mp.user_id
        WHERE m.status = 'completed' AND m.attendance_enabled = true
          AND m.deleted_at IS NULL
          AND mp.invitation_status <> 'declined'
          AND (ar.id IS NULL OR ar.attendance_status NOT IN ('invalidated', 'pending_review'))
          AND m.start_time >= ($${fromIdx} || ' 00:00:00+07')::timestamptz
          AND m.start_time <= ($${toIdx} || ' 23:59:59.999+07')::timestamptz
          AND ${scope.clause}
      )
      SELECT
        COUNT(*) FILTER (WHERE status_bucket = 'on_time')::int AS on_time_count,
        COUNT(*) FILTER (WHERE status_bucket = 'late')::int AS late_count,
        COUNT(*) FILTER (WHERE status_bucket = 'absent')::int AS absent_count,
        COUNT(*)::int AS total_count
      FROM classified
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.graceMinutes,
      params.from,
      params.to,
    ]);

    return {
      onTimeCount: rows?.[0]?.on_time_count ?? 0,
      lateCount: rows?.[0]?.late_count ?? 0,
      absentCount: rows?.[0]?.absent_count ?? 0,
      totalRequiredParticipants: rows?.[0]?.total_count ?? 0,
    };
  }

  async getTrendByWeek(params: OnTimeRateQueryParams): Promise<
    Map<
      string,
      {
        onTimeCount: number;
        lateCount: number;
        absentCount: number;
        totalRequiredParticipants: number;
      }
    >
  > {
    const scope = this.buildScopeWhere(params);
    const graceIdx = scope.values.length + 1;
    const fromIdx = graceIdx + 1;
    const toIdx = graceIdx + 2;

    const sql = `
      WITH classified AS (
        SELECT
          date_trunc('week', m.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS week_start,
          CASE
            WHEN ar.id IS NULL OR ar.attendance_status = 'absent' OR NOT ar.is_present THEN 'absent'
            WHEN $${graceIdx} = 0 THEN
              CASE WHEN NOT ar.is_late THEN 'on_time' ELSE 'late' END
            ELSE
              CASE WHEN ar.late_minutes IS NULL OR ar.late_minutes <= $${graceIdx} THEN 'on_time' ELSE 'late' END
          END AS status_bucket
        FROM meeting_participants mp
        INNER JOIN meetings m ON m.id = mp.meeting_id
        INNER JOIN users u ON u.id = mp.user_id
        LEFT JOIN attendance_records ar ON ar.meeting_id = m.id AND ar.user_id = mp.user_id
        WHERE m.status = 'completed' AND m.attendance_enabled = true
          AND m.deleted_at IS NULL
          AND mp.invitation_status <> 'declined'
          AND (ar.id IS NULL OR ar.attendance_status NOT IN ('invalidated', 'pending_review'))
          AND m.start_time >= ($${fromIdx} || ' 00:00:00+07')::timestamptz
          AND m.start_time <= ($${toIdx} || ' 23:59:59.999+07')::timestamptz
          AND ${scope.clause}
      )
      SELECT
        week_start::text AS week_key,
        COUNT(*) FILTER (WHERE status_bucket = 'on_time')::int AS on_time_count,
        COUNT(*) FILTER (WHERE status_bucket = 'late')::int AS late_count,
        COUNT(*) FILTER (WHERE status_bucket = 'absent')::int AS absent_count,
        COUNT(*)::int AS total_count
      FROM classified
      GROUP BY week_start
      ORDER BY week_start ASC
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.graceMinutes,
      params.from,
      params.to,
    ]);

    const result = new Map<
      string,
      {
        onTimeCount: number;
        lateCount: number;
        absentCount: number;
        totalRequiredParticipants: number;
      }
    >();
    for (const row of rows) {
      result.set(row.week_key, {
        onTimeCount: row.on_time_count,
        lateCount: row.late_count,
        absentCount: row.absent_count,
        totalRequiredParticipants: row.total_count,
      });
    }
    return result;
  }

  async getLateByHourOfDay(
    params: OnTimeRateQueryParams,
  ): Promise<
    Map<number, { lateCount: number; totalRequiredParticipants: number }>
  > {
    const scope = this.buildScopeWhere(params);
    const graceIdx = scope.values.length + 1;
    const fromIdx = graceIdx + 1;
    const toIdx = graceIdx + 2;

    const sql = `
      WITH classified AS (
        SELECT
          EXTRACT(HOUR FROM m.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS hour_of_day,
          CASE
            WHEN ar.id IS NULL OR ar.attendance_status = 'absent' OR NOT ar.is_present THEN 'absent'
            WHEN $${graceIdx} = 0 THEN
              CASE WHEN NOT ar.is_late THEN 'on_time' ELSE 'late' END
            ELSE
              CASE WHEN ar.late_minutes IS NULL OR ar.late_minutes <= $${graceIdx} THEN 'on_time' ELSE 'late' END
          END AS status_bucket
        FROM meeting_participants mp
        INNER JOIN meetings m ON m.id = mp.meeting_id
        INNER JOIN users u ON u.id = mp.user_id
        LEFT JOIN attendance_records ar ON ar.meeting_id = m.id AND ar.user_id = mp.user_id
        WHERE m.status = 'completed' AND m.attendance_enabled = true
          AND m.deleted_at IS NULL
          AND mp.invitation_status <> 'declined'
          AND (ar.id IS NULL OR ar.attendance_status NOT IN ('invalidated', 'pending_review'))
          AND m.start_time >= ($${fromIdx} || ' 00:00:00+07')::timestamptz
          AND m.start_time <= ($${toIdx} || ' 23:59:59.999+07')::timestamptz
          AND ${scope.clause}
      )
      SELECT
        hour_of_day,
        COUNT(*) FILTER (WHERE status_bucket = 'late')::int AS late_count,
        COUNT(*)::int AS total_count
      FROM classified
      GROUP BY hour_of_day
      ORDER BY hour_of_day ASC
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.graceMinutes,
      params.from,
      params.to,
    ]);

    const result = new Map<
      number,
      { lateCount: number; totalRequiredParticipants: number }
    >();
    for (const row of rows) {
      result.set(row.hour_of_day, {
        lateCount: row.late_count,
        totalRequiredParticipants: row.total_count,
      });
    }
    return result;
  }

  async getLateByDepartment(params: OnTimeRateQueryParams): Promise<
    Array<{
      departmentId: string;
      departmentName: string;
      lateCount: number;
      onTimeCount: number;
      totalRequiredParticipants: number;
    }>
  > {
    const scope = this.buildScopeWhere(params);
    const graceIdx = scope.values.length + 1;
    const fromIdx = graceIdx + 1;
    const toIdx = graceIdx + 2;

    const sql = `
      WITH classified AS (
        SELECT
          u.department_id,
          CASE
            WHEN ar.id IS NULL OR ar.attendance_status = 'absent' OR NOT ar.is_present THEN 'absent'
            WHEN $${graceIdx} = 0 THEN
              CASE WHEN NOT ar.is_late THEN 'on_time' ELSE 'late' END
            ELSE
              CASE WHEN ar.late_minutes IS NULL OR ar.late_minutes <= $${graceIdx} THEN 'on_time' ELSE 'late' END
          END AS status_bucket
        FROM meeting_participants mp
        INNER JOIN meetings m ON m.id = mp.meeting_id
        INNER JOIN users u ON u.id = mp.user_id
        LEFT JOIN attendance_records ar ON ar.meeting_id = m.id AND ar.user_id = mp.user_id
        WHERE m.status = 'completed' AND m.attendance_enabled = true
          AND m.deleted_at IS NULL
          AND mp.invitation_status <> 'declined'
          AND (ar.id IS NULL OR ar.attendance_status NOT IN ('invalidated', 'pending_review'))
          AND m.start_time >= ($${fromIdx} || ' 00:00:00+07')::timestamptz
          AND m.start_time <= ($${toIdx} || ' 23:59:59.999+07')::timestamptz
          AND ${scope.clause}
      )
      SELECT
        d.id AS department_id,
        d.department_name AS department_name,
        COUNT(*) FILTER (WHERE c.status_bucket = 'late')::int AS late_count,
        COUNT(*) FILTER (WHERE c.status_bucket = 'on_time')::int AS on_time_count,
        COUNT(*)::int AS total_count
      FROM classified c
      INNER JOIN departments d ON d.id = c.department_id
      GROUP BY d.id, d.department_name
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.graceMinutes,
      params.from,
      params.to,
    ]);

    return rows.map((r: any) => ({
      departmentId: r.department_id,
      departmentName: r.department_name,
      lateCount: r.late_count,
      onTimeCount: r.on_time_count,
      totalRequiredParticipants: r.total_count,
    }));
  }

  /**
   * Hồ sơ user cho endpoint /me — khác getUserDetails() ở chỗ có thêm
   * employeeCode/avatarUrl/departmentName (đúng contract PersonalStatsResponseDto).
   */
  async getUserProfileForStats(userId: string): Promise<{
    id: string;
    fullName: string;
    email: string;
    employeeCode: string | null;
    avatarUrl: string | null;
    departmentId: string | null;
    departmentName: string | null;
  } | null> {
    const rows = await this.dataSource.query(
      `SELECT
         u.id,
         u.full_name AS "fullName",
         u.email,
         u.employee_code AS "employeeCode",
         u.avatar_url AS "avatarUrl",
         u.department_id AS "departmentId",
         d.department_name AS "departmentName"
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = $1
       LIMIT 1`,
      [userId],
    );
    if (!rows || rows.length === 0) return null;
    return rows[0];
  }

  /**
   * KPI totals cho 1 user cụ thể (endpoint /me) — cùng logic phân loại on_time/late/absent
   * và cùng điều kiện "participant bắt buộc" (mp.invitation_status <> 'declined') như
   * getKpiTotals(), chỉ khác WHERE mp.user_id = $1 thay vì lọc theo department scope.
   */
  async getPersonalKpiTotals(
    userId: string,
    from: string,
    to: string,
    graceMinutes: number,
  ): Promise<{
    onTimeCount: number;
    lateCount: number;
    absentCount: number;
    totalRequiredParticipants: number;
  }> {
    const sql = `
      WITH classified AS (
        SELECT
          CASE
            WHEN ar.id IS NULL OR ar.attendance_status = 'absent' OR NOT ar.is_present THEN 'absent'
            WHEN $2 = 0 THEN
              CASE WHEN NOT ar.is_late THEN 'on_time' ELSE 'late' END
            ELSE
              CASE WHEN ar.late_minutes IS NULL OR ar.late_minutes <= $2 THEN 'on_time' ELSE 'late' END
          END AS status_bucket
        FROM meeting_participants mp
        INNER JOIN meetings m ON m.id = mp.meeting_id
        LEFT JOIN attendance_records ar ON ar.meeting_id = m.id AND ar.user_id = mp.user_id
        WHERE m.status = 'completed' AND m.attendance_enabled = true
          AND m.deleted_at IS NULL
          AND mp.invitation_status <> 'declined'
          AND (ar.id IS NULL OR ar.attendance_status NOT IN ('invalidated', 'pending_review'))
          AND mp.user_id = $1
          AND m.start_time >= ($3 || ' 00:00:00+07')::timestamptz
          AND m.start_time <= ($4 || ' 23:59:59.999+07')::timestamptz
      )
      SELECT
        COUNT(*) FILTER (WHERE status_bucket = 'on_time')::int AS on_time_count,
        COUNT(*) FILTER (WHERE status_bucket = 'late')::int AS late_count,
        COUNT(*) FILTER (WHERE status_bucket = 'absent')::int AS absent_count,
        COUNT(*)::int AS total_count
      FROM classified
    `;

    const rows = await this.dataSource.query(sql, [
      userId,
      graceMinutes,
      from,
      to,
    ]);

    return {
      onTimeCount: rows?.[0]?.on_time_count ?? 0,
      lateCount: rows?.[0]?.late_count ?? 0,
      absentCount: rows?.[0]?.absent_count ?? 0,
      totalRequiredParticipants: rows?.[0]?.total_count ?? 0,
    };
  }

  /**
   * Trend theo tuần cho 1 user cụ thể (endpoint /me) — mirror getTrendByWeek(),
   * lọc theo mp.user_id thay vì department scope.
   */
  async getPersonalTrendByWeek(
    userId: string,
    from: string,
    to: string,
    graceMinutes: number,
  ): Promise<
    Map<
      string,
      {
        onTimeCount: number;
        lateCount: number;
        absentCount: number;
        totalRequiredParticipants: number;
      }
    >
  > {
    const sql = `
      WITH classified AS (
        SELECT
          date_trunc('week', m.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS week_start,
          CASE
            WHEN ar.id IS NULL OR ar.attendance_status = 'absent' OR NOT ar.is_present THEN 'absent'
            WHEN $2 = 0 THEN
              CASE WHEN NOT ar.is_late THEN 'on_time' ELSE 'late' END
            ELSE
              CASE WHEN ar.late_minutes IS NULL OR ar.late_minutes <= $2 THEN 'on_time' ELSE 'late' END
          END AS status_bucket
        FROM meeting_participants mp
        INNER JOIN meetings m ON m.id = mp.meeting_id
        LEFT JOIN attendance_records ar ON ar.meeting_id = m.id AND ar.user_id = mp.user_id
        WHERE m.status = 'completed' AND m.attendance_enabled = true
          AND m.deleted_at IS NULL
          AND mp.invitation_status <> 'declined'
          AND (ar.id IS NULL OR ar.attendance_status NOT IN ('invalidated', 'pending_review'))
          AND mp.user_id = $1
          AND m.start_time >= ($3 || ' 00:00:00+07')::timestamptz
          AND m.start_time <= ($4 || ' 23:59:59.999+07')::timestamptz
      )
      SELECT
        week_start::text AS week_key,
        COUNT(*) FILTER (WHERE status_bucket = 'on_time')::int AS on_time_count,
        COUNT(*) FILTER (WHERE status_bucket = 'late')::int AS late_count,
        COUNT(*) FILTER (WHERE status_bucket = 'absent')::int AS absent_count,
        COUNT(*)::int AS total_count
      FROM classified
      GROUP BY week_start
      ORDER BY week_start ASC
    `;

    const rows = await this.dataSource.query(sql, [
      userId,
      graceMinutes,
      from,
      to,
    ]);

    const result = new Map<
      string,
      {
        onTimeCount: number;
        lateCount: number;
        absentCount: number;
        totalRequiredParticipants: number;
      }
    >();
    for (const row of rows) {
      result.set(row.week_key, {
        onTimeCount: row.on_time_count,
        lateCount: row.late_count,
        absentCount: row.absent_count,
        totalRequiredParticipants: row.total_count,
      });
    }
    return result;
  }

  async getLateHistory(
    userId: string,
    from: string,
    to: string,
    graceMinutes: number,
  ): Promise<
    Array<{
      meetingId: string;
      meetingTitle: string;
      scheduledStartTime: Date;
      checkInTime: Date;
      lateMinutes: number;
    }>
  > {
    const sql = `
      SELECT
        m.id AS "meetingId",
        m.title AS "meetingTitle",
        m.start_time AS "scheduledStartTime",
        ar.check_in_time AS "checkInTime",
        ar.late_minutes AS "lateMinutes"
      FROM attendance_records ar
      INNER JOIN meetings m ON m.id = ar.meeting_id
      WHERE ar.user_id = $1
        AND m.status = 'completed'
        AND m.deleted_at IS NULL
        AND m.start_time >= ($2 || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($3 || ' 23:59:59.999+07')::timestamptz
        AND ar.attendance_status NOT IN ('invalidated', 'pending_review')
        AND ar.is_present = true
        AND (
          ($4 = 0 AND ar.is_late = true) OR
          ($4 > 0 AND ar.late_minutes > $4)
        )
      ORDER BY m.start_time DESC
    `;

    return this.dataSource.query(sql, [userId, from, to, graceMinutes]);
  }

  async checkDepartmentExists(departmentId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM departments WHERE id = $1 AND is_active = true LIMIT 1`,
      [departmentId],
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  async getLateByUsers(
    params: OnTimeRateQueryParams,
    sortBy: 'lateRate' | 'lateCount' | 'fullName' = 'lateRate',
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    items: Array<{
      userId: string;
      fullName: string;
      email: string;
      avatarUrl: string | null;
      employeeCode: string | null;
      departmentId: string | null;
      departmentName: string | null;
      lateCount: number;
      onTimeCount: number;
      absentCount: number;
      totalRequired: number;
      lateRate: number;
    }>;
    total: number;
  }> {
    const scope = this.buildScopeWhere(params);
    if (scope.clause === 'FALSE') {
      return { items: [], total: 0 };
    }

    const graceIdx = scope.values.length + 1;
    const fromIdx = graceIdx + 1;
    const toIdx = graceIdx + 2;
    const limitIdx = graceIdx + 3;
    const offsetIdx = graceIdx + 4;

    const sortMap: Record<string, string> = {
      lateRate: 'late_rate DESC, full_name ASC',
      lateCount: 'late_count DESC, full_name ASC',
      fullName: 'full_name ASC',
    };
    const orderByClause = sortMap[sortBy] || sortMap.lateRate;
    const offset = (page - 1) * limit;

    const sql = `
      WITH classified AS (
        SELECT
          u.id AS user_id,
          u.full_name,
          u.email,
          u.avatar_url,
          u.employee_code,
          u.department_id,
          d.department_name,
          CASE
            WHEN ar.id IS NULL OR ar.attendance_status = 'absent' OR NOT ar.is_present THEN 'absent'
            WHEN $${graceIdx} = 0 THEN
              CASE WHEN NOT ar.is_late THEN 'on_time' ELSE 'late' END
            ELSE
              CASE WHEN ar.late_minutes IS NULL OR ar.late_minutes <= $${graceIdx} THEN 'on_time' ELSE 'late' END
          END AS status_bucket
        FROM meeting_participants mp
        INNER JOIN meetings m ON m.id = mp.meeting_id
        INNER JOIN users u ON u.id = mp.user_id
        LEFT JOIN departments d ON d.id = u.department_id
        LEFT JOIN attendance_records ar ON ar.meeting_id = m.id AND ar.user_id = mp.user_id
        WHERE m.status = 'completed' AND m.attendance_enabled = true
          AND m.deleted_at IS NULL
          AND mp.invitation_status <> 'declined'
          AND (ar.id IS NULL OR ar.attendance_status NOT IN ('invalidated', 'pending_review'))
          AND m.start_time >= ($${fromIdx} || ' 00:00:00+07')::timestamptz
          AND m.start_time <= ($${toIdx} || ' 23:59:59.999+07')::timestamptz
          AND ${scope.clause}
      ),
      aggregated AS (
        SELECT
          user_id,
          full_name,
          email,
          avatar_url,
          employee_code,
          department_id,
          department_name,
          COUNT(*) FILTER (WHERE status_bucket = 'late')::int AS late_count,
          COUNT(*) FILTER (WHERE status_bucket = 'on_time')::int AS on_time_count,
          COUNT(*) FILTER (WHERE status_bucket = 'absent')::int AS absent_count,
          COUNT(*)::int AS total_required,
          CASE 
            WHEN COUNT(*) > 0 THEN ROUND((COUNT(*) FILTER (WHERE status_bucket = 'late')::decimal / COUNT(*)::decimal) * 100, 1)
            ELSE 0 
          END::float AS late_rate
        FROM classified
        GROUP BY user_id, full_name, email, avatar_url, employee_code, department_id, department_name
      )
      SELECT
        user_id AS "userId",
        full_name AS "fullName",
        email,
        avatar_url AS "avatarUrl",
        employee_code AS "employeeCode",
        department_id AS "departmentId",
        department_name AS "departmentName",
        late_count AS "lateCount",
        on_time_count AS "onTimeCount",
        absent_count AS "absentCount",
        total_required AS "totalRequired",
        late_rate AS "lateRate",
        COUNT(*) OVER()::int AS "totalCount"
      FROM aggregated
      ORDER BY ${orderByClause}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const rows = await this.dataSource.query<UserLateStatRow[]>(sql, [
      ...scope.values,
      params.graceMinutes,
      params.from,
      params.to,
      limit,
      offset,
    ]);

    if (!rows || rows.length === 0) {
      return { items: [], total: 0 };
    }

    const total = Number(rows[0].totalCount ?? 0);
    const items = rows.map((r) => ({
      userId: r.userId,
      fullName: r.fullName,
      email: r.email,
      avatarUrl: r.avatarUrl ?? null,
      employeeCode: r.employeeCode ?? null,
      departmentId: r.departmentId ?? null,
      departmentName: r.departmentName ?? null,
      lateCount: Number(r.lateCount ?? 0),
      onTimeCount: Number(r.onTimeCount ?? 0),
      absentCount: Number(r.absentCount ?? 0),
      totalRequired: Number(r.totalRequired ?? 0),
      lateRate: Number(r.lateRate ?? 0),
    }));

    return { items, total };
  }
}
