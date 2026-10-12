// RPT-CENTER-BE-001 Task 8 — báo cáo khách: KPI trùng GET /visitors/stats, bảng không lộ giấy tờ/điện thoại.
import { AppDataSource } from '../../../src/database/data-source';
import { VisitQueryService } from '../../../src/modules/visitors/services/visit-query.service';
import { VisitorReportProvider } from '../../../src/modules/reports/center/providers/visitor.provider';
import type { ResolvedScope } from '../../../src/modules/reports/center/report-model';
import { cleanupVisitFixture, seedVisitFixture, VisitFixture } from '../../visitors/fixtures';
import { buildVisitorTestApp, TestRig } from '../../visitors/support/visitor-test-app';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const ADMIN: ResolvedScope = { unrestricted: true, departmentIds: null };
const kpi = (m: { kpis: Array<{ key: string; value: number | null }> }, key: string) => m.kpis.find((k) => k.key === key)?.value;
const vnToday = (offset = 0) => new Date(Date.now() + 7 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

describeDb('RPT-CENTER visitor', () => {
  let fx: VisitFixture;
  let rig: TestRig;
  let query: VisitQueryService;
  let provider: VisitorReportProvider;
  const period = { from: vnToday(-6), to: vnToday(1) };

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    rig = await buildVisitorTestApp();
    fx = await seedVisitFixture(AppDataSource);
    query = rig.app.get(VisitQueryService);
    provider = new VisitorReportProvider(AppDataSource, query as never);
    await AppDataSource.query(`UPDATE visitor_visits SET manual_exit = true WHERE id = $1`, [fx.ids.out]);
  });
  afterAll(async () => { await cleanupVisitFixture(AppDataSource); await rig.close(); await AppDataSource.destroy(); });

  const run = (extra: Record<string, string> = {}, scope = ADMIN, page: { page: number; limit: number } | null = { page: 1, limit: 100 }) =>
    provider.build({ ...period, ...extra }, scope, page, new Date());

  it('KPI bằng đúng GET /visitors/stats với cùng kỳ và đơn vị', async () => {
    for (const departmentId of [undefined, fx.deptA, fx.deptB]) {
      const stats = await query.stats({ ...period, departmentId });
      const m = await run(departmentId ? { departmentId } : {});
      expect([kpi(m, 'totalVisits'), kpi(m, 'uniqueVisitors'), kpi(m, 'avgStayMinutes'), kpi(m, 'overstayCount'), kpi(m, 'noShowRate')])
        .toEqual([stats.kpis.totalVisits, stats.kpis.uniqueVisitors, stats.kpis.avgStayMinutes, stats.kpis.overstayCount, stats.kpis.noShowRate]);
    }
  });

  it('bảng gồm lượt đã đến và lượt hết hạn; không có lượt chờ duyệt/đã duyệt/từ chối/hủy', async () => {
    const m = await run({ departmentId: fx.deptA });
    const labels = m.rows.map((r) => r.statusLabel as string);
    expect(labels.some((l) => l.startsWith('Đang trong khuôn viên'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Đã rời'))).toBe(true);
    const all = await run();
    const mine = all.rows.filter((r) => String(r.visitorName).startsWith('fa11ed00'));
    expect(mine.map((r) => r.purpose).sort()).toEqual(expect.arrayContaining([`fa11ed00 insideOk`, `fa11ed00 overstay`, `fa11ed00 yesterdayExpired`]));
    expect(mine.some((r) => String(r.purpose).endsWith('pending') || String(r.purpose).endsWith('rejected') || String(r.purpose).endsWith('cancelled'))).toBe(false);
  });

  it('nhãn trạng thái: "(quá giờ)", "(giờ ra nhập tay)", "Không đến", "Chưa ghi nhận giờ ra"', async () => {
    const m = await run();
    const by = (p: string) => m.rows.find((r) => r.purpose === `fa11ed00 ${p}`)?.statusLabel;
    expect(by('overstay')).toBe('Đang trong khuôn viên (quá giờ)');
    expect(by('out')).toBe('Đã rời (giờ ra nhập tay)');
    expect(by('yesterdayExpired')).toBe('Không đến');
    expect(by('yesterdayUnrecorded')).toBe('Chưa ghi nhận giờ ra');
  });

  it('hàng không chứa số giấy tờ và điện thoại', async () => {
    const m = await run();
    for (const r of m.rows) {
      expect(Object.keys(r)).not.toEqual(expect.arrayContaining(['idNumber']));
      expect(JSON.stringify(r)).not.toMatch(/0944\d{6}|944\d{9}/);
    }
  });

  it('lọc status và purpose', async () => {
    const expired = await run({ status: 'expired' });
    expect(expired.rows.every((r) => r.statusLabel === 'Không đến')).toBe(true);
    const byPurpose = await run({ purpose: 'fa11ed00 insideOk' });
    expect(byPurpose.total).toBe(1);
    expect(kpi(byPurpose, 'totalVisits')).toBe(1);
  });

  it('phạm vi MANAGER chỉ thấy đơn vị mình', async () => {
    const m = await run({}, { unrestricted: false, departmentIds: [fx.deptB] });
    expect(m.rows.every((r) => r.departmentName === 'fa11ed00 Khoa B')).toBe(true);
    expect(m.total).toBeGreaterThan(0);
    expect((await run({}, { unrestricted: false, departmentIds: [] })).total).toBe(0);
  });

  it('phân trang và sắp xếp', async () => {
    const p = await provider.build(period, ADMIN, { page: 1, limit: 2, sortKey: 'visitorName', sortDir: 'asc' }, new Date());
    expect(p.rows).toHaveLength(2);
    expect(p.total).toBeGreaterThan(2);
    const names = p.rows.map((r) => String(r.visitorName));
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it('kỳ không có lượt → rỗng hợp lệ', async () => {
    const m = await provider.build({ from: '2020-01-01', to: '2020-01-02' }, ADMIN, { page: 1, limit: 10 }, new Date());
    expect(m.total).toBe(0);
    expect(kpi(m, 'totalVisits')).toBe(0);
  });
});
