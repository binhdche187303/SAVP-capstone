// VIS-BE-001 Task 6 — các thao tác ghi trên lượt khách (service thật, DB thật).
// Chạy: RUN_DB_TESTS=1 npx jest --config test/jest-e2e.json test/visitors/visit-actions --runInBand
import { AppDataSource } from '../../src/database/data-source';
import { VisitActionsService } from '../../src/modules/visitors/services/visit-actions.service';
import { VisitorConfigService } from '../../src/modules/visitors/config/visitor-config.service';
import { AuditLogsService } from '../../src/modules/administration/services/audit-logs.service';
import { VisitService } from '../../src/modules/visitors/services/visit.service';
import { buildVisitorTestApp, TestRig } from './support/visitor-test-app';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const TAG = 'fa11ed06';
const HOUR = 3_600_000;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const MANAGE = ['visitor.visit.manage', 'visitor.desk.use', 'visitor.visit.read'];

describeDb('VIS-BE-001 visit actions', () => {
  let rig: TestRig;
  let visits: VisitService;
  let actions: VisitActionsService;
  let hostId: string;
  let otherId: string;
  let phoneSeq = 0;
  const asHost = () => ({ userId: hostId, permissions: ['visitor.host.self'] });
  const asOther = () => ({ userId: otherId, permissions: ['visitor.host.self'] });
  const asAdmin = () => ({ userId: otherId, permissions: MANAGE });

  async function user(code: string, name: string) {
    return (await AppDataSource.query(
      `INSERT INTO users (employee_code, username, email, password_hash, full_name) VALUES ($1,$2,$3,'x',$4) RETURNING id`,
      [`${TAG}-${code}`, `${TAG}${code}`, `${TAG}${code}@t.invalid`, `${TAG} ${name}`],
    ))[0].id as string;
  }
  async function cleanup() {
    await AppDataSource.query(`DELETE FROM visitor_visits WHERE purpose LIKE '${TAG}%'`);
    await AppDataSource.query(`DELETE FROM visitors WHERE full_name LIKE '${TAG}%'`);
    await AppDataSource.query(`DELETE FROM users WHERE employee_code LIKE '${TAG}-%' OR (email LIKE '%@visitor.invalid' AND full_name LIKE '${TAG}%')`);
  }
  const base = (over: Record<string, unknown> = {}) => ({
    visitor: { fullName: `${TAG} Khách ${phoneSeq}`, idNumber: '', phone: `0966${String(++phoneSeq).padStart(6, '0')}`, email: 'k@example.com', organization: 'Công ty A', photo: PNG },
    hostId, purpose: `${TAG} họp`, companions: 0, consent: true,
    scheduledFrom: new Date(Date.now() + HOUR).toISOString(), scheduledTo: new Date(Date.now() + 3 * HOUR).toISOString(), ...over,
  });
  const walkIn = (over: Record<string, unknown> = {}) => visits.create('walk_in', base(over), asAdmin());
  const online = (over: Record<string, unknown> = {}) => visits.create('online', base(over), null);
  async function checkedIn() {
    const v = await walkIn();
    await actions.checkInManual(v.id, { note: 'Đã đối chiếu CCCD' }, asAdmin());
    return v;
  }
  const events = async (id: string) => (await visits.getView(id)).events.map((e) => e.type);

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    await cleanup();
    hostId = await user('H', 'Chủ nhà');
    otherId = await user('O', 'Người khác');
  });
  beforeEach(async () => {
    rig = await buildVisitorTestApp();
    visits = rig.app.get(VisitService);
    actions = rig.app.get(VisitActionsService);
  });
  afterEach(async () => rig.close());
  afterAll(async () => { await cleanup(); await AppDataSource.destroy(); });

  it('duyệt: pending → approved, có sự kiện, email cho khách, gọi đồng bộ thiết bị', async () => {
    const v = await online();
    const res = await actions.approve(v.id, {}, asHost());
    expect(res.status).toBe('approved');
    expect(await events(v.id)).toEqual(expect.arrayContaining(['registered', 'approved', 'email_sent']));
    expect(rig.deviceSync.syncVisit).toHaveBeenCalledWith(v.id);
    expect(rig.notifications.emails.some((e) => String(e.subject).includes('đã được duyệt'))).toBe(true);
  });

  it('duyệt kèm quyền sửa: khu vực và khung giờ được thay; validTo phải sau validFrom', async () => {
    const zone = (await AppDataSource.query(`SELECT id FROM zones WHERE deleted_at IS NULL LIMIT 1`))[0]?.id
      ?? (await AppDataSource.query(`INSERT INTO zones (zone_code, zone_name, zone_type, status) VALUES ('${TAG}-Z','Z ${TAG}','building','active') RETURNING id`))[0].id;
    const v = await online();
    const from = new Date(Date.now() + 2 * HOUR).toISOString();
    await expect(actions.approve(v.id, { access: { validFrom: from, validTo: from, zoneIds: [zone] } }, asAdmin()))
      .rejects.toMatchObject({ response: { message: 'Hiệu lực đến phải sau hiệu lực từ' } });
    const ok = await actions.approve(v.id, { access: { validFrom: from, validTo: new Date(Date.now() + 5 * HOUR).toISOString(), zoneIds: [zone] } }, asAdmin());
    expect(ok.access.zoneIds).toEqual([zone]);
    expect(ok.access.validFrom).toBe(from);
  });

  it('hồi quy: UPDATE có điều kiện trên trạng thái đã cũ → 409 (TypeORM trả [rows, count], không phải mảng dòng)', async () => {
    const v = await online();
    await actions.approve(v.id, {}, asAdmin());
    // Người thứ hai đọc trạng thái cũ (pending_approval) rồi mới ghi: không dòng nào khớp → phải ném 409.
    await expect(
      (actions as unknown as { conditionalUpdate: (...a: unknown[]) => Promise<void> })
        .conditionalUpdate(AppDataSource.manager, { id: v.id }, 'pending_approval', {}, 'rejected'),
    ).rejects.toMatchObject({ status: 409 });
    expect((await visits.getView(v.id)).status).toBe('approved');
  });

  it('hai người duyệt đồng thời: một thành công, một 409, chỉ một sự kiện approved', async () => {
    const v = await online();
    const results = await Promise.allSettled([actions.approve(v.id, {}, asAdmin()), actions.approve(v.id, {}, asAdmin())]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.response.error.code).toMatch(/VISIT_STATE_CONFLICT|VISIT_INVALID_TRANSITION/);
    expect((await events(v.id)).filter((t) => t === 'approved')).toHaveLength(1);
  });

  it('BR-V18: người khác không phải chủ nhà → 403; admin được; manager_only chặn cả chủ nhà', async () => {
    const v = await online();
    await expect(actions.approve(v.id, {}, asOther())).rejects.toMatchObject({ status: 403 });
    expect((await actions.approve(v.id, {}, asAdmin())).status).toBe('approved');
    await AppDataSource.query(`DELETE FROM system_configs WHERE config_key = 'visitor.approver_mode'`);
    await AppDataSource.query(`INSERT INTO system_configs (config_key, config_value, value_type, config_group, is_active) VALUES ('visitor.approver_mode','manager_only','string','visitor',true)`);
    rig.app.get(VisitorConfigService).invalidate();
    const v2 = await online();
    await expect(actions.approve(v2.id, {}, asHost())).rejects.toMatchObject({ status: 403 });
    await AppDataSource.query(`DELETE FROM system_configs WHERE config_key = 'visitor.approver_mode'`);
    rig.app.get(VisitorConfigService).invalidate();
  });

  it('BR-V17: lượt thứ hai của cùng khách chồng khung hiệu lực không duyệt được', async () => {
    const phone = `0967${String(++phoneSeq).padStart(6, '0')}`;
    const a = await walkIn({ visitor: { ...base().visitor, phone } });
    expect(a.status).toBe('approved');
    await expect(walkIn({ visitor: { ...base().visitor, phone } })).rejects.toMatchObject({ response: { error: { code: 'VISIT_OVERLAP' } } });
    const b = await online({ visitor: { ...base().visitor, phone } });
    await expect(actions.approve(b.id, {}, asAdmin())).rejects.toMatchObject({ response: { error: { code: 'VISIT_OVERLAP' } } });
    const c = await online({ visitor: { ...base().visitor, phone }, scheduledFrom: new Date(Date.now() + 40 * HOUR).toISOString(), scheduledTo: new Date(Date.now() + 42 * HOUR).toISOString() });
    expect((await actions.approve(c.id, {}, asAdmin())).status).toBe('approved');
  });

  it('từ chối cần lý do; sau khi đóng không thao tác tiếp được', async () => {
    const v = await online();
    await expect(actions.reject(v.id, { reason: ' ' }, asAdmin())).rejects.toMatchObject({ response: { message: 'Vui lòng nhập lý do từ chối' } });
    const r = await actions.reject(v.id, { reason: 'Trùng lịch' }, asAdmin());
    expect(r).toMatchObject({ status: 'rejected', rejectReason: 'Trùng lịch' });
    await expect(actions.approve(v.id, {}, asAdmin())).rejects.toMatchObject({ status: 409 });
    expect(rig.notifications.emails.some((e) => String(e.subject).includes('không được duyệt'))).toBe(true);
  });

  it('hủy: pending và approved; không hủy được khi đã vào', async () => {
    expect((await actions.cancel((await online()).id, asHost())).status).toBe('cancelled');
    expect((await actions.cancel((await walkIn()).id, asAdmin())).status).toBe('cancelled');
    const inside = await checkedIn();
    await expect(actions.cancel(inside.id, asAdmin())).rejects.toMatchObject({ status: 409 });
  });

  it('thu hồi khi chưa đến → revoked', async () => {
    const v = await walkIn();
    await expect(actions.revoke(v.id, { reason: '' }, asAdmin())).rejects.toMatchObject({ response: { message: 'Vui lòng nhập lý do thu hồi' } });
    expect((await actions.revoke(v.id, { reason: 'Hủy lịch' }, asAdmin())).status).toBe('revoked');
  });

  it('thu hồi khi đang ở trong → must_leave, báo chủ nhà và bảo vệ, có cảnh báo an ninh', async () => {
    const v = await checkedIn();
    const r = await actions.revoke(v.id, { reason: 'Vi phạm nội quy' }, asAdmin());
    expect(r.status).toBe('must_leave');
    expect(r.revokedAt).toBeTruthy();
    expect(await events(v.id)).toEqual(expect.arrayContaining(['revoked', 'host_notified', 'security_notified']));
    expect(rig.alerts.some((a) => a.alertType === 'visitor_must_leave' && a.dedupeKey === v.id)).toBe(true);
    expect(rig.notifications.created.some((n) => n.notificationType === 'visitor_must_leave')).toBe(true);
    await expect(actions.revoke(v.id, { reason: 'lại' }, asAdmin())).rejects.toMatchObject({ status: 409 });
  });

  it('gia hạn: phải sau hiệu lực hiện tại; xóa cờ leo thang quá giờ', async () => {
    const v = await checkedIn();
    await expect(actions.extend(v.id, { validTo: v.access.validFrom }, asAdmin())).rejects.toMatchObject({ response: { message: 'Thời điểm gia hạn phải sau hiệu lực hiện tại' } });
    await AppDataSource.query(`UPDATE visitor_visits SET overstay_notified_at = now(), overstay_escalated_at = now() WHERE id = $1`, [v.id]);
    const later = new Date(new Date(v.access.validTo).getTime() + HOUR).toISOString();
    expect((await actions.extend(v.id, { validTo: later }, asAdmin())).access.validTo).toBe(later);
    const row = (await AppDataSource.query(`SELECT overstay_notified_at, overstay_escalated_at FROM visitor_visits WHERE id = $1`, [v.id]))[0];
    expect(row.overstay_notified_at).toBeNull();
    expect(row.overstay_escalated_at).toBeNull();
    const pending = await online();
    await expect(actions.extend(pending.id, { validTo: later }, asAdmin())).rejects.toMatchObject({ status: 409 });
  });

  it('bổ sung ảnh: khách được mời chưa có ảnh → có ảnh, sự kiện photo_added', async () => {
    const v = await visits.create('host_invite', base({ visitor: { ...base().visitor, photo: null }, consent: false }), asHost());
    expect(v.visitor.hasPhoto).toBe(false);
    await expect(actions.attachPhoto(v.id, { photo: 'khong-phai-anh' }, asAdmin())).rejects.toMatchObject({ response: { message: 'Ảnh không hợp lệ' } });
    const r = await actions.attachPhoto(v.id, { photo: PNG }, asAdmin());
    expect(r.visitor.hasPhoto).toBe(true);
    expect(await events(v.id)).toContain('photo_added');
  });

  it('check-in tay cần ghi chú; check-out ghi giờ ra và báo chủ nhà', async () => {
    const v = await walkIn();
    await expect(actions.checkInManual(v.id, { note: ' ' }, asAdmin())).rejects.toMatchObject({ response: { message: 'Vui lòng nhập ghi chú xác minh' } });
    const inn = await actions.checkInManual(v.id, { note: 'Đã đối chiếu CCCD' }, asAdmin());
    expect(inn.status).toBe('checked_in');
    expect(inn.checkInAt).toBeTruthy();
    const out = await actions.checkOut(v.id, {}, asAdmin());
    expect(out.status).toBe('checked_out');
    expect(out.checkOutAt).toBeTruthy();
    expect(rig.notifications.created.filter((n) => n.notificationType === 'visitor_left')).toHaveLength(1);
  });

  it('đóng thủ công: lỗi đúng thông điệp; "đã rời" → checked_out nhập tay; "không tìm thấy" → chưa ghi nhận giờ ra', async () => {
    const v = await checkedIn();
    const close = (b: Record<string, unknown>) => actions.closeManually(v.id, b as never, asAdmin());
    await expect(close({ reason: 'khac' })).rejects.toMatchObject({ response: { message: 'Vui lòng chọn lý do đóng lượt' } });
    await expect(close({ reason: 'left_unrecorded' })).rejects.toMatchObject({ response: { message: 'Vui lòng nhập giờ ra ước tính' } });
    await expect(close({ reason: 'left_unrecorded', exitAt: new Date(Date.now() - 5 * HOUR).toISOString() })).rejects.toMatchObject({ response: { message: 'Giờ ra phải sau giờ vào và không ở tương lai' } });
    await expect(close({ reason: 'left_unrecorded', exitAt: new Date(Date.now() + HOUR).toISOString() })).rejects.toMatchObject({ response: { message: 'Giờ ra phải sau giờ vào và không ở tương lai' } });
    await expect(close({ reason: 'not_found', note: ' ' })).rejects.toMatchObject({ response: { message: 'Vui lòng ghi chú đã tìm khách ở đâu' } });

    const lost = await close({ reason: 'not_found', note: 'Đã tìm ở Tòa B1' });
    expect(lost).toMatchObject({ status: 'exit_unrecorded', notFound: true });
    expect(await events(v.id)).toEqual(expect.arrayContaining(['security_notified', 'exit_unrecorded']));
    const closed = await close({ reason: 'left_unrecorded', exitAt: new Date().toISOString(), note: 'Bảo vệ xác nhận' });
    expect(closed).toMatchObject({ status: 'checked_out', manualExit: true });
    expect(await events(v.id)).toEqual(expect.arrayContaining(['manual_close']));
  });

  it('không đóng thủ công được lượt chưa vào', async () => {
    const v = await walkIn();
    await expect(actions.closeManually(v.id, { reason: 'left_unrecorded', exitAt: new Date().toISOString() }, asAdmin())).rejects.toMatchObject({ status: 409 });
  });

  it('thao tác hệ thống: check-in/out từ camera, conflict thì trả null; lastSeen chỉ tiến lên', async () => {
    const v = await walkIn();
    const t = new Date();
    const inn = await actions.systemCheckIn(v.id, { at: t, zoneId: null, score: 0.93, deviceEventId: null });
    expect(inn?.status).toBe('checked_in');
    expect(await actions.systemCheckIn(v.id, { at: t, zoneId: null, score: 0.93, deviceEventId: null })).toBeNull();
    await actions.touchLastSeen(v.id, new Date(t.getTime() + 60_000), null);
    await actions.touchLastSeen(v.id, new Date(t.getTime() - 60_000), null);
    const seen = (await visits.getView(v.id)).lastSeen;
    expect(new Date(seen!.at).getTime()).toBe(t.getTime() + 60_000);
    expect((await actions.systemCheckOut(v.id, { at: new Date(), zoneId: null, deviceEventId: null }))?.status).toBe('checked_out');
    expect(await actions.systemCheckOut(v.id, { at: new Date(), zoneId: null, deviceEventId: null })).toBeNull();
  });

  it('ghi nhật ký kiểm toán không chứa ảnh, số giấy tờ hay điện thoại', async () => {
    const v = await online();
    const spy = jest.spyOn(rig.app.get(AuditLogsService), 'logAction');
    await actions.approve(v.id, {}, asAdmin());
    const blob = JSON.stringify(spy.mock.calls);
    expect(blob).toContain('visitor_visit_approve');
    expect(blob).not.toMatch(/data:image|0966\d{6}|@example\.com/);
  });
});
