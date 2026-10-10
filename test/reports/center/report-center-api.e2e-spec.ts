// RPT-CENTER-BE-001 Task 4 — controller + dịch vụ điều phối thật, provider giả, auth giả (header x-test-user).
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../../src/database/data-source';
import { DashboardOverviewConfigService } from '../../../src/modules/analytics/services/dashboard-overview-config.service';
import { AuthzReadRepository } from '../../../src/modules/auth/repositories/authz-read.repository';
import { JwtAuthGuard } from '../../../src/modules/auth/guards/jwt-auth.guard';
import { ReportCenterController } from '../../../src/modules/reports/center/controllers/report-center.controller';
import { ReportCenterEnabledGuard } from '../../../src/modules/reports/center/report-center-enabled.guard';
import { ReportCenterExportService } from '../../../src/modules/reports/center/report-center-export.service';
import { ReportCenterService } from '../../../src/modules/reports/center/report-center.service';
import { REPORT_PROVIDERS, ReportProvider } from '../../../src/modules/reports/center/report-model';
import { ReportScopeService } from '../../../src/modules/reports/center/report-scope.service';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDb('RPT-CENTER API (preview, catalog)', () => {
  const perms = new Map<string, { roles: string[]; permissions: string[] }>();
  const built: Array<{ filters: unknown; scope: unknown; page: unknown }> = [];
  const provider: ReportProvider = {
    type: 'gate-access',
    build: async (filters, scope, page) => {
      built.push({ filters, scope, page });
      return { type: 'gate-access', title: 'x', period: { from: filters.from, to: filters.to }, filterLines: [], kpis: [{ key: 'entries', label: 'Lượt vào', value: 7, format: 'number' }], charts: [{ key: 'hourly', data: [] }], columns: [], rows: [{ a: 1 }], total: 1 };
    },
  };
  let app: import('@nestjs/common').INestApplication;
  let enabled = true;
  let visitorsOn = true;
  const call = (path: string, user?: string) => {
    const r = request(app.getHttpServer()).get(`/api/v1${path}`);
    return user ? r.set('x-test-user', user) : r;
  };

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    perms.set('admin', { roles: ['SYSTEM_ADMIN'], permissions: ['report.center.read', 'report.center.export'] });
    perms.set('employee', { roles: ['EMPLOYEE'], permissions: [] });
    perms.set('manager', { roles: ['MANAGER'], permissions: ['report.center.read'] });
    const moduleRef = await Test.createTestingModule({
      controllers: [ReportCenterController],
      providers: [
        ReportCenterService, ReportScopeService, ReportCenterEnabledGuard,
        { provide: ReportCenterExportService, useValue: { create: async () => ({}), recent: async () => [] } },
        { provide: REPORT_PROVIDERS, useValue: [provider, { ...provider, type: 'vehicle' }, { ...provider, type: 'visitor' }] },
        { provide: DataSource, useValue: AppDataSource },
        { provide: DashboardOverviewConfigService, useValue: { getMaxRangeDays: async () => 31 } },
        { provide: ConfigService, useValue: { get: (k: string, d?: unknown) => (k === 'REPORT_CENTER_ENABLED' ? enabled : k === 'VISITORS_ENABLED' ? visitorsOn : d) } },
        { provide: AuthzReadRepository, useValue: { getEffectiveRolesAndPermissions: async (id: string) => perms.get(id) ?? { roles: [], permissions: [] } } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => { headers: Record<string, string>; user?: unknown } } }) => {
          const req = ctx.switchToHttp().getRequest();
          if (!req.headers['x-test-user']) throw new UnauthorizedException();
          req.user = { userId: req.headers['x-test-user'] };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => { await app.close(); await AppDataSource.destroy(); });

  it('không token → 401; EMPLOYEE thiếu quyền → 403', async () => {
    expect((await call('/reports/catalog')).status).toBe(401);
    expect((await call('/reports/catalog', 'employee')).status).toBe(403);
  });

  it('danh mục trả đủ 7 loại theo thứ tự của FE, sinh viên chưa khả dụng có lý do', async () => {
    const res = await call('/reports/catalog', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { type: string }) => c.type)).toEqual(['staff-attendance', 'student-attendance', 'gate-access', 'room-utilization', 'vehicle', 'visitor', 'security-alert']);
    const student = res.body.data.find((c: { type: string }) => c.type === 'student-attendance');
    expect(student).toMatchObject({ available: false });
    expect(student.unavailableReason).toBeTruthy();
    expect(res.body.data[0]).toHaveProperty('activeSchedules');
  });

  it('lookups có đủ khóa FE cần (không có semesters/subjects/classSections)', async () => {
    const res = await call('/reports/lookups', 'admin');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['buildings', 'departments', 'gates', 'purposes', 'rooms', 'staff', 'zones']);
    expect(res.body.data.purposes.length).toBeGreaterThan(0);
  });

  it('xem trước hợp lệ → kpis/charts/rows/total/notes; limit=500 bị kẹp về 100; sortDir mặc định asc', async () => {
    built.length = 0;
    const res = await call('/reports/gate-access/preview?from=2026-10-01&to=2026-10-07&limit=500&sortKey=fullName', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ kpis: [{ key: 'entries', value: 7 }], charts: [{ key: 'hourly', data: [] }], rows: [{ a: 1 }], total: 1, notes: [] });
    expect(built[0].page).toMatchObject({ page: 1, limit: 100, sortKey: 'fullName', sortDir: 'asc' });
    expect(built[0].scope).toEqual({ unrestricted: true, departmentIds: null });
  });

  it.each([
    ['/reports/nope/preview?from=2026-10-01&to=2026-10-02', 404, 'REPORT_TYPE_NOT_FOUND'],
    ['/reports/constructor/preview?from=2026-10-01&to=2026-10-02', 404, 'REPORT_TYPE_NOT_FOUND'],
    ['/reports/student-attendance/preview?from=2026-10-01&to=2026-10-02', 409, 'REPORT_NOT_AVAILABLE'],
    ['/reports/gate-access/preview?to=2026-10-02', 400, 'VALIDATION_ERROR'],
    ['/reports/gate-access/preview?from=2026-10-05&to=2026-10-02', 400, 'VALIDATION_ERROR'],
    ['/reports/gate-access/preview?from=2026-01-01&to=2026-12-31', 400, 'DATE_RANGE_TOO_LARGE'],
    ['/reports/gate-access/preview?from=2026-10-01&to=2026-10-02&sortKey=password', 400, 'INVALID_SORT'],
    ['/reports/gate-access/preview?from=2026-10-01&to=2026-10-02&evil=1', 400, 'INVALID_FILTER'],
    ['/reports/gate-access/preview?from=2026-10-01&to=2026-10-02&subjectType=alien', 400, 'INVALID_FILTER'],
    ['/reports/gate-access/preview?from=2026-1-1&to=2026-10-02', 400, 'VALIDATION_ERROR'],
  ])('%s → %i %s', async (path, status, code) => {
    const res = await call(path, 'admin');
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
  });

  it('thông điệp lỗi đúng chữ FE đang so', async () => {
    expect((await call('/reports/gate-access/preview?to=2026-10-02', 'admin')).body.message).toBe('Vui lòng chọn kỳ báo cáo');
    expect((await call('/reports/gate-access/preview?from=2026-10-05&to=2026-10-02', 'admin')).body.message).toBe('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
  });

  it('MANAGER xin loại không có chiều đơn vị (vehicle) → 403 REPORT_OUT_OF_SCOPE', async () => {
    const res = await call('/reports/vehicle/preview?from=2026-10-01&to=2026-10-02', 'manager');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REPORT_OUT_OF_SCOPE');
  });

  it('VISITORS_ENABLED=false → báo cáo khách chưa khả dụng: danh mục báo lý do, xem trước 409', async () => {
    visitorsOn = false;
    try {
      const cat = await call('/reports/catalog', 'admin');
      expect(cat.body.data.find((c: { type: string }) => c.type === 'visitor')).toMatchObject({ available: false, unavailableReason: expect.stringContaining('Khách') });
      const res = await call('/reports/visitor/preview?from=2026-10-01&to=2026-10-02', 'admin');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REPORT_NOT_AVAILABLE');
    } finally { visitorsOn = true; }
    expect((await call('/reports/visitor/preview?from=2026-10-01&to=2026-10-02', 'admin')).status).toBe(200);
  });

  it('REPORT_CENTER_ENABLED=false → 404', async () => {
    enabled = false;
    try {
      expect((await call('/reports/catalog', 'admin')).status).toBe(404);
    } finally { enabled = true; }
  });
});
