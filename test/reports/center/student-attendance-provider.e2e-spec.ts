// RPT-CENTER-BE-001 + 2.7 — chuyên cần sinh viên từ class_attendance_records, dữ liệu có đáp án biết trước (tuần 05–09/10/2026).
import { AppDataSource } from '../../../src/database/data-source';
import { StudentAttendanceReportProvider } from '../../../src/modules/reports/center/providers/student-attendance.provider';
import type { ResolvedScope } from '../../../src/modules/reports/center/report-model';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const TAG = 'fa11ed02';
const ADMIN: ResolvedScope = { unrestricted: true, departmentIds: null };
const NOW = new Date('2026-10-20T03:00:00Z');
const FILTERS = { from: '2026-10-05', to: '2026-10-09' };
const kpi = (m: { kpis: Array<{ key: string; value: number | null }> }, key: string) => m.kpis.find((k) => k.key === key)?.value;

describeDb('RPT-CENTER student-attendance', () => {
  let provider: StudentAttendanceReportProvider;
  let deptA: string; let deptB: string; let semester: string; let subject: string; let subjectY: string;
  let secX: string; let secY: string;
  const st: Record<'s1' | 's2' | 's3' | 's4', string> = { s1: '', s2: '', s3: '', s4: '' };

  const q = async (sql: string, p: unknown[] = []) => (await AppDataSource.query(sql, p))[0].id as string;
  const record = (sec: string, student: string, date: string, status: string, checkIn: string | null) =>
    AppDataSource.query(
      `INSERT INTO class_attendance_records (class_section_id, student_id, attendance_date, check_in_at, status) VALUES ($1,$2,$3::date,$4,$5)`,
      [sec, student, date, checkIn ? `${date}T${checkIn}:00+07:00` : null, status]);
  const cleanup = async () => {
    const secs = `(SELECT id FROM class_sections WHERE class_code LIKE '${TAG}-%')`;
    await AppDataSource.query(`DELETE FROM class_attendance_records WHERE class_section_id IN ${secs}`);
    await AppDataSource.query(`DELETE FROM class_enrollments WHERE class_section_id IN ${secs}`);
    await AppDataSource.query(`DELETE FROM class_sessions WHERE class_section_id IN ${secs}`);
    await AppDataSource.query(`DELETE FROM class_sections WHERE class_code LIKE '${TAG}-%'`);
    await AppDataSource.query(`DELETE FROM students WHERE student_code ILIKE '${TAG}-%'`);
    await AppDataSource.query(`DELETE FROM users WHERE employee_code LIKE '${TAG}-%'`);
    await AppDataSource.query(`DELETE FROM subjects WHERE subject_code LIKE '${TAG}-%'`);
    await AppDataSource.query(`DELETE FROM semesters WHERE semester_code LIKE '${TAG}-%'`);
    await AppDataSource.query(`DELETE FROM study_shifts WHERE shift_code LIKE '${TAG}-%'`);
    await AppDataSource.query(`DELETE FROM rooms WHERE room_code LIKE '${TAG}-%'`);
    await AppDataSource.query(`DELETE FROM departments WHERE department_code LIKE '${TAG}%'`);
  };

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    await cleanup();
    deptA = await q(`INSERT INTO departments (department_code, department_name, is_active) VALUES ('${TAG}A','${TAG} Khoa A',true) RETURNING id`);
    deptB = await q(`INSERT INTO departments (department_code, department_name, is_active) VALUES ('${TAG}B','${TAG} Khoa B',true) RETURNING id`);
    semester = await q(`INSERT INTO semesters (semester_code, semester_name, start_date, end_date) VALUES ('${TAG}-HK','${TAG} HK1','2026-09-01','2027-01-15') RETURNING id`);
    subject = await q(`INSERT INTO subjects (subject_code, subject_name) VALUES ('${TAG}-X','${TAG} Môn X') RETURNING id`);
    subjectY = await q(`INSERT INTO subjects (subject_code, subject_name) VALUES ('${TAG}-Y','${TAG} Môn Y') RETURNING id`);
    const mkSection = (code: string, subj: string) => q(
      `INSERT INTO class_sections (class_code, semester_id, subject_id, status) VALUES ($1,$2,$3,'open') RETURNING id`, [`${TAG}-${code}`, semester, subj]);
    secX = await mkSection('X', subject);
    secY = await mkSection('Y', subjectY);
    const mkStudent = async (key: keyof typeof st, name: string, dept: string) => {
      const uid = await q(
        `INSERT INTO users (employee_code, username, email, password_hash, full_name, department_id) VALUES ($1,$2,$3,'x',$4,$5) RETURNING id`,
        [`${TAG}-${key}`, `${TAG}${key}`, `${TAG}${key}@t.invalid`, name, dept]);
      st[key] = await q(`INSERT INTO students (user_id, student_code, department_id) VALUES ($1,$2,$3) RETURNING id`, [uid, `${TAG}-${key}`.toUpperCase(), dept]);
    };
    await mkStudent('s1', 'Sinh Viên Một', deptA);
    await mkStudent('s2', 'Sinh Viên Hai', deptA);
    await mkStudent('s3', 'Sinh Viên Ba', deptB);
    await mkStudent('s4', 'Sinh Viên Bốn', deptA);
    const enroll = (sec: string, s: string, status = 'active') =>
      AppDataSource.query(`INSERT INTO class_enrollments (class_section_id, student_id, status, enrolled_at) VALUES ($1,$2,$3,'2026-09-01T00:00:00Z')`, [sec, s, status]);
    for (const s of [st.s1, st.s2, st.s3]) await enroll(secX, s);
    await enroll(secX, st.s4, 'dropped');
    await enroll(secY, st.s1);

    // Lớp X: 05/10 và 07/10 có điểm danh; 09/10 chỉ có trong lịch buổi học; 08/10 là buổi hủy; 25/10 chưa diễn ra.
    await record(secX, st.s1, '2026-10-05', 'on_time', '08:00');
    await record(secX, st.s2, '2026-10-05', 'late', '08:20');
    await record(secX, st.s3, '2026-10-05', 'absent', null);
    await record(secX, st.s1, '2026-10-07', 'on_time', '08:00');
    await record(secX, st.s3, '2026-10-07', 'on_time', '08:02');
    await record(secX, st.s1, '2026-10-09', 'left', '08:00');
    await record(secX, st.s3, '2026-10-09', 'left', null);           // chỉ có giờ rời → vắng
    await record(secY, st.s1, '2026-10-05', 'on_time', '13:30');
    const shift = await q(`INSERT INTO study_shifts (shift_code, shift_name, shift_order, start_time, end_time) VALUES ('${TAG}-S','${TAG} Ca',90,'08:00','10:30') RETURNING id`);
    const room = await q(`INSERT INTO rooms (room_code, room_name, capacity) VALUES ('${TAG}-R','${TAG} Phòng',40) RETURNING id`);
    const session = (date: string, status: string, no: number) => AppDataSource.query(
      `INSERT INTO class_sessions (class_section_id, session_no, session_date, shift_id, room_id, start_time, end_time, status)
       VALUES ($1,$2,$3::date,$4,$5,$6::timestamptz,$7::timestamptz,$8)`,
      [secX, no, date, shift, room, `${date}T08:00:00+07:00`, `${date}T10:30:00+07:00`, status]);
    await session('2026-10-09', 'scheduled', 3);
    await session('2026-10-08', 'cancelled', 99);
    await session('2026-10-25', 'scheduled', 4);
  });
  afterAll(async () => { await cleanup(); await AppDataSource.destroy(); });
  beforeEach(() => { provider = new StudentAttendanceReportProvider(AppDataSource); });

  const run = (extra: Record<string, string> = {}, scope: ResolvedScope = ADMIN, to = FILTERS.to) =>
    provider.build({ ...FILTERS, to, ...extra } as never, scope, { page: 1, limit: 100 }, NOW);
  const mine = (m: { rows: Array<Record<string, unknown>> }) => m.rows.filter((r) => String(r.studentCode).startsWith(TAG.toUpperCase()));
  const rowOf = (m: { rows: Array<Record<string, unknown>> }, key: string, cls = `${TAG}-X`) =>
    m.rows.find((r) => r.studentCode === `${TAG}-${key}`.toUpperCase() && r.classSectionName === cls);

  it('đếm buổi = lịch buổi học ∪ ngày có điểm danh, bỏ buổi hủy và buổi chưa diễn ra', async () => {
    const m = await run({ classSectionId: secX }, ADMIN, '2026-10-30');
    expect(kpi(m, 'sessionCount')).toBe(3);
  });

  it('có mặt / muộn / vắng từng sinh viên đúng đáp án; vắng ngầm khi không có bản ghi hoặc chỉ có giờ rời', async () => {
    const m = await run({ classSectionId: secX });
    expect(rowOf(m, 's1')).toMatchObject({ sessions: 3, present: 3, late: 0, absent: 0, rate: 100, warning: '' });
    expect(rowOf(m, 's2')).toMatchObject({ sessions: 3, present: 0, late: 1, absent: 2, rate: 33.3, warning: 'Vắng quá 20%' });
    expect(rowOf(m, 's3')).toMatchObject({ sessions: 3, present: 1, late: 0, absent: 2, rate: 33.3, warning: 'Vắng quá 20%' });
  });

  it('sinh viên đã rút khỏi lớp không có trong báo cáo', async () => {
    const m = await run({ classSectionId: secX });
    expect(rowOf(m, 's4')).toBeUndefined();
  });

  it('KPI và biểu đồ khớp số đếm', async () => {
    const m = await run({ classSectionId: secX });
    expect(kpi(m, 'attendanceRate')).toBe(55.6);
    expect(kpi(m, 'absentCount')).toBe(4);
    expect(kpi(m, 'lateCount')).toBe(1);
    expect(kpi(m, 'atRiskStudents')).toBe(2);
    expect(m.charts.find((c) => c.key === 'weekly')?.data).toEqual([{ week: 'Tuần 05/10', rate: 55.6 }]);
    expect(m.charts.find((c) => c.key === 'bySection')?.data).toEqual([{ name: `${TAG}-X – ${TAG} Môn X`, rate: 55.6 }]);
  });

  it('bộ lọc môn học và học kỳ; học kỳ lạ → rỗng, không lỗi', async () => {
    const bySubject = await run({ subjectId: subjectY });
    expect(mine(bySubject).map((r) => r.classSectionName)).toEqual([`${TAG}-Y`]);
    const none = await run({ semesterId: '00000000-0000-4000-8000-000000000000' });
    expect(mine(none)).toHaveLength(0);
    expect(kpi(none, 'attendanceRate')).toBe(0);
    const bad = await run({ semesterId: 'khong-phai-uuid' });
    expect(mine(bad)).toHaveLength(0);
  });

  it('phạm vi đơn vị: quản lý Khoa A chỉ thấy sinh viên Khoa A', async () => {
    const m = await run({ classSectionId: secX }, { unrestricted: false, departmentIds: [deptA] });
    expect(mine(m).map((r) => r.studentCode).sort()).toEqual([`${TAG}-s1`.toUpperCase(), `${TAG}-s2`.toUpperCase()]);
    const empty = await run({ classSectionId: secX }, { unrestricted: false, departmentIds: [] });
    expect(mine(empty)).toHaveLength(0);
  });

  it('từ khóa lọc theo tên không dấu', async () => {
    const m = await run({ classSectionId: secX, q: 'sinh vien hai' });
    expect(mine(m).map((r) => r.studentCode)).toEqual([`${TAG}-s2`.toUpperCase()]);
  });
});
