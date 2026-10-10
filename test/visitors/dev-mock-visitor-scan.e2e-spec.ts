// VIS-BE-001 Task 14 — POST /dev/mock-visitor-scan: 5 ca của test FE "VisitorGate", đi cùng đường với sự kiện camera thật.
import { AppDataSource } from '../../src/database/data-source';
import { VisitorDevScanService } from '../../src/modules/visitors/services/visitor-dev-scan.service';
import { cleanupVisitFixture, seedVisitFixture, VisitFixture } from './fixtures';
import { buildVisitorTestApp, TestRig } from './support/visitor-test-app';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDb('VIS-BE-001 dev mock-visitor-scan', () => {
  let fx: VisitFixture;
  let app: TestRig;
  let dev: VisitorDevScanService;
  const arm = (key: string, sql: string) => AppDataSource.query(`UPDATE visitor_visits SET ${sql} WHERE id = $1`, [fx.ids[key]]);
  const codeOf = async (key: string) => (await AppDataSource.query(`SELECT visit_code FROM visitor_visits WHERE id = $1`, [fx.ids[key]]))[0].visit_code as string;
  const resetApproved = () => arm('approved',
    `status = 'approved', check_in_at = NULL, check_out_at = NULL, revoked_at = NULL, valid_from = now() - interval '30 minutes', valid_to = now() + interval '2 hours'`);

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    app = await buildVisitorTestApp();
    fx = await seedVisitFixture(AppDataSource);
    dev = app.app.get(VisitorDevScanService);
    // Mã thật luôn viết hoa; mã mẫu có TAG thường nên viết hoa lại để tra theo mã (chuẩn hóa hoa) khớp.
    await AppDataSource.query(`UPDATE visitor_visits SET visit_code = upper(visit_code) WHERE purpose LIKE 'fa11ed00%'`);
  });
  afterAll(async () => { await cleanupVisitFixture(AppDataSource); await app.close(); await AppDataSource.destroy(); });
  beforeEach(async () => { await resetApproved(); });

  it('quét bình thường → vào, điểm 0.93, có ghi nhận cổng', async () => {
    const r = await dev.scan({ code: (await codeOf('approved')).toLowerCase(), zoneId: fx.zoneGate, direction: 'in', scenario: 'normal' });
    expect(r).toMatchObject({ outcome: 'checked_in', reason: null, score: 0.93 });
    expect(r.visit.status).toBe('checked_in');
    expect(r.visit.lastSeen?.zoneId).toBe(fx.zoneGate);
  });

  it('ngoài khung giờ → từ chối outside_window, lượt không đổi', async () => {
    const r = await dev.scan({ code: await codeOf('approved'), zoneId: fx.zoneGate, direction: 'in', scenario: 'outside_window' });
    expect(r).toMatchObject({ outcome: 'access_denied', reason: 'outside_window' });
    expect(r.visit.status).toBe('approved');
  });

  it('độ khớp thấp → manual_review low_score (0.71)', async () => {
    const r = await dev.scan({ code: await codeOf('approved'), zoneId: fx.zoneGate, direction: 'in', scenario: 'low_score' });
    expect(r).toMatchObject({ outcome: 'manual_review', reason: 'low_score', score: 0.71 });
    expect(r.visit.status).toBe('approved');
  });

  it('đã bị thu hồi rồi: vào bị từ chối, ra vẫn được', async () => {
    const code = await codeOf('mustLeave');
    const tryIn = await dev.scan({ code, zoneId: fx.zoneB1, direction: 'in', scenario: 'normal' });
    expect(tryIn).toMatchObject({ outcome: 'access_denied', reason: 'access_revoked' });
    const out = await dev.scan({ code, zoneId: fx.zoneGate, direction: 'out', scenario: 'normal' });
    expect(out.outcome).toBe('checked_out');
    expect(out.visit.status).toBe('checked_out');
  });

  it('ra khi chưa vào → not_on_site; vào xong rồi ra → checked_out', async () => {
    const code = await codeOf('approved');
    expect(await dev.scan({ code, zoneId: fx.zoneGate, direction: 'out', scenario: 'normal' })).toMatchObject({ outcome: 'access_denied', reason: 'not_on_site' });
    await dev.scan({ code, zoneId: fx.zoneGate, direction: 'in', scenario: 'normal' });
    expect((await dev.scan({ code, zoneId: fx.zoneGate, direction: 'out', scenario: 'normal' })).outcome).toBe('checked_out');
  });

  it('mã sai → 404 với đúng thông điệp của FE', async () => {
    await expect(dev.scan({ code: 'VS-000000-0000', zoneId: fx.zoneGate, direction: 'in', scenario: 'normal' }))
      .rejects.toMatchObject({ response: { message: 'Không tìm thấy lượt khách với mã này' } });
  });

  it('NODE_ENV=production → từ chối (404) dù route lỡ được nạp', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(dev.scan({ code: await codeOf('approved'), zoneId: fx.zoneGate, direction: 'in', scenario: 'normal' })).rejects.toMatchObject({ status: 404 });
    } finally { process.env.NODE_ENV = prev; }
  });
});
