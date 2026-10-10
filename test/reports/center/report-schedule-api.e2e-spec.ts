// RPT-CENTER-BE-001 Task 13 — CRUD lịch gửi qua HTTP (controller + service thật, auth giả).
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../../src/database/data-source';
import { AuditLogsService } from '../../../src/modules/administration/services/audit-logs.service';
import { AuthzReadRepository } from '../../../src/modules/auth/repositories/authz-read.repository';
import { JwtAuthGuard } from '../../../src/modules/auth/guards/jwt-auth.guard';
import { ReportCenterEnabledGuard } from '../../../src/modules/reports/center/report-center-enabled.guard';
import { ReportScheduleController } from '../../../src/modules/reports/schedules/controllers/report-schedule.controller';
import { ReportScheduleRunService } from '../../../src/modules/reports/schedules/report-schedule-run.service';
import { ReportScheduleService } from '../../../src/modules/reports/schedules/report-schedule.service';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const TAG = 'fa11ed04';

describeDb('RPT-CENTER schedule CRUD', () => {
  let app: import('@nestjs/common').INestApplication;
  let adminId: string;
  const audits: any[] = [];
  const valid = (extra: Record<string, unknown> = {}) => ({
    name: `${TAG} lịch`, reportType: 'gate-access', filters: { subjectType: 'staff' }, period: 'yesterday', frequency: 'daily', time: '08:00',
    formats: ['pdf', 'xlsx'], recipients: [{ type: 'email', value: 'a@b.vn', label: 'A' }], subject: 'Báo cáo ngày', message: 'Gửi anh/chị', ...extra,
  });
  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: unknown, user: string | null = adminId) => {
    let r = request(app.getHttpServer())[method](`/api/v1${path}`);
    if (user) r = r.set('x-test-user', user);
    return body === undefined ? r : r.send(body as object);
  };

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    adminId = (await AppDataSource.query(`INSERT INTO users (employee_code, username, email, password_hash, full_name) VALUES ('${TAG}-A','${TAG}a','${TAG}a@t.invalid','x','${TAG} admin') RETURNING id`))[0].id;
    const perms = new Map<string, string[]>([[adminId, ['report.schedule.manage']]]);
    const moduleRef = await Test.createTestingModule({
      controllers: [ReportScheduleController],
      providers: [
        ReportScheduleService, ReportCenterEnabledGuard,
        { provide: ReportScheduleRunService, useValue: { runNow: async () => ({}) } },
        { provide: DataSource, useValue: AppDataSource },
        { provide: AuditLogsService, useValue: { logAction: async (a: unknown) => { audits.push(a); } } },
        { provide: ConfigService, useValue: { get: (k: string, d?: unknown) => (k === 'REPORT_CENTER_ENABLED' ? true : d) } },
        { provide: AuthzReadRepository, useValue: { getEffectiveRolesAndPermissions: async (id: string) => ({ roles: [], permissions: perms.get(id) ?? [] }) } },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (ctx: any) => { const req = ctx.switchToHttp().getRequest(); if (!req.headers['x-test-user']) throw new UnauthorizedException(); req.user = { userId: req.headers['x-test-user'], email: 'a@t.invalid' }; return true; },
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM report_schedule_runs WHERE schedule_name LIKE '${TAG}%'`);
    await AppDataSource.query(`DELETE FROM report_schedules WHERE name LIKE '${TAG}%'`);
    await AppDataSource.query(`DELETE FROM users WHERE id = $1`, [adminId]);
    await app.close();
    await AppDataSource.destroy();
  });
  beforeEach(() => { audits.length = 0; });

  it('không token → 401; thiếu quyền → 403', async () => {
    expect((await call('get', '/report-schedules', undefined, null)).status).toBe(401);
    const other = (await AppDataSource.query(`INSERT INTO users (employee_code, username, email, password_hash, full_name) VALUES ('${TAG}-M','${TAG}m','${TAG}m@t.invalid','x','m') RETURNING id`))[0].id;
    try { expect((await call('get', '/report-schedules', undefined, other)).status).toBe(403); }
    finally { await AppDataSource.query(`DELETE FROM users WHERE id = $1`, [other]); }
  });

  it.each([
    [{ name: ' ' }, 'Vui lòng nhập tên lịch gửi'],
    [{ reportType: 'nope' }, 'Loại báo cáo không tồn tại'],
    [{ period: 'today' }, 'Kỳ dữ liệu không hợp lệ'],
    [{ frequency: 'yearly' }, 'Tần suất không hợp lệ'],
    [{ time: '25:00' }, 'Giờ gửi không hợp lệ'],
    [{ frequency: 'weekly', dayOfWeek: 9 }, 'Vui lòng chọn thứ trong tuần'],
    [{ frequency: 'monthly', dayOfMonth: 30 }, 'Ngày trong tháng phải từ 1 đến 28 hoặc ngày cuối tháng'],
    [{ formats: [] }, 'Vui lòng chọn ít nhất một định dạng'],
    [{ recipients: [] }, 'Cần ít nhất 1 người nhận'],
    [{ recipients: Array.from({ length: 21 }, (_, i) => ({ type: 'email', value: `u${i}@b.vn` })) }, 'Tối đa 20 người nhận'],
    [{ recipients: [{ type: 'email', value: 'khong-hop-le' }] }, 'Email không hợp lệ: khong-hop-le'],
  ])('kiểm đầu vào %j → 400 "%s"', async (patch, message) => {
    const res = await call('post', '/report-schedules', valid(patch));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
  });

  it('loại sinh viên chưa khả dụng → 409; bộ lọc lạ → 400', async () => {
    expect((await call('post', '/report-schedules', valid({ reportType: 'student-attendance', filters: {} }))).status).toBe(409);
    const res = await call('post', '/report-schedules', valid({ filters: { hack: '1' } }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILTER');
  });

  it('tạo → next_run_at tính đúng, hiển thị đúng dạng FE, ghi audit kèm người nhận', async () => {
    const res = await call('post', '/report-schedules', valid({ time: '08:00' }));
    expect(res.status).toBe(201);
    const s = res.body.data;
    expect(s).toMatchObject({ reportTitle: 'Ra vào khuôn viên', frequency: 'daily', time: '08:00', enabled: true, dayOfWeek: null, dayOfMonth: null, lastRunAt: null, subject: 'Báo cáo ngày' });
    const next = new Date(s.nextRunAt);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(new Date(next.getTime() + 7 * 3_600_000).getUTCHours()).toBe(8); // 08:00 giờ VN
    expect(audits[0]).toMatchObject({ actionType: 'report_schedule_create', metadataJson: { recipients: ['email:a@b.vn'] } });
  });

  it('tháng ngày cuối được lưu và trả về là "last"', async () => {
    const s = (await call('post', '/report-schedules', valid({ frequency: 'monthly', dayOfMonth: 'last' }))).body.data;
    expect(s.dayOfMonth).toBe('last');
    const row = (await AppDataSource.query(`SELECT day_of_month, last_day_of_month FROM report_schedules WHERE id = $1`, [s.id]))[0];
    expect(row).toEqual({ day_of_month: null, last_day_of_month: true });
  });

  it('tắt → next_run_at null; bật lại → có giá trị; sửa tần suất → tính lại', async () => {
    const id = (await call('post', '/report-schedules', valid())).body.data.id;
    expect((await call('patch', `/report-schedules/${id}`, { enabled: false })).body.data).toMatchObject({ enabled: false, nextRunAt: null });
    expect((await call('patch', `/report-schedules/${id}`, { enabled: true })).body.data.nextRunAt).toBeTruthy();
    const updated = (await call('patch', `/report-schedules/${id}`, valid({ frequency: 'weekly', dayOfWeek: 1, name: `${TAG} đổi` }))).body.data;
    expect(updated).toMatchObject({ frequency: 'weekly', dayOfWeek: 1, name: `${TAG} đổi` });
    expect(new Date(new Date(updated.nextRunAt).getTime() + 7 * 3_600_000).getUTCDay()).toBe(1);
  });

  it('nhân bản: tên có " (bản sao)", tắt, không có lần chạy cuối', async () => {
    const id = (await call('post', '/report-schedules', valid())).body.data.id;
    const copy = (await call('post', `/report-schedules/${id}/duplicate`)).body.data;
    expect(copy).toMatchObject({ name: `${TAG} lịch (bản sao)`, enabled: false, nextRunAt: null, lastRunAt: null });
    expect(copy.id).not.toBe(id);
  });

  it('xóa mềm: biến mất khỏi danh sách, lịch sử lần chạy còn', async () => {
    const id = (await call('post', '/report-schedules', valid())).body.data.id;
    await AppDataSource.query(
      `INSERT INTO report_schedule_runs (schedule_id, schedule_name, report_type, trigger, status, period_from, period_to, formats) VALUES ($1,'${TAG} lịch','gate-access','manual','success','2026-10-01','2026-10-01','{pdf}')`, [id]);
    expect((await call('delete', `/report-schedules/${id}`)).status).toBe(200);
    expect((await call('get', '/report-schedules')).body.data.some((s: { id: string }) => s.id === id)).toBe(false);
    expect((await AppDataSource.query(`SELECT deleted_at FROM report_schedules WHERE id = $1`, [id]))[0].deleted_at).not.toBeNull();
    expect(Number((await AppDataSource.query(`SELECT count(*) c FROM report_schedule_runs WHERE schedule_id = $1`, [id]))[0].c)).toBe(1);
    expect((await call('patch', `/report-schedules/${id}`, { enabled: true })).status).toBe(404);
    expect((await call('delete', '/report-schedules/khong-phai-uuid')).status).toBe(404);
  });
});
