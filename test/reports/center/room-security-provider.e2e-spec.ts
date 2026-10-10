// RPT-CENTER-BE-001 Task 6 — provider room-utilization và security-alert.
import { AppDataSource } from '../../../src/database/data-source';
import { RoomUtilizationReportDataService } from '../../../src/modules/reports/services/room-utilization-report-data.service';
import { SecurityAlertReportDataService } from '../../../src/modules/reports/services/security-alert-report-data.service';
import { SecurityAlertEntity } from '../../../src/modules/alerts/entities/security-alert.entity';
import { RoomUtilizationReportProvider } from '../../../src/modules/reports/center/providers/room-utilization.provider';
import { SecurityAlertReportProvider } from '../../../src/modules/reports/center/providers/security-alert.provider';
import type { ReportFilters, ResolvedScope } from '../../../src/modules/reports/center/report-model';
import { cleanupReportFixture, NOW, PERIOD, ReportFixture, seedReportFixture } from './fixtures';
import { cleanupRoomSecurityFixture, RoomFixture, seedAlertFixture, seedRoomFixture } from './room-security-fixture';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const ADMIN: ResolvedScope = { unrestricted: true, departmentIds: null };
const kpi = (m: { kpis: Array<{ key: string; value: number | null }> }, key: string) => m.kpis.find((k) => k.key === key)?.value;

describeDb('RPT-CENTER room-utilization / security-alert', () => {
  let fx: ReportFixture;
  let rf: RoomFixture;
  let room: RoomUtilizationReportProvider;
  let alert: SecurityAlertReportProvider;
  const f = (extra: Record<string, string> = {}): ReportFilters => ({ ...PERIOD, ...extra });

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    fx = await seedReportFixture(AppDataSource);
    rf = await seedRoomFixture(AppDataSource, fx);
    await seedAlertFixture(AppDataSource, fx);
    room = new RoomUtilizationReportProvider(AppDataSource);
    alert = new SecurityAlertReportProvider(AppDataSource, new SecurityAlertReportDataService(AppDataSource.getRepository(SecurityAlertEntity)));
  });
  afterAll(async () => {
    await cleanupRoomSecurityFixture(AppDataSource);
    await cleanupReportFixture(AppDataSource);
    await AppDataSource.destroy();
  });

  describe('room-utilization', () => {
    const run = (extra: Record<string, string> = {}, page: { page: number; limit: number } | null = { page: 1, limit: 50 }) =>
      room.build(f(extra), ADMIN, page, NOW);

    it('KPI: 12 họp, dùng 14h/17h = 82,4%, không đến 2/12 = 16,7%', async () => {
      const m = await run({ building: 'A1' });
      const n = await run({ building: 'B2' });
      expect(kpi(m, 'meetingCount')).toBe(5);
      expect(kpi(n, 'meetingCount')).toBe(7);
      expect((kpi(m, 'meetingCount') as number) + (kpi(n, 'meetingCount') as number)).toBe(12);
      expect((kpi(m, 'usedHours') as number) + (kpi(n, 'usedHours') as number)).toBe(14);
      expect(kpi(m, 'utilizationRate')).toBe(Math.round((8.5 / 10) * 1000) / 10); // R1 4,5 + R2 4 = 8,5 / đặt 6+4
      expect(kpi(n, 'noShowRate')).toBe(Math.round((1 / 7) * 1000) / 10);
    });

    it('khớp số liệu của RoomUtilizationReportDataService trên cùng phòng', async () => {
      const svc = new RoomUtilizationReportDataService(AppDataSource, { get: () => 8 } as never);
      const base = { from: PERIOD.from, to: PERIOD.to, scope: { roomId: rf.rooms.R1 } };
      const section = await svc.getUtilizationSection(base);
      const noShow = await svc.getNoShowSection(base);
      const m = await run({ roomId: rf.rooms.R1 });
      expect(kpi(m, 'usedHours')).toBe(section.actualHours);
      expect(m.rows[0]).toMatchObject({ bookedHours: section.bookedHours, usedHours: section.actualHours, noShowCount: noShow.noShowCount });
    });

    it('lọc roomId/building thu hẹp; bảng có giờ đặt, giờ dùng, tỷ lệ theo phòng', async () => {
      const m = await run({ building: 'B2' });
      expect(m.total).toBe(2);
      const r3 = m.rows.find((r) => String(r.roomName).endsWith('Phòng R3'));
      expect(r3).toMatchObject({ meetingCount: 3, bookedHours: 3, usedHours: 1.5, utilizationRate: 50, noShowCount: 1, building: 'B2' });
    });

    it('biểu đồ ngày theo giờ VN: 14/09 = 10h, 15/09 = 4h', async () => {
      const a = await run({ building: 'A1' });
      const b = await run({ building: 'B2' });
      const days = new Map<string, number>();
      for (const m of [a, b]) for (const d of m.charts.find((c) => c.key === 'daily')?.data as Array<{ date: string; usedHours: number }>) days.set(d.date, (days.get(d.date) ?? 0) + d.usedHours);
      expect(Object.fromEntries(days)).toEqual({ '14/09': 10, '15/09': 4 });
    });

    it('kỳ không có họp → mô hình rỗng hợp lệ', async () => {
      const m = await room.build({ from: '2020-01-01', to: '2020-01-02' }, ADMIN, { page: 1, limit: 10 }, NOW);
      expect(m.total).toBe(0);
      expect(kpi(m, 'utilizationRate')).toBe(0);
    });
  });

  describe('security-alert', () => {
    const run = (extra: Record<string, string> = {}, page: { page: number; limit: number } | null = { page: 1, limit: 50 }) =>
      alert.build(f(extra), ADMIN, page, NOW);

    it('KPI: 15 sự kiện, 4 nghiêm trọng, 7 đã xử lý, thời gian xử lý TB 54 phút', async () => {
      const m = await run();
      expect([kpi(m, 'total'), kpi(m, 'critical'), kpi(m, 'resolved'), kpi(m, 'avgResolveMinutes')]).toEqual([15, 4, 7, 54]);
      expect(m.total).toBe(15);
    });

    it('lọc loại FE → loại thật: watchlist_person=2, camera_offline=2, vehicle=0; visitor_* có mặt', async () => {
      expect((await run({ alertType: 'watchlist_person' })).total).toBe(2);
      expect((await run({ alertType: 'camera_offline' })).total).toBe(2);
      expect((await run({ alertType: 'vehicle' })).total).toBe(0);
      expect((await run({ alertType: 'visitor_overstay' })).total).toBe(2);
    });

    it('lọc severity, zone, trạng thái (open → new)', async () => {
      expect((await run({ severity: 'critical' })).total).toBe(4);
      expect((await run({ zoneId: fx.g1 })).total).toBe(7);
      expect((await run({ status: 'open' })).total).toBe(7);
      expect((await run({ status: 'resolved' })).total).toBe(7);
    });

    it('thời gian xử lý chỉ tính cảnh báo đã xử lý; cảnh báo chưa xử lý không có số phút', async () => {
      const m = await run({ status: 'open' });
      expect(kpi(m, 'avgResolveMinutes')).toBe(0);
      expect(m.rows.every((r) => r.resolveMinutes === null)).toBe(true);
    });

    it('biểu đồ ngày theo giờ VN và cơ cấu loại; nhãn tiếng Việt; payload khách hiển thị ở đối tượng', async () => {
      const m = await run();
      expect(m.charts.find((c) => c.key === 'daily')?.data).toEqual([{ date: '14/09', count: 8 }, { date: '15/09', count: 7 }]);
      const byType = m.charts.find((c) => c.key === 'byType')?.data as Array<{ name: string; count: number }>;
      expect(byType.find((t) => t.name === 'Người lạ')?.count).toBe(4);
      const overstay = m.rows.find((r) => r.typeLabel === 'Khách quá giờ' && r.subject);
      expect(overstay?.subject).toBe('Khách A');
      expect(m.rows[0].severityLabel).toBeTruthy();
    });

    it('phân trang + sắp xếp + q không dấu', async () => {
      const m = await alert.build(f(), ADMIN, { page: 2, limit: 5, sortKey: 'severityLabel', sortDir: 'asc' }, NOW);
      expect(m.rows).toHaveLength(5);
      expect(m.total).toBe(15);
      expect((await run({ q: 'nguoi la' })).total).toBe(4);
    });
  });
});
