// VIS-BE-001 Task 13 — quét định kỳ: hết hạn, quá giờ, chưa ghi giờ ra, dọn ảnh. `now` được truyền vào để tái lập.
import { AppDataSource } from '../../src/database/data-source';
import { VisitorSweepService } from '../../src/modules/visitors/services/visitor-sweep.service';
import { cleanupVisitFixture, seedVisitFixture, VisitFixture } from './fixtures';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const MIN = 60_000;
const DAY = 86_400_000;

describeDb('VIS-BE-001 quét định kỳ', () => {
  let fx: VisitFixture;
  let svc: VisitorSweepService;
  const held = new Set<string>();
  const notified: Array<{ id: string; type: string }> = [];
  const alerted: Array<{ id: string; type: string }> = [];
  const synced: string[] = [];
  const deletedPortraits: Array<{ userId: string; media: string[] }> = [];
  const redis = {
    getClient: () => ({
      set: async (k: string, _v: string, _ex: string, _s: number, _nx: string) => (held.has(k) ? null : (held.add(k), 'OK')),
      del: async (k: string) => { held.delete(k); return 1; },
    }),
  };
  const notifier = {
    notifyHost: async (v: { id: string }, type: string) => { notified.push({ id: v.id, type }); return true; },
    alertSecurity: async (v: { id: string }, type: string) => { alerted.push({ id: v.id, type }); return true; },
  };
  const row = async (key: string) => (await AppDataSource.query(
    `SELECT status, overstay_notified_at, overstay_escalated_at FROM visitor_visits WHERE id = $1`, [fx.ids[key]]))[0];
  const events = async (key: string, type: string): Promise<number> =>
    Number((await AppDataSource.query(`SELECT count(*) c FROM visitor_visit_events WHERE visit_id = $1 AND event_type = $2`, [fx.ids[key], type]))[0].c);
  const set = (key: string, sql: string, params: unknown[] = []) =>
    AppDataSource.query(`UPDATE visitor_visits SET ${sql} WHERE id = $1`, [fx.ids[key], ...params]);

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    fx = await seedVisitFixture(AppDataSource);
    svc = new VisitorSweepService(
      AppDataSource,
      redis as never,
      { get: async () => ({ overstayEscalateMinutes: 30, photoRetentionDays: 30 }) } as never,
      notifier as never,
      { syncVisit: async (id: string) => { synced.push(id); } } as never,
      { deletePortrait: async (userId: string, media: string[] = []) => { deletedPortraits.push({ userId, media }); return { deleted: true }; } } as never,
    );
  });
  beforeEach(() => { held.clear(); notified.length = 0; alerted.length = 0; synced.length = 0; deletedPortraits.length = 0; });
  afterAll(async () => { await cleanupVisitFixture(AppDataSource); await AppDataSource.destroy(); });

  it('approved quá valid_to → expired + sự kiện + đồng bộ thiết bị; lượt còn hạn không đổi', async () => {
    await set('approved', `valid_from = now() - interval '5 hours', valid_to = now() - interval '5 minutes'`);
    const r = await svc.runSweep(new Date());
    expect(r.skipped).toBe(false);
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect((await row('approved')).status).toBe('expired');
    expect(await events('approved', 'expired')).toBe(1);
    expect(synced).toContain(fx.ids.approved);
    expect((await row('pending')).status).toBe('pending_approval');
    await svc.runSweep(new Date());
    expect(await events('approved', 'expired')).toBe(1);
  });

  it('quá giờ 1 phút → mức 1 đúng một lần dù chạy 3 lần; chưa có cảnh báo an ninh', async () => {
    await set('insideOk', `valid_from = now() - interval '5 hours', valid_to = now() - interval '1 minutes', overstay_notified_at = NULL, overstay_escalated_at = NULL`);
    for (let i = 0; i < 3; i++) await svc.runSweep(new Date());
    expect(notified.filter((n) => n.id === fx.ids.insideOk && n.type === 'visitor_overstay')).toHaveLength(1);
    expect(alerted.filter((a) => a.id === fx.ids.insideOk)).toHaveLength(0);
    expect((await row('insideOk')).overstay_notified_at).not.toBeNull();
  });

  it('quá 30 phút → mức 2 đúng một lần, có cảnh báo visitor_overstay', async () => {
    await set('overstay', `valid_from = now() - interval '5 hours', valid_to = now() - interval '45 minutes', overstay_notified_at = NULL, overstay_escalated_at = NULL`);
    await AppDataSource.query(`DELETE FROM visitor_visit_events WHERE visit_id = $1 AND event_type = 'security_notified'`, [fx.ids.overstay]); // các lượt quét trước đã leo thang lượt mẫu này
    for (let i = 0; i < 3; i++) await svc.runSweep(new Date());
    expect(alerted.filter((a) => a.id === fx.ids.overstay && a.type === 'visitor_overstay')).toHaveLength(1);
    expect(notified.filter((n) => n.id === fx.ids.overstay)).toHaveLength(1);
    expect(await events('overstay', 'security_notified')).toBe(1);
  });

  it('còn ở trong: 23:59 giờ VN không đổi, 00:00 hôm sau → exit_unrecorded; lượt nhiều ngày còn hiệu lực không đổi', async () => {
    const vnMidnight = new Date(Math.floor((Date.now() + 7 * 3_600_000) / DAY) * DAY - 7 * 3_600_000); // 00:00 VN hôm nay
    const validTo = new Date(vnMidnight.getTime() + 20 * 3_600_000);
    await set('insideOk', 'valid_from = $2::timestamptz - interval \'3 hours\', valid_to = $2, overstay_notified_at = NULL, overstay_escalated_at = NULL', [validTo]);
    await svc.runSweep(new Date(vnMidnight.getTime() + 23 * 3_600_000 + 59 * MIN));
    expect((await row('insideOk')).status).toBe('checked_in');
    await svc.runSweep(new Date(vnMidnight.getTime() + DAY));
    expect((await row('insideOk')).status).toBe('exit_unrecorded');
    expect(await events('insideOk', 'exit_unrecorded')).toBe(1);
    expect(synced).toContain(fx.ids.insideOk);
  });

  it('lượt nhiều ngày còn hiệu lực không bị đổi dù sang ngày mới', async () => {
    await set('overstay', `status = 'checked_in', valid_from = now() - interval '1 hour', valid_to = now() + interval '3 days', overstay_notified_at = NULL, overstay_escalated_at = NULL`);
    await svc.runSweep(new Date(Date.now() + DAY));
    expect((await row('overstay')).status).toBe('checked_in');
  });

  it('must_leave tính từ ngày revoked_at', async () => {
    await set('mustLeave', `revoked_at = now() - interval '2 days'`);
    await svc.runSweep(new Date());
    expect((await row('mustLeave')).status).toBe('exit_unrecorded');
  });

  it('hai lời gọi song song → một chạy, một skipped', async () => {
    const [a, b] = await Promise.all([svc.runSweep(new Date()), svc.runSweep(new Date())]);
    expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
  });

  it('lỗi ở một lượt không chặn lượt sau', async () => {
    await set('approvedNoPhoto', `status = 'approved', valid_from = now() - interval '5 hours', valid_to = now() - interval '10 minutes'`);
    await set('rejected', `status = 'approved', valid_from = now() - interval '5 hours', valid_to = now() - interval '10 minutes'`);
    let first = true;
    const flaky = new VisitorSweepService(
      AppDataSource, redis as never,
      { get: async () => ({ overstayEscalateMinutes: 30, photoRetentionDays: 30 }) } as never, notifier as never,
      { syncVisit: async () => { if (first) { first = false; throw new Error('boom'); } } } as never,
      { deletePortrait: async () => ({ deleted: true }) } as never,
    );
    await expect(flaky.runSweep(new Date())).resolves.toMatchObject({ skipped: false });
    expect((await row('approvedNoPhoto')).status).toBe('expired');
    expect((await row('rejected')).status).toBe('expired');
  });

  it('dọn ảnh: lượt cuối đóng 31 ngày trước → xóa ảnh + hồ sơ; 29 ngày → giữ; lịch sử lượt còn', async () => {
    const photo = (await AppDataSource.query(`SELECT photo_file_id, vis.user_id FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id WHERE v.id = $1`, [fx.ids.old1]))[0];
    await set('old1', `check_out_at = now() - interval '31 days'`);
    await set('old2', `check_out_at = now() - interval '31 days'`);
    const r = await svc.runPhotoRetention(new Date());
    expect(r.skipped).toBe(false);
    expect(deletedPortraits.find((d) => d.userId === photo.user_id)?.media).toContain(photo.photo_file_id);
    expect((await AppDataSource.query(`SELECT photo_file_id FROM visitor_visits WHERE id = $1`, [fx.ids.old1]))[0].photo_file_id).toBeNull();
    expect((await row('old1')).status).toBe('checked_out');

    deletedPortraits.length = 0;
    await set('out', `check_out_at = now() - interval '29 days'`);
    await svc.runPhotoRetention(new Date());
    const outUser = (await AppDataSource.query(`SELECT vis.user_id FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id WHERE v.id = $1`, [fx.ids.out]))[0].user_id;
    expect(deletedPortraits.find((d) => d.userId === outUser)).toBeUndefined();
  });

  it('dọn ảnh: khách còn lượt đang hiệu lực thì giữ ảnh', async () => {
    const photo = (await AppDataSource.query(`SELECT vis.user_id FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id WHERE v.id = $1`, [fx.ids.pending]))[0];
    await svc.runPhotoRetention(new Date(Date.now() + 90 * DAY));
    expect(deletedPortraits.find((d) => d.userId === photo.user_id)).toBeUndefined();
  });
});
