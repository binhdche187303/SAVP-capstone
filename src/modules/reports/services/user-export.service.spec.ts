/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { UserExportService } from './user-export.service.js';
import {
  UserExportDataService,
  UserExportRow,
} from './user-export-data.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

describe('UserExportService (BE-04 — 2026-07-27, render đồng bộ)', () => {
  let service: UserExportService;
  let userExportDataService: jest.Mocked<UserExportDataService>;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const currentUser = { userId: 'admin-1', email: 'admin@test.com' };

  const makeRow = (overrides: Partial<UserExportRow> = {}): UserExportRow => ({
    id: 'user-1',
    employeeCode: 'NV001',
    fullName: 'Nguyễn Văn A',
    email: 'a@test.com',
    phoneNumber: '0900000000',
    departmentId: 'dept-1',
    departmentName: 'Engineering',
    accountStatus: 'active',
    roles: ['employee'],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    userExportDataService = {
      listUsersForExport: jest.fn().mockResolvedValue([makeRow()]),
    } as unknown as jest.Mocked<UserExportDataService>;

    auditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    service = new UserExportService(userExportDataService, auditLogsService);
  });

  // ─── T-5.1: rewritten from old job-based tests ────────────────────────────

  it('[T-5.1] gọi UserExportDataService.listUsersForExport đúng filter từ query', async () => {
    await service.exportUsersXlsx(currentUser, {
      search: 'nguyen',
      departmentId: 'dept-1',
      roleId: 'role-1',
      locked: true,
    });

    expect(userExportDataService.listUsersForExport).toHaveBeenCalledWith({
      search: 'nguyen',
      departmentId: 'dept-1',
      roleId: 'role-1',
      locked: true,
    });
  });

  it('[T-5.1] trả về buffer khác rỗng', async () => {
    const result = await service.exportUsersXlsx(currentUser, {});
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('[T-5.1] fileName đúng định dạng danh-sach-nguoi-dung-YYYYMMDD-HHmmss.xlsx', async () => {
    const result = await service.exportUsersXlsx(currentUser, {});
    expect(result.fileName).toMatch(/^danh-sach-nguoi-dung-\d{8}-\d{6}\.xlsx$/);
  });

  it('[T-5.1] ghi audit log entityType=users kèm filter + rowCount', async () => {
    await service.exportUsersXlsx(currentUser, { search: 'a' });
    expect(auditLogsService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        actionType: 'export_users',
        entityType: 'users',
        metadataJson: expect.objectContaining({
          filter: expect.objectContaining({ search: 'a' }),
          rowCount: 1,
        }),
      }),
    );
  });

  it('[T-5.1] audit log lỗi KHÔNG chặn việc trả file (fail-soft)', async () => {
    auditLogsService.logAction.mockRejectedValue(new Error('audit down'));
    const result = await service.exportUsersXlsx(currentUser, {});
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.fileName).toMatch(/\.xlsx$/);
  });

  // ─── T-5.2: bù cho 5 test đã xóa cùng user-export-worker.processor.spec.ts ─

  it('[T-5.2] filter rỗng {} vẫn render ra file hợp lệ, không throw', async () => {
    await expect(service.exportUsersXlsx(currentUser, {})).resolves.toEqual(
      expect.objectContaining({ buffer: expect.any(Buffer) }),
    );
  });

  it('[T-5.2] 0 user (data service trả mảng rỗng) vẫn ra file hợp lệ, không throw', async () => {
    userExportDataService.listUsersForExport.mockResolvedValue([]);
    const result = await service.exportUsersXlsx(currentUser, {});
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('[T-5.2] rowCount trong metadata audit khớp đúng số dòng data service trả về', async () => {
    userExportDataService.listUsersForExport.mockResolvedValue([
      makeRow({ id: 'u1' }),
      makeRow({ id: 'u2' }),
      makeRow({ id: 'u3' }),
    ]);
    await service.exportUsersXlsx(currentUser, {});
    expect(auditLogsService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: expect.objectContaining({ rowCount: 3 }),
      }),
    );
  });

  it('[T-5.2] buffer là file XLSX thật (magic bytes ZIP "PK" ở đầu buffer)', async () => {
    const result = await service.exportUsersXlsx(currentUser, {});
    expect(result.buffer[0]).toBe(0x50); // 'P'
    expect(result.buffer[1]).toBe(0x4b); // 'K'
  });

  it('[T-5.2] lỗi từ UserExportDataService bị ném lên, không bị nuốt', async () => {
    userExportDataService.listUsersForExport.mockRejectedValue(
      new Error('db down'),
    );
    await expect(service.exportUsersXlsx(currentUser, {})).rejects.toThrow(
      'db down',
    );
  });
});
