// RPT-CENTER-BE-001 Task 7 — chuyên cần cán bộ trên dữ liệu có lịch biết trước (tuần 05–09/10/2026, giờ VN).
import { AppDataSource } from '../../../src/database/data-source';
import { StaffAttendanceReportProvider } from '../../../src/modules/reports/center/providers/staff-attendance.provider';
import type { ResolvedScope } from '../../../src/modules/reports/center/report-model';
import { cleanupReportFixture, RTAG, seedReportFixture, ReportFixture, VISITOR_DEPT } from './fixtures';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const ADMIN: ResolvedScope = { unrestricted: true, departmentIds: null };
const NOW = new Date('2026-10-20T03:00:00Z');
const FILTERS = { from: '2026-10-05', to: '2026-10-09' };
const kpi = (m: { kpis: Array<{ key: string; value: number | null }> }, key: string) => m.kpis.find((k) => k.key === key)?.value;

describeDb('RPT-CENTER staff-attendance', () => {
  let fx: ReportFixture;
  let provider: StaffAttendanceReportProvider;
  let deviceId: string;
  let users: Record<'s1' | 's2' | 's3' | 's4' | 'student2' | 'visitor2' | 'partner', string>;
  const ids: string[] = [];

  const face = async (userId: string, utc: string) => {
    ids.push((await AppDataSource.query(
      `INSERT INTO iot_device_events (device_id, event_type, event_time, payload_json) VALUES ($1,'ivss_face_event',$2,$3) RETURNING id`,
      [deviceId, utc, JSON.stringify({ userId })]))[0].id);
  };
  /** giờ VN → UTC */
  const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`).toISOString();
  const workday = async (userId: string, ymd: string, a: string, b: string) => { await face(userId, vn(ymd, a)); await face(userId, vn(ymd, b)); };

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    fx = await seedReportFixture(AppDataSource);
    deviceId = (await AppDataSource.query(`INSERT INTO iot_devices (device_code, device_name, device_type) VALUES ('${RTAG}-DEV','bridge','ivss_bridge') RETURNING id`))[0].id;
    const mk = async (c: string, n: string, dept: string) => (await AppDataSource.query(
      `INSERT INTO users (employee_code, username, email, password_hash, full_name, department_id) VALUES ($1,$2,$3,'x',$4,$5) RETURNING id`,
      [`${RTAG}-${c}`, `${RTAG}${c}`.toLowerCase(), `${RTAG}${c}@t.invalid`.toLowerCase(), n, dept]))[0].id as string;
    const partnerDept = (await AppDataSource.query(`SELECT id FROM departments WHERE department_code = 'PARTNER' LIMIT 1`))[0]?.id
      ?? (await AppDataSource.query(`INSERT INTO departments (department_code, department_name, is_active) VALUES ('${RTAG}PARTNER','${RTAG} Đối tác',true) RETURNING id`))[0].id;
    users = {
      s1: await mk('T1', 'Cán Bộ Một', fx.deptA), s2: await mk('T2', 'Cán Bộ Hai', fx.deptA),
      s3: await mk('T3', 'Cán Bộ Ba', fx.deptB), s4: await mk('T4', 'Cán Bộ Bốn', fx.deptB),
      student2: fx.student, visitor2: fx.visitor, partner: await mk('PT', 'Đối Tác', partnerDept),
    };
    // Hai cán bộ mẫu dùng chung của fixture không thuộc kịch bản này: cho nghỉ việc để không lẫn vào số liệu.
    await AppDataSource.query(`UPDATE users SET employment_status = 'resigned' WHERE id = ANY($1::uuid[])`, [[fx.staffA, fx.staffB]]);
    const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
    for (const d of week) await workday(users.s1, d, '08:00', '17:00');
    await workday(users.s2, week[0], '08:30', '17:00');                  // thứ Hai muộn
    await workday(users.s2, week[2], '08:00', '16:00');                  // thứ Tư về sớm
    await workday(users.s2, week[3], '08:00', '17:00');                  // thứ Năm đúng giờ
    await AppDataSource.query(                                           // thứ Sáu chỉ có nhật ký cổng (xe có chủ)
      `INSERT INTO gate_access_logs (zone_id, user_id, plate_number, direction, access_time) VALUES ($1,$2,'${RTAG.toUpperCase()}1','enter',$3),($1,$2,'${RTAG.toUpperCase()}1','leave',$4)`,
      [fx.g1, users.s2, vn(week[4], '08:00'), vn(week[4], '17:00')]);
    await face(users.s3, '2026-10-05T23:30:00Z');                        // = 06:30 thứ Ba theo giờ VN
    await face(users.s3, vn(week[1], '17:00'));
    for (const d of [week[0], week[1], week[3], week[4]]) await workday(users.s4, d, '08:00', '17:00');
    await face(users.s4, vn(week[2], '08:00'));                           // thứ Tư chỉ một lần thấy
    for (const u of [users.student2, users.visitor2, users.partner]) for (const d of week) await workday(u, d, '08:00', '17:00');
  });
  afterAll(async () => {
    if (ids.length) await AppDataSource.query(`DELETE FROM iot_device_events WHERE id = ANY($1::uuid[])`, [ids]);
    await AppDataSource.query(`DELETE FROM iot_devices WHERE device_code = '${RTAG}-DEV'`);
    await AppDataSource.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE employee_code LIKE '${RTAG}-%')`);
    await AppDataSource.query(`DELETE FROM users WHERE employee_code LIKE '${RTAG}-%'`);
    await cleanupReportFixture(AppDataSource);
    await AppDataSource.destroy();
  });
  beforeEach(() => { provider = new StaffAttendanceReportProvider(AppDataSource); });

  const run = (extra: Record<string, string> = {}, scope: ResolvedScope = ADMIN, page: { page: number; limit: number } | null = { page: 1, limit: 100 }) =>
    provider.build({ ...FILTERS, departmentId: undefined, ...extra } as never, scope, page, NOW);
  const mine = (m: { rows: Array<Record<string, unknown>> }) => m.rows.filter((r) => String(r.employeeCode).startsWith(`${RTAG}-T`));

  it('sinh viên, tài khoản khách và đối tác không có trong bảng; 4 cán bộ có mặt', async () => {
    const m = await run();
    const codes = mine(m).map((r) => r.employeeCode);
    expect([...codes].sort()).toEqual([`${RTAG}-T1`, `${RTAG}-T2`, `${RTAG}-T3`, `${RTAG}-T4`]);
    expect(m.rows.some((r) => String(r.employeeCode).includes('S1') || String(r.employeeCode).includes('V1') || String(r.employeeCode).includes('PT'))).toBe(false);
  });

  it('bảng theo từng cán bộ đúng số tay', async () => {
    const byCode = Object.fromEntries(mine(await run()).map((r) => [String(r.employeeCode).slice(-2), r]));
    expect(byCode.T1).toMatchObject({ workDays: 5, onTime: 5, late: 0, earlyLeave: 0, absent: 0, totalHours: 45, rate: 100 });
    expect(byCode.T2).toMatchObject({ workDays: 4, onTime: 2, late: 1, earlyLeave: 1, absent: 1, totalHours: 34.5, rate: 40 });
    expect(byCode.T3).toMatchObject({ workDays: 1, onTime: 1, late: 0, absent: 4, totalHours: 10.5, rate: 20 });
    expect(byCode.T4).toMatchObject({ workDays: 5, onTime: 4, earlyLeave: 1, absent: 0, totalHours: 36, rate: 80 });
  });

  it('sự kiện lúc 23:30Z thuộc ngày hôm sau theo giờ VN (T3 có mặt thứ Ba, không phải thứ Hai)', async () => {
    const m = await run({ staffId: users.s3 });
    expect(mine(m)[0]).toMatchObject({ workDays: 1, absent: 4 });
  });

  it('cán bộ chỉ có nhật ký cổng (xe có chủ) vẫn được tính có mặt', async () => {
    const m = await run({ staffId: users.s2 });
    expect(mine(m)[0]).toMatchObject({ workDays: 4 });
  });

  it('KPI tổng trên 4 cán bộ: chuyên cần 60%, muộn 1, về sớm 2, vắng 5, TB 8,4 giờ/ngày', async () => {
    const m = await run({}, { unrestricted: false, departmentIds: [fx.deptA, fx.deptB] });
    expect([kpi(m, 'attendanceRate'), kpi(m, 'lateCount'), kpi(m, 'earlyLeaveCount'), kpi(m, 'absentDays'), kpi(m, 'avgHoursPerDay')]).toEqual([60, 1, 2, 5, 8.4]);
  });

  it('KPI theo đơn vị: đơn vị A 70%, đơn vị B 50%', async () => {
    expect(kpi(await run({ departmentId: fx.deptA }), 'attendanceRate')).toBe(70);
    expect(kpi(await run({ departmentId: fx.deptB }), 'attendanceRate')).toBe(50);
  });

  it('lọc departmentId và staffId; phạm vi MANAGER', async () => {
    expect(mine(await run({ departmentId: fx.deptA }))).toHaveLength(2);
    expect(mine(await run({ staffId: users.s4 }))).toHaveLength(1);
    expect(mine(await run({}, { unrestricted: false, departmentIds: [fx.deptB] }))).toHaveLength(2);
    expect((await run({}, { unrestricted: false, departmentIds: [] })).total).toBe(0);
  });

  it('ngày hôm nay chưa hết giờ không tính vắng; ngày tương lai bị cắt', async () => {
    const midday = new Date(vn('2026-10-07', '10:00'));
    const m = await provider.build({ from: '2026-10-05', to: '2026-10-09' }, ADMIN, { page: 1, limit: 100 }, midday);
    const t3 = mine(m).find((r) => String(r.employeeCode).endsWith('T3'));
    expect(t3).toMatchObject({ absent: 1, workDays: 1 }); // thứ Hai vắng (đã qua), thứ Ba có mặt, thứ Tư (hôm nay) pending, thứ Năm–Sáu tương lai
  });

  it('cấu hình workStart=07:30 đổi kết quả (đọc từ system_configs)', async () => {
    await AppDataSource.query(`DELETE FROM system_configs WHERE config_key = 'report.staff_attendance.rules'`);
    await AppDataSource.query(`INSERT INTO system_configs (config_key, config_value, config_json, config_group) VALUES ('report.staff_attendance.rules', NULL, '{"workStart":"07:30"}', 'report')`);
    try {
      const m = await run({ staffId: users.s1 });
      expect(mine(m)[0]).toMatchObject({ late: 5, onTime: 0 });
    } finally {
      await AppDataSource.query(`DELETE FROM system_configs WHERE config_key = 'report.staff_attendance.rules'`);
    }
  });

  it('ghi chú hạn chế có trong phản hồi; kỳ không có cán bộ nào → mô hình rỗng hợp lệ', async () => {
    const m = await run();
    expect(m.notes?.length).toBe(2);
    const empty = await run({ q: 'khong-co-ai-ten-nhu-vay' });
    expect(empty.total).toBe(0);
    expect(kpi(empty, 'attendanceRate')).toBe(0);
  });
});
