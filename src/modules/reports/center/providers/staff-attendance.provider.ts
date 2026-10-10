import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { resolveNonStaffDepartmentIds } from '../../../../common/utils/non-staff-department.util.js';
import { REPORT_DEFINITIONS } from '../report-definition.registry.js';
import { describeFilters } from '../report-filter-lines.js';
import type { ReportFilters, ReportModel, ReportPage, ReportProvider, ResolvedScope } from '../report-model.js';
import {
  classifyDay, DEFAULT_STAFF_ATTENDANCE_RULES, workdaysInRange, type DayResult, type StaffAttendanceRules,
} from '../staff-attendance.rules.js';
import { pageRows, pct, round1, vnDayEnd, vnDayStart } from './report-provider.util.js';

const TZ = `'Asia/Ho_Chi_Minh'`;
const UUID_RE = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const NOTES = [
  'Chưa trừ ngày nghỉ lễ và nghỉ phép; những ngày này đang được tính là vắng.',
  'Cán bộ không có ảnh khuôn mặt đã duyệt và không có xe đăng ký sẽ luôn hiện vắng.',
];

interface Staff { id: string; employee_code: string; full_name: string; department_id: string | null; department_name: string | null }
interface Seen { user_id: string; day: string; first_seen: Date; last_seen: Date }

/**
 * Chuyên cần cán bộ (2.13 — loại mới). Lần thấy đầu/cuối mỗi ngày (giờ VN) gộp ở DB từ sự kiện khuôn mặt IVSS
 * và nhật ký cổng có chủ; phân loại ở ứng dụng bằng `classifyDay`.
 */
@Injectable()
export class StaffAttendanceReportProvider implements ReportProvider {
  readonly type = 'staff-attendance' as const;

  constructor(private readonly dataSource: DataSource) {}

  async loadRules(): Promise<StaffAttendanceRules> {
    try {
      const rows: Array<{ config_json: Partial<StaffAttendanceRules> | null }> = await this.dataSource.query(
        `SELECT config_json FROM system_configs WHERE config_key = 'report.staff_attendance.rules' LIMIT 1`,
      );
      const c = rows[0]?.config_json;
      if (c && typeof c === 'object') {
        const d = DEFAULT_STAFF_ATTENDANCE_RULES;
        const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
        return {
          workStart: typeof c.workStart === 'string' && hhmm.test(c.workStart) ? c.workStart : d.workStart,
          workEnd: typeof c.workEnd === 'string' && hhmm.test(c.workEnd) ? c.workEnd : d.workEnd,
          graceMinutes: Number.isInteger(c.graceMinutes) && (c.graceMinutes as number) >= 0 ? (c.graceMinutes as number) : d.graceMinutes,
          workdays: Array.isArray(c.workdays) && c.workdays.every((x) => Number.isInteger(x) && x >= 0 && x <= 6) && c.workdays.length ? c.workdays : d.workdays,
        };
      }
    } catch {
      // Thiếu bảng cấu hình hoặc lỗi đọc → dùng mặc định, không làm hỏng báo cáo.
    }
    return DEFAULT_STAFF_ATTENDANCE_RULES;
  }

  async build(filters: ReportFilters, scope: ResolvedScope, page: ReportPage | null, now: Date): Promise<ReportModel> {
    const def = REPORT_DEFINITIONS['staff-attendance'];
    const rules = await this.loadRules();
    const days = workdaysInRange(filters.from, filters.to, rules, now);
    const staff = await this.listStaff(filters, scope);
    const seenByKey = await this.loadSeen(staff.map((s) => s.id), filters);

    type Fact = { staff: Staff; day: string; result: DayResult };
    const facts: Fact[] = [];
    for (const s of staff) {
      for (const day of days) {
        const seen = seenByKey.get(`${s.id}|${day}`);
        const result = classifyDay(seen ? { firstSeen: seen.first_seen, lastSeen: seen.last_seen } : null, day, rules, now);
        if (result.status === 'pending' || result.status === 'off') continue;
        facts.push({ staff: s, day, result });
      }
    }
    const isOnTime = (f: Fact) => f.result.status === 'on_time';
    const isLate = (f: Fact) => f.result.status === 'late' || f.result.status === 'late_and_early';
    const isEarly = (f: Fact) => f.result.status === 'early_leave' || f.result.status === 'late_and_early';
    const isAbsent = (f: Fact) => f.result.status === 'absent';
    const present = facts.filter((f) => !isAbsent(f));

    const rows = staff.map((s) => {
      const mine = facts.filter((f) => f.staff.id === s.id);
      const worked = mine.filter((f) => !isAbsent(f));
      return {
        employeeCode: s.employee_code,
        fullName: s.full_name,
        departmentName: s.department_name,
        workDays: worked.length,
        onTime: mine.filter(isOnTime).length,
        late: mine.filter(isLate).length,
        earlyLeave: mine.filter(isEarly).length,
        absent: mine.filter(isAbsent).length,
        totalHours: round1(worked.reduce((t, f) => t + f.result.hours, 0)),
        rate: pct(mine.filter(isOnTime).length, mine.length),
      };
    }).filter((r) => r.workDays + r.absent > 0);

    const dailyKeys = [...new Set(facts.map((f) => f.day))].sort();
    const deptNames = [...new Set(facts.map((f) => f.staff.department_name ?? 'Chưa có đơn vị'))];
    const paged = pageRows(rows, page, undefined, []);
    return {
      type: 'staff-attendance',
      title: def.title,
      period: { from: filters.from, to: filters.to },
      filterLines: await describeFilters(this.dataSource, def, filters),
      kpis: [
        { key: 'attendanceRate', label: 'Tỷ lệ chuyên cần', value: pct(facts.filter(isOnTime).length, facts.length), format: 'percent' },
        { key: 'lateCount', label: 'Lượt đi muộn', value: facts.filter(isLate).length, format: 'number' },
        { key: 'earlyLeaveCount', label: 'Lượt về sớm', value: facts.filter(isEarly).length, format: 'number' },
        { key: 'absentDays', label: 'Ngày vắng', value: facts.filter(isAbsent).length, format: 'number' },
        { key: 'avgHoursPerDay', label: 'Giờ hiện diện TB/ngày', value: present.length ? round1(present.reduce((t, f) => t + f.result.hours, 0) / present.length) : 0, format: 'hours' },
      ],
      charts: [
        {
          key: 'daily',
          data: dailyKeys.map((d) => {
            const day = facts.filter((f) => f.day === d);
            return { date: `${d.slice(8, 10)}/${d.slice(5, 7)}`, rate: pct(day.filter(isOnTime).length, day.length) };
          }),
        },
        {
          key: 'byDepartment',
          data: deptNames.map((name) => {
            const dept = facts.filter((f) => (f.staff.department_name ?? 'Chưa có đơn vị') === name);
            return { name, rate: pct(dept.filter(isOnTime).length, dept.length) };
          }),
        },
      ],
      columns: def.columns,
      rows: paged.rows,
      total: paged.total,
      notes: NOTES,
    };
  }

  private async listStaff(filters: ReportFilters, scope: ResolvedScope): Promise<Staff[]> {
    const nonStaff = await resolveNonStaffDepartmentIds(this.dataSource);
    const params: unknown[] = [nonStaff];
    let where = '';
    if (filters['departmentId']) { params.push(filters['departmentId']); where += ` AND u.department_id = $${params.length}::uuid`; }
    if (filters['staffId']) { params.push(filters['staffId']); where += ` AND u.id = $${params.length}::uuid`; }
    if (filters.q) { params.push(filters.q); where += ` AND (unaccent(lower(u.full_name)) LIKE '%' || unaccent(lower($${params.length})) || '%' OR lower(u.employee_code) LIKE '%' || lower($${params.length}) || '%')`; }
    if (!scope.unrestricted) { params.push(scope.departmentIds ?? []); where += ` AND u.department_id = ANY($${params.length}::uuid[])`; }
    return this.dataSource.query(
      `SELECT u.id, u.employee_code, u.full_name, u.department_id, d.department_name
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.deleted_at IS NULL AND u.employment_status IN ('active','probation') AND u.account_status = 'active'
          AND (u.department_id IS NULL OR NOT (u.department_id = ANY($1::uuid[])))
          AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND ur.is_active = true AND r.role_code = 'STUDENT')
          ${where}
        ORDER BY u.full_name, u.employee_code`,
      params,
    );
  }

  private async loadSeen(userIds: string[], filters: ReportFilters): Promise<Map<string, Seen>> {
    if (userIds.length === 0) return new Map();
    const rows: Seen[] = await this.dataSource.query(
      `WITH seen AS (
         SELECT (e.payload_json->>'userId')::uuid AS user_id, e.event_time AS t
           FROM iot_device_events e
          WHERE e.event_type = 'ivss_face_event' AND e.payload_json->>'userId' ~ '${UUID_RE}'
            AND e.event_time >= $2 AND e.event_time <= $3
            AND (e.payload_json->>'userId')::uuid = ANY($1::uuid[])
         UNION ALL
         SELECT l.user_id, l.access_time FROM gate_access_logs l
          WHERE l.user_id = ANY($1::uuid[]) AND l.access_time >= $2 AND l.access_time <= $3
       )
       SELECT user_id, to_char((t AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day, min(t) AS first_seen, max(t) AS last_seen
         FROM seen GROUP BY 1, 2`,
      [userIds, vnDayStart(filters.from), vnDayEnd(filters.to)],
    );
    return new Map(rows.map((r) => [`${r.user_id}|${r.day}`, r]));
  }
}
