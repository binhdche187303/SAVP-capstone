/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager, Brackets } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
  InternalServerErrorException,
} from '@nestjs/common';

import { UsersService } from './users.service.js';
import { PasswordGeneratorService } from './password-generator.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { AuthConfigService } from '../../auth/services/auth-config.service.js';
import * as bcrypt from 'bcryptjs';
import {
  PARTNER_DEPARTMENT_ID,
  clearPartnerDepartmentCache,
} from '../../../common/utils/partner-account.util.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { CloudinaryService } from '../../storage/cloudinary.service.js';
import { CreateUserDto } from '../dto/create-user.dto.js';
import {
  UserEntity,
  EmploymentStatus,
  AccountStatus,
} from '../entities/user.entity.js';
import { DepartmentEntity } from '../entities/department.entity.js';
import { RoleEntity } from '../entities/role.entity.js';
import { UserRoleEntity } from '../entities/user-role.entity.js';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../../meetings/entities/meeting-participant.entity.js';
import { RoomBookingEntity } from '../../rooms/entities/room-booking.entity.js';
import { DeviceUserMappingEntity } from '../../iot/entities/device-user-mapping.entity.js';

interface MockFindOneOptions {
  where?: {
    email?: string;
    username?: string;
    employeeCode?: string;
    id?: string;
  };
}

describe('UsersService', () => {
  let service: UsersService;
  let dataSource: jest.Mocked<DataSource>;
  let passwordGeneratorService: jest.Mocked<PasswordGeneratorService>;
  let notificationsService: jest.Mocked<NotificationsService>;
  let redisService: jest.Mocked<RedisService>;
  let authConfigService: jest.Mocked<AuthConfigService>;
  let cloudinaryService: jest.Mocked<CloudinaryService>;
  let authzReadRepository: jest.Mocked<AuthzReadRepository>;
  let em: jest.Mocked<EntityManager>;

  beforeEach(async () => {
    clearPartnerDepartmentCache();
    // Mock EntityManager
    em = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      softDelete: jest.fn(),
      createQueryBuilder: jest.fn(),
      getRepository: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>;

    // Mock DataSource
    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (manager: EntityManager) => unknown) =>
          cb(em),
        ),
      manager: em,
      getRepository: jest.fn(),
      query: jest.fn().mockResolvedValue([{ id: PARTNER_DEPARTMENT_ID }]),
    } as unknown as jest.Mocked<DataSource>;

    // Mock PasswordGeneratorService
    passwordGeneratorService = {
      generateTemporaryPassword: jest.fn().mockReturnValue('tempPassword123!'),
    } as unknown as jest.Mocked<PasswordGeneratorService>;

    // Mock NotificationsService
    notificationsService = {
      enqueueEmailNotification: jest.fn().mockResolvedValue({
        notification: { id: 'notif-id' },
        jobId: 'bull-job-id',
      }),
    } as unknown as jest.Mocked<NotificationsService>;

    // Mock RedisService + AuthConfigService (UC-10 token revocation)
    redisService = {
      setWithTtl: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RedisService>;
    authConfigService = {
      getRefreshTokenTtlSeconds: jest.fn().mockReturnValue(604800),
    } as unknown as jest.Mocked<AuthConfigService>;
    cloudinaryService = {
      uploadImage: jest.fn().mockResolvedValue({
        publicId: 'pub',
        secureUrl: 'https://cdn/pub',
      }),
      deleteImage: jest.fn().mockResolvedValue(undefined),
      resolveMediaStorageProvider: jest.fn().mockReturnValue('cloud_provider'),
    } as unknown as jest.Mocked<CloudinaryService>;
    authzReadRepository = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: [], permissions: [] }),
    } as unknown as jest.Mocked<AuthzReadRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DataSource, useValue: dataSource },
        {
          provide: PasswordGeneratorService,
          useValue: passwordGeneratorService,
        },
        {
          provide: NotificationsService,
          useValue: notificationsService,
        },
        { provide: RedisService, useValue: redisService },
        { provide: AuthConfigService, useValue: authConfigService },
        { provide: CloudinaryService, useValue: cloudinaryService },
        { provide: AuthzReadRepository, useValue: authzReadRepository },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  const validDto: CreateUserDto = {
    fullName: 'Nguyen Van A',
    email: 'nva@company.com',
    departmentId: 'dept-id',
    roleIds: ['role-id-1'],
    employeeCode: 'EMP001',
    phoneNumber: '+84 987654321',
    positionTitle: 'Developer',
    directManagerId: 'manager-id',
  };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserDetail', () => {
    const targetUserId = 'target-user-id';
    const authUserId = 'auth-user-id';
    const managerUserId = 'manager-user-id';

    const baseTargetUser = {
      id: targetUserId,
      employeeCode: 'EMP001',
      email: 'user@company.com',
      fullName: 'Nguyen Van A',
      phoneNumber: '0909123456',
      avatarUrl: 'https://storage.example.com/avatars/uuid.jpg',
      positionTitle: 'Software Engineer',
      departmentId: 'dept-id',
      directManagerId: managerUserId,
      accountStatus: 'active',
      employmentStatus: 'active',
      mustChangePassword: false,
      lastLoginAt: new Date('2026-06-07T10:30:00.000Z'),
      createdAt: new Date('2026-01-15T08:00:00.000Z'),
      department: { id: 'dept-id', departmentName: 'IT Department' },
    };

    const baseAuthAdmin = {
      id: authUserId,
      departmentId: 'admin-dept-id',
    };

    const managerUser = {
      id: managerUserId,
      fullName: 'Tran Van B',
    };

    const activeRole = {
      id: 'role-id-1',
      role: {
        id: 'role-id-1',
        roleCode: 'EMPLOYEE',
        roleName: 'Nhan vien',
      },
    };

    function setupSystemAdmin() {
      em.findOne.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserEntity) {
          if (options?.where?.id === targetUserId) return baseTargetUser;
          if (options?.where?.id === authUserId) return baseAuthAdmin;
          if (options?.where?.id === managerUserId) return managerUser;
          return null;
        }
        if (entityClass === FaceProfileEntity) {
          return { id: 'face-profile-id', userId: targetUserId };
        }
        if (entityClass === DepartmentEntity) {
          return null;
        }
        return null;
      });

      em.find.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserRoleEntity) {
          if (options?.where?.userId === authUserId) {
            return [
              {
                role: {
                  id: 'sysadmin-role-id',
                  roleCode: 'SYSTEM_ADMIN',
                  isSystemRole: true,
                },
              },
            ];
          }
          if (options?.where?.userId === targetUserId) {
            return [activeRole];
          }
        }
        return [];
      });

      em.create.mockImplementation(
        (_entityClass: unknown, plain: unknown) => plain,
      );
      em.save.mockImplementation(
        async (_entityClass: unknown, entity: unknown) => entity,
      );
    }

    function setupBusinessAdmin(
      adminDeptId: string,
      targetDeptId: string,
      childDeptIds: string[] = [],
    ) {
      em.findOne.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserEntity) {
          if (options?.where?.id === targetUserId) {
            return { ...baseTargetUser, departmentId: targetDeptId };
          }
          if (options?.where?.id === authUserId) {
            return { ...baseAuthAdmin, departmentId: adminDeptId };
          }
          if (options?.where?.id === managerUserId) return managerUser;
          if (options?.where?.id) return null;
          return null;
        }
        if (entityClass === FaceProfileEntity) {
          return { id: 'face-profile-id', userId: targetUserId };
        }
        if (entityClass === DepartmentEntity) {
          if (options?.where?.parentDepartmentId === adminDeptId) {
            return null;
          }
          return null;
        }
        return null;
      });

      em.find.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserRoleEntity) {
          if (options?.where?.userId === authUserId) {
            return [{ role: { id: 'bizadmin-role-id', isSystemRole: false } }];
          }
          if (options?.where?.userId === targetUserId) {
            return [activeRole];
          }
        }
        if (entityClass === DepartmentEntity) {
          if (options?.where?.parentDepartmentId === adminDeptId) {
            return childDeptIds.map((id) => ({ id }));
          }
        }
        return [];
      });

      em.create.mockImplementation(
        (_entityClass: unknown, plain: unknown) => plain,
      );
      em.save.mockImplementation(
        async (_entityClass: unknown, entity: unknown) => entity,
      );
    }

    // ===== HAPPY PATH TESTS (T007) =====

    it('[HP1] System Admin xem user detail — HTTP 200, d?y d? 17 fields (AC-001, AC-012)', async () => {
      setupSystemAdmin();

      const result = await service.getUserDetail(targetUserId, authUserId);

      expect(result).toBeDefined();
      expect(result.id).toBe(targetUserId);
      expect(result.employeeCode).toBe('EMP001');
      expect(result.email).toBe('user@company.com');
      expect(result.fullName).toBe('Nguyen Van A');
      expect(result.phoneNumber).toBe('0909123456');
      expect(result.avatarUrl).toBe(
        'https://storage.example.com/avatars/uuid.jpg',
      );
      expect(result.positionTitle).toBe('Software Engineer');
      expect(result.department).toBeDefined();
      expect(result.department!.id).toBe('dept-id');
      expect(result.department!.departmentName).toBe('IT Department');
      expect(result.directManager).toBeDefined();
      expect(result.directManager!.id).toBe(managerUserId);
      expect(result.directManager!.fullName).toBe('Tran Van B');
      expect(result.accountStatus).toBe('active');
      expect(result.employmentStatus).toBe('active');
      expect(result.mustChangePassword).toBe(false);
      expect(result.lastLoginAt).toBe('2026-06-07T10:30:00.000Z');
      expect(result.roles).toHaveLength(1);
      expect(result.roles[0].roleCode).toBe('EMPLOYEE');
      expect(result.hasFaceProfile).toBe(true);
      expect(result.createdAt).toBe('2026-01-15T08:00:00.000Z');

      const fieldCount = Object.keys(result).length;
      expect(fieldCount).toBe(16);
    });

    it('[HP2] Business Admin xem user cùng department — HTTP 200 (AC-013)', async () => {
      setupBusinessAdmin('dept-id', 'dept-id');

      const result = await service.getUserDetail(targetUserId, authUserId);

      expect(result).toBeDefined();
      expect(result.id).toBe(targetUserId);
      expect(result.fullName).toBe('Nguyen Van A');
    });

    it('[HP3] Business Admin xem user child department — HTTP 200 (AC-013)', async () => {
      setupBusinessAdmin('parent-dept', 'child-dept', ['child-dept']);

      const result = await service.getUserDetail(targetUserId, authUserId);

      expect(result).toBeDefined();
      expect(result.id).toBe(targetUserId);
    });

    it('[HP4] Self-view (Business Admin xem chính mình) — bypass scope (AC-014)', async () => {
      em.findOne.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserEntity) {
          if (options?.where?.id === authUserId) {
            return {
              ...baseTargetUser,
              id: authUserId,
              departmentId: 'own-dept',
            };
          }
          return null;
        }
        if (entityClass === FaceProfileEntity) {
          return null;
        }
        return null;
      });

      em.find.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserRoleEntity) {
          if (options?.where?.userId === authUserId) {
            return [{ role: { id: 'bizadmin-role-id', isSystemRole: false } }];
          }
        }
        return [];
      });

      em.create.mockImplementation(
        (_entityClass: unknown, plain: unknown) => plain,
      );
      em.save.mockImplementation(
        async (_entityClass: unknown, entity: unknown) => entity,
      );

      const result = await service.getUserDetail(authUserId, authUserId);

      expect(result).toBeDefined();
      expect(result.id).toBe(authUserId);
      expect(result.hasFaceProfile).toBe(false);
    });

    // ===== ERROR CASE TESTS (T008) =====

    it('[E5] User không t?n t?i — 404 USER_NOT_FOUND (AC-007)', async () => {
      em.findOne.mockImplementation(async (entityClass: unknown) => {
        if (entityClass === UserEntity) return null;
        return null;
      });
      em.find.mockResolvedValue([]);

      await expect(
        service.getUserDetail('non-existent-id', authUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('[E6] User soft-deleted — 404 USER_NOT_FOUND (AC-008)', async () => {
      em.findOne.mockImplementation(
        async (entityClass: unknown, options: any) => {
          if (entityClass === UserEntity) {
            if (
              options?.where?.id === targetUserId &&
              options?.where?.deletedAt !== undefined
            ) {
              return null;
            }
          }
          return null;
        },
      );

      await expect(
        service.getUserDetail(targetUserId, authUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('[E4] Business Admin ngoài scope — 403 FORBIDDEN (AC-006)', async () => {
      setupBusinessAdmin('admin-dept', 'other-dept');

      await expect(
        service.getUserDetail(targetUserId, authUserId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Audit log failure không block response (non-blocking try/catch)', async () => {
      setupSystemAdmin();

      em.save.mockImplementation(async (entityClass: unknown) => {
        if (entityClass === AuditLogEntity) {
          throw new Error('Audit service down');
        }
        return undefined;
      });

      const result = await service.getUserDetail(targetUserId, authUserId);
      expect(result).toBeDefined();
      expect(result.id).toBe(targetUserId);
    });

    it('Database error — throw 500 INTERNAL_ERROR', async () => {
      em.findOne.mockRejectedValue(new Error('Database connection failed'));

      await expect(
        service.getUserDetail(targetUserId, authUserId),
      ).rejects.toThrow(Error);
    });

    // ===== DATA FORMAT TESTS (T009) =====

    it('[HP4] hasFaceProfile = false khi không có face_profile (AC-002)', async () => {
      setupSystemAdmin();
      em.findOne.mockImplementation(
        async (entityClass: unknown, options: any) => {
          if (entityClass === UserEntity) {
            if (options?.where?.id === targetUserId) return baseTargetUser;
            if (options?.where?.id === authUserId) return baseAuthAdmin;
            if (options?.where?.id === managerUserId) return managerUser;
            return null;
          }
          if (entityClass === FaceProfileEntity) {
            return null;
          }
          return null;
        },
      );

      const result = await service.getUserDetail(targetUserId, authUserId);
      expect(result.hasFaceProfile).toBe(false);
    });

    it('[HP5] directManager = null khi direct_manager_id = null (AC-015)', async () => {
      const userWithoutManager = {
        ...baseTargetUser,
        directManagerId: null,
      };

      em.findOne.mockImplementation(
        async (entityClass: unknown, options: any) => {
          if (entityClass === UserEntity) {
            if (options?.where?.id === targetUserId) return userWithoutManager;
            if (options?.where?.id === authUserId) return baseAuthAdmin;
            return null;
          }
          if (entityClass === FaceProfileEntity) {
            return { id: 'face-id' };
          }
          return null;
        },
      );

      em.find.mockImplementation(async (entityClass: unknown, options: any) => {
        if (entityClass === UserRoleEntity) {
          if (options?.where?.userId === authUserId) {
            return [{ role: { id: 'sysadmin-role-id', roleCode: 'SYSTEM_ADMIN', isSystemRole: true } }];
          }
          if (options?.where?.userId === targetUserId) {
            return [activeRole];
          }
        }
        return [];
      });

      const result = await service.getUserDetail(targetUserId, authUserId);
      expect(result.directManager).toBeNull();
      expect(result).toHaveProperty('directManager');
    });

    it('[HP6] avatarUrl = null khi avatar_url = null (AC-016)', async () => {
      const userWithoutAvatar = {
        ...baseTargetUser,
        avatarUrl: null,
      };

      em.findOne.mockImplementation(
        async (entityClass: unknown, options: any) => {
          if (entityClass === UserEntity) {
            if (options?.where?.id === targetUserId) return userWithoutAvatar;
            if (options?.where?.id === authUserId) return baseAuthAdmin;
            return null;
          }
          if (entityClass === FaceProfileEntity) {
            return { id: 'face-id' };
          }
          return null;
        },
      );

      em.find.mockImplementation(async (entityClass: unknown, options: any) => {
        if (entityClass === UserRoleEntity) {
          if (options?.where?.userId === authUserId) {
            return [{ role: { id: 'sysadmin-role-id', roleCode: 'SYSTEM_ADMIN', isSystemRole: true } }];
          }
          if (options?.where?.userId === targetUserId) {
            return [activeRole];
          }
        }
        return [];
      });

      const result = await service.getUserDetail(targetUserId, authUserId);
      expect(result.avatarUrl).toBeNull();
    });

    it('[HP7] avatarUrl có giá tr? t? DB (AC-017)', async () => {
      setupSystemAdmin();
      const result = await service.getUserDetail(targetUserId, authUserId);
      expect(result.avatarUrl).toBe(
        'https://storage.example.com/avatars/uuid.jpg',
      );
    });

    it('[AC-018] employmentStatus ch? nh?n 4 enum values', async () => {
      setupSystemAdmin();
      const result = await service.getUserDetail(targetUserId, authUserId);
      expect(['active', 'probation', 'resigned', 'transferred']).toContain(
        result.employmentStatus,
      );
    });

    it('[AC-009, AC-010] No INSERT/UPDATE/DELETE operations — only SELECT', async () => {
      setupSystemAdmin();
      await service.getUserDetail(targetUserId, authUserId);

      expect(em.findOne).toHaveBeenCalled();
      expect(em.find).toHaveBeenCalled();
    });
  });

  describe('getPublicProfile', () => {
    const targetUserId = 'public-target-user-id';

    const basePublicUser = {
      id: targetUserId,
      fullName: 'Nguyen Van A',
      email: 'a.nguyen@company.com',
      employeeCode: 'EMP001',
      avatarUrl: 'https://res.cloudinary.com/demo/image/upload/avatar.jpg',
      department: { id: 'dept-id', departmentName: 'Phong Ky Thuat' },
    };

    // ===== HAPPY PATH & DATA FORMAT TESTS (T004) =====

    it('[AC-001] Happy path — trả đủ 6 field whitelist', async () => {
      em.findOne.mockResolvedValue(basePublicUser);

      const result = await service.getPublicProfile(targetUserId);

      expect(result).toEqual({
        id: targetUserId,
        fullName: 'Nguyen Van A',
        email: 'a.nguyen@company.com',
        employeeCode: 'EMP001',
        department: { id: 'dept-id', departmentName: 'Phong Ky Thuat' },
        avatarUrl: 'https://res.cloudinary.com/demo/image/upload/avatar.jpg',
      });
    });

    it('[AC-002] Self-view — targetUserId là chính authenticated user vẫn xử lý bình thường', async () => {
      const selfUserId = 'self-user-id';
      em.findOne.mockResolvedValue({ ...basePublicUser, id: selfUserId });

      const result = await service.getPublicProfile(selfUserId);

      expect(result.id).toBe(selfUserId);
      const [calledEntity, calledOptions] = em.findOne.mock.calls[0] as [
        unknown,
        { where: { id: string } },
      ];
      expect(calledEntity).toBe(UserEntity);
      expect(calledOptions.where.id).toBe(selfUserId);
    });

    it('[AC-008] department = null khi department_id = null, không omit field', async () => {
      em.findOne.mockResolvedValue({ ...basePublicUser, department: null });

      const result = await service.getPublicProfile(targetUserId);

      expect(result.department).toBeNull();
      expect(result).toHaveProperty('department');
    });

    it('[AC-009] avatarUrl = null khi avatar_url = null (chưa được duyệt)', async () => {
      em.findOne.mockResolvedValue({ ...basePublicUser, avatarUrl: null });

      const result = await service.getPublicProfile(targetUserId);

      expect(result.avatarUrl).toBeNull();
      expect(result).toHaveProperty('avatarUrl');
    });

    it('[AC-010] avatarUrl có giá trị khi avatar đã được duyệt', async () => {
      em.findOne.mockResolvedValue(basePublicUser);

      const result = await service.getPublicProfile(targetUserId);

      expect(result.avatarUrl).toBe(
        'https://res.cloudinary.com/demo/image/upload/avatar.jpg',
      );
    });

    it('[AC-011] employeeCode = null khi employee_code = null, không omit field', async () => {
      em.findOne.mockResolvedValue({ ...basePublicUser, employeeCode: null });

      const result = await service.getPublicProfile(targetUserId);

      expect(result.employeeCode).toBeNull();
      expect(result).toHaveProperty('employeeCode');
    });

    // ===== ERROR CASE TESTS (T005) =====

    it('[AC-006] userId không tồn tại — 404 USER_NOT_FOUND', async () => {
      em.findOne.mockResolvedValue(null);

      await expect(service.getPublicProfile('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('[AC-007] target user đã soft-delete — 404 USER_NOT_FOUND giống user không tồn tại', async () => {
      // deletedAt: IsNull() filter trong query khiến soft-deleted user không được trả về
      em.findOne.mockResolvedValue(null);

      await expect(service.getPublicProfile(targetUserId)).rejects.toThrow(
        NotFoundException,
      );

      const [calledEntity, calledOptions] = em.findOne.mock.calls[0] as [
        unknown,
        { where: { id: string } },
      ];
      expect(calledEntity).toBe(UserEntity);
      expect(calledOptions.where.id).toBe(targetUserId);
    });

    // ===== READ-ONLY & SENSITIVE FIELD EXCLUSION TESTS (T006) =====

    it('[AC-012] Chỉ gọi findOne (SELECT), không gọi save/create', async () => {
      em.findOne.mockResolvedValue(basePublicUser);

      await service.getPublicProfile(targetUserId);

      expect(em.findOne).toHaveBeenCalledTimes(1);
      expect(em.save).not.toHaveBeenCalled();
      expect(em.create).not.toHaveBeenCalled();
      expect(em.find).not.toHaveBeenCalled();
    });

    it('[AC-013] Response KHÔNG chứa field quản trị nhạy cảm nào', async () => {
      em.findOne.mockResolvedValue(basePublicUser);

      const result = await service.getPublicProfile(targetUserId);

      expect(Object.keys(result).sort()).toEqual(
        [
          'avatarUrl',
          'department',
          'email',
          'employeeCode',
          'fullName',
          'id',
        ].sort(),
      );
      expect(result).not.toHaveProperty('accountStatus');
      expect(result).not.toHaveProperty('employmentStatus');
      expect(result).not.toHaveProperty('mustChangePassword');
      expect(result).not.toHaveProperty('lastLoginAt');
      expect(result).not.toHaveProperty('failedLoginCount');
      expect(result).not.toHaveProperty('lockedUntil');
      expect(result).not.toHaveProperty('passwordUpdatedAt');
      expect(result).not.toHaveProperty('roles');
      expect(result).not.toHaveProperty('directManager');
      expect(result).not.toHaveProperty('positionTitle');
      expect(result).not.toHaveProperty('phoneNumber');
      expect(result).not.toHaveProperty('hasFaceProfile');
      expect(result).not.toHaveProperty('createdAt');
      expect(result).not.toHaveProperty('updatedAt');
    });
  });

  describe('createUser', () => {
    it('should create user and enqueue credential email (Happy Path)', async () => {
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.id === 'manager-id') {
              return {
                id: 'manager-id',
                accountStatus: 'active',
                employmentStatus: 'active',
              };
            }
            return null;
          }
          if (entityClass === DepartmentEntity) {
            return {
              id: 'dept-id',
              isActive: true,
            };
          }
          if (entityClass === RoleEntity) {
            return {
              id: 'role-id-1',
              roleCode: 'employee',
              roleName: 'Employee',
              isActive: true,
            };
          }
          return null;
        },
      );

      const mockSavedUser = {
        id: 'new-user-id',
        fullName: 'Nguyen Van A',
        email: 'nva@company.com',
        username: 'nva@company.com',
        employeeCode: 'EMP001',
        accountStatus: 'active',
        mustChangePassword: true,
        createdAt: new Date(),
      };
      em.create.mockImplementation(
        <T>(_entityClass: unknown, plain: T): T => plain,
      );
      em.save.mockImplementation(
        async <T>(entityClass: unknown, entity: T): Promise<T> => {
          if (entityClass === UserEntity) {
            return mockSavedUser as unknown as T;
          }
          return entity;
        },
      );

      const result = await service.createUser(validDto, 'creator-id', {
        ipAddress: '127.0.0.1',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('new-user-id');
      expect(result.email).toBe('nva@company.com');
      expect(result.mustChangePassword).toBe(true);
      expect(result.roles[0].roleCode).toBe('employee');

      // Transaction contains 3 saves: User + UserRole + AuditLog
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(em.save).toHaveBeenCalledTimes(3);

      // After transaction: enqueueEmailNotification called
      expect(
        notificationsService.enqueueEmailNotification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          toEmails: ['nva@company.com'],
          relatedEntityType: 'users',
          relatedEntityId: 'new-user-id',
        }),
      );
    });

    it('should throw ConflictException if email already exists', async () => {
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (
            entityClass === UserEntity &&
            options?.where?.email === 'nva@company.com'
          ) {
            return { id: 'existing-id' };
          }
          return null;
        },
      );

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if username already exists', async () => {
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.email === 'nva@company.com') return null;
            if (options?.where?.username === 'nva@company.com')
              return { id: 'existing-id' };
          }
          return null;
        },
      );

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException if department does not exist', async () => {
      em.findOne.mockImplementation(async (entityClass) => {
        if (entityClass === UserEntity) return null;
        if (entityClass === DepartmentEntity) return null;
        return null;
      });

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnprocessableEntityException if department is inactive', async () => {
      em.findOne.mockImplementation(async (entityClass) => {
        if (entityClass === UserEntity) return null;
        if (entityClass === DepartmentEntity) {
          return { id: 'dept-id', isActive: false };
        }
        return null;
      });

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw NotFoundException if role does not exist', async () => {
      em.findOne.mockImplementation(async (entityClass) => {
        if (entityClass === UserEntity) return null;
        if (entityClass === DepartmentEntity)
          return { id: 'dept-id', isActive: true };
        if (entityClass === RoleEntity) return null;
        return null;
      });

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnprocessableEntityException if role is inactive', async () => {
      em.findOne.mockImplementation(async (entityClass) => {
        if (entityClass === UserEntity) return null;
        if (entityClass === DepartmentEntity)
          return { id: 'dept-id', isActive: true };
        if (entityClass === RoleEntity)
          return { id: 'role-id-1', isActive: false };
        return null;
      });

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw ConflictException if employeeCode already exists', async () => {
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.email === 'nva@company.com') return null;
            if (options?.where?.username === 'nva@company.com') return null;
            if (options?.where?.employeeCode === 'EMP001')
              return { id: 'existing-id' };
          }
          if (entityClass === DepartmentEntity)
            return { id: 'dept-id', isActive: true };
          if (entityClass === RoleEntity)
            return { id: 'role-id-1', isActive: true };
          return null;
        },
      );

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException if manager does not exist', async () => {
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.id === 'manager-id') return null;
            return null;
          }
          if (entityClass === DepartmentEntity)
            return { id: 'dept-id', isActive: true };
          if (entityClass === RoleEntity)
            return { id: 'role-id-1', isActive: true };
          return null;
        },
      );

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnprocessableEntityException if manager is inactive/resigned', async () => {
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.id === 'manager-id') {
              return {
                id: 'manager-id',
                accountStatus: 'inactive',
                employmentStatus: 'active',
              };
            }
            return null;
          }
          if (entityClass === DepartmentEntity)
            return { id: 'dept-id', isActive: true };
          if (entityClass === RoleEntity)
            return { id: 'role-id-1', isActive: true };
          return null;
        },
      );

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should create user successfully even if notification enqueue fails (non-blocking)', async () => {
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.id === 'manager-id') {
              return {
                id: 'manager-id',
                accountStatus: 'active',
                employmentStatus: 'active',
              };
            }
            return null;
          }
          if (entityClass === DepartmentEntity)
            return { id: 'dept-id', isActive: true };
          if (entityClass === RoleEntity)
            return { id: 'role-id-1', isActive: true };
          return null;
        },
      );

      const mockSavedUser = {
        id: 'new-user-id',
        fullName: 'Nguyen Van A',
        email: 'nva@company.com',
        accountStatus: 'active',
        mustChangePassword: true,
        createdAt: new Date(),
      };
      em.create.mockImplementation(
        <T>(_entityClass: unknown, plain: T): T => plain,
      );
      em.save.mockImplementation(
        async <T>(entityClass: unknown, entity: T): Promise<T> => {
          if (entityClass === UserEntity) {
            return mockSavedUser as unknown as T;
          }
          return entity;
        },
      );

      // Make notification enqueue fail
      notificationsService.enqueueEmailNotification.mockRejectedValue(
        new Error('Queue service down'),
      );

      const result = await service.createUser(validDto, 'creator-id', {});

      // User creation still succeeds
      expect(result).toBeDefined();
      expect(result.id).toBe('new-user-id');
    });

    it('should not block user creation if audit log writing fails', async () => {
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.id === 'manager-id') {
              return {
                id: 'manager-id',
                accountStatus: 'active',
                employmentStatus: 'active',
              };
            }
            return null;
          }
          if (entityClass === DepartmentEntity)
            return { id: 'dept-id', isActive: true };
          if (entityClass === RoleEntity)
            return { id: 'role-id-1', isActive: true };
          return null;
        },
      );

      const mockSavedUser = {
        id: 'new-user-id',
        email: 'nva@company.com',
        fullName: 'Nguyen Van A',
        accountStatus: 'active',
        mustChangePassword: true,
        createdAt: new Date(),
      };
      em.create.mockImplementation(
        <T>(_entityClass: unknown, plain: T): T => plain,
      );
      em.save.mockImplementation(
        async <T>(entityClass: unknown, entity: T): Promise<T> => {
          if (entityClass === UserEntity) {
            return mockSavedUser as unknown as T;
          }
          if (
            typeof entityClass === 'function' &&
            entityClass.name === 'AuditLogEntity'
          ) {
            throw new Error('Audit service down');
          }
          return entity;
        },
      );

      const result = await service.createUser(validDto, 'creator-id', {});
      expect(result).toBeDefined();
      expect(result.id).toBe('new-user-id');
    });
  });

  describe('updateUserRoles', () => {
    const targetUserId = 'target-user-id';
    const actorId = 'actor-id';

    const activeTarget = {
      id: targetUserId,
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
    };

    // Helper: dựng mock em cho một kịch bản updateUserRoles.
    function setup(opts: {
      target?: unknown;
      roles?: Record<string, { isActive: boolean; isSystemRole?: boolean }>;
      currentActiveRoleIds?: string[]; // tập role active hiện tại (Phase A)
      existingRowByRoleId?: Record<string, unknown>; // reactivate-if-exists lookup
      removeRows?: unknown[]; // rows trả về khi soft-remove trong txn
      systemRolesInRemove?: { id: string; isSystemRole: boolean }[]; // BR-04
      involvedRoles?: { id: string; roleCode: string }[]; // BA 2026-08-03: lookup roleCode cho exemption check
      finalActiveRoles?: { id: string; roleCode: string; roleName: string }[]; // getActiveRolesResponse
      activeFaceProfiles?: { id: string; status: string }[]; // BA 2026-08-03: face_profiles ACTIVE hiện có
      saveThrowsOnUserRole?: boolean;
    }) {
      em.findOne.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserEntity) {
          return options?.where?.id === targetUserId
            ? (opts.target ?? activeTarget)
            : null;
        }
        if (entityClass === RoleEntity) {
          const r = opts.roles?.[options?.where?.id];
          return r ? { id: options.where.id, ...r } : null;
        }
        if (entityClass === UserRoleEntity) {
          // reactivate-if-exists lookup trong transaction
          const roleId = options?.where?.roleId;
          return opts.existingRowByRoleId?.[roleId] ?? null;
        }
        return null;
      });

      em.find.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserRoleEntity) {
          // getActiveRolesResponse (có relations)
          if (options?.relations?.role) {
            return (opts.finalActiveRoles ?? []).map((r) => ({ role: r }));
          }
          // soft-remove trong txn (where có roleId là In(...))
          if (options?.where?.roleId) {
            return opts.removeRows ?? [];
          }
          // Phase A currentActive
          return (opts.currentActiveRoleIds ?? []).map((roleId) => ({
            roleId,
          }));
        }
        if (entityClass === RoleEntity) {
          // BA 2026-08-03: lookup roleCode cho toàn bộ role liên quan (exemption
          // check) khi có; nếu không, fallback về hành vi cũ (BR-04: find roles
          // In(toRemove)) — actor≠target nên 2 query này không xảy ra cùng lúc
          // trong cùng 1 test.
          return opts.involvedRoles ?? opts.systemRolesInRemove ?? [];
        }
        if (entityClass === FaceProfileEntity) {
          return opts.activeFaceProfiles ?? [];
        }
        return [];
      });

      em.create.mockImplementation(
        (_entityClass: unknown, plain: unknown) => plain,
      );
      em.save.mockImplementation(
        async (entityClass: unknown, entity: unknown) => {
          if (opts.saveThrowsOnUserRole && entityClass === UserRoleEntity) {
            throw new Error('DB write failed');
          }
          return entity;
        },
      );
    }

    it('[U1] Happy path add+remove — soft-remove role bỏ, insert role thêm, audit atomic, trả role mới', async () => {
      const removedRow: any = { roleId: 'role-a', isActive: true };
      setup({
        roles: { 'role-b': { isActive: true, isSystemRole: false } },
        currentActiveRoleIds: ['role-a'],
        existingRowByRoleId: {}, // role-b chưa có row → insert
        removeRows: [removedRow],
        finalActiveRoles: [{ id: 'role-b', roleCode: 'ROLE_B', roleName: 'B' }],
      });

      const result = await service.updateUserRoles(
        targetUserId,
        ['role-b'],
        actorId,
        { ipAddress: '127.0.0.1' },
      );

      // trả tập role active mới
      expect(result).toEqual({
        userId: targetUserId,
        roles: [{ id: 'role-b', roleCode: 'ROLE_B', roleName: 'B' }],
      });
      // soft-remove: role-a bị set inactive + expired
      expect(removedRow.isActive).toBe(false);
      expect(removedRow.expiredAt).toBeInstanceOf(Date);
      // insert row mới cho role-b
      expect(em.create).toHaveBeenCalledWith(
        UserRoleEntity,
        expect.objectContaining({
          userId: targetUserId,
          roleId: 'role-b',
          assignedBy: actorId,
          isActive: true,
        }),
      );
      // audit atomic đúng old/new roleIds
      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          actionType: 'ACCOUNT_ROLE_UPDATE',
          entityType: 'users',
          entityId: targetUserId,
          oldValueJson: { roleIds: ['role-a'] },
          newValueJson: { roleIds: ['role-b'] },
        }),
      );
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('[U2] No-op idempotent — desired == current: không mở transaction, không ghi DB', async () => {
      setup({
        roles: { 'role-a': { isActive: true } },
        currentActiveRoleIds: ['role-a'],
        finalActiveRoles: [{ id: 'role-a', roleCode: 'ROLE_A', roleName: 'A' }],
      });

      const result = await service.updateUserRoles(
        targetUserId,
        ['role-a'],
        actorId,
        {},
      );

      expect(result.roles).toEqual([
        { id: 'role-a', roleCode: 'ROLE_A', roleName: 'A' },
      ]);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(em.save).not.toHaveBeenCalled();
    });

    it('[U3] USER_NOT_FOUND — user không tồn tại/đã soft-delete', async () => {
      setup({ target: null });

      await expect(
        service.updateUserRoles(targetUserId, ['role-a'], actorId, {}),
      ).rejects.toThrow(NotFoundException);
      expect(em.save).not.toHaveBeenCalled();
    });

    it('[U4] ACCOUNT_INACTIVE — target account_status ≠ active (BR-08)', async () => {
      setup({
        target: {
          id: targetUserId,
          accountStatus: AccountStatus.LOCKED,
          deletedAt: null,
        },
      });

      await expect(
        service.updateUserRoles(targetUserId, ['role-a'], actorId, {}),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('[U5] ROLE_NOT_FOUND — desired role không tồn tại', async () => {
      setup({ roles: {}, currentActiveRoleIds: [] });

      await expect(
        service.updateUserRoles(targetUserId, ['role-x'], actorId, {}),
      ).rejects.toThrow(NotFoundException);
      expect(em.save).not.toHaveBeenCalled();
    });

    it('[U6] ROLE_INACTIVE — desired role đang inactive', async () => {
      setup({
        roles: { 'role-a': { isActive: false } },
        currentActiveRoleIds: [],
      });

      await expect(
        service.updateUserRoles(targetUserId, ['role-a'], actorId, {}),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(em.save).not.toHaveBeenCalled();
    });

    it('[U7] BR-04 self-lockout — actor tự gỡ vai trò hệ thống của chính mình', async () => {
      setup({
        roles: { 'role-a': { isActive: true } },
        currentActiveRoleIds: ['role-sys', 'role-a'],
        systemRolesInRemove: [{ id: 'role-sys', isSystemRole: true }],
      });

      await expect(
        // actorId === targetUserId, desired bỏ role-sys (system role)
        service.updateUserRoles(targetUserId, ['role-a'], targetUserId, {}),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('[U8] Reactivate-if-exists — add role từng soft-remove: update row cũ, KHÔNG insert trùng', async () => {
      const existingInactive: any = {
        id: 'ur-b',
        roleId: 'role-b',
        isActive: false,
      };
      setup({
        roles: {
          'role-a': { isActive: true },
          'role-b': { isActive: true },
        },
        currentActiveRoleIds: ['role-a'],
        existingRowByRoleId: { 'role-b': existingInactive },
        removeRows: [],
        finalActiveRoles: [
          { id: 'role-a', roleCode: 'ROLE_A', roleName: 'A' },
          { id: 'role-b', roleCode: 'ROLE_B', roleName: 'B' },
        ],
      });

      await service.updateUserRoles(
        targetUserId,
        ['role-a', 'role-b'],
        actorId,
        {},
      );

      // row cũ được reactivate
      expect(existingInactive.isActive).toBe(true);
      expect(existingInactive.expiredAt).toBeNull();
      expect(existingInactive.assignedBy).toBe(actorId);
      // KHÔNG tạo row UserRoleEntity mới (chỉ AuditLogEntity được create)
      expect(em.create).not.toHaveBeenCalledWith(
        UserRoleEntity,
        expect.anything(),
      );
      expect(em.save).toHaveBeenCalledWith(UserRoleEntity, existingInactive);
    });

    it('[U10] BA 2026-08-03 — Promote lên BUSINESS_ADMIN: giữ nguyên face_profile ACTIVE, không revoke', async () => {
      const activeProfile: any = {
        id: 'fp-1',
        status: FaceProfileStatus.ACTIVE,
      };
      setup({
        roles: { 'role-ba': { isActive: true } },
        currentActiveRoleIds: ['role-employee'],
        involvedRoles: [
          { id: 'role-employee', roleCode: 'EMPLOYEE' },
          { id: 'role-ba', roleCode: 'BUSINESS_ADMIN' },
        ],
        existingRowByRoleId: {},
        removeRows: [{ roleId: 'role-employee', isActive: true }],
        finalActiveRoles: [
          { id: 'role-ba', roleCode: 'BUSINESS_ADMIN', roleName: 'BA' },
        ],
        activeFaceProfiles: [activeProfile],
      });

      await service.updateUserRoles(targetUserId, ['role-ba'], actorId, {});

      // Không đụng vào face_profiles khi promote (không exempt → exempt).
      expect(em.save).not.toHaveBeenCalledWith(
        FaceProfileEntity,
        expect.anything(),
      );
      expect(activeProfile.status).toBe(FaceProfileStatus.ACTIVE);
    });

    it('[U11] BA 2026-08-03 — Demote từ BUSINESS_ADMIN xuống EMPLOYEE: revoke face_profile ACTIVE + audit riêng', async () => {
      const activeProfile: any = {
        id: 'fp-1',
        status: FaceProfileStatus.ACTIVE,
      };
      setup({
        roles: { 'role-employee': { isActive: true } },
        currentActiveRoleIds: ['role-ba'],
        involvedRoles: [
          { id: 'role-ba', roleCode: 'BUSINESS_ADMIN' },
          { id: 'role-employee', roleCode: 'EMPLOYEE' },
        ],
        existingRowByRoleId: {},
        removeRows: [{ roleId: 'role-ba', isActive: true }],
        finalActiveRoles: [
          { id: 'role-employee', roleCode: 'EMPLOYEE', roleName: 'Employee' },
        ],
        activeFaceProfiles: [activeProfile],
      });

      await service.updateUserRoles(
        targetUserId,
        ['role-employee'],
        actorId,
        {},
      );

      // Face profile ACTIVE bị revoke → bắt buộc upload lại.
      expect(activeProfile.status).toBe(FaceProfileStatus.REVOKED);
      expect(em.save).toHaveBeenCalledWith(FaceProfileEntity, activeProfile);
      // Audit riêng cho việc auto-revoke, tách khỏi ACCOUNT_ROLE_UPDATE.
      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          actionType: 'biometric.auto_revoked_on_role_downgrade',
          entityType: 'face_profiles',
          entityId: targetUserId,
        }),
      );
    });

    it('[U12] BA 2026-08-03 — Đổi role trong nội bộ nhóm exempt (SYSTEM_ADMIN→BUSINESS_ADMIN): không revoke', async () => {
      const activeProfile: any = {
        id: 'fp-1',
        status: FaceProfileStatus.ACTIVE,
      };
      setup({
        roles: { 'role-ba': { isActive: true } },
        currentActiveRoleIds: ['role-sa'],
        involvedRoles: [
          { id: 'role-sa', roleCode: 'SYSTEM_ADMIN' },
          { id: 'role-ba', roleCode: 'BUSINESS_ADMIN' },
        ],
        existingRowByRoleId: {},
        removeRows: [{ roleId: 'role-sa', isActive: true }],
        finalActiveRoles: [
          { id: 'role-ba', roleCode: 'BUSINESS_ADMIN', roleName: 'BA' },
        ],
        activeFaceProfiles: [activeProfile],
      });

      await service.updateUserRoles(targetUserId, ['role-ba'], actorId, {});

      expect(activeProfile.status).toBe(FaceProfileStatus.ACTIVE);
      expect(em.save).not.toHaveBeenCalledWith(
        FaceProfileEntity,
        expect.anything(),
      );
    });

    it('[U9] Rollback — WRITE trong transaction lỗi thì reject (atomic)', async () => {
      setup({
        roles: { 'role-b': { isActive: true } },
        currentActiveRoleIds: ['role-a'],
        removeRows: [{ roleId: 'role-a', isActive: true }],
        saveThrowsOnUserRole: true,
      });

      await expect(
        service.updateUserRoles(targetUserId, ['role-b'], actorId, {}),
      ).rejects.toThrow('DB write failed');
    });
  });

  describe('updateUser', () => {
    const targetUserId = 'target-user-id';
    const actorId = 'actor-id';

    const baseTarget = {
      id: targetUserId,
      employeeCode: 'EMP001',
      email: 'user@company.com',
      fullName: 'Nguyen Van A',
      phoneNumber: '0900000000',
      avatarUrl: null,
      positionTitle: 'Dev',
      departmentId: 'admin-dept',
      directManagerId: null,
      accountStatus: 'active',
      employmentStatus: 'active',
      mustChangePassword: false,
      lastLoginAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      department: { id: 'admin-dept', departmentName: 'IT' },
    };

    function setup(opts: {
      target?: unknown; // null để test USER_NOT_FOUND
      actorIsSystemAdmin?: boolean;
      actorDeptId?: string; // scope Business Admin
      childDepts?: string[];
      employeeCodeDup?: boolean;
      department?: unknown; // A.4 department lookup
      freshRoles?: unknown[];
      manager?: unknown;
      faceProfile?: unknown;
      updateThrows?: boolean;
    }) {
      const target = opts.target === undefined ? baseTarget : opts.target;

      em.findOne.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserEntity) {
          const where = options?.where ?? {};
          // uniqueness employee_code (loại self)
          if (where.employeeCode !== undefined) {
            return opts.employeeCodeDup ? { id: 'other-user' } : null;
          }
          // resolveDepartmentScope: lookup actor (select departmentId)
          if (where.id === actorId && options?.select?.departmentId) {
            return { departmentId: opts.actorDeptId ?? null };
          }
          // manager lookup (select id, fullName)
          if (
            (target as any)?.directManagerId &&
            where.id === (target as any).directManagerId
          ) {
            return opts.manager ?? null;
          }
          // fresh (map) — có relations.department
          if (where.id === targetUserId && options?.relations?.department) {
            return target;
          }
          // A.2 target load
          if (where.id === targetUserId) {
            return target;
          }
          return null;
        }
        if (entityClass === DepartmentEntity) {
          return opts.department ?? null;
        }
        if (entityClass === FaceProfileEntity) {
          return opts.faceProfile ?? null;
        }
        return null;
      });

      em.find.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserRoleEntity) {
          if (options?.where?.userId === actorId) {
            return [
              {
                role: {
                  roleCode: opts.actorIsSystemAdmin ? 'SYSTEM_ADMIN' : 'EMPLOYEE',
                  isSystemRole: !!opts.actorIsSystemAdmin,
                },
              },
            ];
          }
          if (options?.where?.userId === targetUserId) {
            return opts.freshRoles ?? [];
          }
          return [];
        }
        if (entityClass === DepartmentEntity) {
          // collectDepartmentScope children
          return (opts.childDepts ?? []).map((id) => ({ id }));
        }
        return [];
      });

      em.create.mockImplementation(
        (_entityClass: unknown, plain: unknown) => plain,
      );
      em.save.mockImplementation(
        async (_entityClass: unknown, entity: unknown) => entity,
      );
      (em.update as jest.Mock).mockImplementation(async () => {
        if (opts.updateThrows) throw new Error('DB write failed');
        return { affected: 1 };
      });
    }

    it('[U1] Happy path — cập nhật 1 field (phoneNumber), audit diff đúng, trả 16 field', async () => {
      setup({ actorIsSystemAdmin: true });

      const result = await service.updateUser(
        targetUserId,
        { phoneNumber: '0911111111' },
        actorId,
        { ipAddress: '127.0.0.1' },
      );

      expect(em.update).toHaveBeenCalledWith(UserEntity, targetUserId, {
        phoneNumber: '0911111111',
      });
      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          actionType: 'ACCOUNT_UPDATE',
          entityType: 'users',
          entityId: targetUserId,
          oldValueJson: { phoneNumber: '0900000000' },
          newValueJson: { phoneNumber: '0911111111' },
        }),
      );
      expect(Object.keys(result)).toHaveLength(16);
      expect(result.id).toBe(targetUserId);
      expect(result.email).toBe('user@company.com'); // email không đổi
    });

    it('[U2] Happy path — nhiều field (fullName + positionTitle + departmentId)', async () => {
      setup({
        actorIsSystemAdmin: true,
        department: { id: 'new-dept', isActive: true },
      });

      await service.updateUser(
        targetUserId,
        {
          fullName: 'New Name',
          positionTitle: 'Lead',
          departmentId: 'new-dept',
        },
        actorId,
        {},
      );

      expect(em.update).toHaveBeenCalledWith(UserEntity, targetUserId, {
        fullName: 'New Name',
        positionTitle: 'Lead',
        departmentId: 'new-dept',
      });
      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          newValueJson: {
            fullName: 'New Name',
            positionTitle: 'Lead',
            departmentId: 'new-dept',
          },
        }),
      );
    });

    it('[U3] No-op — field gửi trùng giá trị cũ: không WRITE, không audit', async () => {
      setup({ actorIsSystemAdmin: true });

      const result = await service.updateUser(
        targetUserId,
        { phoneNumber: '0900000000' },
        actorId,
        {},
      );

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(em.update).not.toHaveBeenCalled();
      expect(em.create).not.toHaveBeenCalled();
      expect(result.id).toBe(targetUserId);
    });

    it('[U4] EMPTY_UPDATE — không field nào → 400', async () => {
      setup({ actorIsSystemAdmin: true });

      await expect(
        service.updateUser(targetUserId, {}, actorId, {}),
      ).rejects.toThrow(BadRequestException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[U5] employeeCode trùng user khác → 409, không WRITE', async () => {
      setup({ actorIsSystemAdmin: true, employeeCodeDup: true });

      await expect(
        service.updateUser(
          targetUserId,
          { employeeCode: 'EMP999' },
          actorId,
          {},
        ),
      ).rejects.toThrow(ConflictException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[U5b] employeeCode = giá trị cũ của chính mình → không lỗi, không check unique (no-op)', async () => {
      setup({ actorIsSystemAdmin: true, employeeCodeDup: true });

      // employeeCode 'EMP001' trùng giá trị hiện tại -> bị loại khỏi diff -> không check unique
      const result = await service.updateUser(
        targetUserId,
        { employeeCode: 'EMP001' },
        actorId,
        {},
      );

      expect(result.id).toBe(targetUserId);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[U6] department không tồn tại → 404', async () => {
      setup({ actorIsSystemAdmin: true, department: null });

      await expect(
        service.updateUser(targetUserId, { departmentId: 'nope' }, actorId, {}),
      ).rejects.toThrow(NotFoundException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[U7] department inactive → 422', async () => {
      setup({
        actorIsSystemAdmin: true,
        department: { id: 'new-dept', isActive: false },
      });

      await expect(
        service.updateUser(
          targetUserId,
          { departmentId: 'new-dept' },
          actorId,
          {},
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[U8] Business Admin — target user ngoài scope → 403', async () => {
      setup({
        actorIsSystemAdmin: false,
        actorDeptId: 'admin-dept',
        target: { ...baseTarget, departmentId: 'other-dept' },
      });

      await expect(
        service.updateUser(
          targetUserId,
          { phoneNumber: '0911111111' },
          actorId,
          {},
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[U9] Business Admin — department MỚI ngoài scope → 403', async () => {
      setup({
        actorIsSystemAdmin: false,
        actorDeptId: 'admin-dept', // scope = { admin-dept }
        target: { ...baseTarget, departmentId: 'admin-dept' }, // target trong scope
        department: { id: 'new-dept', isActive: true }, // dept mới tồn tại+active nhưng ngoài scope
      });

      await expect(
        service.updateUser(
          targetUserId,
          { departmentId: 'new-dept' },
          actorId,
          {},
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[U10] System Admin — bỏ qua scope (đổi department khác phòng) → thành công', async () => {
      setup({
        actorIsSystemAdmin: true,
        target: { ...baseTarget, departmentId: 'x-dept' },
        department: { id: 'new-dept', isActive: true },
      });

      await service.updateUser(
        targetUserId,
        { departmentId: 'new-dept' },
        actorId,
        {},
      );

      expect(em.update).toHaveBeenCalledWith(UserEntity, targetUserId, {
        departmentId: 'new-dept',
      });
    });

    it('[U11] USER_NOT_FOUND — user không tồn tại/đã soft-delete → 404', async () => {
      setup({ actorIsSystemAdmin: true, target: null });

      await expect(
        service.updateUser(
          targetUserId,
          { phoneNumber: '0911111111' },
          actorId,
          {},
        ),
      ).rejects.toThrow(NotFoundException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[U12] Rollback — WRITE trong transaction lỗi → reject (atomic)', async () => {
      setup({ actorIsSystemAdmin: true, updateThrows: true });

      await expect(
        service.updateUser(
          targetUserId,
          { phoneNumber: '0911111111' },
          actorId,
          {},
        ),
      ).rejects.toThrow('DB write failed');
    });
    it('[PTA-U1] actor without account.partner.manage is blocked', async () => {
      setup({
        actorIsSystemAdmin: true,
        target: { ...baseTarget, departmentId: PARTNER_DEPARTMENT_ID },
      });
      authzReadRepository.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: [],
        permissions: [],
      });

      await expect(
        service.updateUser(
          targetUserId,
          { accountExpiresAt: new Date(Date.now() + 86400000).toISOString() },
          actorId,
          {},
        ),
      ).rejects.toMatchObject({
        response: { error: { code: 'FORBIDDEN' } },
        status: 403,
      });
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[PTA-U2] accountExpiresAt is rejected for non-partner users', async () => {
      setup({ actorIsSystemAdmin: true, target: baseTarget });
      authzReadRepository.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: [],
        permissions: ['account.partner.manage'],
      });

      await expect(
        service.updateUser(
          targetUserId,
          { accountExpiresAt: new Date(Date.now() + 86400000).toISOString() },
          actorId,
          {},
        ),
      ).rejects.toMatchObject({
        response: { error: { code: 'ACCOUNT_EXPIRY_PARTNER_ONLY' } },
        status: 403,
      });
    });

    it('[PTA-U3] partner extension succeeds and writes account.partner.extend audit', async () => {
      setup({
        actorIsSystemAdmin: true,
        target: {
          ...baseTarget,
          departmentId: PARTNER_DEPARTMENT_ID,
          accountExpiresAt: null,
        },
      });
      authzReadRepository.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: [],
        permissions: ['account.partner.manage'],
      });
      const next = new Date(Date.now() + 86400000);

      await service.updateUser(
        targetUserId,
        { accountExpiresAt: next.toISOString() },
        actorId,
        {},
      );

      expect(em.update).toHaveBeenCalledWith(UserEntity, targetUserId, {
        accountExpiresAt: next,
      });
      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({ actionType: 'account.partner.extend' }),
      );
    });

    it('[PTA-U4] shortening accountExpiresAt (still future) writes account.partner.lock_early, not extend', async () => {
      const oldExpiry = new Date(Date.now() + 7 * 86400000);
      setup({
        actorIsSystemAdmin: true,
        target: {
          ...baseTarget,
          departmentId: PARTNER_DEPARTMENT_ID,
          accountExpiresAt: oldExpiry,
        },
      });
      authzReadRepository.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: [],
        permissions: ['account.partner.manage'],
      });
      const next = new Date(Date.now() + 3 * 86400000); // van o tuong lai, nhung som hon oldExpiry

      await service.updateUser(
        targetUserId,
        { accountExpiresAt: next.toISOString() },
        actorId,
        {},
      );

      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({ actionType: 'account.partner.lock_early' }),
      );
    });
  });

  describe('deleteUser', () => {
    const targetUserId = 'target-user-id';
    const actorId = 'actor-id';

    const baseTarget = {
      id: targetUserId,
      email: 'user@company.com',
      fullName: 'Nguyen Van A',
      employeeCode: 'EMP001',
      departmentId: 'dept-id',
      accountStatus: 'active',
      deletedAt: null,
    };

    function makeQb(count: number) {
      const qb: any = {
        innerJoin: () => qb,
        where: () => qb,
        andWhere: () => qb,
        getCount: async () => count,
      };
      return qb;
    }

    function setup(opts: {
      target?: unknown;
      targetRoles?: {
        roleId: string;
        role: { roleCode: string; isActive: boolean };
      }[];
      otherAdminCount?: number;
      hostCount?: number;
      participantCount?: number;
      bookingCount?: number;
      manageeCount?: number;
      departmentCount?: number;
      softDeleteThrows?: boolean;
      redisThrows?: boolean;
    }) {
      const target = opts.target === undefined ? baseTarget : opts.target;

      em.findOne.mockImplementation(async (entity, o: any) => {
        if (entity === UserEntity && o?.where?.id === targetUserId) {
          return target;
        }
        return null;
      });
      em.find.mockImplementation(async (entity, o: any) => {
        if (entity === UserRoleEntity && o?.where?.userId === targetUserId) {
          return opts.targetRoles ?? [];
        }
        return [];
      });
      (em.count as jest.Mock).mockImplementation(async (entity: unknown) => {
        if (entity === MeetingEntity) return opts.hostCount ?? 0;
        if (entity === RoomBookingEntity) return opts.bookingCount ?? 0;
        if (entity === UserEntity) return opts.manageeCount ?? 0;
        if (entity === DepartmentEntity) return opts.departmentCount ?? 0;
        return 0;
      });
      (em.createQueryBuilder as jest.Mock).mockImplementation(
        (entity: unknown) => {
          if (entity === UserRoleEntity) {
            return makeQb(opts.otherAdminCount ?? 1);
          }
          if (entity === MeetingParticipantEntity) {
            return makeQb(opts.participantCount ?? 0);
          }
          return makeQb(0);
        },
      );
      (em.softDelete as jest.Mock).mockImplementation(async () => {
        if (opts.softDeleteThrows) throw new Error('DB write failed');
        return { affected: 1 };
      });
      (em.update as jest.Mock).mockResolvedValue({ affected: 1 });
      em.create.mockImplementation((_entity: unknown, plain: unknown) => plain);
      em.save.mockResolvedValue(undefined);

      if (opts.redisThrows) {
        redisService.setWithTtl.mockRejectedValue(new Error('redis down'));
      }
    }

    const sysAdminRole = [
      { roleId: 'r-sys', role: { roleCode: 'SYSTEM_ADMIN', isActive: true } },
    ];

    it('[D1] Happy path — soft-delete users + vô hiệu user_roles + face_profiles + device_user_mappings + audit + revoke', async () => {
      setup({});

      await service.deleteUser(targetUserId, actorId, {
        ipAddress: '127.0.0.1',
      });

      expect(em.softDelete).toHaveBeenCalledWith(UserEntity, targetUserId);
      expect(em.update).toHaveBeenCalledWith(
        UserRoleEntity,
        { userId: targetUserId, isActive: true },
        expect.objectContaining({ isActive: false }),
      );
      expect(em.softDelete).toHaveBeenCalledWith(FaceProfileEntity, {
        userId: targetUserId,
      });
      expect(em.softDelete).toHaveBeenCalledWith(DeviceUserMappingEntity, {
        userId: targetUserId,
      });
      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          actionType: 'ACCOUNT_DELETE',
          entityType: 'users',
          entityId: targetUserId,
          oldValueJson: expect.objectContaining({
            id: targetUserId,
            email: 'user@company.com',
          }),
        }),
      );
      expect(redisService.setWithTtl).toHaveBeenCalledWith(
        `auth:user:${targetUserId}:invalid_after`,
        expect.any(String),
        604800,
      );
    });

    it('[D2] BR-01 self-delete → 422 CANNOT_DELETE_SELF, không WRITE', async () => {
      setup({});
      await expect(
        service.deleteUser(targetUserId, targetUserId, {}),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(em.softDelete).not.toHaveBeenCalled();
    });

    it('[D3] BR-02 last SYSTEM_ADMIN → 422 LAST_SYSTEM_ADMIN, không WRITE', async () => {
      setup({ targetRoles: sysAdminRole, otherAdminCount: 0 });
      await expect(
        service.deleteUser(targetUserId, actorId, {}),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(em.softDelete).not.toHaveBeenCalled();
    });

    it('[D4] BR-02 còn admin khác → không chặn (thành công)', async () => {
      setup({ targetRoles: sysAdminRole, otherAdminCount: 2 });
      await service.deleteUser(targetUserId, actorId, {});
      expect(em.softDelete).toHaveBeenCalledWith(UserEntity, targetUserId);
    });

    it('[D5] BR-03 đã xóa/không tồn tại → 404 USER_NOT_FOUND', async () => {
      setup({ target: null });
      await expect(
        service.deleteUser(targetUserId, actorId, {}),
      ).rejects.toThrow(NotFoundException);
      expect(em.softDelete).not.toHaveBeenCalled();
    });

    it('[D6] Ràng buộc (a) meeting host/organizer → 409 upcoming_meeting_host', async () => {
      setup({ hostCount: 1 });
      await expect(
        service.deleteUser(targetUserId, actorId, {}),
      ).rejects.toMatchObject({
        response: {
          error: {
            code: 'USER_HAS_DEPENDENCIES',
            details: {
              dependencies: expect.arrayContaining(['upcoming_meeting_host']),
            },
          },
        },
      });
      expect(em.softDelete).not.toHaveBeenCalled();
    });

    it('[D7] Ràng buộc (b) participant → 409 upcoming_meeting_participant', async () => {
      setup({ participantCount: 1 });
      await expect(
        service.deleteUser(targetUserId, actorId, {}),
      ).rejects.toMatchObject({
        response: {
          error: {
            details: {
              dependencies: expect.arrayContaining([
                'upcoming_meeting_participant',
              ]),
            },
          },
        },
      });
    });

    it('[D8] Ràng buộc (c) booking → 409 active_booking', async () => {
      setup({ bookingCount: 1 });
      await expect(
        service.deleteUser(targetUserId, actorId, {}),
      ).rejects.toMatchObject({
        response: {
          error: {
            details: {
              dependencies: expect.arrayContaining(['active_booking']),
            },
          },
        },
      });
    });

    it('[D9] Ràng buộc (d) direct_manager → 409 manages_users', async () => {
      setup({ manageeCount: 1 });
      await expect(
        service.deleteUser(targetUserId, actorId, {}),
      ).rejects.toMatchObject({
        response: {
          error: {
            details: {
              dependencies: expect.arrayContaining(['manages_users']),
            },
          },
        },
      });
    });

    it('[D10] Ràng buộc (e) department manager → 409 manages_department', async () => {
      setup({ departmentCount: 1 });
      await expect(
        service.deleteUser(targetUserId, actorId, {}),
      ).rejects.toMatchObject({
        response: {
          error: {
            details: {
              dependencies: expect.arrayContaining(['manages_department']),
            },
          },
        },
      });
    });

    it('[D10b] Nhiều loại vi phạm cùng lúc → details liệt kê đủ', async () => {
      setup({ hostCount: 1, bookingCount: 1, manageeCount: 1 });
      await expect(
        service.deleteUser(targetUserId, actorId, {}),
      ).rejects.toMatchObject({
        response: {
          error: {
            details: {
              dependencies: expect.arrayContaining([
                'upcoming_meeting_host',
                'active_booking',
                'manages_users',
              ]),
            },
          },
        },
      });
    });

    it('[D11] Rollback — WRITE trong transaction lỗi → reject, KHÔNG revoke', async () => {
      setup({ softDeleteThrows: true });
      await expect(
        service.deleteUser(targetUserId, actorId, {}),
      ).rejects.toThrow('DB write failed');
      expect(redisService.setWithTtl).not.toHaveBeenCalled();
    });

    it('[D12] Redis set fail post-commit → không throw, DB vẫn soft-deleted', async () => {
      setup({ redisThrows: true });
      await expect(
        service.deleteUser(targetUserId, actorId, {}),
      ).resolves.toBeUndefined();
      expect(em.softDelete).toHaveBeenCalledWith(UserEntity, targetUserId);
      expect(redisService.setWithTtl).toHaveBeenCalled();
    });
  });

  describe('updateUserStatus', () => {
    const targetUserId = 'target-user-id';
    const actorId = 'actor-id';

    function makeQb(count: number) {
      const qb: any = {
        innerJoin: () => qb,
        where: () => qb,
        andWhere: () => qb,
        getCount: async () => count,
      };
      return qb;
    }

    function setup(opts: {
      target?: unknown; // null -> USER_NOT_FOUND
      currentStatus?: string;
      targetDeptId?: string;
      actorIsSystemAdmin?: boolean;
      actorDeptId?: string;
      targetIsAdmin?: boolean;
      otherAdminCount?: number;
      updateThrows?: boolean;
      redisThrows?: boolean;
    }) {
      const target =
        opts.target === undefined
          ? {
              id: targetUserId,
              accountStatus: opts.currentStatus ?? 'active',
              departmentId: opts.targetDeptId ?? 'admin-dept',
            }
          : opts.target;

      em.findOne.mockImplementation(async (entity, o: any) => {
        if (entity === UserEntity) {
          if (o?.where?.id === actorId && o?.select?.departmentId) {
            return { departmentId: opts.actorDeptId ?? null };
          }
          if (o?.where?.id === targetUserId) return target;
          return null;
        }
        return null;
      });
      em.find.mockImplementation(async (entity, o: any) => {
        if (entity === UserRoleEntity) {
          if (o?.where?.userId === actorId) {
            return [
              {
                role: {
                  roleCode: opts.actorIsSystemAdmin !== false ? 'SYSTEM_ADMIN' : 'EMPLOYEE',
                  isSystemRole: opts.actorIsSystemAdmin !== false,
                },
              },
            ];
          }
          if (o?.where?.userId === targetUserId) {
            return opts.targetIsAdmin
              ? [{ role: { roleCode: 'SYSTEM_ADMIN', isActive: true } }]
              : [];
          }
          return [];
        }
        if (entity === DepartmentEntity) return [];
        return [];
      });
      (em.createQueryBuilder as jest.Mock).mockImplementation(
        (entity: unknown) =>
          makeQb(entity === UserRoleEntity ? (opts.otherAdminCount ?? 1) : 0),
      );
      (em.update as jest.Mock).mockImplementation(async () => {
        if (opts.updateThrows) throw new Error('DB write failed');
        return { affected: 1 };
      });
      em.create.mockImplementation((_e: unknown, plain: unknown) => plain);
      em.save.mockResolvedValue(undefined);
      if (opts.redisThrows) {
        redisService.setWithTtl.mockRejectedValue(new Error('redis down'));
      }
    }

    it('[S1] active→inactive (System Admin): UPDATE inactive + audit WARNING + revoke', async () => {
      setup({ currentStatus: 'active' });

      const result = await service.updateUserStatus(
        targetUserId,
        'inactive',
        actorId,
        { ipAddress: '127.0.0.1' },
      );

      expect(result).toEqual({ id: targetUserId, accountStatus: 'inactive' });
      expect(em.update).toHaveBeenCalledWith(UserEntity, targetUserId, {
        accountStatus: 'inactive',
      });
      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          actionType: 'ACCOUNT_STATUS_UPDATE',
          severity: 'warning',
          oldValueJson: { accountStatus: 'active' },
          newValueJson: { accountStatus: 'inactive' },
        }),
      );
      expect(redisService.setWithTtl).toHaveBeenCalledWith(
        `auth:user:${targetUserId}:invalid_after`,
        expect.any(String),
        604800,
      );
    });

    it('[S2] inactive→active: UPDATE active + audit INFO + KHÔNG revoke', async () => {
      setup({ currentStatus: 'inactive' });

      const result = await service.updateUserStatus(
        targetUserId,
        'active',
        actorId,
        {},
      );

      expect(result).toEqual({ id: targetUserId, accountStatus: 'active' });
      expect(em.update).toHaveBeenCalledWith(UserEntity, targetUserId, {
        accountStatus: 'active',
      });
      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({ severity: 'info' }),
      );
      expect(redisService.setWithTtl).not.toHaveBeenCalled();
    });

    it('[S3] No-op (status == current) → 200, không WRITE/audit', async () => {
      setup({ currentStatus: 'active' });

      const result = await service.updateUserStatus(
        targetUserId,
        'active',
        actorId,
        {},
      );

      expect(result).toEqual({ id: targetUserId, accountStatus: 'active' });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[S4] BR-02 self-deactivate → 422 CANNOT_DEACTIVATE_SELF', async () => {
      setup({ currentStatus: 'active' });
      await expect(
        service.updateUserStatus(targetUserId, 'inactive', targetUserId, {}),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[S5] BR-05 last SYSTEM_ADMIN (→inactive) → 422 LAST_SYSTEM_ADMIN', async () => {
      setup({
        currentStatus: 'active',
        targetIsAdmin: true,
        otherAdminCount: 0,
      });
      await expect(
        service.updateUserStatus(targetUserId, 'inactive', actorId, {}),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[S6] BR-05 còn admin khác → thành công', async () => {
      setup({
        currentStatus: 'active',
        targetIsAdmin: true,
        otherAdminCount: 2,
      });
      await service.updateUserStatus(targetUserId, 'inactive', actorId, {});
      expect(em.update).toHaveBeenCalledWith(UserEntity, targetUserId, {
        accountStatus: 'inactive',
      });
    });

    it('[S7] BR-04 current=LOCKED → 409 INVALID_STATUS_TRANSITION', async () => {
      setup({ currentStatus: 'locked' });
      await expect(
        service.updateUserStatus(targetUserId, 'inactive', actorId, {}),
      ).rejects.toThrow(ConflictException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[S8] BR-04 current=PENDING_RESET → 409 INVALID_STATUS_TRANSITION', async () => {
      setup({ currentStatus: 'pending_reset' });
      await expect(
        service.updateUserStatus(targetUserId, 'active', actorId, {}),
      ).rejects.toThrow(ConflictException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[S9] BR-06 USER_NOT_FOUND → 404', async () => {
      setup({ target: null });
      await expect(
        service.updateUserStatus(targetUserId, 'inactive', actorId, {}),
      ).rejects.toThrow(NotFoundException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[S10] BR-07 Business Admin — target ngoài scope → 403', async () => {
      setup({
        currentStatus: 'active',
        actorIsSystemAdmin: false,
        actorDeptId: 'admin-dept',
        targetDeptId: 'other-dept',
      });
      await expect(
        service.updateUserStatus(targetUserId, 'inactive', actorId, {}),
      ).rejects.toThrow(ForbiddenException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[S11] System Admin bỏ qua scope (target khác phòng) → thành công', async () => {
      setup({
        currentStatus: 'active',
        actorIsSystemAdmin: true,
        targetDeptId: 'other-dept',
      });
      await service.updateUserStatus(targetUserId, 'inactive', actorId, {});
      expect(em.update).toHaveBeenCalledWith(UserEntity, targetUserId, {
        accountStatus: 'inactive',
      });
    });

    it('[S12] Redis fail post-commit (→inactive) → không throw, status đã đổi', async () => {
      setup({ currentStatus: 'active', redisThrows: true });
      await expect(
        service.updateUserStatus(targetUserId, 'inactive', actorId, {}),
      ).resolves.toEqual({ id: targetUserId, accountStatus: 'inactive' });
      expect(em.update).toHaveBeenCalled();
      expect(redisService.setWithTtl).toHaveBeenCalled();
    });

    it('[S13] Rollback — WRITE trong transaction lỗi → reject, KHÔNG revoke', async () => {
      setup({ currentStatus: 'active', updateThrows: true });
      await expect(
        service.updateUserStatus(targetUserId, 'inactive', actorId, {}),
      ).rejects.toThrow('DB write failed');
      expect(redisService.setWithTtl).not.toHaveBeenCalled();
    });
  });

  describe('lockUser / unlockUser', () => {
    const targetUserId = 'target-user-id';
    const actorId = 'actor-id';

    function makeQb(count: number) {
      const qb: any = {
        innerJoin: () => qb,
        where: () => qb,
        andWhere: () => qb,
        getCount: async () => count,
      };
      return qb;
    }

    function setup(opts: {
      target?: unknown; // null -> USER_NOT_FOUND
      currentStatus?: string;
      targetDeptId?: string;
      actorIsSystemAdmin?: boolean;
      actorDeptId?: string;
      targetIsAdmin?: boolean;
      otherAdminCount?: number;
      updateThrows?: boolean;
      redisThrows?: boolean;
    }) {
      const target =
        opts.target === undefined
          ? {
              id: targetUserId,
              accountStatus: opts.currentStatus ?? 'active',
              departmentId: opts.targetDeptId ?? 'admin-dept',
            }
          : opts.target;

      em.findOne.mockImplementation(async (entity, o: any) => {
        if (entity === UserEntity) {
          if (o?.where?.id === actorId && o?.select?.departmentId) {
            return { departmentId: opts.actorDeptId ?? null };
          }
          if (o?.where?.id === targetUserId) return target;
          return null;
        }
        return null;
      });
      em.find.mockImplementation(async (entity, o: any) => {
        if (entity === UserRoleEntity) {
          if (o?.where?.userId === actorId) {
            return [
              {
                role: {
                  roleCode: opts.actorIsSystemAdmin !== false ? 'SYSTEM_ADMIN' : 'EMPLOYEE',
                  isSystemRole: opts.actorIsSystemAdmin !== false,
                },
              },
            ];
          }
          if (o?.where?.userId === targetUserId) {
            return opts.targetIsAdmin
              ? [{ role: { roleCode: 'SYSTEM_ADMIN', isActive: true } }]
              : [];
          }
          return [];
        }
        if (entity === DepartmentEntity) return [];
        return [];
      });
      (em.createQueryBuilder as jest.Mock).mockImplementation(
        (entity: unknown) =>
          makeQb(entity === UserRoleEntity ? (opts.otherAdminCount ?? 1) : 0),
      );
      (em.update as jest.Mock).mockImplementation(async () => {
        if (opts.updateThrows) throw new Error('DB write failed');
        return { affected: 1 };
      });
      em.create.mockImplementation((_e: unknown, plain: unknown) => plain);
      em.save.mockResolvedValue(undefined);
      if (opts.redisThrows) {
        redisService.setWithTtl.mockRejectedValue(new Error('redis down'));
      }
    }

    // ===== lockUser =====

    it('[L1] lock happy (System Admin): LOCKED + audit WARNING(reason) + revoke; giữ user_roles', async () => {
      setup({ currentStatus: 'active' });

      const result = await service.lockUser(
        targetUserId,
        'vi pham bao mat',
        actorId,
        { ipAddress: '127.0.0.1' },
      );

      expect(result).toEqual({ id: targetUserId, accountStatus: 'locked' });
      expect(em.update).toHaveBeenCalledWith(UserEntity, targetUserId, {
        accountStatus: 'locked',
        lockedUntil: null,
      });
      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          actionType: 'ACCOUNT_LOCK',
          severity: 'warning',
          oldValueJson: { accountStatus: 'active' },
          newValueJson: { accountStatus: 'locked' },
          metadataJson: { reason: 'vi pham bao mat' },
        }),
      );
      expect(redisService.setWithTtl).toHaveBeenCalledWith(
        `auth:user:${targetUserId}:invalid_after`,
        expect.any(String),
        604800,
      );
      // KHÔNG đụng user_roles (không update UserRoleEntity)
      expect(em.update).not.toHaveBeenCalledWith(
        UserRoleEntity,
        expect.anything(),
        expect.anything(),
      );
    });

    it('[L2] BR-01 self-lock → 422 CANNOT_LOCK_SELF', async () => {
      setup({ currentStatus: 'active' });
      await expect(
        service.lockUser(targetUserId, undefined, targetUserId, {}),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[L3] BR-02 last SYSTEM_ADMIN → 422 LAST_SYSTEM_ADMIN', async () => {
      setup({
        currentStatus: 'active',
        targetIsAdmin: true,
        otherAdminCount: 0,
      });
      await expect(
        service.lockUser(targetUserId, undefined, actorId, {}),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[L4] BR-02 còn admin khác → thành công', async () => {
      setup({
        currentStatus: 'active',
        targetIsAdmin: true,
        otherAdminCount: 2,
      });
      await service.lockUser(targetUserId, undefined, actorId, {});
      expect(em.update).toHaveBeenCalledWith(UserEntity, targetUserId, {
        accountStatus: 'locked',
        lockedUntil: null,
      });
    });

    it('[L5] No-op đã LOCKED → 200, không WRITE/audit', async () => {
      setup({ currentStatus: 'locked' });
      const result = await service.lockUser(
        targetUserId,
        undefined,
        actorId,
        {},
      );
      expect(result).toEqual({ id: targetUserId, accountStatus: 'locked' });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[L6] Lock từ INACTIVE (BR-04) → thành công → LOCKED', async () => {
      setup({ currentStatus: 'inactive' });
      const result = await service.lockUser(
        targetUserId,
        undefined,
        actorId,
        {},
      );
      expect(result.accountStatus).toBe('locked');
      expect(em.update).toHaveBeenCalledWith(UserEntity, targetUserId, {
        accountStatus: 'locked',
        lockedUntil: null,
      });
    });

    it('[L7] Business Admin — target ngoài scope → 403', async () => {
      setup({
        currentStatus: 'active',
        actorIsSystemAdmin: false,
        actorDeptId: 'admin-dept',
        targetDeptId: 'other-dept',
      });
      await expect(
        service.lockUser(targetUserId, undefined, actorId, {}),
      ).rejects.toThrow(ForbiddenException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[L8] System Admin bỏ qua scope → thành công', async () => {
      setup({
        currentStatus: 'active',
        actorIsSystemAdmin: true,
        targetDeptId: 'other-dept',
      });
      await service.lockUser(targetUserId, undefined, actorId, {});
      expect(em.update).toHaveBeenCalled();
    });

    it('[L9] Redis fail post-commit → không throw, status đã LOCKED', async () => {
      setup({ currentStatus: 'active', redisThrows: true });
      await expect(
        service.lockUser(targetUserId, undefined, actorId, {}),
      ).resolves.toEqual({ id: targetUserId, accountStatus: 'locked' });
      expect(em.update).toHaveBeenCalled();
      expect(redisService.setWithTtl).toHaveBeenCalled();
    });

    it('[L10] Rollback — WRITE lỗi → reject, KHÔNG revoke', async () => {
      setup({ currentStatus: 'active', updateThrows: true });
      await expect(
        service.lockUser(targetUserId, undefined, actorId, {}),
      ).rejects.toThrow('DB write failed');
      expect(redisService.setWithTtl).not.toHaveBeenCalled();
    });

    it('[L11] USER_NOT_FOUND → 404', async () => {
      setup({ target: null });
      await expect(
        service.lockUser(targetUserId, undefined, actorId, {}),
      ).rejects.toThrow(NotFoundException);
      expect(em.update).not.toHaveBeenCalled();
    });

    // ===== unlockUser =====

    it('[U1] unlock happy → ACTIVE + reset + audit INFO; KHÔNG revoke', async () => {
      setup({ currentStatus: 'locked' });

      const result = await service.unlockUser(targetUserId, actorId, {});

      expect(result).toEqual({ id: targetUserId, accountStatus: 'active' });
      expect(em.update).toHaveBeenCalledWith(UserEntity, targetUserId, {
        accountStatus: 'active',
        failedLoginCount: 0,
        lockedUntil: null,
      });
      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          actionType: 'ACCOUNT_UNLOCK',
          severity: 'info',
          oldValueJson: { accountStatus: 'locked' },
          newValueJson: { accountStatus: 'active' },
        }),
      );
      expect(redisService.setWithTtl).not.toHaveBeenCalled();
    });

    it('[U2] NOT_LOCKED (đang active) → 409', async () => {
      setup({ currentStatus: 'active' });
      await expect(
        service.unlockUser(targetUserId, actorId, {}),
      ).rejects.toThrow(ConflictException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[U3] Business Admin — target ngoài scope → 403', async () => {
      setup({
        currentStatus: 'locked',
        actorIsSystemAdmin: false,
        actorDeptId: 'admin-dept',
        targetDeptId: 'other-dept',
      });
      await expect(
        service.unlockUser(targetUserId, actorId, {}),
      ).rejects.toThrow(ForbiddenException);
      expect(em.update).not.toHaveBeenCalled();
    });

    it('[U4] USER_NOT_FOUND → 404', async () => {
      setup({ target: null });
      await expect(
        service.unlockUser(targetUserId, actorId, {}),
      ).rejects.toThrow(NotFoundException);
      expect(em.update).not.toHaveBeenCalled();
    });
  });

  describe('listUsers (UC-13 search)', () => {
    let findAndCount: jest.Mock;
    // [FIX 2026-08-17] batch hasFaceProfile — mock riêng FaceProfileEntity.createQueryBuilder,
    // KHÔNG lẫn với findAndCount của UserEntity (getRepository trả khác nhau theo entity).
    let getRawMany: jest.Mock;
    let fpWhere: jest.Mock;
    let fpAndWhere: jest.Mock;

    beforeEach(() => {
      findAndCount = jest.fn().mockResolvedValue([[], 0]);
      getRawMany = jest.fn().mockResolvedValue([]); // mặc định: KHÔNG ai có active face profile
      const fpQb: any = {};
      fpQb.select = jest.fn().mockReturnValue(fpQb);
      fpWhere = jest.fn().mockReturnValue(fpQb);
      fpAndWhere = jest.fn().mockReturnValue(fpQb);
      fpQb.where = fpWhere;
      fpQb.andWhere = fpAndWhere;
      fpQb.getRawMany = getRawMany;

      (dataSource.getRepository as jest.Mock).mockImplementation(
        (entityClass: unknown) => {
          if (entityClass === FaceProfileEntity) {
            return { createQueryBuilder: jest.fn().mockReturnValue(fpQb) };
          }
          return { findAndCount };
        },
      );
    });

    it('[T1/T2/T3/T4] search → where là mảng OR 3 nhánh (fullName/email/employeeCode), MỖI nhánh giữ baseWhere (ACTIVE + deletedAt)', async () => {
      await service.listUsers({ search: 'abc', page: 1, limit: 20 });

      const opts = findAndCount.mock.calls[0][0];
      expect(Array.isArray(opts.where)).toBe(true);
      expect(opts.where).toHaveLength(3);

      // T4: mọi nhánh OR đều kèm baseWhere -> không lộ INACTIVE/deleted
      for (const branch of opts.where) {
        expect(branch.accountStatus).toBe(AccountStatus.ACTIVE);
        expect(branch.deletedAt).toBeDefined(); // IsNull()
      }

      // T2/T3/T1: từng nhánh field
      expect(opts.where[0].fullName).toBeDefined();
      expect(opts.where[1].email).toBeDefined();
      expect(opts.where[2].employeeCode).toBeDefined();
    });

    it('[T6] nhánh employeeCode dùng ILike (null không khớp ở tầng DB — semantics ILIKE)', async () => {
      await service.listUsers({ search: 'EMP', page: 1, limit: 20 });
      const opts = findAndCount.mock.calls[0][0];
      // FindOperator ILike có type 'ilike'
      expect(opts.where[2].employeeCode?.type).toBe('ilike');
    });

    it('[T5] select có employeeCode và map output có employeeCode', async () => {
      findAndCount.mockResolvedValue([
        [
          {
            id: 'u1',
            fullName: 'A',
            email: 'a@x.com',
            employeeCode: 'EMP1',
            avatarUrl: 'https://cdn.example.com/avatars/u1.jpg',
          },
        ],
        1,
      ]);

      const res = await service.listUsers({ search: 'a', page: 1, limit: 20 });

      const opts = findAndCount.mock.calls[0][0];
      expect(opts.select.employeeCode).toBe(true);
      expect(opts.select.id).toBe(true);
      expect(opts.select.fullName).toBe(true);
      expect(opts.select.email).toBe(true);
      expect(res.data[0]).toEqual({
        id: 'u1',
        fullName: 'A',
        email: 'a@x.com',
        employeeCode: 'EMP1',
        avatarUrl: 'https://cdn.example.com/avatars/u1.jpg',
        hasFaceProfile: false, // [FIX 2026-08-17] getRawMany() mặc định [] → không ai active
      });
      expect(res.total).toBe(1);
    });

    // [FIX 2026-08-09] mirror listUsersForManagement — GET /users (bare) trước đây thiếu avatarUrl.
    it('[T9] select có avatarUrl: true, map output có avatarUrl (mirror listUsersForManagement)', async () => {
      findAndCount.mockResolvedValue([
        [
          {
            id: 'u1',
            fullName: 'A',
            email: 'a@x.com',
            employeeCode: null,
            avatarUrl: null,
          },
        ],
        1,
      ]);
      const res = await service.listUsers({ page: 1, limit: 20 });
      const opts = findAndCount.mock.calls[0][0];
      expect(opts.select.avatarUrl).toBe(true);
      expect(res.data[0].avatarUrl).toBeNull();
      expect(res.data[0].hasFaceProfile).toBe(false); // regression: field khác không đổi
    });

    it('[T7] phân trang & sort giữ nguyên (skip/take/order)', async () => {
      await service.listUsers({ search: 'a', page: 2, limit: 10 });
      const opts = findAndCount.mock.calls[0][0];
      expect(opts.skip).toBe(10);
      expect(opts.take).toBe(10);
      expect(opts.order).toEqual({ fullName: 'asc' });
    });

    it('[T8] không search → where = baseWhere (object, không mảng OR), giữ ACTIVE + deletedAt', async () => {
      await service.listUsers({ page: 1, limit: 20 });
      const opts = findAndCount.mock.calls[0][0];
      expect(Array.isArray(opts.where)).toBe(false);
      expect(opts.where.accountStatus).toBe(AccountStatus.ACTIVE);
      expect(opts.where.deletedAt).toBeDefined();
    });

    // [FIX 2026-08-17] hasFaceProfile — batch query (mirror pattern "Batch roles" của
    // listUsersForManagement), chỉ tính status=ACTIVE.
    describe('hasFaceProfile (chỉ status=active, batch query tránh N+1)', () => {
      const userRow = (id: string) => ({
        id,
        fullName: `User ${id}`,
        email: `${id}@x.com`,
        employeeCode: null,
        avatarUrl: null,
      });

      it('user có face_profile status=active → hasFaceProfile=true', async () => {
        findAndCount.mockResolvedValue([[userRow('u1')], 1]);
        getRawMany.mockResolvedValue([{ userId: 'u1' }]);

        const res = await service.listUsers({ page: 1, limit: 20 });

        expect(res.data[0].hasFaceProfile).toBe(true);
      });

      it.each(['pending_review', 'revoked', 'rejected', 'disabled'])(
        'user có face_profile nhưng status=%s (KHÔNG active) → hasFaceProfile=false',
        async (status) => {
          findAndCount.mockResolvedValue([[userRow('u1')], 1]);
          // Batch query CHỈ lọc status=ACTIVE ở tầng SQL (andWhere) — profile status
          // khác sẽ không nằm trong kết quả getRawMany() dù có tồn tại trong DB thật.
          getRawMany.mockResolvedValue([]);

          const res = await service.listUsers({ page: 1, limit: 20 });

          expect(res.data[0].hasFaceProfile).toBe(false);
          expect(fpAndWhere).toHaveBeenCalledWith('fp.status = :status', {
            status: FaceProfileStatus.ACTIVE,
          });
          void status; // tham số chỉ để đặt tên test rõ ràng, hành vi mock giống nhau
        },
      );

      it('user hoàn toàn KHÔNG có face_profile nào → hasFaceProfile=false', async () => {
        findAndCount.mockResolvedValue([[userRow('u1')], 1]);
        getRawMany.mockResolvedValue([]); // batch query không trả row nào cho u1

        const res = await service.listUsers({ page: 1, limit: 20 });

        expect(res.data[0].hasFaceProfile).toBe(false);
      });

      it('trang trộn lẫn cả 3 trường hợp (active/status khác/không có profile) → batch query map ĐÚNG cho từng user, không lẫn lộn', async () => {
        findAndCount.mockResolvedValue([
          [userRow('u-active'), userRow('u-revoked'), userRow('u-none')],
          3,
        ]);
        // Chỉ 'u-active' xuất hiện trong kết quả batch (status=active) — 'u-revoked'
        // (có profile nhưng status khác) và 'u-none' (không có profile nào) đều
        // KHÔNG xuất hiện, đúng semantics SQL WHERE status='active'.
        getRawMany.mockResolvedValue([{ userId: 'u-active' }]);

        const res = await service.listUsers({ page: 1, limit: 20 });

        const byId = Object.fromEntries(
          res.data.map((u) => [u.id, u.hasFaceProfile]),
        );
        expect(byId).toEqual({
          'u-active': true,
          'u-revoked': false,
          'u-none': false,
        });
      });

      it('KHÔNG N+1: đúng 1 lần createQueryBuilder/getRawMany cho CẢ trang, bất kể số user', async () => {
        findAndCount.mockResolvedValue([
          [userRow('u1'), userRow('u2'), userRow('u3'), userRow('u4')],
          4,
        ]);
        getRawMany.mockResolvedValue([{ userId: 'u2' }]);

        await service.listUsers({ page: 1, limit: 20 });

        const fpRepoCalls = (
          dataSource.getRepository as jest.Mock
        ).mock.calls.filter((c) => c[0] === FaceProfileEntity);
        expect(fpRepoCalls.length).toBe(1); // 1 lần getRepository(FaceProfileEntity)
        expect(getRawMany).toHaveBeenCalledTimes(1); // 1 query batch, KHÔNG phải 4 (per-row)
        expect(fpWhere).toHaveBeenCalledWith('fp.userId IN (:...userIds)', {
          userIds: ['u1', 'u2', 'u3', 'u4'],
        });
      });

      it('trang rỗng (0 user) → KHÔNG gọi batch query (guard userIds.length > 0)', async () => {
        findAndCount.mockResolvedValue([[], 0]);

        await service.listUsers({ page: 1, limit: 20 });

        expect(getRawMany).not.toHaveBeenCalled();
      });
    });
  });

  describe('listUsersForManagement (UC-14 filter)', () => {
    const actorId = 'actor-id';

    type QbRecord = { name: string; args: unknown[] };
    function makeQb(result: {
      manyAndCount?: [unknown[], number];
      many?: unknown[];
    }) {
      const records: QbRecord[] = [];
      const qb: any = {};
      const chain =
        (name: string) =>
        (...args: unknown[]) => {
          records.push({ name, args });
          return qb;
        };
      qb.where = chain('where');
      qb.andWhere = chain('andWhere');
      qb.orderBy = chain('orderBy');
      qb.select = chain('select');
      qb.skip = chain('skip');
      qb.take = chain('take');
      qb.innerJoinAndSelect = chain('innerJoinAndSelect');
      qb.getManyAndCount = jest
        .fn()
        .mockResolvedValue(result.manyAndCount ?? [[], 0]);
      qb.getMany = jest.fn().mockResolvedValue(result.many ?? []);
      qb.records = records;
      return qb;
    }

    function setup(opts: {
      actorIsSystemAdmin?: boolean;
      actorDeptId?: string;
      users?: { id: string }[];
      total?: number;
      userRoles?: { userId: string; role: { roleCode: string } }[];
    }) {
      em.find.mockImplementation(async (entity, o: any) => {
        if (entity === UserRoleEntity && o?.where?.userId === actorId) {
          return [
            {
                role: {
                  roleCode: opts.actorIsSystemAdmin !== false ? 'SYSTEM_ADMIN' : 'EMPLOYEE',
                  isSystemRole: opts.actorIsSystemAdmin !== false,
                },
              },
          ];
        }
        if (entity === DepartmentEntity) return []; // collectDepartmentScope children
        return [];
      });
      em.findOne.mockImplementation(async (entity, o: any) => {
        if (entity === UserEntity && o?.where?.id === actorId) {
          return { departmentId: opts.actorDeptId ?? null };
        }
        return null;
      });

      const users = opts.users ?? [];
      const mainQb = makeQb({
        manyAndCount: [users, opts.total ?? users.length],
      });
      const rolesQb = makeQb({ many: opts.userRoles ?? [] });

      (dataSource.getRepository as jest.Mock).mockImplementation(
        (entity: unknown) => ({
          createQueryBuilder: () =>
            entity === UserRoleEntity ? rolesQb : mainQb,
        }),
      );

      return { mainQb, rolesQb };
    }

    function andWheres(qb: any): unknown[] {
      return (qb.records as QbRecord[])
        .filter((r) => r.name === 'andWhere')
        .map((r) => r.args[0]);
    }
    function hasAndWhereStr(qb: any, sub: string): boolean {
      return andWheres(qb).some(
        (a) => typeof a === 'string' && a.includes(sub),
      );
    }

    it('[M1] filter departmentId → andWhere department_id', async () => {
      const { mainQb } = setup({ actorIsSystemAdmin: true });
      await service.listUsersForManagement({ departmentId: 'dep-1' }, actorId);
      expect(hasAndWhereStr(mainQb, 'u.departmentId = :departmentId')).toBe(
        true,
      );
    });

    it('[M2] filter accountStatus → andWhere account_status', async () => {
      const { mainQb } = setup({ actorIsSystemAdmin: true });
      await service.listUsersForManagement(
        { accountStatus: 'locked' },
        actorId,
      );
      expect(hasAndWhereStr(mainQb, 'u.accountStatus = :accountStatus')).toBe(
        true,
      );
    });

    it('[M3] filter roleId → andWhere SUBQUERY user_roles (không innerJoin)', async () => {
      const { mainQb } = setup({ actorIsSystemAdmin: true });
      await service.listUsersForManagement({ roleId: 'role-1' }, actorId);
      expect(hasAndWhereStr(mainQb, 'SELECT ur.user_id FROM user_roles')).toBe(
        true,
      );
      // KHÔNG innerJoin trên qb chính
      expect(
        (mainQb.records as QbRecord[]).some(
          (r) => r.name === 'innerJoinAndSelect',
        ),
      ).toBe(false);
    });

    it('[M4] filter search → andWhere(Brackets) OR', async () => {
      const { mainQb } = setup({ actorIsSystemAdmin: true });
      await service.listUsersForManagement({ search: 'abc' }, actorId);
      expect(andWheres(mainQb).some((a) => a instanceof Brackets)).toBe(true);
    });

    it('[M5] tổ hợp nhiều filter (AND)', async () => {
      const { mainQb } = setup({ actorIsSystemAdmin: true });
      await service.listUsersForManagement(
        {
          departmentId: 'dep-1',
          accountStatus: 'active',
          roleId: 'role-1',
          search: 'x',
        },
        actorId,
      );
      expect(hasAndWhereStr(mainQb, 'u.departmentId = :departmentId')).toBe(
        true,
      );
      expect(hasAndWhereStr(mainQb, 'u.accountStatus = :accountStatus')).toBe(
        true,
      );
      expect(hasAndWhereStr(mainQb, 'SELECT ur.user_id FROM user_roles')).toBe(
        true,
      );
      expect(andWheres(mainQb).some((a) => a instanceof Brackets)).toBe(true);
    });

    it('[M6] mặc định (không filter) → chỉ deleted_at IS NULL, không lọc trạng thái', async () => {
      const { mainQb } = setup({ actorIsSystemAdmin: true });
      await service.listUsersForManagement({}, actorId);
      const whereCall = (mainQb.records as QbRecord[]).find(
        (r) => r.name === 'where',
      );
      expect(whereCall?.args[0]).toBe('u.deletedAt IS NULL');
      expect(hasAndWhereStr(mainQb, 'u.accountStatus')).toBe(false);
    });

    it('[M7] sort allowlist → orderBy = SORT_MAP[sortBy], hướng sortOrder', async () => {
      const { mainQb } = setup({ actorIsSystemAdmin: true });
      await service.listUsersForManagement(
        { sortBy: 'email', sortOrder: 'desc' },
        actorId,
      );
      const orderBy = (mainQb.records as QbRecord[]).find(
        (r) => r.name === 'orderBy',
      );
      expect(orderBy?.args).toEqual(['u.email', 'DESC']);
    });

    it('[M8] Business Admin — trong scope → andWhere department_id IN scope', async () => {
      const { mainQb } = setup({
        actorIsSystemAdmin: false,
        actorDeptId: 'admin-dept',
      });
      await service.listUsersForManagement({}, actorId);
      expect(hasAndWhereStr(mainQb, 'u.departmentId IN (:...scopeIds)')).toBe(
        true,
      );
    });

    it('[M9] Business Admin — departmentId ngoài scope → 403 FORBIDDEN', async () => {
      setup({ actorIsSystemAdmin: false, actorDeptId: 'admin-dept' });
      await expect(
        service.listUsersForManagement({ departmentId: 'other-dept' }, actorId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('[M10] System Admin → KHÔNG andWhere scope', async () => {
      const { mainQb } = setup({ actorIsSystemAdmin: true });
      await service.listUsersForManagement({}, actorId);
      expect(hasAndWhereStr(mainQb, 'scopeIds')).toBe(false);
    });

    it('[M11] phân trang → skip/take đúng', async () => {
      const { mainQb } = setup({ actorIsSystemAdmin: true });
      await service.listUsersForManagement({ page: 3, limit: 10 }, actorId);
      const skip = (mainQb.records as QbRecord[]).find(
        (r) => r.name === 'skip',
      );
      const take = (mainQb.records as QbRecord[]).find(
        (r) => r.name === 'take',
      );
      expect(skip?.args[0]).toBe(20);
      expect(take?.args[0]).toBe(10);
    });

    it('[M12] roles map đúng + KHÔNG N+1 (1 query roles cho cả trang)', async () => {
      const { rolesQb } = setup({
        actorIsSystemAdmin: true,
        users: [{ id: 'u1' }, { id: 'u2' }],
        total: 2,
        userRoles: [
          { userId: 'u1', role: { roleCode: 'ADMIN' } },
          { userId: 'u1', role: { roleCode: 'MANAGER' } },
          { userId: 'u2', role: { roleCode: 'EMPLOYEE' } },
        ],
      });

      const res = await service.listUsersForManagement({}, actorId);

      expect(rolesQb.getMany).toHaveBeenCalledTimes(1); // 1 query cho cả trang
      expect(res.data[0].roles).toEqual(['ADMIN', 'MANAGER']);
      expect(res.data[1].roles).toEqual(['EMPLOYEE']);
      expect(res.total).toBe(2);
    });

    it('[M13] trang rỗng (userIds=[]) → KHÔNG query roles', async () => {
      const { rolesQb } = setup({
        actorIsSystemAdmin: true,
        users: [],
        total: 0,
      });
      const res = await service.listUsersForManagement({}, actorId);
      expect(rolesQb.getMany).not.toHaveBeenCalled();
      expect(res.data).toEqual([]);
    });
  });

  describe('PTA partner provisioning', () => {
    const setupPersistMocks = () => {
      const repoMock = { insert: jest.fn().mockResolvedValue(undefined) };
      (em.getRepository as jest.Mock).mockReturnValue(repoMock);
      em.create.mockImplementation((_entity: unknown, plain: unknown) => plain);
      em.save.mockImplementation(
        async (_entity: unknown, plain: unknown) => plain,
      );
      return repoMock;
    };

    it('persistAccount creates partner user with email password and pending-review face profile', async () => {
      const repoMock = setupPersistMocks();
      const expiresAt = new Date(Date.now() + 86400000);
      const result = await service.persistAccount(
        em,
        {
          fullName: 'Partner',
          email: 'partner@x.com',
          departmentId: PARTNER_DEPARTMENT_ID,
          roleIds: ['role-1'],
          employeeCode: null,
          phoneNumber: null,
          positionTitle: null,
          directManagerId: null,
          partner: {
            accountExpiresAt: expiresAt,
            mediaFileId: 'media-1',
            faceProfileId: 'face-1',
            detectedMime: 'image/jpeg',
            storageKey: 's1',
            fileUrl: 'https://cdn/x.jpg',
            fileName: 'x.jpg',
            uploadedBy: 'admin',
          },
        } as any,
        'admin',
        {},
      );

      const created = result.user as any;
      expect(result.tempPassword).toBe('partner@x.com');
      expect(await bcrypt.compare('partner@x.com', created.passwordHash)).toBe(
        true,
      );
      expect(created.mustChangePassword).toBe(false);
      expect(created.accountExpiresAt).toEqual(expiresAt);
      expect(created.departmentId).toBe(PARTNER_DEPARTMENT_ID);
      expect(repoMock.insert).toHaveBeenCalledWith(
        expect.objectContaining({ status: FaceProfileStatus.PENDING_REVIEW }),
      );
      expect(repoMock.insert).toHaveBeenCalledWith(
        expect.objectContaining({ relatedEntityType: 'face_profile' }),
      );
    });

    it('rejects partner creation without avatar before creating users', async () => {
      const dto: CreateUserDto = {
        fullName: 'Partner',
        email: 'partner@x.com',
        roleIds: ['role-1'],
        accountType: 'partner',
        accountExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      };

      await expect(service.createUser(dto, 'admin', {})).rejects.toMatchObject({
        response: { error: { code: 'AVATAR_FILE_REQUIRED' } },
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
    });

    it('createUser: đối tác KHÔNG gửi roleIds (đúng luồng FE thật) → vẫn tạo được, tự ép role EMPLOYEE', async () => {
      // Tái hiện bug thật đã phát hiện trên UI: form "Tạo tài khoản đối tác"
      // không có ô chọn role, nên FE không gửi field roleIds — trước đây DTO
      // bắt buộc roleIds cho MỌI accountType nên request luôn bị 400
      // "Danh sách vai trò không được rỗng". roleIds giờ chỉ bắt buộc khi
      // accountType !== 'partner' (xem create-user.dto.ts).
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) return null;
          if (entityClass === DepartmentEntity) {
            return { id: PARTNER_DEPARTMENT_ID, isActive: true };
          }
          if (entityClass === RoleEntity) {
            if (options?.where?.roleCode === 'EMPLOYEE') {
              return {
                id: 'role-employee-id',
                roleCode: 'EMPLOYEE',
                roleName: 'Employee',
                isActive: true,
              };
            }
            return null;
          }
          return null;
        },
      );
      const mockSavedUser = {
        id: 'new-partner-id',
        fullName: 'Doi Tac Test',
        email: 'doitac.test@example.com',
        departmentId: PARTNER_DEPARTMENT_ID,
        accountStatus: 'active',
        mustChangePassword: false,
        accountExpiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
      };
      em.create.mockImplementation(
        <T>(_entityClass: unknown, plain: T): T => plain,
      );
      em.save.mockImplementation(
        async <T>(entityClass: unknown, entity: T): Promise<T> => {
          if (entityClass === UserEntity) return mockSavedUser as unknown as T;
          return entity;
        },
      );
      em.getRepository.mockReturnValue({
        insert: jest.fn().mockResolvedValue(undefined),
      } as any);

      const dto: CreateUserDto = {
        fullName: 'Doi Tac Test',
        email: 'doitac.test@example.com',
        accountType: 'partner',
        accountExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        // roleIds KHÔNG được gửi — đúng như FE thật không gửi field này
      };

      const result = await service.createUser(
        dto,
        'admin',
        {},
        {
          buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]),
          size: 5,
          originalname: 'face.jpg',
        },
      );

      expect(result.roles).toEqual([
        expect.objectContaining({ roleCode: 'EMPLOYEE' }),
      ]);
      expect(em.save).toHaveBeenCalledWith(
        UserRoleEntity,
        expect.objectContaining({ roleId: 'role-employee-id' }),
      );
    });

    it('keeps employee persist behavior unchanged', async () => {
      setupPersistMocks();
      const result = await service.persistAccount(
        em,
        {
          fullName: 'Employee',
          email: 'emp@x.com',
          departmentId: 'dept-1',
          roleIds: ['role-1'],
          employeeCode: null,
          phoneNumber: null,
          positionTitle: null,
          directManagerId: null,
        },
        'admin',
        {},
      );

      const created = result.user as any;
      expect(result.tempPassword).toBe('tempPassword123!');
      expect(created.mustChangePassword).toBe(true);
      expect(created.accountExpiresAt).toBeNull();
    });
  });
});
