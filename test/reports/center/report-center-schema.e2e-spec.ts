// RPT-CENTER-BE-001 Task 1 — bảng lịch gửi, quyền, chỉ mục.
import { AppDataSource } from '../../../src/database/data-source';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDb('RPT-CENTER schema', () => {
  let ownerId: string;
  let scheduleId: string;

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    ownerId = (await AppDataSource.query(
      `INSERT INTO users (employee_code, username, email, password_hash, full_name) VALUES ('fa11ed02-O','fa11ed02o','fa11ed02o@t.invalid','x','fa11ed02 Chủ lịch') RETURNING id`))[0].id;
    scheduleId = (await AppDataSource.query(
      `INSERT INTO report_schedules (name, report_type, filters_json, period, frequency, send_time, formats, recipients_json, owner_user_id)
       VALUES ('fa11ed02 lịch','gate-access','{}','yesterday','daily','08:00','{pdf}','[]',$1) RETURNING id`, [ownerId]))[0].id;
  });
  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM report_schedule_runs WHERE schedule_id = $1`, [scheduleId]);
    await AppDataSource.query(`DELETE FROM report_schedules WHERE id = $1`, [scheduleId]);
    await AppDataSource.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
    await AppDataSource.destroy();
  });

  const insertRun = (trigger: string, scheduledFor: string | null) => AppDataSource.query(
    `INSERT INTO report_schedule_runs (schedule_id, schedule_name, report_type, trigger, status, scheduled_for, period_from, period_to, formats)
     VALUES ($1,'x','gate-access',$2,'queued',$3,'2026-10-01','2026-10-01','{pdf}')`, [scheduleId, trigger, scheduledFor]);

  it('hai lần chạy scheduled cùng (schedule_id, scheduled_for) → 23505; manual thì trùng được', async () => {
    await insertRun('scheduled', '2026-10-10T01:00:00Z');
    await expect(insertRun('scheduled', '2026-10-10T01:00:00Z')).rejects.toMatchObject({ code: '23505' });
    await insertRun('manual', null);
    await insertRun('manual', null);
  });

  it('day_of_month = 29 vi phạm CHECK', async () => {
    await expect(AppDataSource.query(`UPDATE report_schedules SET day_of_month = 29 WHERE id = $1`, [scheduleId])).rejects.toMatchObject({ code: '23514' });
  });

  it('quyền report.* gán đúng vai trò: MANAGER đọc/xuất nhưng không quản lý lịch', async () => {
    const rows = await AppDataSource.query(
      `SELECT r.role_code, p.permission_code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
        WHERE p.permission_code LIKE 'report.center.%' OR p.permission_code = 'report.schedule.manage'`);
    const has = (role: string, code: string) => rows.some((x: { role_code: string; permission_code: string }) => x.role_code === role && x.permission_code === code);
    const exists = await AppDataSource.query(`SELECT role_code FROM roles WHERE role_code IN ('MANAGER','SYSTEM_ADMIN','BUSINESS_ADMIN')`);
    const roles = exists.map((r: { role_code: string }) => r.role_code);
    for (const role of ['SYSTEM_ADMIN', 'BUSINESS_ADMIN']) {
      if (!roles.includes(role)) continue;
      expect(has(role, 'report.center.read')).toBe(true);
      expect(has(role, 'report.center.export')).toBe(true);
      expect(has(role, 'report.schedule.manage')).toBe(true);
    }
    if (roles.includes('MANAGER')) {
      expect(has('MANAGER', 'report.center.read')).toBe(true);
      expect(has('MANAGER', 'report.center.export')).toBe(true);
      expect(has('MANAGER', 'report.schedule.manage')).toBe(false);
    }
    const codes = await AppDataSource.query(`SELECT permission_code FROM permissions WHERE permission_code IN ('report.center.read','report.center.export','report.schedule.manage')`);
    expect(codes).toHaveLength(3);
  });

  it('chỉ mục biểu thức sự kiện khuôn mặt tồn tại và được planner dùng', async () => {
    const idx = await AppDataSource.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'IDX_iot_device_events_face_user_time'`);
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).toContain("payload_json ->> 'userId'");
    await AppDataSource.query(`SET enable_seqscan = off`);
    const plan: Array<{ 'QUERY PLAN': string }> = await AppDataSource.query(
      `EXPLAIN SELECT 1 FROM iot_device_events WHERE event_type = 'ivss_face_event' AND payload_json->>'userId' = 'x' AND event_time >= now() - interval '1 day'`);
    await AppDataSource.query(`RESET enable_seqscan`);
    expect(plan.map((p) => p['QUERY PLAN']).join('\n')).toContain('IDX_iot_device_events_face_user_time');
  });

  it('down rồi up lại không lỗi', async () => {
    await AppDataSource.undoLastMigration({ transaction: 'each' });
    await AppDataSource.undoLastMigration({ transaction: 'each' });
    await AppDataSource.undoLastMigration({ transaction: 'each' });
    expect(await AppDataSource.query(`SELECT to_regclass('report_schedules') AS t`)).toEqual([{ t: null }]);
    await AppDataSource.runMigrations({ transaction: 'each' });
    expect((await AppDataSource.query(`SELECT to_regclass('report_schedules') AS t`))[0].t).toBe('report_schedules');
  });
});
