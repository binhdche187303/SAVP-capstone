// VIS-BE-001 Task 4 — mã lượt, định danh khách, tài khoản ẩn, loại trừ khỏi danh sách nhân sự.
// Chạy: RUN_DB_TESTS=1 npx jest --config test/jest-e2e.json test/visitors/visitor-identity --runInBand
import * as bcrypt from 'bcryptjs';
import { AppDataSource } from '../../src/database/data-source';
import { VisitCodeService } from '../../src/modules/visitors/services/visit-code.service';
import { VisitorIdentityService } from '../../src/modules/visitors/services/visitor-identity.service';
import { UsersService } from '../../src/modules/accounts/services/users.service';
import { DepartmentsService } from '../../src/modules/accounts/services/departments.service';
import { VISITOR_DEPARTMENT_ID } from '../../src/modules/visitors/constants/visit-status.constant';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const TAG = 'fa11ed04';

describeDb('VIS-BE-001 identity', () => {
  const codes = new VisitCodeService();
  let usersService: UsersService;
  let identity: VisitorIdentityService;

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    usersService = Object.create(UsersService.prototype) as UsersService;
    (usersService as unknown as { dataSource: unknown }).dataSource = AppDataSource;
    identity = new VisitorIdentityService(AppDataSource, usersService);
  });
  afterAll(async () => {
    await cleanup();
    await AppDataSource.destroy();
  });
  beforeEach(cleanup);

  async function cleanup(): Promise<void> {
    await AppDataSource.query(`DELETE FROM visitor_visit_code_counters WHERE day >= '2031-01-01'`);
    await AppDataSource.query(`DELETE FROM visitors WHERE phone_number LIKE '0977%' OR full_name LIKE $1`, [`${TAG}%`]);
    await AppDataSource.query(`DELETE FROM users WHERE email LIKE '%@visitor.invalid' AND full_name LIKE $1`, [`${TAG}%`]);
  }

  describe('mã lượt', () => {
    it('lượt đầu của ngày là 0001, tiếp theo 0002', async () => {
      const from = new Date('2031-03-05T02:00:00Z');
      const a = await AppDataSource.transaction((m) => codes.next(m, from));
      const b = await AppDataSource.transaction((m) => codes.next(m, from));
      expect([a, b]).toEqual(['VS-310305-0001', 'VS-310305-0002']);
    });
    it('hai kết nối đồng thời cùng ngày không trùng mã', async () => {
      const from = new Date('2031-03-06T02:00:00Z');
      const run = () => AppDataSource.transaction(async (m) => {
        const c = await codes.next(m, from);
        await new Promise((r) => setTimeout(r, 50));
        return c;
      });
      const [x, y] = await Promise.all([run(), run()]);
      expect(new Set([x, y]).size).toBe(2);
      expect([x, y].sort()).toEqual(['VS-310306-0001', 'VS-310306-0002']);
    });
    it('ngày theo giờ Việt Nam: 17:30Z thuộc ngày hôm sau', async () => {
      expect(await AppDataSource.transaction((m) => codes.next(m, new Date('2031-03-07T17:30:00Z')))).toBe('VS-310308-0001');
    });
  });

  describe('định danh khách', () => {
    const input = (over: Record<string, unknown> = {}) => ({
      fullName: `${TAG} Trần Thị Demo`, idNumber: '977000000001', phone: '0977000001', email: 'a@example.com', organization: 'Công ty A', ...over,
    });
    it('cùng CCCD hai lần → cùng khách; lần hai cập nhật thông tin mới nhất', async () => {
      const a = await identity.resolve(input());
      const b = await identity.resolve(input({ organization: 'Công ty B', phone: '0977000002' }));
      expect(b.visitorId).toBe(a.visitorId);
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      const row = (await AppDataSource.query(`SELECT organization, phone_number FROM visitors WHERE id = $1`, [a.visitorId]))[0];
      expect(row.organization).toBe('Công ty B');
    });
    it('không CCCD, cùng điện thoại (kể cả +84) → cùng khách', async () => {
      const a = await identity.resolve(input({ idNumber: undefined, phone: '0977000003' }));
      const b = await identity.resolve(input({ idNumber: undefined, phone: '+84977000003' }));
      expect(b.visitorId).toBe(a.visitorId);
    });
    it('hai lời gọi đồng thời cùng CCCD → một dòng visitors, một tài khoản ẩn', async () => {
      const [a, b] = await Promise.all([identity.resolve(input({ idNumber: '977000000009', phone: '0977000009' })), identity.resolve(input({ idNumber: '977000000009', phone: '0977000009' }))]);
      expect(a.visitorId).toBe(b.visitorId);
      const rows = await AppDataSource.query(`SELECT count(*)::int AS n FROM visitors WHERE id_number = '977000000009'`);
      expect(rows[0].n).toBe(1);
    });
    it('tài khoản ẩn: đơn vị VISITOR, active, không role, không đăng nhập được', async () => {
      const r = await identity.resolve(input({ idNumber: '977000000010', phone: '0977000010' }));
      const u = (await AppDataSource.query(`SELECT * FROM users WHERE id = $1`, [r.userId]))[0];
      expect(u.department_id).toBe(VISITOR_DEPARTMENT_ID);
      expect(u.account_status).toBe('active');
      expect(u.email).toMatch(/@visitor\.invalid$/);
      const roles = await AppDataSource.query(`SELECT 1 FROM user_roles WHERE user_id = $1`, [r.userId]);
      expect(roles).toHaveLength(0);
      await expect(bcrypt.compare('Abcd1234@', u.password_hash)).resolves.toBe(false);
    });
  });

  describe('loại trừ khỏi danh sách nhân sự', () => {
    it('listUsers không trả tài khoản khách ẩn', async () => {
      const r = await identity.resolve({ fullName: `${TAG} Ẩn Danh`, idNumber: '977000000020', phone: '0977000020' });
      const res = await usersService.listUsers({ search: `${TAG} Ẩn Danh`, page: 1, limit: 20 } as never);
      expect(res.data.find((x: { id: string }) => x.id === r.userId)).toBeUndefined();
    });
    it('listDepartments không trả đơn vị VISITOR', async () => {
      const svc = Object.create(DepartmentsService.prototype) as DepartmentsService;
      (svc as unknown as { dataSource: unknown }).dataSource = AppDataSource;
      (svc as unknown as { countActiveMembersBatch: unknown }).countActiveMembersBatch = async () => new Map();
      const res = await svc.listDepartments({ search: 'VISITOR', page: 1, limit: 20 } as never);
      expect(res.data.find((d: { departmentCode: string }) => d.departmentCode === 'VISITOR')).toBeUndefined();
    });
  });
});
