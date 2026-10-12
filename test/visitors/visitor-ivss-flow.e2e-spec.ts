// VIS-BE-001 Task 10 — sự kiện nhận diện camera IVSS → check-in/out, nhật ký cổng, cảnh báo.
import { AppDataSource } from '../../src/database/data-source';
import { VisitActionsService } from '../../src/modules/visitors/services/visit-actions.service';
import { VisitService } from '../../src/modules/visitors/services/visit.service';
import { VisitorGateService } from '../../src/modules/visitors/services/visitor-gate.service';
import { buildVisitorTestApp, TestRig } from './support/visitor-test-app';
import { cleanupVisitFixture, seedVisitFixture, VisitFixture } from './fixtures';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const MIN = 60_000;

describeDb('VIS-BE-001 IVSS flow', () => {
  let rig: TestRig;
  let gate: VisitorGateService;
  let visits: VisitService;
  let actions: VisitActionsService;
  let fx: VisitFixture;

  const userOf = async (key: string) => (await AppDataSource.query(
    `SELECT vis.user_id FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id WHERE v.id = $1`, [fx.ids[key]]))[0].user_id as string;
  const ev = async (key: string, over: Record<string, unknown> = {}) => ({
    userId: await userOf(key), zoneId: fx.zoneGate, direction: 'enter' as const, eventTime: new Date(), similarity: 0.95,
    sourceEventId: null, deviceId: null, ...over,
  });
  const status = async (key: string) => (await visits.getView(fx.ids[key])).status;
  const eventTypes = async (key: string) => (await visits.getView(fx.ids[key])).events.map((e) => e.type);
  const gateLogs = async (userId: string) => AppDataSource.query(`SELECT direction FROM gate_access_logs WHERE user_id = $1 ORDER BY access_time`, [userId]);
  /** Đưa một lượt của fixture về trạng thái sạch: khung hiệu lực chứa "bây giờ", đủ hai khu, không có sự kiện cũ. */
  const arm = async (key: string, st: string, opts: { inside?: boolean; revoked?: boolean } = {}) => {
    await AppDataSource.query(
      `UPDATE visitor_visits SET status = $2, valid_from = now() - interval '1 hour', valid_to = now() + interval '2 hours',
              check_in_at = ${opts.inside ? 'now()' : 'NULL'}, check_out_at = NULL, revoked_at = ${opts.revoked ? 'now()' : 'NULL'},
              last_seen_at = NULL, last_seen_zone_id = NULL, face_score = NULL WHERE id = $1`, [fx.ids[key], st]);
    await AppDataSource.query(`DELETE FROM visitor_visit_events WHERE visit_id = $1`, [fx.ids[key]]);
    await AppDataSource.query(`DELETE FROM visitor_visit_zones WHERE visit_id = $1`, [fx.ids[key]]);
    await AppDataSource.query(`INSERT INTO visitor_visit_zones (visit_id, zone_id) VALUES ($1,$2),($1,$3)`, [fx.ids[key], fx.zoneGate, fx.zoneB1]);
  };

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    fx = await seedVisitFixture(AppDataSource);
  });
  beforeEach(async () => {
    rig = await buildVisitorTestApp();
    gate = rig.app.get(VisitorGateService);
    visits = rig.app.get(VisitService);
    actions = rig.app.get(VisitActionsService);
    await AppDataSource.query(`DELETE FROM gate_access_logs WHERE metadata_json->>'source' = 'visitor'`);
  });
  afterEach(async () => rig.close());
  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM gate_access_logs WHERE metadata_json->>'source' = 'visitor'`);
    await cleanupVisitFixture(AppDataSource);
    await AppDataSource.destroy();
  });

  it('khách đã duyệt, đúng giờ, đúng cổng, độ khớp cao → check-in, ghi nhật ký cổng, báo chủ nhà', async () => {
    await arm('approved', 'approved');
    await gate.onIvssFaceEvent(await ev('approved'));
    expect(await status('approved')).toBe('checked_in');
    const userId = await userOf('approved');
    expect((await gateLogs(userId)).map((r: { direction: string }) => r.direction)).toEqual(['enter']);
    expect(await eventTypes('approved')).toEqual(expect.arrayContaining(['face_verified', 'check_in', 'host_notified']));
    expect(rig.notifications.created.some((n) => n.notificationType === 'visitor_arrived')).toBe(true);
    const view = await visits.getView(fx.ids.approved);
    expect(view.faceScore).toBeCloseTo(0.95);
    expect(view.lastSeen?.zoneId).toBe(fx.zoneGate);
  });

  it('cùng sự kiện đến lần hai (khách đã ở trong) → không check-in lại, không thêm nhật ký', async () => {
    await arm('approved', 'approved');
    await gate.onIvssFaceEvent(await ev('approved'));
    await gate.onIvssFaceEvent(await ev('approved', { eventTime: new Date(Date.now() + MIN) }));
    expect((await gateLogs(await userOf('approved')))).toHaveLength(1);
    expect((await eventTypes('approved')).filter((t) => t === 'check_in')).toHaveLength(1);
  });

  it('hướng leave tại cổng → check-out, nhật ký leave; khách đã bị thu hồi vẫn ra được', async () => {
    await arm('approved', 'approved');
    await gate.onIvssFaceEvent(await ev('approved'));
    await actions.revoke(fx.ids.approved, { reason: 'Vi phạm' }, { userId: fx.hostA, permissions: ['visitor.visit.manage'] });
    expect(await status('approved')).toBe('must_leave');
    await gate.onIvssFaceEvent(await ev('approved', { direction: 'leave', eventTime: new Date(Date.now() + 5 * MIN) }));
    expect(await status('approved')).toBe('checked_out');
    expect((await gateLogs(await userOf('approved'))).map((r: { direction: string }) => r.direction)).toEqual(['enter', 'leave']);
  });

  it('độ khớp dưới ngưỡng → cần lễ tân xác minh, KHÔNG check-in, không cảnh báo an ninh', async () => {
    await arm('approved', 'approved');
    await gate.onIvssFaceEvent(await ev('approved', { similarity: 0.7 }));
    expect(await status('approved')).toBe('approved');
    expect(await eventTypes('approved')).toContain('manual_review');
    expect(rig.alerts).toHaveLength(0);
  });

  it('thang điểm 0–100 được chuẩn hóa về 0–1', async () => {
    await arm('approved', 'approved');
    await gate.onIvssFaceEvent(await ev('approved', { similarity: 93 }));
    expect(await status('approved')).toBe('checked_in');
    expect((await visits.getView(fx.ids.approved)).faceScore).toBeCloseTo(0.93);
  });

  it('ngoài khung giờ → từ chối, sự kiện access_denied + cảnh báo visitor_zone_violation; lặp lại trong 60 giây chỉ ghi một lần', async () => {
    await arm('approved', 'approved');
    await AppDataSource.query(`UPDATE visitor_visits SET valid_from = now() + interval '3 hours', valid_to = now() + interval '5 hours' WHERE id = $1`, [fx.ids.approved]);
    await gate.onIvssFaceEvent(await ev('approved'));
    await gate.onIvssFaceEvent(await ev('approved'));
    expect(await status('approved')).toBe('approved');
    expect((await eventTypes('approved')).filter((t) => t === 'access_denied')).toHaveLength(1);
    expect(rig.alerts.filter((a) => a.alertType === 'visitor_zone_violation')).toHaveLength(1);
  });

  it('sai khu vực (cổng không nằm trong danh sách được phép) → từ chối', async () => {
    await arm('approved', 'approved');
    await AppDataSource.query(`DELETE FROM visitor_visit_zones WHERE visit_id = $1 AND zone_id = $2`, [fx.ids.approved, fx.zoneGate]);
    await gate.onIvssFaceEvent(await ev('approved'));
    expect(await status('approved')).toBe('approved');
    expect(await eventTypes('approved')).toContain('access_denied');
  });

  it('khách phải rời bị camera chiều vào / khu khác thấy → từ chối + cảnh báo visitor_must_leave', async () => {
    await arm('mustLeave', 'must_leave', { inside: true, revoked: true });
    await gate.onIvssFaceEvent(await ev('mustLeave'));
    await gate.onIvssFaceEvent(await ev('mustLeave', { zoneId: fx.zoneB1 }));
    expect(await status('mustLeave')).toBe('must_leave');
    expect(rig.alerts.some((a) => a.alertType === 'visitor_must_leave' && a.dedupeKey === fx.ids.mustLeave)).toBe(true);
  });

  it('khách đang ở trong đi vào khu vực không được phép → cảnh báo visitor_zone_violation', async () => {
    await arm('insideOk', 'checked_in', { inside: true });
    await AppDataSource.query(`DELETE FROM visitor_visit_zones WHERE visit_id = $1 AND zone_id = $2`, [fx.ids.insideOk, fx.zoneB1]);
    await gate.onIvssFaceEvent(await ev('insideOk', { zoneId: fx.zoneB1 }));
    expect(rig.alerts.some((a) => a.alertType === 'visitor_zone_violation')).toBe(true);
  });

  it('hướng "seen" ở cổng: chỉ cập nhật lần cuối thấy, không check-in', async () => {
    await arm('approved', 'approved');
    const at = new Date(Date.now() + MIN);
    await gate.onIvssFaceEvent(await ev('approved', { direction: 'seen', eventTime: at }));
    expect(await status('approved')).toBe('approved');
    expect(new Date((await visits.getView(fx.ids.approved)).lastSeen!.at).getTime()).toBe(at.getTime());
  });

  it('người không phải khách: thoát ngay, không đụng tới lượt nào; kết quả âm được nhớ đệm', async () => {
    const spy = jest.spyOn(AppDataSource, 'query');
    const staff = { userId: fx.hostA, zoneId: fx.zoneGate, direction: 'enter' as const, eventTime: new Date(), similarity: 0.99, sourceEventId: null, deviceId: null };
    await gate.onIvssFaceEvent(staff);
    const first = spy.mock.calls.length;
    await gate.onIvssFaceEvent(staff);
    expect(spy.mock.calls.length).toBe(first); // lần hai không truy vấn DB
    expect(first).toBe(1);
    spy.mockRestore();
  });

  it('khách có hai lượt: chọn lượt có khung hiệu lực chứa thời điểm sự kiện', async () => {
    await arm('approved', 'approved');
    const sameVisitor = (await AppDataSource.query(`SELECT visitor_id FROM visitor_visits WHERE id = $1`, [fx.ids.approved]))[0].visitor_id;
    const other = (await AppDataSource.query(
      `INSERT INTO visitor_visits (visit_code, visitor_id, channel, status, host_user_id, department_id, purpose, scheduled_from, scheduled_to, valid_from, valid_to)
       VALUES ('VS-fa11ed00-99', $1, 'online', 'approved', $2, $3, 'fa11ed00 lượt sau', now() + interval '30 hours', now() + interval '32 hours', now() + interval '29 hours', now() + interval '33 hours') RETURNING id`,
      [sameVisitor, fx.hostA, fx.deptA]))[0].id;
    await AppDataSource.query(`INSERT INTO visitor_visit_zones (visit_id, zone_id) VALUES ($1, $2)`, [other, fx.zoneGate]);
    await gate.onIvssFaceEvent(await ev('approved'));
    expect(await status('approved')).toBe('checked_in');
    expect((await visits.getView(other)).status).toBe('approved');
  });

  it('VISITORS_ENABLED=false → bỏ qua hoàn toàn', async () => {
    await rig.close();
    rig = await buildVisitorTestApp({ enabled: false });
    gate = rig.app.get(VisitorGateService);
    await arm('approved', 'approved');
    await gate.onIvssFaceEvent(await ev('approved'));
    expect(await status('approved')).toBe('approved');
  });

  it('lỗi bên trong không ném ra ngoài (không làm hỏng webhook)', async () => {
    await expect(gate.onIvssFaceEvent({ userId: 'không-phải-uuid', zoneId: null, direction: 'enter', eventTime: new Date(), similarity: 1, sourceEventId: null, deviceId: null })).resolves.toBeUndefined();
  });

  it('FaceGate: xác thực chiều vào/ra theo id lượt', async () => {
    await arm('approved', 'approved');
    await gate.onFaceGateVerify({ visitId: fx.ids.approved, deviceId: '00000000-0000-0000-0000-000000000000', zoneId: fx.zoneGate, direction: 'in', verifyTime: new Date() });
    expect(await status('approved')).toBe('checked_in');
    await gate.onFaceGateVerify({ visitId: fx.ids.approved, deviceId: '00000000-0000-0000-0000-000000000000', zoneId: fx.zoneGate, direction: 'out', verifyTime: new Date(Date.now() + MIN) });
    expect(await status('approved')).toBe('checked_out');
  });
});
