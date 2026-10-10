// VIS-BE-001 Task 1 — ràng buộc DB của phân hệ Khách.
// Chạy: RUN_DB_TESTS=1 npx jest --config test/jest-e2e.json test/visitors/visitor-schema --runInBand
import { QueryRunner } from 'typeorm';
import { AppDataSource } from '../../src/database/data-source';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const VISITOR_DEPT_ID = '8d4f3a2b-5c7b-4a3f-8e9d-2b3c4d5e6f70';

describeDb('VIS-BE-001 visitor schema', () => {
  let qr: QueryRunner;
  let n = 0;

  beforeAll(async () => {
    await AppDataSource.initialize();
    // DB test dựng bằng synchronize nên chưa có seed role; chèn trước để migration quyền gắn được.
    await AppDataSource.query(
      `INSERT INTO roles (role_code, role_name, is_active) SELECT c, c, true FROM unnest($1::text[]) c
       WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.role_code = c)`,
      [['GUARD', 'EMPLOYEE', 'TEACHER', 'MANAGER', 'SYSTEM_ADMIN', 'BUSINESS_ADMIN']],
    );
    await AppDataSource.runMigrations({ transaction: 'each' });
  });
  afterAll(async () => AppDataSource.destroy());
  beforeEach(async () => {
    qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
  });
  afterEach(async () => {
    await qr.rollbackTransaction();
    await qr.release();
  });

  async function pgError(sql: string, params: unknown[] = []): Promise<string | undefined> {
    await qr.query('SAVEPOINT t');
    try {
      await qr.query(sql, params);
      await qr.query('RELEASE SAVEPOINT t');
      return undefined;
    } catch (e) {
      await qr.query('ROLLBACK TO SAVEPOINT t');
      return (e as { code?: string }).code;
    }
  }

  async function user(): Promise<string> {
    n += 1;
    const rows = await qr.query(
      `INSERT INTO users (employee_code, username, email, password_hash, full_name, department_id)
       VALUES ($1,$2,$3,'x','Test',$4) RETURNING id`,
      [`VT${Date.now()}${n}`, `vt${Date.now()}${n}`, `vt${Date.now()}${n}@t.invalid`, VISITOR_DEPT_ID],
    );
    return rows[0].id;
  }
  async function visitor(idNumber: string | null, phone: string): Promise<string | undefined> {
    const userId = await user();
    return pgError(
      `INSERT INTO visitors (user_id, full_name, id_number, phone_number) VALUES ($1,'A',$2,$3)`,
      [userId, idNumber, phone],
    );
  }
  async function visitRow(overrides: { code?: string; from?: string; to?: string } = {}): Promise<string | undefined> {
    const vId = (await qr.query(
      `INSERT INTO visitors (user_id, full_name, phone_number) VALUES ($1,'V',$2) RETURNING id`,
      [await user(), `0988${String(++n).padStart(6, '0')}`],
    ))[0].id;
    const host = await user();
    return pgError(
      `INSERT INTO visitor_visits (visit_code, visitor_id, channel, status, host_user_id, purpose,
         scheduled_from, scheduled_to, valid_from, valid_to)
       VALUES ($1,$2,'walk_in','approved',$3,'p',$4,$5,$4,$5)`,
      [overrides.code ?? 'VS-261012-0001', vId, host, overrides.from ?? '2026-10-12T08:00:00Z', overrides.to ?? '2026-10-12T10:00:00Z'],
    );
  }

  it('đủ 5 bảng', async () => {
    const rows = await qr.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
      [['visitors', 'visitor_visits', 'visitor_visit_zones', 'visitor_visit_events', 'visitor_visit_code_counters']],
    );
    expect(rows).toHaveLength(5);
  });

  it('định danh khách: trùng CCCD lỗi; trùng điện thoại khi không có CCCD lỗi; khác CCCD cùng điện thoại được', async () => {
    expect(await visitor('001099000111', '0911000001')).toBeUndefined();
    expect(await visitor('001099000111', '0911000002')).toBe('23505');
    expect(await visitor(null, '0911000003')).toBeUndefined();
    expect(await visitor(null, '0911000003')).toBe('23505');
    expect(await visitor('001099000222', '0911000001')).toBeUndefined();
  });

  it('lượt khách: CHECK thời gian và mã lượt duy nhất', async () => {
    expect(await visitRow({ from: '2026-10-12T10:00:00Z', to: '2026-10-12T08:00:00Z' })).toBe('23514');
    expect(await visitRow({ code: 'VS-261012-0007' })).toBeUndefined();
    expect(await visitRow({ code: 'VS-261012-0007' })).toBe('23505');
  });

  it('đơn vị VISITOR và phân quyền', async () => {
    const dept = await qr.query(`SELECT department_code FROM departments WHERE id = $1`, [VISITOR_DEPT_ID]);
    expect(dept[0]?.department_code).toBe('VISITOR');
    const bound = await qr.query(
      `SELECT r.role_code, p.permission_code FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
        WHERE p.permission_code LIKE 'visitor.%'`,
    );
    const has = (role: string, perm: string) => bound.some((b: { role_code: string; permission_code: string }) => b.role_code === role && b.permission_code === perm);
    expect(has('GUARD', 'visitor.desk.use')).toBe(true);
    expect(has('GUARD', 'visitor.visit.manage')).toBe(false);
    expect(has('EMPLOYEE', 'visitor.host.self')).toBe(true);
    expect(has('TEACHER', 'visitor.host.self')).toBe(true);
    expect(has('MANAGER', 'visitor.stats.read')).toBe(false);
    const perms = await qr.query(`SELECT permission_code FROM permissions WHERE permission_code LIKE 'visitor.%' ORDER BY 1`);
    expect(perms.map((p: { permission_code: string }) => p.permission_code)).toEqual([
      'visitor.desk.use', 'visitor.host.self', 'visitor.stats.read', 'visitor.visit.manage', 'visitor.visit.read',
    ]);
  });
});
