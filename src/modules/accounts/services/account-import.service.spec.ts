import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { BadRequestException, ConflictException } from '@nestjs/common';

import { AccountImportService } from './account-import.service.js';
import { UserEntity } from '../entities/user.entity.js';
import { DepartmentEntity } from '../entities/department.entity.js';
import { RoleEntity } from '../entities/role.entity.js';
import {
  IMPORT_ACCOUNTS_HEADERS,
  XLSX_MIME,
  ImportAccountRowStatus,
  ImportAccountRowReason,
} from '../constants/import-accounts.constants.js';

type AnyRow = Record<string, string>;

async function buildXlsx(
  rows: AnyRow[],
  headers: readonly string[] = IMPORT_ACCOUNTS_HEADERS,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Accounts');
  sheet.columns = headers.map((h) => ({ header: h, key: h, width: 20 }));
  rows.forEach((r) => sheet.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function fileOf(buffer: Buffer) {
  return {
    buffer,
    mimetype: XLSX_MIME,
    size: buffer.length,
    originalname: 'accounts.xlsx',
  };
}

describe('AccountImportService', () => {
  let service: AccountImportService;
  let usersService: { persistAccount: jest.Mock };
  let notificationsService: { enqueueEmailNotification: jest.Mock };
  let cloudinaryService: {
    uploadImage: jest.Mock;
    deleteImage: jest.Mock;
    resolveMediaStorageProvider: jest.Mock;
  };
  let vehicleRegistrationService: { register: jest.Mock };
  let dataSource: any;

  // Mutable DB fixtures
  let dbDepartments: Array<Partial<DepartmentEntity>>;
  let dbRoles: Array<Partial<RoleEntity>>;
  let dbUsers: Array<Partial<UserEntity>>;

  beforeEach(() => {
    dbDepartments = [{ id: 'dept-eng', departmentCode: 'ENG', isActive: true }];
    dbRoles = [{ id: 'role-emp', roleCode: 'EMPLOYEE', isActive: true }];
    dbUsers = [];

    usersService = {
      persistAccount: jest.fn().mockImplementation((_em, data) =>
        Promise.resolve({
          user: { id: `new-${data.email}` },
          tempPassword: 'Temp123!@#',
        }),
      ),
    };
    notificationsService = {
      enqueueEmailNotification: jest.fn().mockResolvedValue({}),
    };
    cloudinaryService = {
      uploadImage: jest
        .fn()
        .mockResolvedValue({ publicId: 'p1', secureUrl: 'https://x/p1.jpg' }),
      deleteImage: jest.fn().mockResolvedValue(undefined),
      resolveMediaStorageProvider: jest.fn().mockReturnValue('cloud_provider'),
    };
    vehicleRegistrationService = {
      register: jest.fn().mockResolvedValue({ id: 'vr-1' }),
    };

    const deptRepo = {
      find: jest.fn((opts: any) => {
        const codes: string[] = opts.where.departmentCode.value;
        return Promise.resolve(
          dbDepartments.filter(
            (d) => d.isActive && codes.includes(d.departmentCode as string),
          ),
        );
      }),
    };
    const roleRepo = {
      find: jest.fn((opts: any) => {
        const codes: string[] = opts.where.roleCode.value;
        return Promise.resolve(
          dbRoles.filter(
            (r) => r.isActive && codes.includes(r.roleCode as string),
          ),
        );
      }),
    };
    const userRepo = {
      find: jest.fn((opts: any) => {
        const where = opts.where;
        if (where.employeeCode) {
          const codes: string[] = where.employeeCode.value;
          return Promise.resolve(
            dbUsers.filter(
              (u) => u.employeeCode && codes.includes(u.employeeCode),
            ),
          );
        }
        const emails: string[] = where.email.value;
        return Promise.resolve(
          dbUsers.filter(
            (u) => u.email && emails.includes(u.email.toLowerCase()),
          ),
        );
      }),
    };

    dataSource = {
      getRepository: jest.fn((entity: any) => {
        if (entity === DepartmentEntity) return deptRepo;
        if (entity === RoleEntity) return roleRepo;
        if (entity === UserEntity) return userRepo;
        return { find: jest.fn().mockResolvedValue([]) };
      }),
      transaction: jest.fn((cb: any) =>
        cb({
          getRepository: jest.fn(() => ({
            insert: jest.fn().mockResolvedValue({}),
          })),
        }),
      ),
      manager: { save: jest.fn().mockResolvedValue({}) },
      // assertNoAdminRoleGrant: actor mặc định là SYSTEM_ADMIN.
      query: jest.fn().mockResolvedValue([{ ok: 1 }]),
    };

    service = new AccountImportService(
      dataSource,
      usersService as any,
      notificationsService as any,
      cloudinaryService as any,
      vehicleRegistrationService as any,
    );
  });

  const actor = { userId: 'admin-1' };
  const ctx = {};

  it('rejects non-xlsx file', async () => {
    await expect(
      service.importAccounts(
        {
          buffer: Buffer.from('x'),
          mimetype: 'text/plain',
          originalname: 'a.txt',
        },
        {},
        actor,
        ctx,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects file with wrong header', async () => {
    const buf = await buildXlsx([{ wrong: 'x' }], ['wrong']);
    await expect(
      service.importAccounts(fileOf(buf), {}, actor, ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preview: does not write DB and classifies rows', async () => {
    dbUsers = [
      { id: 'u-existing', email: 'existing@company.com', employeeCode: null },
    ];
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
      },
      {
        full_name: '',
        email: 'b@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
      }, // missing name
      {
        full_name: 'C',
        email: 'bad-email',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
      }, // invalid email
      {
        full_name: 'D',
        email: 'existing@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
      }, // exists
      {
        full_name: 'E',
        email: 'e@company.com',
        department_code: 'NOPE',
        role_codes: 'EMPLOYEE',
      }, // dept not found
      {
        full_name: 'F',
        email: 'f@company.com',
        department_code: 'ENG',
        role_codes: 'GHOST',
      }, // role not found
    ]);

    const report = await service.importAccounts(
      fileOf(buf),
      { commit: false },
      actor,
      ctx,
    );

    expect(report.mode).toBe('preview');
    expect(report.totalRows).toBe(6);
    expect(report.validCount).toBe(1);
    expect(report.invalidCount).toBe(5);
    expect(usersService.persistAccount).not.toHaveBeenCalled();

    const reasons = report.results.map((r) => r.reason);
    expect(reasons).toContain(ImportAccountRowReason.MISSING_REQUIRED_FIELD);
    expect(reasons).toContain(ImportAccountRowReason.INVALID_EMAIL);
    expect(reasons).toContain(ImportAccountRowReason.EMAIL_ALREADY_EXISTS);
    expect(reasons).toContain(ImportAccountRowReason.DEPARTMENT_NOT_FOUND);
    expect(reasons).toContain(ImportAccountRowReason.ROLE_NOT_FOUND);
  });

  it('detects duplicate email within the file', async () => {
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'dup@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
      },
      {
        full_name: 'B',
        email: 'dup@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
      },
    ]);
    const report = await service.importAccounts(
      fileOf(buf),
      { commit: false },
      actor,
      ctx,
    );
    const second = report.results.find((r) => r.row === 3);
    expect(second?.reason).toBe(ImportAccountRowReason.DUPLICATE_IN_FILE);
  });

  it('commit: creates valid rows, skips invalid, sends one email per created account', async () => {
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
      },
      {
        full_name: '',
        email: 'b@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
      }, // invalid
    ]);

    const report = await service.importAccounts(
      fileOf(buf),
      { commit: true },
      actor,
      ctx,
    );

    expect(report.mode).toBe('commit');
    expect(report.successCount).toBe(1);
    expect(report.failedCount).toBe(1);
    expect(usersService.persistAccount).toHaveBeenCalledTimes(1);
    expect(notificationsService.enqueueEmailNotification).toHaveBeenCalledTimes(
      1,
    );

    const success = report.results.find(
      (r) => r.status === ImportAccountRowStatus.SUCCESS,
    );
    expect(success?.userId).toBeDefined();
    // NFR-004: no password field in results
    expect(JSON.stringify(report.results)).not.toContain('Temp123');
  });

  it('resolves multiple role codes separated by ";"', async () => {
    dbRoles.push({ id: 'role-mgr', roleCode: 'MANAGER', isActive: true });
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE;MANAGER',
      },
    ]);
    await service.importAccounts(fileOf(buf), { commit: true }, actor, ctx);
    const data = usersService.persistAccount.mock.calls[0][1];
    expect(data.roleIds.sort()).toEqual(['role-emp', 'role-mgr'].sort());
  });

  it('generates a template with the correct headers', async () => {
    const buffer = await service.generateTemplate();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0];
    const headers = IMPORT_ACCOUNTS_HEADERS.map((_, i) =>
      String(sheet.getRow(1).getCell(i + 1).value ?? '').toLowerCase(),
    );
    expect(headers).toEqual([...IMPORT_ACCOUNTS_HEADERS]);
  });

  // ── Sinh trắc học kèm import (tùy chọn) ────────────────────────────────

  const jpegPhoto = (originalname: string) => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]);
    return {
      buffer,
      originalname,
      mimetype: 'image/jpeg',
      size: buffer.length,
    };
  };

  it('commit + gửi kèm ảnh nhưng chưa xác nhận consent → BadRequestException', async () => {
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
        employee_code: 'EMP001',
      },
    ]);
    await expect(
      service.importAccounts(fileOf(buf), { commit: true }, actor, ctx, [
        jpegPhoto('EMP001.jpg'),
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(usersService.persistAccount).not.toHaveBeenCalled();
  });

  it('preview: báo trước ảnh khớp (pending_commit) và không khớp (not_provided), không upload gì', async () => {
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
        employee_code: 'EMP001',
      },
      {
        full_name: 'B',
        email: 'b@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
        employee_code: 'EMP002',
      },
    ]);
    const report = await service.importAccounts(
      fileOf(buf),
      { commit: false },
      actor,
      ctx,
      [jpegPhoto('EMP001.jpg')],
    );
    const rowA = report.results.find((r) => r.email === 'a@company.com');
    const rowB = report.results.find((r) => r.email === 'b@company.com');
    expect(rowA?.biometricStatus).toBe('pending_commit');
    expect(rowB?.biometricStatus).toBe('not_provided');
    expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
  });

  it('commit: ảnh khớp employee_code (không phân biệt hoa/thường/đuôi file) → upload + biometricStatus=attached', async () => {
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
        employee_code: 'EMP001',
      },
    ]);
    const report = await service.importAccounts(
      fileOf(buf),
      { commit: true, biometricConsentConfirmed: true },
      actor,
      ctx,
      [jpegPhoto('emp001.JPG')],
    );
    const row = report.results.find((r) => r.email === 'a@company.com');
    expect(row?.status).toBe(ImportAccountRowStatus.SUCCESS);
    expect(row?.biometricStatus).toBe('attached');
    expect(cloudinaryService.uploadImage).toHaveBeenCalledTimes(1);
  });

  it('commit: role BUSINESS_ADMIN không cần sinh trắc học → role_exempt, không upload', async () => {
    dbRoles.push({
      id: 'role-badmin',
      roleCode: 'BUSINESS_ADMIN',
      isActive: true,
    });
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'BUSINESS_ADMIN',
        employee_code: 'EMP001',
      },
    ]);
    const report = await service.importAccounts(
      fileOf(buf),
      { commit: true, biometricConsentConfirmed: true },
      actor,
      ctx,
      [jpegPhoto('EMP001.jpg')],
    );
    const row = report.results.find((r) => r.email === 'a@company.com');
    expect(row?.biometricStatus).toBe('role_exempt');
    expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
  });

  it('phân quyền 2 tầng: actor không phải SYSTEM_ADMIN import role quản trị → 403', async () => {
    dataSource.query.mockResolvedValue([]);
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE;SYSTEM_ADMIN',
        employee_code: 'EMP001',
      },
    ]);
    await expect(
      service.importAccounts(fileOf(buf), { commit: false }, actor, ctx),
    ).rejects.toMatchObject({
      response: { error: { code: 'ADMIN_ROLE_GRANT_FORBIDDEN' } },
    });
  });

  it('commit: file khớp tên nhưng không phải ảnh hợp lệ (magic bytes) → invalid_image', async () => {
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
        employee_code: 'EMP001',
      },
    ]);
    const badFile = {
      buffer: Buffer.from('not an image'),
      originalname: 'EMP001.jpg',
      mimetype: 'image/jpeg',
      size: 12,
    };
    const report = await service.importAccounts(
      fileOf(buf),
      { commit: true, biometricConsentConfirmed: true },
      actor,
      ctx,
      [badFile],
    );
    const row = report.results.find((r) => r.email === 'a@company.com');
    expect(row?.status).toBe(ImportAccountRowStatus.SUCCESS);
    expect(row?.biometricStatus).toBe('invalid_image');
    expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
  });

  it('commit: không có employee_code trong file ảnh → not_provided, tài khoản vẫn tạo thành công', async () => {
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
        employee_code: 'EMP999',
      },
    ]);
    const report = await service.importAccounts(
      fileOf(buf),
      { commit: true, biometricConsentConfirmed: true },
      actor,
      ctx,
      [jpegPhoto('EMP001.jpg')],
    );
    const row = report.results.find((r) => r.email === 'a@company.com');
    expect(row?.status).toBe(ImportAccountRowStatus.SUCCESS);
    expect(row?.biometricStatus).toBe('not_provided');
  });

  // ── Biển số xe kèm import (tùy chọn, cột license_plate) ────────────────

  it('preview: license_plate sai định dạng → invalid_plate, KHÔNG gọi DB', async () => {
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
        license_plate: '123',
      },
    ]);
    const report = await service.importAccounts(
      fileOf(buf),
      { commit: false },
      actor,
      ctx,
    );
    const row = report.results.find((r) => r.email === 'a@company.com');
    expect(row?.vehiclePlateStatus).toBe('invalid_plate');
    expect(vehicleRegistrationService.register).not.toHaveBeenCalled();
  });

  it('preview: license_plate đúng định dạng → pending_commit, KHÔNG gọi DB', async () => {
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
        license_plate: '30A-123.45',
      },
    ]);
    const report = await service.importAccounts(
      fileOf(buf),
      { commit: false },
      actor,
      ctx,
    );
    const row = report.results.find((r) => r.email === 'a@company.com');
    expect(row?.vehiclePlateStatus).toBe('pending_commit');
    expect(vehicleRegistrationService.register).not.toHaveBeenCalled();
  });

  it('commit: license_plate hợp lệ → đăng ký hộ qua VehicleRegistrationService, vehiclePlateStatus=attached', async () => {
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
        license_plate: '30A-123.45',
      },
    ]);
    const report = await service.importAccounts(
      fileOf(buf),
      { commit: true },
      actor,
      ctx,
    );
    const row = report.results.find((r) => r.email === 'a@company.com');
    expect(row?.status).toBe(ImportAccountRowStatus.SUCCESS);
    expect(row?.vehiclePlateStatus).toBe('attached');
    expect(vehicleRegistrationService.register).toHaveBeenCalledWith(
      'new-a@company.com',
      { plateRaw: '30A-123.45' },
    );
  });

  it('commit: biển đã được đăng ký (conflict) → vehiclePlateStatus=duplicate_plate, tài khoản vẫn SUCCESS', async () => {
    vehicleRegistrationService.register.mockRejectedValueOnce(
      new ConflictException({
        code: 'PLATE_ALREADY_REGISTERED',
        message: 'Biển số này đã được đăng ký',
      }),
    );
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
        license_plate: '30A12345',
      },
    ]);
    const report = await service.importAccounts(
      fileOf(buf),
      { commit: true },
      actor,
      ctx,
    );
    const row = report.results.find((r) => r.email === 'a@company.com');
    expect(row?.status).toBe(ImportAccountRowStatus.SUCCESS);
    expect(row?.vehiclePlateStatus).toBe('duplicate_plate');
  });

  it('không điền license_plate → vehiclePlateStatus để trống, không gọi DB', async () => {
    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
      },
    ]);
    const report = await service.importAccounts(
      fileOf(buf),
      { commit: true },
      actor,
      ctx,
    );
    const row = report.results.find((r) => r.email === 'a@company.com');
    expect(row?.vehiclePlateStatus).toBeUndefined();
    expect(vehicleRegistrationService.register).not.toHaveBeenCalled();
  });

  // ── Ảnh sinh trắc học gộp trong 1 file .zip (photosZip) ─────────────────

  it('commit: gửi ảnh qua photosZip (gộp) → giải nén, khớp employee_code, biometricStatus=attached', async () => {
    const zip = new JSZip();
    zip.file('EMP001.jpg', Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
        employee_code: 'EMP001',
      },
    ]);
    const report = await service.importAccounts(
      fileOf(buf),
      { commit: true, biometricConsentConfirmed: true },
      actor,
      ctx,
      [],
      { buffer: zipBuffer, size: zipBuffer.length, originalname: 'photos.zip' },
    );
    const row = report.results.find((r) => r.email === 'a@company.com');
    expect(row?.status).toBe(ImportAccountRowStatus.SUCCESS);
    expect(row?.biometricStatus).toBe('attached');
    expect(cloudinaryService.uploadImage).toHaveBeenCalledTimes(1);
  });

  it('commit: photosZip nhưng chưa xác nhận consent → BadRequestException', async () => {
    const zip = new JSZip();
    zip.file('EMP001.jpg', Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    const buf = await buildXlsx([
      {
        full_name: 'A',
        email: 'a@company.com',
        department_code: 'ENG',
        role_codes: 'EMPLOYEE',
        employee_code: 'EMP001',
      },
    ]);
    await expect(
      service.importAccounts(fileOf(buf), { commit: true }, actor, ctx, [], {
        buffer: zipBuffer,
        size: zipBuffer.length,
        originalname: 'photos.zip',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(usersService.persistAccount).not.toHaveBeenCalled();
  });
});
