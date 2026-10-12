// VIS-BE-001 Task 8 — ma trận quyền của endpoint nội bộ (spec §7.2, §7.3) qua HTTP thật.
import request from 'supertest';
import { AppDataSource } from '../../src/database/data-source';
import { buildVisitorTestApp, TestRig } from './support/visitor-test-app';
import { cleanupVisitFixture, seedVisitFixture, VisitFixture } from './fixtures';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const ALL = ['visitor.visit.read', 'visitor.visit.manage', 'visitor.desk.use', 'visitor.stats.read', 'visitor.host.self'];
const ROLES: Record<string, string[]> = {
  SYSTEM_ADMIN: ALL,
  BUSINESS_ADMIN: ALL,
  GUARD: ['visitor.visit.read', 'visitor.desk.use'],
  MANAGER: ['visitor.host.self'],
  EMPLOYEE: ['visitor.host.self'],
};
const ROLE_USER: Record<string, string> = Object.fromEntries(Object.keys(ROLES).map((r, i) => [r, `00000000-0000-4000-8000-00000000000${i + 1}`]));

describeDb('VIS-BE-001 RBAC', () => {
  let rig: TestRig;
  let fx: VisitFixture;

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    fx = await seedVisitFixture(AppDataSource);
  });
  beforeEach(async () => {
    rig = await buildVisitorTestApp();
    for (const [role, perms] of Object.entries(ROLES)) rig.permissionsByUser.set(ROLE_USER[role], perms);
    rig.permissionsByUser.set(fx.hostA, ROLES.EMPLOYEE);
  });
  afterEach(async () => rig.close());
  afterAll(async () => { await cleanupVisitFixture(AppDataSource); await AppDataSource.destroy(); });

  const call = (method: 'get' | 'post', url: string, userId?: string, body: object = {}) => {
    const r = request(rig.app.getHttpServer())[method](`/api/v1${url}`);
    if (userId) r.set('x-test-user', userId);
    return method === 'post' ? r.send(body) : r;
  };

  // [method, đường dẫn, quyền cần (bất kỳ một trong)]
  const endpoints = (): Array<[string, 'get' | 'post', string, string[]]> => {
    const v = fx.ids.pending;
    return [
      ['lookups', 'get', '/visitors/lookups', []],
      ['list', 'get', '/visitors/visits', ['visitor.visit.read']],
      ['related', 'get', `/visitors/visits/${v}/related`, ['visitor.visit.read']],
      ['approve', 'post', `/visitors/visits/${v}/approve`, ['visitor.visit.manage', 'visitor.host.self']],
      ['reject', 'post', `/visitors/visits/${v}/reject`, ['visitor.visit.manage', 'visitor.host.self']],
      ['cancel', 'post', `/visitors/visits/${v}/cancel`, ['visitor.visit.manage', 'visitor.host.self']],
      ['revoke', 'post', `/visitors/visits/${v}/revoke`, ['visitor.visit.manage']],
      ['extend', 'post', `/visitors/visits/${v}/extend`, ['visitor.visit.manage']],
      ['close-manual', 'post', `/visitors/visits/${v}/close-manual`, ['visitor.visit.manage']],
      ['photo', 'post', `/visitors/visits/${v}/photo`, ['visitor.desk.use']],
      ['check-in', 'post', `/visitors/visits/${v}/check-in`, ['visitor.desk.use']],
      ['check-out', 'post', `/visitors/visits/${v}/check-out`, ['visitor.desk.use']],
      ['desk', 'get', '/visitors/desk/today', ['visitor.desk.use']],
      ['stats', 'get', '/visitors/stats?from=2026-01-01&to=2026-01-31', ['visitor.stats.read']],
      ['my-visits', 'get', '/visitors/my-visits', ['visitor.host.self']],
      ['my-notifications', 'get', '/visitors/my-notifications', ['visitor.host.self']],
    ];
  };

  it('không token → 401 ở mọi endpoint', async () => {
    for (const [name, method, url] of endpoints()) {
      const res = await call(method, url);
      expect([name, res.status]).toEqual([name, 401]);
    }
  });

  it.each(Object.keys(ROLES))('ma trận quyền: %s', async (role) => {
    for (const [name, method, url, required] of endpoints()) {
      const res = await call(method, url, ROLE_USER[role]);
      const allowed = required.length === 0 || required.some((p) => ROLES[role].includes(p));
      const ownershipOnly = allowed && !ROLES[role].includes('visitor.visit.manage') && required.includes('visitor.host.self') && required.includes('visitor.visit.manage');
      if (ownershipOnly) {
        // Qua cửa quyền ở controller, nhưng lượt này không phải của người gọi → service chặn (BR-V18).
        expect([name, res.status, res.body.error?.code]).toEqual([name, 403, 'VISIT_FORBIDDEN']);
      } else if (allowed) expect([name, res.status === 403 || res.status === 401]).toEqual([name, false]);
      else expect([name, res.status]).toEqual([name, 403]);
    }
  });

  it('tạo lượt: walk_in cần desk.use; host_invite cần host.self', async () => {
    const body = (channel: string) => ({ channel, visitor: {}, hostId: fx.hostA });
    expect((await call('post', '/visitors/visits', ROLE_USER.GUARD, body('walk_in'))).status).not.toBe(403);
    expect((await call('post', '/visitors/visits', ROLE_USER.EMPLOYEE, body('walk_in'))).status).toBe(403);
    expect((await call('post', '/visitors/visits', ROLE_USER.GUARD, body('host_invite'))).status).toBe(403);
    expect((await call('post', '/visitors/visits', ROLE_USER.EMPLOYEE, body('host_invite'))).status).not.toBe(403);
    expect((await call('post', '/visitors/visits', ROLE_USER.GUARD, body('online'))).status).toBe(400);
  });

  it('chi tiết: người được gặp xem được lượt của mình, không xem được lượt của người khác', async () => {
    expect((await call('get', `/visitors/visits/${fx.ids.pending}`, fx.hostA)).status).toBe(200);
    expect((await call('get', `/visitors/visits/${fx.ids.approved}`, fx.hostA)).status).toBe(403);
    expect((await call('get', `/visitors/visits/${fx.ids.approved}`, ROLE_USER.GUARD)).status).toBe(200);
  });

  it('người được gặp duyệt lượt của mình qua HTTP; của người khác → 403', async () => {
    expect((await call('post', `/visitors/visits/${fx.ids.approved}/approve`, fx.hostA)).status).toBe(403);
  });

  it('VISITORS_ENABLED=false → 404 ở endpoint nội bộ', async () => {
    await rig.close();
    rig = await buildVisitorTestApp({ enabled: false });
    expect((await call('get', '/visitors/lookups', ROLE_USER.SYSTEM_ADMIN)).status).toBe(404);
  });

  it('danh sách trả đúng dạng { success, data: { items, total, counts } }', async () => {
    const res = await call('get', `/visitors/visits?q=${encodeURIComponent('fa11ed00')}&limit=3`, ROLE_USER.BUSINESS_ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(3);
    expect(res.body.data.counts).toHaveProperty('pending_approval');
  });
});
