// VIS-BE-001 Task 11 — đẩy/gỡ khuôn mặt khách xuống FaceGate theo khu vực (thiết bị giả).
import { createHash } from 'crypto';
import { AppDataSource } from '../../src/database/data-source';
import { VisitorFaceGateService } from '../../src/modules/visitors/services/visitor-facegate.service';
import { cleanupVisitFixture, seedVisitFixture, VisitFixture } from './fixtures';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const MIN = 60_000;

describeDb('VIS-BE-001 FaceGate', () => {
  let fx: VisitFixture;
  let svc: VisitorFaceGateService;
  let deviceId: string;
  let enabled = true;
  let portrait: Buffer | null = Buffer.from('anh');
  const calls: Record<string, unknown[]> = { add: [], del: [] };
  const provider = {
    failAdd: false,
    uploadFace: async () => ({ dwfiletype: 1, dwfileindex: 2, dwfilepos: 3 }),
    addPerson: async (i: unknown) => { if (provider.failAdd) throw Object.assign(new Error('timeout'), { kind: 'timeout' }); calls.add.push(i); return { ok: true as const }; },
    findUidByName: async () => 'uid-1',
    deletePerson: async (uid: string) => { calls.del.push(uid); return { ok: true as const }; },
  };
  const unameOf = (visitId: string) => createHash('sha256').update(`visitor:${visitId}`).digest('hex').slice(0, 32);
  const arm = async (key: string, st: string, fromMin: number, toMin: number) => {
    await AppDataSource.query(
      `UPDATE visitor_visits SET status = $2, valid_from = now() + ($3 || ' minutes')::interval, valid_to = now() + ($4 || ' minutes')::interval WHERE id = $1`,
      [fx.ids[key], st, String(fromMin), String(toMin)]);
    await AppDataSource.query(`DELETE FROM visitor_visit_zones WHERE visit_id = $1`, [fx.ids[key]]);
    await AppDataSource.query(`INSERT INTO visitor_visit_zones (visit_id, zone_id) VALUES ($1,$2)`, [fx.ids[key], fx.zoneGate]);
  };
  const mappings = (visitId: string) => AppDataSource.query(
    `SELECT sync_status, device_person_id, device_person_code, last_sync_error, deleted_at FROM device_user_mappings WHERE metadata_json->>'visitId' = $1 ORDER BY created_at`, [visitId]);
  const live = async (visitId: string) => (await mappings(visitId)).filter((m: { deleted_at: unknown }) => m.deleted_at === null);

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    fx = await seedVisitFixture(AppDataSource);
    deviceId = (await AppDataSource.query(
      `INSERT INTO iot_devices (device_code, device_name, device_type, zone_id) VALUES ('fa11ed00-FG','FaceGate cổng','face_server',$1) RETURNING id`, [fx.zoneGate]))[0].id;
    svc = new VisitorFaceGateService(
      AppDataSource,
      { get: (k: string, d: unknown) => (k === 'VISITOR_FACEGATE_ENABLED' ? enabled : d) } as never,
      { create: () => provider } as never,
      { getPortraitBytes: async () => portrait } as never,
    );
  });
  beforeEach(async () => {
    enabled = true; portrait = Buffer.from('anh'); provider.failAdd = false; calls.add = []; calls.del = [];
    await AppDataSource.query(`DELETE FROM device_user_mappings WHERE device_id = $1`, [deviceId]);
  });
  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM device_user_mappings WHERE device_id = $1`, [deviceId]);
    await AppDataSource.query(`DELETE FROM iot_devices WHERE id = $1`, [deviceId]);
    await cleanupVisitFixture(AppDataSource);
    await AppDataSource.destroy();
  });

  it('cờ tắt → không làm gì', async () => {
    enabled = false;
    await arm('approved', 'approved', -30, 120);
    expect(await svc.provision(fx.ids.approved)).toBe('disabled');
    expect(calls.add).toHaveLength(0);
  });

  it('duyệt → đẩy khuôn mặt với khung hiệu lực của lượt, ghi mapping nguồn visitor (không có bookingId)', async () => {
    await arm('approved', 'approved', -30, 120);
    expect(await svc.provision(fx.ids.approved)).toBe('provisioned');
    expect(calls.add).toHaveLength(1);
    const arg = calls.add[0] as { uname: string; validFrom: Date; validTo: Date };
    expect(arg.uname).toBe(unameOf(fx.ids.approved));
    expect(arg.uname.length).toBeLessThanOrEqual(32);
    expect(Math.abs(arg.validTo.getTime() - Date.now() - 120 * MIN)).toBeLessThan(5_000);
    const row = (await live(fx.ids.approved))[0];
    expect(row).toMatchObject({ sync_status: 'synced', device_person_id: 'uid-1' });
    const meta = (await AppDataSource.query(`SELECT metadata_json FROM device_user_mappings WHERE metadata_json->>'visitId' = $1`, [fx.ids.approved]))[0].metadata_json;
    expect(meta.source).toBe('visitor');
    expect(meta.bookingId).toBeUndefined();
  });

  it('lặp lại → idempotent: một mapping, không addPerson lần hai', async () => {
    await arm('approved', 'approved', -30, 120);
    await svc.provision(fx.ids.approved);
    expect(await svc.provision(fx.ids.approved)).toBe('noop');
    expect(calls.add).toHaveLength(1);
    expect(await live(fx.ids.approved)).toHaveLength(1);
  });

  it('khu vực không có thiết bị FaceGate → bỏ qua, không lỗi', async () => {
    await arm('approved', 'approved', -30, 120);
    await AppDataSource.query(`DELETE FROM visitor_visit_zones WHERE visit_id = $1`, [fx.ids.approved]);
    await AppDataSource.query(`INSERT INTO visitor_visit_zones (visit_id, zone_id) VALUES ($1,$2)`, [fx.ids.approved, fx.zoneB1]);
    expect(await svc.provision(fx.ids.approved)).toBe('no_device');
    expect(calls.add).toHaveLength(0);
  });

  it('thiết bị lỗi (timeout) → mapping failed, không ném; reconcile đẩy lại thành công', async () => {
    await arm('approved', 'approved', -30, 120);
    provider.failAdd = true;
    await expect(svc.provision(fx.ids.approved)).resolves.toBe('failed');
    expect((await live(fx.ids.approved))[0]).toMatchObject({ sync_status: 'failed' });
    provider.failAdd = false;
    const r = await svc.reconcile();
    expect(r.provisioned).toBeGreaterThanOrEqual(1);
    expect((await live(fx.ids.approved))[0]).toMatchObject({ sync_status: 'synced' });
  });

  it('chưa có ảnh đã duyệt → mapping pending no_portrait', async () => {
    await arm('approved', 'approved', -30, 120);
    portrait = null;
    expect(await svc.provision(fx.ids.approved)).toBe('no_portrait');
    expect((await live(fx.ids.approved))[0]).toMatchObject({ sync_status: 'pending', last_sync_error: 'no_portrait' });
  });

  it('gỡ: deletePerson được gọi, mapping xóa mềm; gọi lại không lỗi', async () => {
    await arm('approved', 'approved', -30, 120);
    await svc.provision(fx.ids.approved);
    await svc.deprovision(fx.ids.approved);
    expect(calls.del).toEqual(['uid-1']);
    expect(await live(fx.ids.approved)).toHaveLength(0);
    await expect(svc.deprovision(fx.ids.approved)).resolves.toBeUndefined();
  });

  it('gia hạn: gỡ rồi đẩy lại với khung mới', async () => {
    await arm('approved', 'approved', -30, 120);
    await svc.provision(fx.ids.approved);
    await AppDataSource.query(`UPDATE visitor_visits SET valid_to = now() + interval '300 minutes' WHERE id = $1`, [fx.ids.approved]);
    await svc.reprovision(fx.ids.approved);
    expect(calls.del).toEqual(['uid-1']);
    expect(calls.add).toHaveLength(2);
    const second = calls.add[1] as { validTo: Date };
    expect(Math.abs(second.validTo.getTime() - Date.now() - 300 * MIN)).toBeLessThan(5_000);
  });

  it('khách phải rời → cửa không mở nữa: reconcile gỡ khỏi thiết bị', async () => {
    await arm('approved', 'approved', -30, 120);
    await svc.provision(fx.ids.approved);
    await AppDataSource.query(`UPDATE visitor_visits SET status = 'must_leave' WHERE id = $1`, [fx.ids.approved]);
    const r = await svc.reconcile();
    expect(r.removed).toBeGreaterThanOrEqual(1);
    expect(await live(fx.ids.approved)).toHaveLength(0);
  });

  it('reconcile: lượt sắp tới trong 60 phút được đẩy sớm; lượt xa hơn thì chưa', async () => {
    await arm('approved', 'approved', 20, 140);
    await arm('pending', 'approved', 300, 420);
    await svc.reconcile();
    expect(await live(fx.ids.approved)).toHaveLength(1);
    expect(await live(fx.ids.pending)).toHaveLength(0);
  });

  it('reconcile: lượt đã đóng/hết hạn có mapping còn sót → được gỡ', async () => {
    await arm('approved', 'approved', -30, 120);
    await svc.provision(fx.ids.approved);
    await AppDataSource.query(`UPDATE visitor_visits SET status = 'checked_out' WHERE id = $1`, [fx.ids.approved]);
    await svc.reconcile();
    expect(await live(fx.ids.approved)).toHaveLength(0);
  });

  it('slot (thiết bị, khách) đang bận bởi lượt khác còn hiệu lực → hoãn, không đẩy', async () => {
    await arm('old1', 'approved', -30, 120);
    await svc.provision(fx.ids.old1);
    // old2 cùng khách (khách lặp) — lượt thứ hai trùng thiết bị và vẫn trong 60 phút tới
    await arm('old2', 'approved', 30, 200);
    expect(await svc.provision(fx.ids.old2)).toBe('slot_busy');
    expect(calls.add).toHaveLength(1);
  });
});
