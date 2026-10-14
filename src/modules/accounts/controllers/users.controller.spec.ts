import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ParseUUIDPipe, HttpStatus, ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UsersController } from './users.controller.js';
import { UsersService } from '../services/users.service.js';
import { AccountImportService } from '../services/account-import.service.js';
import { PartnerAccountImportService } from '../services/partner-account-import.service.js';
import { UserExportService } from '../../reports/services/user-export.service.js';
import { CreateUserDto } from '../dto/create-user.dto.js';
import { UpdateUserDto } from '../dto/update-user.dto.js';
import { UpdateUserStatusDto } from '../dto/update-user-status.dto.js';
import { LockUserDto } from '../dto/lock-user.dto.js';
import { ManageUsersQueryDto } from '../dto/manage-users-query.dto.js';
import { UpdateUserRolesDto } from '../dto/update-user-roles.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

describe('UsersController', () => {
  let controller: UsersController;
  let service: {
    createUser: jest.Mock;
    getUserDetail: jest.Mock;
    getPublicProfile: jest.Mock;
    updateUserRoles: jest.Mock;
    updateUser: jest.Mock;
    deleteUser: jest.Mock;
    updateUserStatus: jest.Mock;
    lockUser: jest.Mock;
    unlockUser: jest.Mock;
    listUsersForManagement: jest.Mock;
  };
  let userExportService: { exportUsersXlsx: jest.Mock };
  let partnerAccountImportService: {
    generateTemplate: jest.Mock;
    importPartnerAccounts: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      createUser: jest.fn(),
      getUserDetail: jest.fn(),
      getPublicProfile: jest.fn(),
      updateUserRoles: jest.fn(),
      updateUser: jest.fn(),
      deleteUser: jest.fn(),
      updateUserStatus: jest.fn(),
      lockUser: jest.fn(),
      unlockUser: jest.fn(),
      listUsersForManagement: jest.fn(),
    };
    userExportService = { exportUsersXlsx: jest.fn() };
    partnerAccountImportService = {
      generateTemplate: jest.fn(),
      importPartnerAccounts: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: service,
        },
        {
          provide: AccountImportService,
          useValue: {
            generateTemplate: jest.fn(),
            importAccounts: jest.fn(),
          },
        },
        {
          provide: PartnerAccountImportService,
          useValue: partnerAccountImportService,
        },
        {
          provide: UserExportService,
          useValue: userExportService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createUser', () => {
    it('should call UsersService.createUser and return response in standard success format', async () => {
      const dto: CreateUserDto = {
        fullName: 'Nguyen Van A',
        email: 'nva@company.com',
        departmentId: 'dept-uuid',
        roleIds: ['role-uuid'],
      };

      const mockUserResult = {
        id: 'new-user-uuid',
        employeeCode: null,
        email: 'nva@company.com',
        fullName: 'Nguyen Van A',
        accountStatus: 'active',
        mustChangePassword: true,
        roles: [
          { id: 'role-uuid', roleCode: 'employee', roleName: 'Employee' },
        ],
        createdAt: new Date(),
      };

      service.createUser.mockResolvedValue(mockUserResult);

      const request = {
        user: { userId: 'admin-uuid' },
      } as unknown as Request;

      const result = await controller.createUser(
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
        'req-id',
        undefined,
      );

      expect(service.createUser).toHaveBeenCalledWith(
        dto,
        'admin-uuid',
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
          requestId: 'req-id',
        },
        undefined,
      );

      expect(result).toEqual({
        success: true,
        message:
          'Nhân viên đã được tạo thành công và thông tin đăng nhập đã được gửi tới email.',
        data: mockUserResult,
      });
    });
  });

  describe('getUserDetail', () => {
    const validUserId = '550e8400-e29b-41d4-a716-446655440000';

    const mockDetailResult = {
      id: validUserId,
      employeeCode: 'EMP001',
      email: 'user@company.com',
      fullName: 'Nguyen Van A',
      phoneNumber: '0909123456',
      avatarUrl: null,
      positionTitle: 'Software Engineer',
      department: { id: 'dept-id', departmentName: 'IT Department' },
      directManager: { id: 'mgr-id', fullName: 'Tran Van B' },
      accountStatus: 'active',
      employmentStatus: 'active',
      mustChangePassword: false,
      lastLoginAt: '2026-06-07T10:30:00.000Z',
      roles: [{ id: 'role-id', roleCode: 'EMPLOYEE', roleName: 'Nhan vien' }],
      hasFaceProfile: true,
      createdAt: '2026-01-15T08:00:00.000Z',
    };

    it('[HP1] Happy path — gọi service với đúng params, response format (AC-001)', async () => {
      service.getUserDetail.mockResolvedValue(mockDetailResult);

      const request = {
        user: { userId: 'admin-uuid' },
      } as unknown as Request;

      const result = await controller.getUserDetail(
        validUserId,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
        'req-id',
      );

      expect(service.getUserDetail).toHaveBeenCalledWith(
        validUserId,
        'admin-uuid',
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
          requestId: 'req-id',
        },
      );

      expect(result).toEqual({
        success: true,
        message: 'User detail retrieved successfully',
        data: mockDetailResult,
      });
    });
  });

  describe('getPublicProfile', () => {
    const validUserId = '550e8400-e29b-41d4-a716-446655440000';

    const mockPublicProfileResult = {
      id: validUserId,
      fullName: 'Nguyen Van A',
      email: 'a.nguyen@company.com',
      employeeCode: 'EMP001',
      department: { id: 'dept-id', departmentName: 'Phong Ky Thuat' },
      avatarUrl: 'https://res.cloudinary.com/demo/image/upload/avatar.jpg',
    };

    it('[AC-001] Happy path — gọi service đúng userId, response format chuẩn', async () => {
      service.getPublicProfile.mockResolvedValue(mockPublicProfileResult);

      const result = await controller.getPublicProfile(validUserId);

      expect(service.getPublicProfile).toHaveBeenCalledWith(validUserId);
      expect(result).toEqual({
        success: true,
        message: 'Lấy hồ sơ công khai thành công',
        data: mockPublicProfileResult,
      });
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { getPublicProfile } = UsersController.prototype;

    it('[AC-003] Endpoint chỉ áp dụng JwtAuthGuard, KHÔNG có PermissionsGuard — mọi role đều truy cập được', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        getPublicProfile,
      ) as unknown[];

      expect(guards).toEqual([JwtAuthGuard]);
      expect(guards).not.toContain(PermissionsGuard);
    });

    it('[AC-004] userId không hợp lệ → ParseUUIDPipe reject với code INVALID_USER_ID (400)', async () => {
      const pipe = new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/public-profile',
        }),
      });

      await expect(
        pipe.transform('not-a-valid-uuid', {} as never),
      ).rejects.toMatchObject({
        error: { code: 'INVALID_USER_ID', details: {} },
      });
    });
  });

  describe('updateUserRoles', () => {
    const validUserId = '550e8400-e29b-41d4-a716-446655440000';

    it('[C1] Success — gọi service đúng params & trả response format chuẩn', async () => {
      const dto: UpdateUserRolesDto = {
        roleIds: ['role-uuid-1', 'role-uuid-2'],
      };
      const mockResult = {
        userId: validUserId,
        roles: [
          { id: 'role-uuid-1', roleCode: 'MANAGER', roleName: 'Quản lý' },
        ],
      };
      service.updateUserRoles.mockResolvedValue(mockResult);

      const request = {
        user: { userId: 'sysadmin-uuid' },
      } as unknown as Request;

      const result = await controller.updateUserRoles(
        validUserId,
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
        'req-id',
      );

      expect(service.updateUserRoles).toHaveBeenCalledWith(
        validUserId,
        dto.roleIds,
        'sysadmin-uuid',
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
          requestId: 'req-id',
        },
      );
      expect(result).toEqual({
        success: true,
        message: 'Cập nhật vai trò tài khoản thành công',
        data: mockResult,
      });
    });

    it('[C2] userId không hợp lệ → ParseUUIDPipe reject code INVALID_USER_ID (400)', async () => {
      const pipe = new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/roles',
        }),
      });

      await expect(
        pipe.transform('not-a-valid-uuid', {} as never),
      ).rejects.toMatchObject({
        error: { code: 'INVALID_USER_ID', details: {} },
      });
    });

    it('[C3] roleIds rỗng → DTO @ArrayNotEmpty báo lỗi validation (400)', async () => {
      const dto = plainToInstance(UpdateUserRolesDto, { roleIds: [] });
      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('roleIds');
      expect(errors[0].constraints).toHaveProperty('arrayNotEmpty');
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { updateUserRoles } = UsersController.prototype;

    it('[C4] Endpoint áp dụng JwtAuthGuard + PermissionsGuard (401/403 gate)', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        updateUserRoles,
      ) as unknown[];

      expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
    });

    it('[C5] Yêu cầu permission accounts.user.update_roles (403 nếu thiếu)', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        updateUserRoles,
      ) as string[];

      expect(permissions).toEqual(['accounts.user.update_roles']);
    });
  });

  describe('updateUser', () => {
    const validUserId = '550e8400-e29b-41d4-a716-446655440000';

    it('[C1] Success — gọi service đúng params & trả response format chuẩn', async () => {
      const dto: UpdateUserDto = {
        phoneNumber: '0911111111',
        positionTitle: 'Lead',
      };
      const mockResult = { id: validUserId, fullName: 'Nguyen Van A' };
      service.updateUser.mockResolvedValue(mockResult);

      const request = {
        user: { userId: 'admin-uuid' },
      } as unknown as Request;

      const result = await controller.updateUser(
        validUserId,
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
        'req-id',
      );

      expect(service.updateUser).toHaveBeenCalledWith(
        validUserId,
        dto,
        'admin-uuid',
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
          requestId: 'req-id',
        },
      );
      expect(result).toEqual({
        success: true,
        message: 'Cập nhật thông tin tài khoản thành công',
        data: mockResult,
      });
    });

    it('[C2] userId không hợp lệ → ParseUUIDPipe reject code INVALID_USER_ID (400)', async () => {
      const pipe = new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId',
        }),
      });

      await expect(
        pipe.transform('not-a-valid-uuid', {} as never),
      ).rejects.toMatchObject({
        error: { code: 'INVALID_USER_ID', details: {} },
      });
    });

    it('[C3] Body chứa field cấm (email) → forbidNonWhitelisted reject (400)', async () => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });

      await expect(
        pipe.transform({ email: 'a@b.com', phoneNumber: '0911111111' }, {
          type: 'body',
          metatype: UpdateUserDto,
        } as never),
      ).rejects.toBeDefined();
    });

    it('[C3b] roleIds/accountStatus cũng bị chặn bởi forbidNonWhitelisted', async () => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });

      await expect(
        pipe.transform({ roleIds: [], accountStatus: 'locked' }, {
          type: 'body',
          metatype: UpdateUserDto,
        } as never),
      ).rejects.toBeDefined();
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { updateUser } = UsersController.prototype;

    it('[C4] Endpoint áp dụng JwtAuthGuard; quyền update/self-update được service kiểm soát theo target user', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        updateUser,
      ) as unknown[];

      expect(guards).toEqual([JwtAuthGuard]);
    });

    it('[C5] Không gắn RequirePermissions trực tiếp để cho phép self-update hồ sơ cá nhân', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        updateUser,
      ) as string[];

      expect(permissions).toBeUndefined();
    });
  });

  describe('deleteUser', () => {
    const validUserId = '550e8400-e29b-41d4-a716-446655440000';

    it('[DC1] Success — gọi service đúng params & trả { success, message }', async () => {
      service.deleteUser.mockResolvedValue(undefined);

      const request = {
        user: { userId: 'sysadmin-uuid' },
      } as unknown as Request;

      const result = await controller.deleteUser(
        validUserId,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
        'req-id',
      );

      expect(service.deleteUser).toHaveBeenCalledWith(
        validUserId,
        'sysadmin-uuid',
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
          requestId: 'req-id',
        },
      );
      expect(result).toEqual({
        success: true,
        message: 'Đã xóa tài khoản thành công',
      });
    });

    it('[DC2] userId không hợp lệ → ParseUUIDPipe reject code INVALID_USER_ID (400)', async () => {
      const pipe = new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId',
        }),
      });

      await expect(
        pipe.transform('not-a-valid-uuid', {} as never),
      ).rejects.toMatchObject({
        error: { code: 'INVALID_USER_ID', details: {} },
      });
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { deleteUser } = UsersController.prototype;

    it('[DC3] Endpoint áp dụng JwtAuthGuard + PermissionsGuard', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        deleteUser,
      ) as unknown[];

      expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
    });

    it('[DC4] Yêu cầu permission accounts.user.delete', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        deleteUser,
      ) as string[];

      expect(permissions).toEqual(['accounts.user.delete']);
    });
  });

  describe('updateUserStatus', () => {
    const validUserId = '550e8400-e29b-41d4-a716-446655440000';

    it('[SC1] Success — gọi service đúng params & trả { success, message, data }', async () => {
      const dto: UpdateUserStatusDto = { status: 'inactive' };
      const mockResult = { id: validUserId, accountStatus: 'inactive' };
      service.updateUserStatus.mockResolvedValue(mockResult);

      const request = {
        user: { userId: 'admin-uuid' },
      } as unknown as Request;

      const result = await controller.updateUserStatus(
        validUserId,
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
        'req-id',
      );

      expect(service.updateUserStatus).toHaveBeenCalledWith(
        validUserId,
        'inactive',
        'admin-uuid',
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
          requestId: 'req-id',
        },
      );
      expect(result).toEqual({
        success: true,
        message: 'Cập nhật trạng thái tài khoản thành công',
        data: mockResult,
      });
    });

    it('[SC2] userId không hợp lệ → ParseUUIDPipe reject INVALID_USER_ID (400)', async () => {
      const pipe = new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/status',
        }),
      });

      await expect(
        pipe.transform('not-a-valid-uuid', {} as never),
      ).rejects.toMatchObject({
        error: { code: 'INVALID_USER_ID', details: {} },
      });
    });

    it('[SC3] status không hợp lệ (locked) → DTO @IsIn reject', async () => {
      const dto = plainToInstance(UpdateUserStatusDto, { status: 'locked' });
      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('status');
      expect(errors[0].constraints).toHaveProperty('isIn');
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { updateUserStatus } = UsersController.prototype;

    it('[SC4] Endpoint áp dụng JwtAuthGuard + PermissionsGuard', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        updateUserStatus,
      ) as unknown[];

      expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
    });

    it('[SC5] Yêu cầu permission accounts.user.update_status', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        updateUserStatus,
      ) as string[];

      expect(permissions).toEqual(['accounts.user.update_status']);
    });
  });

  describe('lockUser / unlockUser', () => {
    const validUserId = '550e8400-e29b-41d4-a716-446655440000';

    it('[LC1] lock success — gọi service đúng params & trả chuẩn', async () => {
      const dto: LockUserDto = { reason: 'vi pham' };
      const mockResult = { id: validUserId, accountStatus: 'locked' };
      service.lockUser.mockResolvedValue(mockResult);

      const request = {
        user: { userId: 'admin-uuid' },
      } as unknown as Request;

      const result = await controller.lockUser(
        validUserId,
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
        'req-id',
      );

      expect(service.lockUser).toHaveBeenCalledWith(
        validUserId,
        'vi pham',
        'admin-uuid',
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
          requestId: 'req-id',
        },
      );
      expect(result).toEqual({
        success: true,
        message: 'Đã khóa tài khoản thành công',
        data: mockResult,
      });
    });

    it('[LC2] userId không hợp lệ (lock) → ParseUUIDPipe reject INVALID_USER_ID (400)', async () => {
      const pipe = new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/lock',
        }),
      });

      await expect(
        pipe.transform('not-a-valid-uuid', {} as never),
      ).rejects.toMatchObject({
        error: { code: 'INVALID_USER_ID', details: {} },
      });
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { lockUser, unlockUser } = UsersController.prototype;

    it('[LC3] lock endpoint áp dụng JwtAuthGuard + PermissionsGuard', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        lockUser,
      ) as unknown[];

      expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
    });

    it('[LC4] lock yêu cầu permission accounts.user.lock', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        lockUser,
      ) as string[];

      expect(permissions).toEqual(['accounts.user.lock']);
    });

    it('[UC1] unlock success — gọi service đúng params & trả chuẩn', async () => {
      const mockResult = { id: validUserId, accountStatus: 'active' };
      service.unlockUser.mockResolvedValue(mockResult);

      const request = {
        user: { userId: 'admin-uuid' },
      } as unknown as Request;

      const result = await controller.unlockUser(
        validUserId,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
        'req-id',
      );

      expect(service.unlockUser).toHaveBeenCalledWith(
        validUserId,
        'admin-uuid',
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
          requestId: 'req-id',
        },
      );
      expect(result).toEqual({
        success: true,
        message: 'Đã mở khóa tài khoản thành công',
        data: mockResult,
      });
    });

    it('[UC2] unlock yêu cầu permission accounts.user.unlock', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        unlockUser,
      ) as string[];

      expect(permissions).toEqual(['accounts.user.unlock']);
    });
  });

  describe('listUsersForManagement (UC-14)', () => {
    it('[MC1] Success — gọi service đúng params & trả { success, message, data, meta }', async () => {
      const query: ManageUsersQueryDto = { page: 2, limit: 10 };
      const mockData = [
        {
          id: 'u1',
          fullName: 'A',
          email: 'a@x.com',
          employeeCode: 'EMP1',
          accountStatus: 'active',
          departmentId: 'dep-1',
          roles: ['MANAGER'],
        },
      ];
      service.listUsersForManagement.mockResolvedValue({
        data: mockData,
        total: 25,
      });

      const request = {
        user: { userId: 'admin-uuid' },
      } as unknown as Request;

      const result = await controller.listUsersForManagement(query, request);

      expect(service.listUsersForManagement).toHaveBeenCalledWith(
        query,
        'admin-uuid',
      );
      expect(result).toEqual({
        success: true,
        message: 'Lấy danh sách tài khoản thành công',
        data: mockData,
        meta: { page: 2, limit: 10, total: 25, totalPages: 3 },
      });
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { listUsersForManagement } = UsersController.prototype;

    it('[MC2] Endpoint áp dụng JwtAuthGuard + PermissionsGuard', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        listUsersForManagement,
      ) as unknown[];

      expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
    });

    it('[MC3] Yêu cầu permission accounts.user.manage', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        listUsersForManagement,
      ) as string[];

      expect(permissions).toEqual(['accounts.user.manage']);
    });

    it('[MC4] sortBy ngoài allowlist → DTO @IsIn reject', async () => {
      const dto = plainToInstance(ManageUsersQueryDto, {
        sortBy: 'passwordHash',
      });
      const errors = await validate(dto);
      const sortByError = errors.find((e) => e.property === 'sortBy');
      expect(sortByError?.constraints).toHaveProperty('isIn');
    });
  });

  describe('exportUsers (BE-04)', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { exportUsers } = UsersController.prototype;

    it('[EX1] Success — gọi userExportService đúng filter + userId/email từ token, set 2 header rồi res.send(buffer)', async () => {
      const buffer = Buffer.from('XLSX_CONTENT');
      userExportService.exportUsersXlsx.mockResolvedValue({
        buffer,
        fileName: 'danh-sach-nguoi-dung-20260727-090000.xlsx',
      });

      const request = {
        user: { userId: 'admin-uuid', email: 'admin@test.com' },
      } as unknown as Request;
      const res = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.exportUsers(
        { search: 'nguyen', departmentId: 'dept-1' },
        request,
        res,
      );

      expect(userExportService.exportUsersXlsx).toHaveBeenCalledWith(
        { userId: 'admin-uuid', email: 'admin@test.com' },
        { search: 'nguyen', departmentId: 'dept-1' },
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="danh-sach-nguoi-dung-20260727-090000.xlsx"',
      );
      expect(res.send).toHaveBeenCalledWith(buffer);
    });

    it('[EX2] Endpoint áp dụng JwtAuthGuard + PermissionsGuard', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        exportUsers,
      ) as unknown[];

      expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
    });

    it('[EX3] Yêu cầu permission accounts.user.export', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        exportUsers,
      ) as string[];

      expect(permissions).toEqual(['accounts.user.export']);
    });
  });

  describe('importPartnerAccounts (PTA-IMPORT-001)', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { downloadPartnerImportTemplate, importPartnerAccounts } =
      UsersController.prototype;

    it('downloadPartnerImportTemplate sets headers and sends xlsx buffer', async () => {
      partnerAccountImportService.generateTemplate.mockResolvedValue(
        Buffer.from('PARTNER_TEMPLATE'),
      );

      const res = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.downloadPartnerImportTemplate(res);

      expect(partnerAccountImportService.generateTemplate).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="partner-accounts-template.xlsx"',
      );
      expect(res.send).toHaveBeenCalledWith(Buffer.from('PARTNER_TEMPLATE'));
    });

    it('requires account.partner.import permission for download template', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        downloadPartnerImportTemplate,
      ) as string[];

      expect(permissions).toEqual(['account.partner.import']);
    });

    it('importPartnerAccounts passes options to service and returns standard response', async () => {
      partnerAccountImportService.importPartnerAccounts.mockResolvedValue({
        mode: 'preview',
        totalRows: 1,
        validCount: 1,
        invalidCount: 0,
        results: [{ row: 2, email: 'p1@doitac.com', status: 'valid' }],
      });

      const request = {
        user: { userId: 'admin-uuid' },
      } as unknown as Request;

      const fileMock = { buffer: Buffer.from('xlsx'), originalname: 'p.xlsx' };
      const dto = { commit: false, defaultExpiresInDays: 3 };

      const res = await controller.importPartnerAccounts(
        { file: [fileMock] },
        dto,
        request as any,
        '127.0.0.1',
      );

      expect(
        partnerAccountImportService.importPartnerAccounts,
      ).toHaveBeenCalledWith(
        fileMock,
        [],
        undefined,
        dto,
        { id: 'admin-uuid' },
        { ipAddress: '127.0.0.1', userAgent: undefined, requestId: undefined },
      );
      expect(res.success).toBe(true);
      expect(res.message).toBe('Kiểm tra hoàn tất');
      expect(res.data.mode).toBe('preview');
    });

    it('requires account.partner.import permission for import endpoint', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        importPartnerAccounts,
      ) as string[];

      expect(permissions).toEqual(['account.partner.import']);
    });
  });
});
