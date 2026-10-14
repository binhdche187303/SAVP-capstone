import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { REPORT_DEFINITIONS } from '../report-definition.registry.js';
import { describeFilters } from '../report-filter-lines.js';
import type { ReportFilters, ReportModel, ReportPage, ReportProvider, ResolvedScope } from '../report-model.js';
import { pageRows, pct, vnDayKey } from './report-provider.util.js';

/** Vắng quá ngưỡng này (trên tổng số buổi) thì cảnh báo — khớp mockup FE. */
export const STUDENT_ABSENCE_WARNING_RATIO = 0.2;
const WARNING_TEXT = 'Vắng quá 20%';
const NOTES = [
  'Số buổi của một lớp = các buổi đã diễn ra trong kỳ báo cáo, lấy từ lịch buổi học (không tính buổi hủy) và từ các ngày lớp đó có điểm danh.',
  'Sinh viên đang học lớp nhưng không có bản ghi điểm danh trong một buổi được tính là vắng. Chỉ có giờ rời lớp mà không có giờ vào cũng tính là vắng.',
];

export interface StudentAttendanceCounts { sessions: number; present: number; late: number; absent: number }

/** Một dòng báo cáo từ số đếm: "có mặt" không gồm đi muộn, tỷ lệ = (số buổi − vắng) / số buổi. */
export function toStudentRow(counts: StudentAttendanceCounts): { rate: number; warning: string } {
  const { sessions, absent } = counts;
  return {
    rate: pct(sessions - absent, sessions),
    warning: sessions > 0 && absent / sessions > STUDENT_ABSENCE_WARNING_RATIO ? WARNING_TEXT : '',
  };
}

/**
 * Mỗi (buổi, sinh viên đang học) là một "sự kiện": buổi = lịch buổi học ∪ ngày có điểm danh (≤ hôm nay giờ VN, trong kỳ).
 * Trạng thái: không có bản ghi / không có giờ vào / status absent → absent; status late → late; còn lại → present.
 */
const FACTS_CTE = `
  WITH days AS (
    SELECT s.class_section_id, s.session_date AS day
      FROM class_sessions s
     WHERE s.status <> 'cancelled' AND s.session_date BETWEEN $1::date AND $2::date AND s.session_date <= $3::date
    UNION
    SELECT r.class_section_id, r.attendance_date
      FROM class_attendance_records r
     WHERE r.attendance_date BETWEEN $1::date AND $2::date AND r.attendance_date <= $3::date
  ),
  facts AS (
    SELECT cs.id AS section_id, cs.class_code, subj.subject_name, st.id AS student_id, st.student_code, u.full_name,
           d.day,
           CASE
             WHEN r.id IS NULL OR r.check_in_at IS NULL OR r.status = 'absent' THEN 'absent'
             WHEN r.status = 'late' THEN 'late'
             ELSE 'present'
           END AS status
      FROM days d
      JOIN class_sections cs ON cs.id = d.class_section_id AND cs.deleted_at IS NULL
      JOIN subjects subj ON subj.id = cs.subject_id
      JOIN class_enrollments ce ON ce.class_section_id = cs.id AND ce.status = 'active'
                               AND (ce.enrolled_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= d.day
      JOIN students st ON st.id = ce.student_id AND st.deleted_at IS NULL
      JOIN users u ON u.id = st.user_id
      LEFT JOIN class_attendance_records r
        ON r.class_section_id = cs.id AND r.student_id = st.id AND r.attendance_date = d.day
     WHERE true __WHERE__
  )`;

interface SectionRow { section_id: string; class_code: string; subject_name: string; student_code: string; full_name: string; sessions: number; present: number; late: number; absent: number }

/**
 * Chuyên cần sinh viên (2.13 + 2.7). Nguồn: `class_attendance_records` (điểm danh khuôn mặt/tay theo lớp-ngày)
 * đối chiếu danh sách lớp `class_enrollments`; tổng hợp ở DB, chỉ trả số đếm.
 */
@Injectable()
export class StudentAttendanceReportProvider implements ReportProvider {
  readonly type = 'student-attendance' as const;

  constructor(private readonly dataSource: DataSource) {}

  async build(filters: ReportFilters, scope: ResolvedScope, page: ReportPage | null, now: Date): Promise<ReportModel> {
    const def = REPORT_DEFINITIONS['student-attendance'];
    const base: unknown[] = [filters.from, filters.to, vnDayKey(now)];
    const { where, params } = this.buildWhere(filters, scope, base);
    const cte = FACTS_CTE.replace('__WHERE__', where);

    const [rawRows, totals, weeks, bySection] = await Promise.all([
      this.dataSource.query(
        `${cte}
         SELECT section_id, class_code, subject_name, student_code, full_name,
                count(*)::int AS sessions,
                count(*) FILTER (WHERE status = 'present')::int AS present,
                count(*) FILTER (WHERE status = 'late')::int AS late,
                count(*) FILTER (WHERE status = 'absent')::int AS absent
           FROM facts GROUP BY section_id, class_code, subject_name, student_id, student_code, full_name`,
        params,
      ) as Promise<SectionRow[]>,
      this.dataSource.query(
        `${cte}
         SELECT count(DISTINCT (section_id, day))::int AS session_count, count(*)::int AS total,
                count(*) FILTER (WHERE status = 'late')::int AS late,
                count(*) FILTER (WHERE status = 'absent')::int AS absent
           FROM facts`,
        params,
      ) as Promise<Array<{ session_count: number; total: number; late: number; absent: number }>>,
      this.dataSource.query(
        `${cte}
         SELECT to_char(date_trunc('week', day::timestamp), 'DD/MM') AS week, date_trunc('week', day::timestamp) AS monday,
                count(*)::int AS total, count(*) FILTER (WHERE status = 'absent')::int AS absent
           FROM facts GROUP BY 2 ORDER BY 2`,
        params,
      ) as Promise<Array<{ week: string; total: number; absent: number }>>,
      this.dataSource.query(
        `${cte}
         SELECT class_code || ' – ' || subject_name AS name, count(*)::int AS total,
                count(*) FILTER (WHERE status = 'absent')::int AS absent
           FROM facts GROUP BY section_id, class_code, subject_name ORDER BY class_code`,
        params,
      ) as Promise<Array<{ name: string; total: number; absent: number }>>,
    ]);

    const rows = rawRows.map((r) => ({
      studentCode: r.student_code,
      fullName: r.full_name,
      classSectionName: r.class_code,
      subjectName: r.subject_name,
      sessions: r.sessions,
      present: r.present,
      late: r.late,
      absent: r.absent,
      ...toStudentRow(r),
    }));
    const t = totals[0] ?? { session_count: 0, total: 0, late: 0, absent: 0 };
    const paged = pageRows(rows, page, filters.q, ['studentCode', 'fullName', 'classSectionName', 'subjectName']);
    return {
      type: 'student-attendance',
      title: def.title,
      period: { from: filters.from, to: filters.to },
      filterLines: await describeFilters(this.dataSource, def, filters),
      kpis: [
        { key: 'attendanceRate', label: 'Tỷ lệ chuyên cần', value: pct(t.total - t.absent, t.total), format: 'percent' },
        { key: 'sessionCount', label: 'Số buổi', value: t.session_count, format: 'number' },
        { key: 'absentCount', label: 'Lượt vắng', value: t.absent, format: 'number' },
        { key: 'lateCount', label: 'Lượt muộn', value: t.late, format: 'number' },
        { key: 'atRiskStudents', label: 'SV vắng quá 20%', value: new Set(rows.filter((r) => r.warning).map((r) => r.studentCode)).size, format: 'number' },
      ],
      charts: [
        { key: 'weekly', data: weeks.map((w) => ({ week: `Tuần ${w.week}`, rate: pct(w.total - w.absent, w.total) })) },
        { key: 'bySection', data: bySection.map((s) => ({ name: s.name, rate: pct(s.total - s.absent, s.total) })) },
      ],
      columns: def.columns,
      rows: paged.rows,
      total: paged.total,
      notes: NOTES,
    };
  }

  /** Bộ lọc học kỳ/môn/lớp + phạm vi đơn vị (đơn vị của sinh viên) → mệnh đề WHERE tham số hóa. */
  private buildWhere(filters: ReportFilters, scope: ResolvedScope, base: unknown[]): { where: string; params: unknown[] } {
    const params = [...base];
    let where = '';
    const eq = (key: string, column: string) => {
      const v = filters[key];
      if (!v) return;
      params.push(v);
      where += ` AND ${column}::text = $${params.length}`;
    };
    eq('semesterId', 'cs.semester_id');
    eq('subjectId', 'cs.subject_id');
    eq('classSectionId', 'cs.id');
    if (!scope.unrestricted) {
      params.push(scope.departmentIds ?? []);
      where += ` AND st.department_id = ANY($${params.length}::uuid[])`;
    }
    return { where, params };
  }
}
