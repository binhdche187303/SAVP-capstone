// VIS-BE-001 Task 5 — đăng ký công khai, tra cứu, tìm người gặp, giới hạn tần suất.
// Chạy: RUN_DB_TESTS=1 npx jest --config test/jest-e2e.json test/visitors/public-visitor --runInBand
import request from 'supertest';
import { AppDataSource } from '../../src/database/data-source';
import { buildVisitorTestApp, TestRig } from './support/visitor-test-app';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const TAG = 'fa11ed05';
const HOUR = 3_600_000;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describeDb('VIS-BE-001 public visitor API', () => {
  let rig: TestRig;
  let hostId: string;
  let partnerId: string;

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    await cleanup();
    await AppDataSource.query(
      `INSERT INTO departments (department_code, department_name, is_active) SELECT 'T05D', 'Khoa Thử Nghiệm', true
        WHERE NOT EXISTS (SELECT 1 FROM departments WHERE department_code = 'T05D')`,
    );
    const dept = (await AppDataSource.query(`SELECT id FROM departments WHERE department_code = 'T05D'`))[0].id;
    hostId = (await AppDataSource.query(
      `INSERT INTO users (employee_code, username, email, password_hash, full_name, department_id)
       VALUES ('${TAG}-H', '${TAG}host', '${TAG}host@t.invalid', 'x', '${TAG} Nguyễn Văn Chủ', $1) RETURNING id`, [dept])
    )[0].id;
    const partnerDept = (await AppDataSource.query(`SELECT id FROM departments WHERE department_code = 'PARTNER'`))[0]?.id
      ?? (await AppDataSource.query(`INSERT INTO departments (department_code, department_name, is_active) VALUES ('PARTNER','Đối tác',true) RETURNING id`))[0].id;
    partnerId = (await AppDataSource.query(
      `INSERT INTO users (employee_code, username, email, password_hash, full_name, department_id)
       VALUES ('${TAG}-P', '${TAG}partner', '${TAG}partner@t.invalid', 'x', '${TAG} Đối Tác', $1) RETURNING id`, [partnerDept])
    )[0].id;
    await AppDataSource.query(
      `INSERT INTO zones (zone_code, zone_name, zone_type, status) VALUES ('${TAG}-GATE', 'Cổng thử ${TAG}', 'gate', 'active') ON CONFLICT DO NOTHING`);
  });
  beforeEach(async () => { rig = await buildVisitorTestApp(); });
  afterEach(async () => rig.close());
  afterAll(async () => { await cleanup(); await AppDataSource.destroy(); });

  async function cleanup() {
    await AppDataSource.query(`DELETE FROM visitor_visits WHERE visit_code LIKE 'VS-%' AND purpose LIKE '${TAG}%'`);
    await AppDataSource.query(`DELETE FROM visitors WHERE full_name LIKE '${TAG}%'`);
    await AppDataSource.query(`DELETE FROM users WHERE employee_code LIKE '${TAG}-%' OR (email LIKE '%@visitor.invalid' AND full_name LIKE '${TAG}%')`);
  }

  const payload = (over: Record<string, unknown> = {}) => ({
    visitor: { fullName: `${TAG} Trần Thị Demo`, idNumber: '', phone: '0955000001', email: 'demo@example.com', organization: 'Công ty CP MISA', plateNumber: '', photo: PNG },
    hostId, purpose: `${TAG} Làm việc với đơn vị`, companions: 0,
    scheduledFrom: new Date(Date.now() + HOUR).toISOString(), scheduledTo: new Date(Date.now() + 3 * HOUR).toISOString(), consent: true, ...over,
  });
  const post = (body: unknown) => request(rig.app.getHttpServer()).post('/api/v1/public/visitor-registrations').send(body as object);

  it('đăng ký hợp lệ → 201 chờ duyệt, có sự kiện, thông báo người được gặp và email cho khách', async () => {
    const res = await post(payload());
    expect(res.status).toBe(201);
    const v = res.body.data;
    expect(v.status).toBe('pending_approval');
    expect(v.code).toMatch(/^VS-\d{6}-\d{4}$/);
    expect(v.visitor.hasPhoto).toBe(true);
    expect(v.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['registered', 'email_sent']));
    expect(rig.notifications.created.some((n) => n.notificationType === 'visitor_pending_approval' && (n.recipientUserIds as string[])[0] === hostId)).toBe(true);
    expect(rig.notifications.emails.some((n) => (n.toEmails as string[]).includes('demo@example.com'))).toBe(true);
  });

  it.each([
    [{ visitor: { fullName: '', phone: '0955000001', email: 'a@b.co', photo: PNG } }, 'Vui lòng nhập họ tên khách'],
    [{ visitor: { fullName: 'A', phone: '12345', email: 'a@b.co', photo: PNG } }, 'Số điện thoại không hợp lệ'],
    [{ consent: false }, 'Cần đồng ý xử lý dữ liệu sinh trắc để tiếp tục'],
    [{ hostId: '00000000-0000-0000-0000-000000000000' }, 'Vui lòng chọn người cần gặp'],
  ])('sai dữ liệu %#', async (over, message) => {
    const res = await post(payload(over));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('người gặp thuộc đơn vị đối tác bị từ chối', async () => {
    const res = await post(payload({ hostId: partnerId }));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Vui lòng chọn người cần gặp');
  });

  it('ảnh quá 2 MB → 413; ảnh không phải JPEG/PNG → 400', async () => {
    const big = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 10).toString('base64')}`;
    expect((await post(payload({ visitor: { ...payload().visitor, photo: big } }))).status).toBe(413);
    const gif = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const res = await post(payload({ visitor: { ...payload().visitor, photo: gif } }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PHOTO');
  });

  it('tra cứu: không lộ dữ liệu cá nhân; mã viết thường vẫn tìm được; mã sai → 404', async () => {
    const created = (await post(payload({ visitor: { ...payload().visitor, idNumber: '955000000001' } }))).body.data;
    const res = await request(rig.app.getHttpServer()).get(`/api/v1/public/visitor-registrations/${created.code.toLowerCase()}`);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    ['955000000001', '0955000001', 'demo@example.com'].forEach((s) => expect(text).not.toContain(s));
    expect(res.body.data.visitor.fullName).toContain('Trần Thị Demo');
    const missing = await request(rig.app.getHttpServer()).get('/api/v1/public/visitor-registrations/VS-000000-0000');
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Không tìm thấy lượt đăng ký với mã này');
  });

  it('tìm người gặp: 1 ký tự → rỗng; tìm không dấu; không trả đối tác; chỉ 4 trường', async () => {
    const get = (q: string) => request(rig.app.getHttpServer()).get(`/api/v1/public/visitor-hosts?q=${encodeURIComponent(q)}`);
    expect((await get('a')).body.data).toEqual([]);
    const found = (await get(`${TAG} nguyen van chu`)).body.data;
    expect(found).toHaveLength(1);
    expect(Object.keys(found[0]).sort()).toEqual(['departmentId', 'departmentName', 'fullName', 'id']);
    expect((await get(`${TAG} Đối Tác`)).body.data).toEqual([]);
    const one = await request(rig.app.getHttpServer()).get(`/api/v1/public/visitor-hosts/${hostId}`);
    expect(one.body.data.fullName).toContain('Nguyễn Văn Chủ');
    expect((await request(rig.app.getHttpServer()).get(`/api/v1/public/visitor-hosts/${partnerId}`)).status).toBe(404);
  });

  it('giới hạn tần suất: lần thứ 6 đăng ký → 429', async () => {
    for (let i = 0; i < 5; i += 1) await post(payload({ visitor: { ...payload().visitor, fullName: '', phone: '1' } }));
    const res = await post(payload());
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('VISITORS_ENABLED=false → 404', async () => {
    await rig.close();
    rig = await buildVisitorTestApp({ enabled: false });
    expect((await post(payload())).status).toBe(404);
  });

  it('GET /public/visitor-purposes: không cần đăng nhập, trả danh sách mục đích', async () => {
    const res = await request(rig.app.getHttpServer()).get('/api/v1/public/visitor-purposes');
    expect(res.status).toBe(200);
    expect(res.body.data.purposes).toEqual(expect.arrayContaining(['Làm việc với đơn vị']));
  });
});
