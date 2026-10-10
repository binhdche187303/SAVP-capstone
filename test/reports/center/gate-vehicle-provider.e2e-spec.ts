// RPT-CENTER-BE-001 Task 5 — provider gate-access và vehicle trên dữ liệu mẫu có số liệu biết trước.
import { AppDataSource } from '../../../src/database/data-source';
import { GateAccessReportProvider } from '../../../src/modules/reports/center/providers/gate-access.provider';
import { VehicleReportProvider } from '../../../src/modules/reports/center/providers/vehicle.provider';
import type { ReportFilters, ResolvedScope } from '../../../src/modules/reports/center/report-model';
import { cleanupReportFixture, NOW, PERIOD, ReportFixture, seedReportFixture } from './fixtures';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const ADMIN: ResolvedScope = { unrestricted: true, departmentIds: null };
const kpi = (m: { kpis: Array<{ key: string; value: number | null }> }, key: string) => m.kpis.find((k) => k.key === key)?.value;

describeDb('RPT-CENTER gate-access / vehicle', () => {
  let fx: ReportFixture;
  let gate: GateAccessReportProvider;
  let vehicle: VehicleReportProvider;
  const filters = (extra: Record<string, string> = {}): ReportFilters => ({ ...PERIOD, ...extra });
  // Dữ liệu dùng chung DB: giới hạn vào các cổng của fixture để không lẫn dữ liệu khác.
  const gateReport = (extra: Record<string, string> = {}, scope = ADMIN, page = { page: 1, limit: 50 } as never) =>
    gate.build(filters({ ...extra }), scope, page, NOW);

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    fx = await seedReportFixture(AppDataSource);
    gate = new GateAccessReportProvider(AppDataSource);
    vehicle = new VehicleReportProvider(AppDataSource);
  });
  afterAll(async () => { await cleanupReportFixture(AppDataSource); await AppDataSource.destroy(); });

  describe('gate-access', () => {
    it('KPI (cộng hai cổng): 13 lượt vào, 11 lượt ra, 1 đang trong khuôn viên hôm nay; bảng chỉ 11 phiên hoàn tất', async () => {
      const m = await gate.build(filters({ zoneId: fx.g1 }), ADMIN, { page: 1, limit: 50 }, NOW);
      const all = await Promise.all([fx.g1, fx.g2].map((z) => gate.build(filters({ zoneId: z }), ADMIN, { page: 1, limit: 50 }, NOW)));
      const entries = all.reduce((n, r) => n + (kpi(r, 'entries') as number), 0);
      const exits = all.reduce((n, r) => n + (kpi(r, 'exits') as number), 0);
      const onSite = all.reduce((n, r) => n + (kpi(r, 'onSite') as number), 0);
      expect({ entries, exits, onSite }).toEqual({ entries: 13, exits: 11, onSite: 1 });
      expect(kpi(m, 'entries')).toBe(7);
      const rowsTotal = all.reduce((n, r) => n + r.total, 0);
      expect(rowsTotal).toBe(11); // chỉ phiên hoàn tất
    });

    it('phiên chưa hoàn tất không nằm trong bảng nhưng phiên mở hôm nay được đếm ở onSite', async () => {
      const m = await gateReport({ zoneId: fx.g2 });
      expect(kpi(m, 'onSite')).toBe(1);
      expect(m.rows.every((r) => r.checkOutTime !== null)).toBe(true);
    });

    it('lưu trú trung bình = trung bình thời lượng phiên hoàn tất (phút)', async () => {
      const m1 = await gateReport({ zoneId: fx.g1 });
      // G1 hoàn tất: 32400, 32400, 14400, 14400, 7200, 7200 → TB 18000s = 300 phút
      expect(kpi(m1, 'avgStayMinutes')).toBe(300);
    });

    it('lọc subjectType: sinh viên 2 phiên, khách 1, vãng lai 2, cán bộ 6', async () => {
      const count = async (t: string) => (await gateReport({ subjectType: t })).total;
      expect({ student: await count('student'), visitor: await count('visitor'), unknown: await count('unknown'), staff: await count('staff') })
        .toEqual({ student: 2, visitor: 1, unknown: 2, staff: 6 });
    });

    it('lọc departmentId và zoneId thu hẹp đúng', async () => {
      expect((await gateReport({ departmentId: fx.deptB })).total).toBe(2);
      expect((await gateReport({ zoneId: fx.g2, subjectType: 'staff' })).total).toBe(3);
    });

    it('biểu đồ theo giờ gộp theo GIỜ VIỆT NAM: phiên vào 23:30 VN (16:30Z) rơi vào 23h, ra 01:30 VN rơi vào 01h', async () => {
      const m = await gateReport({ zoneId: fx.g1 });
      const hourly = m.charts.find((c) => c.key === 'hourly')?.data as Array<{ hour: string; entries: number; exits: number }>;
      expect(hourly.find((h) => h.hour === '23h')?.entries).toBe(1);
      expect(hourly.find((h) => h.hour === '01h')?.exits).toBe(1);
      expect(hourly.find((h) => h.hour === '16h')?.entries ?? 0).toBe(0);
    });

    it('phạm vi MANAGER chỉ thấy đơn vị mình (staff của đơn vị)', async () => {
      const m = await gateReport({}, { unrestricted: false, departmentIds: [fx.deptB] });
      expect(m.total).toBe(2);
      expect(m.rows.every((r) => r.departmentName === `fa11ed01 Khoa B`)).toBe(true);
      const empty = await gateReport({}, { unrestricted: false, departmentIds: [] });
      expect(empty.total).toBe(0);
    });

    it('q tìm theo tên không dấu, theo biển số và theo mã', async () => {
      expect((await gateReport({ q: 'nguyen van an' })).total).toBeGreaterThanOrEqual(4);
      expect((await gateReport({ q: 'FA11ED01A' })).total).toBe(1);
      expect((await gateReport({ q: 'fa11ed01-s1' })).total).toBe(2);
    });

    it('phân trang và sắp xếp: limit 2 trang 2, sort fullName desc', async () => {
      const p1 = await gate.build(filters({ departmentId: fx.deptA }), ADMIN, { page: 1, limit: 2, sortKey: 'fullName', sortDir: 'desc' }, NOW);
      const p3 = await gate.build(filters({ departmentId: fx.deptA }), ADMIN, { page: 9, limit: 2, sortKey: 'fullName', sortDir: 'desc' }, NOW);
      expect(p1.rows).toHaveLength(2);
      expect(p1.total).toBeGreaterThan(2);
      expect(p3.rows).toHaveLength(0);
      expect(p3.total).toBe(p1.total);
      const names = p1.rows.map((r) => r.fullName as string);
      expect([...names].sort().reverse()).toEqual(names);
    });

    it('kỳ không có dữ liệu → mô hình rỗng hợp lệ, biểu đồ theo giờ rỗng', async () => {
      const m = await gate.build({ from: '2020-01-01', to: '2020-01-02' }, ADMIN, { page: 1, limit: 10 }, NOW);
      expect(m.total).toBe(0);
      expect(m.rows).toEqual([]);
      expect(m.charts.find((c) => c.key === 'hourly')?.data).toEqual([]);
      expect(kpi(m, 'entries')).toBe(0);
    });

    it('xuất (page=null) trả toàn bộ dòng', async () => {
      const m = await gate.build(filters({ departmentId: fx.deptA }), ADMIN, null, NOW);
      expect(m.rows.length).toBe(m.total);
    });
  });

  describe('vehicle', () => {
    const veh = (extra: Record<string, string> = {}, scope = ADMIN) => vehicle.build(filters(extra), scope, { page: 1, limit: 50 }, NOW);

    it('KPI: 5 lượt, 2 ô tô, 3 xe máy, 3 chưa đăng ký, 2 thuộc danh sách kiểm soát', async () => {
      const m = await veh();
      const mine = m.rows.filter((r) => String(r.plateNumber).startsWith('FA11ED01'));
      expect(mine).toHaveLength(5);
      const g1 = await veh({ zoneId: fx.g1 });
      const g2 = await veh({ zoneId: fx.g2 });
      expect(kpi(g1, 'total')).toBe(2);
      expect(kpi(g2, 'total')).toBe(3);
      expect(kpi(g1, 'cars')).toBe(2);
      expect(kpi(g2, 'motorbikes')).toBe(3);
      expect(kpi(g2, 'unregistered')).toBe(2);
      expect(kpi(g2, 'watchlist')).toBe(2);
    });

    it('lọc registrationStatus / vehicleType', async () => {
      const wl = await veh({ registrationStatus: 'watchlist' });
      expect(wl.rows.filter((r) => String(r.plateNumber).startsWith('FA11ED01'))).toHaveLength(2);
      expect(wl.rows.every((r) => r.statusLabel === 'Danh sách kiểm soát')).toBe(true);
      const unreg = await veh({ registrationStatus: 'unregistered', zoneId: fx.g1 });
      expect(unreg.total).toBe(1);
      const cars = await veh({ vehicleType: 'car', zoneId: fx.g1 });
      expect(cars.rows.map((r) => r.vehicleTypeLabel)).toEqual(['Ô tô', 'Ô tô']);
    });

    it('cơ cấu loại xe và nhãn chủ xe / đơn vị', async () => {
      const g1 = await veh({ zoneId: fx.g1 });
      expect(g1.charts.find((c) => c.key === 'byType')?.data).toEqual([{ name: 'Ô tô', count: 2 }]);
      const own = g1.rows.find((r) => r.plateNumber === 'FA11ED01A');
      expect(own).toMatchObject({ ownerName: 'Nguyễn Văn An', vehicleTypeLabel: 'Ô tô', statusLabel: 'Đã đăng ký' });
    });

    it('vehicle không có chiều đơn vị: lọc theo phạm vi vẫn an toàn (phạm vi rỗng → không dòng)', async () => {
      expect((await veh({}, { unrestricted: false, departmentIds: [] })).total).toBe(0);
    });
  });
});
