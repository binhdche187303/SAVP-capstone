/**
 * Dữ liệu UEL cần bổ sung: SV / cán bộ chưa có email, lớp HP chưa có giảng viên.
 * Tóm tắt lưu kèm mỗi lượt đồng bộ (lịch sử); danh sách chi tiết xuất Excel để người dùng tự bổ sung.
 * Đọc thẳng DB (không gọi UEL).
 */
import * as ExcelJS from 'exceljs';
import type { DataSource } from 'typeorm';
import {
  cohortOfClass,
  lecturerNamesOf,
  personNameKey,
} from './uel-sync.mapper.js';

/** Email tạm sinh cho người UEL không có email (emailOf). */
const NO_EMAIL = '%@no-email.uel.local';
const OTHER_GROUP = 'Khác';

export type SectionGapReason =
  | 'not_assigned'
  | 'ambiguous'
  | 'not_in_staff'
  | 'pending';

export const SECTION_GAP_REASON_LABEL: Record<SectionGapReason, string> = {
  not_assigned: 'UEL chưa phân công giảng viên',
  ambiguous: 'Tên GV trùng nhiều cán bộ — cần chọn đúng người',
  not_in_staff: 'GV không có trong danh sách nhân sự UEL',
  pending: 'Đã khớp GV, sẽ gán ở lần đồng bộ lớp HP tới',
};

export interface UelGapSummary {
  generatedAt: string;
  students: {
    total: number;
    noEmail: number;
    groups: { label: string; total: number; noEmail: number }[];
  };
  staff: { total: number; noEmail: number };
  sections: {
    total: number;
    noLecturer: number;
    reasons: Record<SectionGapReason, number>;
  };
}

interface StudentGap {
  code: string;
  name: string;
  cls: string | null;
  dept: string | null;
}
interface StaffGap {
  code: string;
  name: string;
  dept: string | null;
}
interface SectionGap {
  term: string;
  code: string;
  subjectCode: string;
  subjectName: string | null;
  uelLecturer: string | null;
  reason: SectionGapReason;
}

export interface UelGaps {
  studentClasses: { cls: string | null; total: number; noEmail: number }[];
  students: StudentGap[];
  staffTotal: number;
  staff: StaffGap[];
  sectionTotal: number;
  sections: SectionGap[];
}

/** Nhóm khóa theo lớp sinh hoạt: K15–K39 → "Kxx"; liên kết quốc tế / SĐH / hệ khác (K44, K64…) → "Khác". */
export function cohortGroupOf(cls: string | null): string {
  const k = cohortOfClass(cls);
  return k !== null && k >= 15 && k < 40 ? `K${k}` : OTHER_GROUP;
}

export function sectionGapReasonOf(
  uelLecturer: string | null,
  staffByName: ReadonlyMap<string, string[]>,
): SectionGapReason {
  const [first] = lecturerNamesOf(uelLecturer);
  if (!first) return 'not_assigned';
  const n = staffByName.get(first)?.length ?? 0;
  if (n > 1) return 'ambiguous';
  return n === 0 ? 'not_in_staff' : 'pending';
}

/** Cán bộ (không phải SV) đang làm, theo họ tên chuẩn hóa — dùng gán GV theo tên. */
export async function staffIdsByName(
  db: DataSource,
): Promise<Map<string, string[]>> {
  const rows = await db.query<{ lecturer_name: string; id: string }[]>(
    `SELECT u.full_name AS lecturer_name, u.id FROM users u
      WHERE u.deleted_at IS NULL AND u.employee_code IS NOT NULL
        AND u.employment_status <> 'resigned'
        AND NOT EXISTS (SELECT 1 FROM students s WHERE s.user_id = u.id AND s.deleted_at IS NULL)`,
  );
  const out = new Map<string, string[]>();
  for (const x of rows) {
    const k = personNameKey(x.lecturer_name);
    out.set(k, [...(out.get(k) ?? []), x.id]);
  }
  return out;
}

const STAFF_WHERE = `u.deleted_at IS NULL AND u.employee_code IS NOT NULL
        AND u.employment_status <> 'resigned'
        AND NOT EXISTS (SELECT 1 FROM students s WHERE s.user_id = u.id AND s.deleted_at IS NULL)`;

export async function loadGaps(db: DataSource): Promise<UelGaps> {
  const studentClasses = await db.query<
    { cls: string | null; total: number; no_email: number }[]
  >(
    `SELECT s.administrative_class AS cls, count(*)::int AS total,
            count(*) FILTER (WHERE u.email LIKE $1)::int AS no_email
       FROM students s JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
      WHERE s.deleted_at IS NULL
      GROUP BY s.administrative_class`,
    [NO_EMAIL],
  );
  const students = await db.query<StudentGap[]>(
    `SELECT s.student_code AS code, u.full_name AS name, s.administrative_class AS cls,
            d.department_name AS dept
       FROM students s JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
       LEFT JOIN departments d ON d.id = s.department_id
      WHERE s.deleted_at IS NULL AND u.email LIKE $1
      ORDER BY s.administrative_class NULLS LAST, s.student_code`,
    [NO_EMAIL],
  );
  const [staffCount] = await db.query<{ total: number }[]>(
    `SELECT count(*)::int AS total FROM users u WHERE ${STAFF_WHERE}`,
  );
  const staff = await db.query<StaffGap[]>(
    `SELECT u.employee_code AS code, u.full_name AS name, d.department_name AS dept
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE ${STAFF_WHERE} AND u.email LIKE $1
      ORDER BY d.department_name NULLS LAST, u.employee_code`,
    [NO_EMAIL],
  );
  const [sectionCount] = await db.query<{ total: number }[]>(
    `SELECT count(*)::int AS total FROM class_sections cs
      WHERE cs.deleted_at IS NULL AND cs.source = 'uel_api'`,
  );
  const byName = await staffIdsByName(db);
  const sectionRows = await db.query<
    {
      term: string;
      code: string;
      subject_code: string;
      subject_name: string | null;
      uel_lecturer: string | null;
    }[]
  >(
    `SELECT sm.semester_code AS term, cs.class_code AS code, sub.subject_code,
            sub.subject_name, cs.uel_lecturer_name AS uel_lecturer
       FROM class_sections cs
       JOIN semesters sm ON sm.id = cs.semester_id
       JOIN subjects sub ON sub.id = cs.subject_id
      WHERE cs.deleted_at IS NULL AND cs.source = 'uel_api' AND cs.lecturer_user_id IS NULL
      ORDER BY sm.semester_code, cs.class_code`,
  );
  return {
    studentClasses: studentClasses.map((c) => ({
      cls: c.cls,
      total: Number(c.total),
      noEmail: Number(c.no_email),
    })),
    students,
    staffTotal: Number(staffCount?.total ?? 0),
    staff,
    sectionTotal: Number(sectionCount?.total ?? 0),
    sections: sectionRows.map((x) => ({
      term: x.term,
      code: x.code,
      subjectCode: x.subject_code,
      subjectName: x.subject_name,
      uelLecturer: x.uel_lecturer,
      reason: sectionGapReasonOf(x.uel_lecturer, byName),
    })),
  };
}

export function summarizeGaps(g: UelGaps, now = new Date()): UelGapSummary {
  const groups = new Map<string, { total: number; noEmail: number }>();
  for (const c of g.studentClasses) {
    const label = cohortGroupOf(c.cls);
    const x = groups.get(label) ?? { total: 0, noEmail: 0 };
    x.total += c.total;
    x.noEmail += c.noEmail;
    groups.set(label, x);
  }
  const ordered = [...groups.entries()]
    .sort(([a], [b]) =>
      a === OTHER_GROUP ? 1 : b === OTHER_GROUP ? -1 : a.localeCompare(b),
    )
    .map(([label, x]) => ({ label, ...x }));
  const reasons: Record<SectionGapReason, number> = {
    not_assigned: 0,
    ambiguous: 0,
    not_in_staff: 0,
    pending: 0,
  };
  for (const s of g.sections) reasons[s.reason]++;
  return {
    generatedAt: now.toISOString(),
    students: {
      total: ordered.reduce((n, x) => n + x.total, 0),
      noEmail: ordered.reduce((n, x) => n + x.noEmail, 0),
      groups: ordered,
    },
    staff: { total: g.staffTotal, noEmail: g.staff.length },
    sections: {
      total: g.sectionTotal,
      noLecturer: g.sections.length,
      reasons,
    },
  };
}

function sheet(
  wb: ExcelJS.Workbook,
  name: string,
  columns: { header: string; key: string; width: number }[],
  rows: Record<string, unknown>[],
): void {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  ws.addRows(rows);
  if (rows.length)
    ws.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } };
}

/** File Excel: Tổng hợp + 3 danh sách, cột "(bổ sung)" để trống cho người dùng điền. */
export async function gapsWorkbook(g: UelGaps, now: Date): Promise<Buffer> {
  const s = summarizeGaps(g, now);
  const wb = new ExcelJS.Workbook();
  wb.created = now;

  const sum: Record<string, unknown>[] = [
    {
      item: 'Thời điểm xuất',
      value: now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    },
    {
      item: 'Sinh viên',
      value: s.students.total,
      extra: `${s.students.noEmail} chưa có email`,
    },
    ...s.students.groups.map((x) => ({
      item: `  ${x.label === OTHER_GROUP ? 'Khác (liên kết, SĐH, hệ khác)' : x.label}`,
      value: x.total,
      extra: `${x.noEmail} chưa có email`,
    })),
    {
      item: 'Cán bộ',
      value: s.staff.total,
      extra: `${s.staff.noEmail} chưa có email`,
    },
    {
      item: 'Lớp học phần',
      value: s.sections.total,
      extra: `${s.sections.noLecturer} chưa có giảng viên`,
    },
    ...(Object.keys(s.sections.reasons) as SectionGapReason[]).map((k) => ({
      item: `  ${SECTION_GAP_REASON_LABEL[k]}`,
      value: s.sections.reasons[k],
    })),
  ];
  sheet(
    wb,
    'Tổng hợp',
    [
      { header: 'Mục', key: 'item', width: 50 },
      { header: 'Số lượng', key: 'value', width: 22 },
      { header: 'Ghi chú', key: 'extra', width: 30 },
    ],
    sum,
  );
  sheet(
    wb,
    'SV chưa có email',
    [
      { header: 'Mã SV', key: 'code', width: 16 },
      { header: 'Họ tên', key: 'name', width: 30 },
      { header: 'Lớp sinh hoạt', key: 'cls', width: 18 },
      { header: 'Khóa', key: 'group', width: 8 },
      { header: 'Khoa', key: 'dept', width: 30 },
      { header: 'Email (bổ sung)', key: 'email', width: 32 },
    ],
    g.students.map((x) => ({ ...x, group: cohortGroupOf(x.cls), email: '' })),
  );
  sheet(
    wb,
    'Cán bộ chưa có email',
    [
      { header: 'Mã NS', key: 'code', width: 14 },
      { header: 'Họ tên', key: 'name', width: 30 },
      { header: 'Đơn vị', key: 'dept', width: 36 },
      { header: 'Email (bổ sung)', key: 'email', width: 32 },
    ],
    g.staff.map((x) => ({ ...x, email: '' })),
  );
  sheet(
    wb,
    'Lớp HP chưa có GV',
    [
      { header: 'Học kỳ', key: 'term', width: 18 },
      { header: 'Mã lớp HP', key: 'code', width: 18 },
      { header: 'Mã HP', key: 'subjectCode', width: 12 },
      { header: 'Tên HP', key: 'subjectName', width: 36 },
      { header: 'GV theo UEL', key: 'uelLecturer', width: 30 },
      { header: 'Lý do', key: 'reason', width: 44 },
      { header: 'Mã GV (bổ sung)', key: 'gv', width: 16 },
    ],
    g.sections.map((x) => ({
      ...x,
      reason: SECTION_GAP_REASON_LABEL[x.reason],
      gv: '',
    })),
  );
  return Buffer.from(await wb.xlsx.writeBuffer());
}
