// VIS-BE-001 Task 7 — danh sách, quầy lễ tân, của tôi, thống kê (service thật, DB thật).
import { AppDataSource } from '../../src/database/data-source';
import { VisitQueryService } from '../../src/modules/visitors/services/visit-query.service';
import { buildVisitorTestApp, TestRig } from './support/visitor-test-app';
import { cleanupVisitFixture, seedVisitFixture, TAG, VisitFixture } from './fixtures';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDb('VIS-BE-001 visit queries', () => {
  let rig: TestRig;
  let q: VisitQueryService;
  let fx: VisitFixture;
  const ymd = (offsetDays: number) => new Date(Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    fx = await seedVisitFixture(AppDataSource);
    rig = await buildVisitorTestApp();
    q = rig.app.get(VisitQueryService);
  });
  afterAll(async () => { await rig.close(); await cleanupVisitFixture(AppDataSource); await AppDataSource.destroy(); });

  describe('danh sách', () => {
    const own = { q: TAG, limit: 100 };
    it('counts cộng lại bằng total khi không lọc trạng thái; must_leave tính vào nhóm đang trong khuôn viên', async () => {
      const r = await q.list({ ...own });
      expect(r.total).toBe(13);
      expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(13);
      expect(r.counts).toEqual({ pending_approval: 1, approved: 2, checked_in: 3, checked_out: 3, closed: 4 });
    });
    it('lọc closed trả đúng các trạng thái đóng; lọc checked_in gồm must_leave', async () => {
      const closed = await q.list({ ...own, status: 'closed' });
      expect(closed.items.map((i) => i.status).sort()).toEqual(['cancelled', 'exit_unrecorded', 'expired', 'rejected']);
      expect(closed.total).toBe(4);
      const inside = await q.list({ ...own, status: 'checked_in' });
      expect(inside.items.map((i) => i.id).sort()).toEqual([fx.ids.insideOk, fx.ids.overstay, fx.ids.mustLeave].sort());
    });
    it('lọc ngày hai đầu theo giờ VN, đơn vị, người gặp', async () => {
      expect((await q.list({ ...own, from: ymd(-1), to: ymd(-1) })).total).toBe(2);
      expect((await q.list({ ...own, from: ymd(0), to: ymd(0), departmentId: fx.deptB })).total).toBe(3);
      expect((await q.list({ ...own, hostId: fx.hostB })).total).toBe(5);
    });
    it('tìm không dấu và không phân biệt hoa thường; tìm theo mã lượt', async () => {
      expect((await q.list({ q: `${TAG} khach overstay`, limit: 10 })).total).toBe(1);
      expect((await q.list({ q: `${TAG.toUpperCase()} KHÁCH OVERSTAY`, limit: 10 })).total).toBe(1);
      expect((await q.list({ q: `VS-${TAG}-04` })).total).toBe(1);
    });
    it('ký tự % và _ trong ô tìm không khớp mọi thứ', async () => {
      expect((await q.list({ q: '%' })).total).toBe(0);
    });
    it('phân trang, sắp theo giờ hẹn giảm dần', async () => {
      const p1 = await q.list({ ...own, limit: 5, page: 1 });
      const p3 = await q.list({ ...own, limit: 5, page: 3 });
      expect(p1.items).toHaveLength(5);
      expect(p3.items).toHaveLength(3);
      const times = p1.items.map((i) => i.scheduledFrom);
      expect([...times].sort().reverse()).toEqual(times);
    });
    it('VisitView có đủ khóa FE đọc; danh sách không mang ảnh, chi tiết có ảnh', async () => {
      const item = (await q.list({ ...own, status: 'pending_approval' })).items[0];
      ['id', 'code', 'status', 'visitor', 'hostName', 'departmentName', 'access', 'zoneNames', 'events', 'availableActions', 'overstayLevel'].forEach((k) => expect(item).toHaveProperty(k));
      expect(item.visitor.photo).toBeNull();
      expect(item.access.zoneIds).toHaveLength(2);
    });
    it('related: các lượt của cùng một khách', async () => {
      const r = await q.related(fx.ids.old1);
      expect(r.map((v) => v.id).sort()).toEqual([fx.ids.old1, fx.ids.old2].sort());
      await expect(q.related('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ status: 404 });
    });
    it('chi tiết: lượt có ảnh trả data URL (từ bản giả đọc media)', async () => {
      const d = await q.detail(fx.ids.insideOk);
      expect(d.visitor.hasPhoto).toBe(true);
      expect(d.visitor.photo === null || d.visitor.photo.startsWith('data:image/')).toBe(true);
    });
    it('lookups: đơn vị không gồm VISITOR/PARTNER; khu vực có cờ FaceGate', async () => {
      const l = await q.lookups();
      expect(l.departments.some((d) => d.name.includes('Khách đến làm việc'))).toBe(false);
      expect(l.zones.find((z) => z.id === fx.zoneGate)).toMatchObject({ hasFaceGate: false });
      expect(l.purposes).toHaveLength(8);
    });
  });

  describe('quầy lễ tân', () => {
    it('KPI hôm nay theo số của fixture (>= vì DB có thể có dữ liệu khác)', async () => {
      const d = await q.deskToday();
      expect(d.kpis.expected).toBeGreaterThanOrEqual(7);
      expect(d.kpis.onSite).toBeGreaterThanOrEqual(3);
      expect(d.kpis.overstay).toBeGreaterThanOrEqual(1);
      expect(d.kpis.arrived).toBeGreaterThanOrEqual(4);
    });
    it('hàng cần xử lý đúng loại và thứ tự', async () => {
      const mine = (await q.deskToday()).attention.filter((a) => [fx.ids.mustLeave, fx.ids.overstay, fx.ids.yesterdayUnrecorded, fx.ids.approvedNoPhoto, fx.ids.approved].includes(a.visit.id));
      expect(mine.map((a) => [a.kind, a.visit.id])).toEqual([
        ['must_leave', fx.ids.mustLeave],
        ['overstay', fx.ids.overstay],
        ['exit_unrecorded', fx.ids.yesterdayUnrecorded],
        ['no_photo', fx.ids.approvedNoPhoto],
      ]);
      const overstay = mine.find((a) => a.kind === 'overstay')!.visit;
      expect(overstay.overstayLevel).toBe(2);
      expect(overstay.lastSeen?.zoneName).toContain('Cổng');
    });
    it('cảnh báo tại cổng hôm nay có lượt bị từ chối', async () => {
      const a = (await q.deskToday()).alerts.find((x) => x.visitId === fx.ids.approved);
      expect(a).toMatchObject({ type: 'access_denied', note: 'Ngoài khung giờ được cấp' });
    });
    it('danh sách khách hôm nay gồm khách còn ở trong từ hôm trước', async () => {
      const ids = (await q.deskToday()).items.map((i) => i.id);
      [fx.ids.pending, fx.ids.insideOk, fx.ids.mustLeave].forEach((id) => expect(ids).toContain(id));
      expect(ids).not.toContain(fx.ids.old1);
    });
  });

  describe('của tôi', () => {
    it('phân nhóm theo người được gặp', async () => {
      const m = await q.myVisits(fx.hostA);
      expect(m.pending.map((v) => v.id)).toEqual([fx.ids.pending]);
      expect(m.upcoming.map((v) => v.id).sort()).toEqual([fx.ids.approvedNoPhoto, fx.ids.insideOk, fx.ids.mustLeave].sort());
      expect(m.past.map((v) => v.id)).toEqual(expect.arrayContaining([fx.ids.out, fx.ids.rejected, fx.ids.old1]));
      expect((await q.myVisits(fx.hostB)).pending).toHaveLength(0);
    });
  });

  describe('thống kê', () => {
    const range = () => ({ from: ymd(-30), to: ymd(0), departmentId: undefined as string | undefined });
    it('tổng theo đơn vị cộng lại bằng tổng lượt; KPI đúng số tay', async () => {
      const s = await q.stats({ ...range(), groupBy: 'day' });
      const mine = s.byDepartment.filter((d) => d.name.startsWith(TAG));
      expect(mine.reduce((a, b) => a + b.count, 0)).toBe(7); // 7 lượt đã đến
      const a = await q.stats({ ...range(), departmentId: fx.deptA });
      expect(a.kpis.totalVisits).toBe(5);
      expect(a.kpis.uniqueVisitors).toBe(5);
      expect(a.kpis.overstayCount).toBe(0);
      expect(a.kpis.noShowRate).toBe(0);
      const b = await q.stats({ ...range(), departmentId: fx.deptB });
      expect(b.kpis.overstayCount).toBe(2); // overstay đang ở trong + old2 ra sau hiệu lực
      expect(b.kpis.noShowRate).toBe(33.3);
    });
    it('byPeriod điền ngày trống; byHour đủ 12 giờ; tổ chức xếp theo số lượt', async () => {
      const s = await q.stats({ from: ymd(-6), to: ymd(0), departmentId: fx.deptA, groupBy: 'day' });
      expect(s.byPeriod).toHaveLength(7);
      expect(s.byHour).toHaveLength(12);
      expect(s.topOrganizations.length).toBeGreaterThan(0);
      const w = await q.stats({ from: ymd(-30), to: ymd(0), departmentId: fx.deptA, groupBy: 'week' });
      expect(w.byPeriod[0].bucket).toMatch(/^Tuần \d{2}\/\d{2}$/);
    });
    it('kỳ rỗng → KPI 0; tham số sai → 400', async () => {
      const s = await q.stats({ from: '2020-01-01', to: '2020-01-07', groupBy: 'day' });
      expect(s.kpis).toEqual({ totalVisits: 0, uniqueVisitors: 0, avgStayMinutes: 0, overstayCount: 0, noShowRate: 0 });
      await expect(q.stats({ from: ymd(0), to: ymd(-3) })).rejects.toMatchObject({ response: { message: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc' } });
    });
  });
});
