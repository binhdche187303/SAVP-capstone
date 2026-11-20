/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { DepartmentsService } from './departments.service.js';
import { CreateDepartmentDto } from '../dto/create-department.dto.js';
import { UpdateDepartmentDto } from '../dto/update-department.dto.js';
import { DepartmentEntity } from '../entities/department.entity.js';
import { UserEntity } from '../entities/user.entity.js';
import { PARTNER_DEPARTMENT_ID } from '../../../common/utils/partner-account.util.js';

describe('DepartmentsService', () => {
  let service: DepartmentsService;
  let dataSource: jest.Mocked<DataSource>;
  let em: jest.Mocked<EntityManager>;
  let repo: { findAndCount: jest.Mock; findOne: jest.Mock };
  let userRepo: {
    find: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let userQueryBuilder: {
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    groupBy: jest.Mock;
    getRawMany: jest.Mock;
  };

  const validDto: CreateDepartmentDto = {
    departmentCode: 'IT',
    departmentName: 'Phòng Công nghệ thông tin',
  };

  beforeEach(async () => {
    em = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      // syncDepartmentManagerRole (gán/gỡ MANAGER theo trưởng đơn vị)
      query: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<EntityManager>;

    repo = { findAndCount: jest.fn(), findOne: jest.fn() };
    userQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    userRepo = {
      find: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue(userQueryBuilder),
    };
    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (manager: EntityManager) => unknown) =>
          cb(em),
        ),
      getRepository: jest
        .fn()
        .mockImplementation((entity: unknown) =>
          entity === UserEntity ? userRepo : { ...repo, createQueryBuilder: jest.fn().mockReturnValue(userQueryBuilder) },
        ),
    } as unknown as jest.Mocked<DataSource>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentsService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<DepartmentsService>(DepartmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createDepartment', () => {
    it('[AC-001] should create department successfully (Happy Path)', async () => {
      em.findOne.mockResolvedValue(null); // no duplicate, no parent, no manager
      const mockSavedDept = {
        id: 'new-dept-uuid',
        departmentCode: 'IT',
        departmentName: 'Phòng Công nghệ thông tin',
        parentDepartmentId: null,
        managerUserId: null,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockResolvedValue(mockSavedDept);

      const result = await service.createDepartment(validDto, 'creator-id', {
        ipAddress: '127.0.0.1',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('new-dept-uuid');
      expect(result.departmentCode).toBe('IT');
      expect(result.isActive).toBe(true);
      // Phòng ban vừa tạo chắc chắn chưa có nhân viên nào.
      expect(result.memberCount).toBe(0);
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('[AC-002] should create department with parentDepartmentId', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.id === 'parent-uuid') {
            return {
              id: 'parent-uuid',
              isActive: true,
              parentDepartmentId: null,
            };
          }
          return null; // no duplicate code/name
        }
        return null;
      });
      const mockSavedDept = {
        id: 'new-dept-uuid',
        departmentCode: 'DEV',
        departmentName: 'Phòng Phát triển',
        parentDepartmentId: 'parent-uuid',
        managerUserId: null,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockResolvedValue(mockSavedDept);

      const result = await service.createDepartment(
        {
          ...validDto,
          departmentCode: 'DEV',
          departmentName: 'Phòng Phát triển',
          parentDepartmentId: 'parent-uuid',
        },
        'creator-id',
        {},
      );

      expect(result.parentDepartmentId).toBe('parent-uuid');
    });

    it('[AC-003] should create department with managerUserId', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) return null; // no duplicate
        if (entityClass === UserEntity) {
          if (options?.where?.id === 'manager-uuid') {
            return { id: 'manager-uuid', accountStatus: 'active' };
          }
        }
        return null;
      });
      const mockSavedDept = {
        id: 'new-dept-uuid',
        departmentCode: 'HR',
        departmentName: 'Phòng Nhân sự',
        parentDepartmentId: null,
        managerUserId: 'manager-uuid',
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockResolvedValue(mockSavedDept);

      const result = await service.createDepartment(
        {
          ...validDto,
          departmentCode: 'HR',
          departmentName: 'Phòng Nhân sự',
          managerUserId: 'manager-uuid',
        },
        'creator-id',
        {},
      );

      expect(result.managerUserId).toBe('manager-uuid');
    });

    it('[AC-014] should throw ConflictException if departmentCode already exists', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.departmentCode === 'IT') {
            return { id: 'existing', departmentCode: 'IT' };
          }
          return null;
        }
        return null;
      });

      await expect(
        service.createDepartment(validDto, 'creator-id', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('[AC-015] should throw ConflictException if departmentName already exists', async () => {
      let callCount = 0;
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          callCount++;
          if (callCount === 1) return null; // code unique
          return {
            id: 'existing',
            departmentName: 'Phòng Công nghệ thông tin',
          }; // name duplicate
        }
        return null;
      });

      await expect(
        service.createDepartment(validDto, 'creator-id', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('[AC-017] should throw NotFoundException if parent not found', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.id === 'nonexistent') return null; // parent not found
          return null; // no duplicate code/name
        }
        return null;
      });

      await expect(
        service.createDepartment(
          {
            ...validDto,
            parentDepartmentId: 'nonexistent',
          },
          'creator-id',
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('[AC-017] should throw NotFoundException if parent is inactive', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.id === 'inactive-parent') {
            return { id: 'inactive-parent', isActive: false };
          }
          return null;
        }
        return null;
      });

      await expect(
        service.createDepartment(
          {
            ...validDto,
            parentDepartmentId: 'inactive-parent',
          },
          'creator-id',
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('[AC-013] should throw NotFoundException if manager is inactive', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) return null;
        if (entityClass === UserEntity) {
          if (options?.where?.id === 'inactive-manager') {
            return { id: 'inactive-manager', accountStatus: 'inactive' };
          }
        }
        return null;
      });

      await expect(
        service.createDepartment(
          {
            ...validDto,
            managerUserId: 'inactive-manager',
          },
          'creator-id',
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('[AC-018→019] should throw UnprocessableEntityException for depth > 5', async () => {
      // Mock: parent chain depth 5
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.departmentCode === 'IT') return null; // no code duplicate
          if (options?.where?.departmentName === 'Phòng Công nghệ thông tin')
            return null; // no name duplicate
          if (options?.where?.id === 'deep-parent') {
            // Return parent with chain of depth 5
            return {
              id: 'deep-parent',
              isActive: true,
              parentDepartmentId: 'level4',
            };
          }
          if (options?.where?.id === 'level4') {
            return { id: 'level4', parentDepartmentId: 'level3' };
          }
          if (options?.where?.id === 'level3') {
            return { id: 'level3', parentDepartmentId: 'level2' };
          }
          if (options?.where?.id === 'level2') {
            return { id: 'level2', parentDepartmentId: 'level1' };
          }
          if (options?.where?.id === 'level1') {
            return { id: 'level1', parentDepartmentId: null };
          }
          return null;
        }
        return null;
      });

      await expect(
        service.createDepartment(
          {
            ...validDto,
            parentDepartmentId: 'deep-parent',
          },
          'creator-id',
          {},
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[AC-020] should write audit log on success', async () => {
      const mockSavedDept = {
        id: 'audit-dept-uuid',
        departmentCode: 'AUDIT',
        departmentName: 'Audit Dept',
        parentDepartmentId: null,
        managerUserId: null,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      em.findOne.mockResolvedValue(null);
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockResolvedValue(mockSavedDept);

      await service.createDepartment(
        {
          departmentCode: 'AUDIT',
          departmentName: 'Audit Dept',
        },
        'creator-id',
        {},
      );

      // Verify audit log was created (em.save called for both department + audit log)
      expect(em.save).toHaveBeenCalled();
    });
  });

  describe('updateDepartment', () => {
    const baseDept = (over: Partial<DepartmentEntity> = {}) =>
      ({
        id: 'd1',
        departmentCode: 'IT',
        departmentName: 'Phòng CNTT',
        parentDepartmentId: null,
        managerUserId: null,
        description: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...over,
      }) as DepartmentEntity;

    it('body rỗng (mọi field undefined) → 400 EMPTY_UPDATE_PAYLOAD', async () => {
      await expect(
        service.updateDepartment('d1', {}, 'updater-id', {}),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('phòng ban không tồn tại → 404 DEPARTMENT_NOT_FOUND', async () => {
      em.findOne.mockResolvedValue(null);
      await expect(
        service.updateDepartment(
          'missing',
          { description: 'x' },
          'updater-id',
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('phòng ban đã xóa mềm (deletedAt khác null) → 404', async () => {
      em.findOne.mockResolvedValue(baseDept({ deletedAt: new Date() }));
      await expect(
        service.updateDepartment('d1', { description: 'x' }, 'updater-id', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('đổi tên trùng với phòng ban khác → 409 DEPARTMENT_ALREADY_EXISTS', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.id === 'd1' && !options?.where?.deletedAt) {
            return baseDept();
          }
          if (options?.where?.departmentName === 'Phòng Nhân sự') {
            return baseDept({ id: 'd2', departmentName: 'Phòng Nhân sự' });
          }
        }
        return null;
      });

      await expect(
        service.updateDepartment(
          'd1',
          { departmentName: 'Phòng Nhân sự' },
          'updater-id',
          {},
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('gửi lại đúng tên hiện tại (không đổi) → KHÔNG bị coi là trùng, cập nhật thành công', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.id === 'd1') return baseDept();
        }
        return null;
      });
      em.update.mockResolvedValue(undefined as any);

      const result = await service.updateDepartment(
        'd1',
        { departmentName: 'Phòng CNTT' },
        'updater-id',
        {},
      );

      expect(result.departmentName).toBe('Phòng CNTT');
      expect(em.update).toHaveBeenCalled();
    });

    it('parentDepartmentId = chính id đang sửa → 422 VALIDATION_ERROR', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity && options?.where?.id === 'd1') {
          return baseDept();
        }
        return null;
      });

      await expect(
        service.updateDepartment(
          'd1',
          { parentDepartmentId: 'd1' },
          'updater-id',
          {},
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('parentDepartmentId trỏ vào hậu duệ của chính nó → 422 (chu trình)', async () => {
      // d1 (đang sửa) là cha của d2; thử set cha của d1 = d2 -> chu trình
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.id === 'd1' && !options?.select)
            return baseDept();
          if (options?.where?.id === 'd2' && !options?.select) {
            return baseDept({ id: 'd2', parentDepartmentId: 'd1' });
          }
          // wouldCreateCycle / calcDepth traversal (dùng select)
          if (options?.select) {
            if (options.where.id === 'd2') {
              return { id: 'd2', parentDepartmentId: 'd1' };
            }
            if (options.where.id === 'd1') {
              return { id: 'd1', parentDepartmentId: null };
            }
          }
        }
        return null;
      });

      await expect(
        service.updateDepartment(
          'd1',
          { parentDepartmentId: 'd2' },
          'updater-id',
          {},
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('parentDepartmentId không tồn tại/không active → 404 RESOURCE_NOT_FOUND', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.id === 'd1') return baseDept();
          if (options?.where?.id === 'ghost') return null;
        }
        return null;
      });

      await expect(
        service.updateDepartment(
          'd1',
          { parentDepartmentId: 'ghost' },
          'updater-id',
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('đổi parent vượt quá 5 cấp → 422 VALIDATION_ERROR', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.id === 'd1' && !options?.select)
            return baseDept();
          if (options?.where?.id === 'deep-parent') {
            return options?.select
              ? { id: 'deep-parent', parentDepartmentId: 'level4' }
              : {
                  id: 'deep-parent',
                  isActive: true,
                  parentDepartmentId: 'level4',
                };
          }
          if (options?.where?.id === 'level4')
            return { id: 'level4', parentDepartmentId: 'level3' };
          if (options?.where?.id === 'level3')
            return { id: 'level3', parentDepartmentId: 'level2' };
          if (options?.where?.id === 'level2')
            return { id: 'level2', parentDepartmentId: 'level1' };
          if (options?.where?.id === 'level1')
            return { id: 'level1', parentDepartmentId: null };
        }
        return null;
      });

      await expect(
        service.updateDepartment(
          'd1',
          { parentDepartmentId: 'deep-parent' },
          'updater-id',
          {},
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('managerUserId không tồn tại/không active → 404 RESOURCE_NOT_FOUND', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity && options?.where?.id === 'd1') {
          return baseDept();
        }
        if (entityClass === UserEntity) return null;
        return null;
      });

      await expect(
        service.updateDepartment(
          'd1',
          { managerUserId: 'ghost-user' },
          'updater-id',
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('chỉ gửi 1 field (description) → chỉ field đó đổi, các field khác giữ nguyên', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity && options?.where?.id === 'd1') {
          return baseDept({ managerUserId: 'm1', parentDepartmentId: 'p1' });
        }
        return null;
      });
      em.update.mockResolvedValue(undefined as any);
      userRepo.count.mockResolvedValue(4);

      const result = await service.updateDepartment(
        'd1',
        { description: 'Mô tả mới' },
        'updater-id',
        {},
      );

      expect(result.description).toBe('Mô tả mới');
      expect(result.managerUserId).toBe('m1');
      expect(result.parentDepartmentId).toBe('p1');
      expect(result.departmentName).toBe('Phòng CNTT');
      expect(result.memberCount).toBe(4);
    });

    it('clear parent/manager bằng null → cập nhật thành null', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity && options?.where?.id === 'd1') {
          return baseDept({ managerUserId: 'm1', parentDepartmentId: 'p1' });
        }
        return null;
      });
      em.update.mockResolvedValue(undefined as any);

      const result = await service.updateDepartment(
        'd1',
        { parentDepartmentId: null, managerUserId: null },
        'updater-id',
        {},
      );

      expect(result.parentDepartmentId).toBeNull();
      expect(result.managerUserId).toBeNull();
    });

    it('ghi audit log khi cập nhật thành công', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity && options?.where?.id === 'd1') {
          return baseDept();
        }
        return null;
      });
      em.update.mockResolvedValue(undefined as any);
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);

      await service.updateDepartment(
        'd1',
        { description: 'mo ta moi' },
        'updater-id',
        {
          ipAddress: '127.0.0.1',
        },
      );

      expect(em.save).toHaveBeenCalled();
    });
  });

  describe('listDepartments', () => {
    const deptRow = (over: Partial<DepartmentEntity> = {}) =>
      ({
        id: 'd1',
        departmentCode: 'IT',
        departmentName: 'CNTT',
        parentDepartmentId: null,
        managerUserId: null,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...over,
      }) as DepartmentEntity;

    it('list rỗng → data [], meta total 0 / totalPages 0', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      const r = await service.listDepartments({});
      expect(r.data).toEqual([]);
      expect(r.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
    });

    it('phân trang: page=2 limit=5, total=12 → skip 5 take 5, totalPages 3', async () => {
      repo.findAndCount.mockResolvedValue([[deptRow()], 12]);
      const r = await service.listDepartments({ page: 2, limit: 5 });
      const opts = repo.findAndCount.mock.calls[0][0];
      expect(opts.skip).toBe(5);
      expect(opts.take).toBe(5);
      expect(r.meta).toEqual({ page: 2, limit: 5, total: 12, totalPages: 3 });
      expect(r.data[0].departmentCode).toBe('IT');
    });

    it('search → where OR trên departmentName/departmentCode (ILIKE)', async () => {
      repo.findAndCount.mockResolvedValue([[deptRow()], 1]);
      await service.listDepartments({ search: 'cntt' });
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect(Array.isArray(where)).toBe(true);
      expect(where).toHaveLength(2);
      // mỗi nhánh giữ deletedAt filter + 1 field ILike
      expect(where[0]).toHaveProperty('departmentName');
      expect(where[1]).toHaveProperty('departmentCode');
    });

    it('parentId → where lọc parentDepartmentId (không search → object đơn)', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.listDepartments({ parentId: 'parent-uuid' });
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect(Array.isArray(where)).toBe(false);
      expect(where.parentDepartmentId).toBe('parent-uuid');
    });

    it('map entity → response đúng field (id/code/name/parentId/managerId/createdAt)', async () => {
      repo.findAndCount.mockResolvedValue([
        [deptRow({ managerUserId: 'm1', parentDepartmentId: 'p1' })],
        1,
      ]);
      const r = await service.listDepartments({});
      expect(r.data[0]).toMatchObject({
        id: 'd1',
        departmentCode: 'IT',
        departmentName: 'CNTT',
        parentDepartmentId: 'p1',
        managerUserId: 'm1',
      });
      expect(r.data[0].createdAt).toBeInstanceOf(Date);
    });

    it('memberCount: gắn đúng số lượng theo kết quả GROUP BY batch query (1 query cho cả trang)', async () => {
      repo.findAndCount.mockResolvedValue([
        [deptRow({ id: 'd1' }), deptRow({ id: 'd2' }), deptRow({ id: 'd3' })],
        3,
      ]);
      userQueryBuilder.getRawMany.mockResolvedValue([
        { departmentId: 'd1', count: '5' },
        { departmentId: 'd2', count: '0' },
        // d3 không xuất hiện trong kết quả GROUP BY (0 nhân viên)
      ]);

      const r = await service.listDepartments({});

      expect(userRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(userQueryBuilder.where).toHaveBeenCalledWith(
        'u.departmentId IN (:...departmentIds)',
        { departmentIds: ['d1', 'd2', 'd3'] },
      );
      expect(r.data.find((d) => d.id === 'd1')?.memberCount).toBe(5);
      expect(r.data.find((d) => d.id === 'd2')?.memberCount).toBe(0);
      expect(r.data.find((d) => d.id === 'd3')?.memberCount).toBe(0);
    });

    it('tách số cán bộ / SV: staffCount = memberCount - studentCount (SV gắn vào khoa)', async () => {
      repo.findAndCount.mockResolvedValue([
        [deptRow({ id: 'd1' }), deptRow({ id: 'd2' })],
        2,
      ]);
      userQueryBuilder.getRawMany.mockResolvedValue([
        { departmentId: 'd1', count: '3469', students: '3406' },
      ]);

      const r = await service.listDepartments({});

      expect(r.data.find((d) => d.id === 'd1')).toMatchObject({
        memberCount: 3469,
        staffCount: 63,
        studentCount: 3406,
      });
      expect(r.data.find((d) => d.id === 'd2')).toMatchObject({
        memberCount: 0,
        staffCount: 0,
        studentCount: 0,
      });
    });

    it('memberCount: list rỗng → KHÔNG gọi batch query (tránh query thừa)', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.listDepartments({});
      expect(userRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('listDepartmentMembers', () => {
    const dept = (over: Partial<DepartmentEntity> = {}) =>
      ({
        id: 'd1',
        departmentCode: 'IT',
        departmentName: 'CNTT',
        parentDepartmentId: null,
        managerUserId: null,
        description: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...over,
      }) as DepartmentEntity;

    const user = (over: Record<string, unknown> = {}) => ({
      id: 'u1',
      employeeCode: 'EMP001',
      fullName: 'Nguyễn Văn A',
      email: 'a@company.com',
      phoneNumber: null,
      avatarUrl: null,
      positionTitle: 'Backend Engineer',
      employmentStatus: 'active',
      ...over,
    });

    it('[AC-005] phòng ban không tồn tại → NotFoundException DEPARTMENT_NOT_FOUND', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.listDepartmentMembers('missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(userRepo.find).not.toHaveBeenCalled();
    });

    it('[AC-006] phòng ban tồn tại nhưng 0 nhân viên hợp lệ → trả mảng rỗng', async () => {
      repo.findOne.mockResolvedValue(dept());
      userRepo.find.mockResolvedValue([]);

      const result = await service.listDepartmentMembers('d1');

      expect(result).toEqual([]);
    });

    it('[AC-001] trả đúng danh sách nhân viên trực thuộc phòng ban, đã lọc qua where (active/probation + account active)', async () => {
      repo.findOne.mockResolvedValue(dept());
      userRepo.find.mockResolvedValue([
        user({ id: 'u1', fullName: 'Nguyễn Văn A' }),
        user({
          id: 'u2',
          fullName: 'Trần Thị B',
          employmentStatus: 'probation',
        }),
      ]);

      const result = await service.listDepartmentMembers('d1');

      expect(result).toHaveLength(2);
      const whereArg = userRepo.find.mock.calls[0][0].where;
      expect(whereArg.departmentId).toBe('d1');
      expect(whereArg.accountStatus).toBe('active');
      expect(result[0].departmentCode).toBe('IT');
      expect(result[0].departmentName).toBe('CNTT');
    });

    it('[AC-004] gắn isDepartmentManager=true đúng người khớp manager_user_id và đưa lên đầu danh sách', async () => {
      repo.findOne.mockResolvedValue(dept({ managerUserId: 'u2' }));
      userRepo.find.mockResolvedValue([
        user({ id: 'u1', fullName: 'An Nguyễn' }),
        user({ id: 'u2', fullName: 'Zoe Trần' }),
      ]);

      const result = await service.listDepartmentMembers('d1');

      expect(result[0].id).toBe('u2');
      expect(result[0].isDepartmentManager).toBe(true);
      expect(result[1].isDepartmentManager).toBe(false);
    });

    it('sort theo fullName khi không ai là trưởng phòng', async () => {
      repo.findOne.mockResolvedValue(dept({ managerUserId: null }));
      userRepo.find.mockResolvedValue([
        user({ id: 'u1', fullName: 'Zoe' }),
        user({ id: 'u2', fullName: 'An' }),
      ]);

      const result = await service.listDepartmentMembers('d1');

      expect(result.map((r) => r.fullName)).toEqual(['An', 'Zoe']);
    });

    it('[AC-008] response không chứa passwordHash hay field ngoài DTO', async () => {
      repo.findOne.mockResolvedValue(dept());
      userRepo.find.mockResolvedValue([user()]);

      const result = await service.listDepartmentMembers('d1');

      expect(result[0]).not.toHaveProperty('passwordHash');
      expect(Object.keys(result[0]).sort()).toEqual(
        [
          'id',
          'departmentCode',
          'departmentName',
          'employeeCode',
          'fullName',
          'email',
          'phoneNumber',
          'avatarUrl',
          'positionTitle',
          'employmentStatus',
          'isDepartmentManager',
        ].sort(),
      );
    });
  });

  describe('PTA partner department protection', () => {
    it('blocks update of the fixed partner department for any actor', async () => {
      em.findOne.mockResolvedValue({
        id: '7c3e2f1a-4b6a-4f2e-9d8c-1a2b3c4d5e6f',
        departmentCode: 'PARTNER',
        departmentName: 'Đối tác',
        parentDepartmentId: null,
        managerUserId: null,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        service.updateDepartment(
          '7c3e2f1a-4b6a-4f2e-9d8c-1a2b3c4d5e6f',
          { departmentName: 'Renamed' },
          'system-admin',
          {},
        ),
      ).rejects.toMatchObject({
        response: { error: { code: 'PARTNER_DEPARTMENT_PROTECTED' } },
        status: 403,
      });
    });

    it('allows update of other departments', async () => {
      const dept = {
        id: 'other-dept',
        departmentName: 'IT',
        parentDepartmentId: null,
        managerUserId: null,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      em.findOne.mockResolvedValue(dept);

      const result = await service.updateDepartment(
        'other-dept',
        { departmentName: 'Phong IT' },
        'admin',
        {},
      );
      expect(result.id).toBe('other-dept');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ACCT-DEPT-DETAIL-001 — getDepartmentById
  // ─────────────────────────────────────────────────────────────────────────

  describe('getDepartmentById', () => {
    const baseDept = {
      id: 'dept-uuid',
      departmentCode: 'IT',
      departmentName: 'Phòng Công nghệ thông tin',
      parentDepartmentId: null,
      managerUserId: null,
      description: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    it('[AC-001] tìm thấy phòng ban active → trả về DepartmentResponseDto đúng shape', async () => {
      repo.findOne.mockResolvedValue(baseDept);

      const result = await service.getDepartmentById('dept-uuid');

      expect(result.id).toBe('dept-uuid');
      expect(result.departmentCode).toBe('IT');
      expect(result.isActive).toBe(true);
      expect(dataSource.getRepository).toHaveBeenCalledWith(DepartmentEntity);
    });

    it('[AC-002] phòng ban isActive=false → vẫn trả về (không lọc theo trạng thái)', async () => {
      repo.findOne.mockResolvedValue({ ...baseDept, isActive: false });

      const result = await service.getDepartmentById('dept-uuid');

      expect(result.isActive).toBe(false);
    });

    it('memberCount: trả đúng số nhân viên active đang trực thuộc, lọc qua UserEntity.count()', async () => {
      repo.findOne.mockResolvedValue(baseDept);
      userRepo.count.mockResolvedValue(7);

      const result = await service.getDepartmentById('dept-uuid');

      expect(result.memberCount).toBe(7);
      expect(userRepo.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ departmentId: 'dept-uuid' }),
      });
    });

    it('[AC-003] id không tồn tại → ném NotFoundException DEPARTMENT_NOT_FOUND', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.getDepartmentById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.getDepartmentById('nonexistent'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({ code: 'DEPARTMENT_NOT_FOUND' }),
        }),
      });
    });

    it('[AC-004] id của bản ghi đã soft-delete → ném NotFoundException (findOne trả null vì where deletedAt IS NULL)', async () => {
      // repo.findOne với where {deletedAt: IsNull()} sẽ trả null cho bản ghi deleted
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.getDepartmentById('soft-deleted-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ACCT-DEPT-DEACTIVATE-001 — deactivateDepartment
  // ─────────────────────────────────────────────────────────────────────────

  describe('deactivateDepartment', () => {
    const activeDept = {
      id: 'dept-active',
      departmentCode: 'IT',
      departmentName: 'Phòng IT',
      parentDepartmentId: null,
      managerUserId: null,
      description: null,
      isActive: true,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockResolvedValue({});
    });

    it('[AC-001] Happy path: deactivate thành công → isActive=false, audit ghi', async () => {
      em.findOne.mockResolvedValue(activeDept); // BR-01 OK
      em.find.mockResolvedValue([]); // BR-04: không có con active
      em.count = jest.fn().mockResolvedValue(0); // BR-05: không có nhân viên active
      em.update = jest.fn().mockResolvedValue(undefined);

      const result = await service.deactivateDepartment(
        'dept-active',
        'actor-id',
        {},
      );

      expect(result.isActive).toBe(false);
      // BR-05 vừa xác nhận 0 nhân viên active nên response memberCount phải là 0.
      expect(result.memberCount).toBe(0);
      expect(em.update).toHaveBeenCalledWith(
        DepartmentEntity,
        'dept-active',
        expect.objectContaining({ isActive: false }),
      );
    });

    it('[BR-02] PARTNER_DEPARTMENT_ID → ném ForbiddenException PARTNER_DEPARTMENT_PROTECTED', async () => {
      em.findOne.mockResolvedValue({
        ...activeDept,
        id: PARTNER_DEPARTMENT_ID,
        departmentCode: 'PARTNER',
      });

      await expect(
        service.deactivateDepartment(PARTNER_DEPARTMENT_ID, 'actor', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('[BR-03] đã inactive → ném ConflictException DEPARTMENT_ALREADY_INACTIVE', async () => {
      em.findOne.mockResolvedValue({ ...activeDept, isActive: false });

      await expect(
        service.deactivateDepartment('dept-active', 'actor', {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({
            code: 'DEPARTMENT_ALREADY_INACTIVE',
          }),
        }),
      });
    });

    it('[BR-04] còn phòng ban con active → ném ConflictException DEPARTMENT_HAS_ACTIVE_CHILDREN', async () => {
      em.findOne.mockResolvedValue(activeDept);
      em.find.mockResolvedValue([{ id: 'child-uuid' }]); // có con active

      await expect(
        service.deactivateDepartment('dept-active', 'actor', {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({
            code: 'DEPARTMENT_HAS_ACTIVE_CHILDREN',
          }),
        }),
      });
    });

    it('[BR-05] còn nhân viên active → ném ConflictException DEPARTMENT_HAS_ACTIVE_MEMBERS', async () => {
      em.findOne.mockResolvedValue(activeDept);
      em.find.mockResolvedValue([]); // không có con active
      em.count = jest.fn().mockResolvedValue(3); // có 3 nhân viên active

      await expect(
        service.deactivateDepartment('dept-active', 'actor', {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({
            code: 'DEPARTMENT_HAS_ACTIVE_MEMBERS',
          }),
        }),
      });
    });

    it('[BR-01] phòng ban không tồn tại → ném NotFoundException DEPARTMENT_NOT_FOUND', async () => {
      em.findOne.mockResolvedValue(null);

      await expect(
        service.deactivateDepartment('nonexistent', 'actor', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ACCT-DEPT-DEACTIVATE-001 — reactivateDepartment
  // ─────────────────────────────────────────────────────────────────────────

  describe('reactivateDepartment', () => {
    const inactiveDept = {
      id: 'dept-inactive',
      departmentCode: 'HR',
      departmentName: 'Phòng Nhân sự',
      parentDepartmentId: null,
      managerUserId: null,
      description: null,
      isActive: false,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockResolvedValue({});
      em.update = jest.fn().mockResolvedValue(undefined);
    });

    it('[AC-006] Happy path: không có cha → reactivate thành công → isActive=true', async () => {
      em.findOne.mockResolvedValue(inactiveDept); // dept, no parent

      const result = await service.reactivateDepartment(
        'dept-inactive',
        'actor',
        {},
      );

      expect(result.isActive).toBe(true);
      // Phòng ban inactive không thể nhận nhân viên mới trong lúc tắt.
      expect(result.memberCount).toBe(0);
      expect(em.update).toHaveBeenCalledWith(
        DepartmentEntity,
        'dept-inactive',
        expect.objectContaining({ isActive: true }),
      );
    });

    it('[AC-006b] Có cha active → reactivate thành công', async () => {
      const deptWithParent = {
        ...inactiveDept,
        parentDepartmentId: 'parent-uuid',
      };
      const activePart = { id: 'parent-uuid', isActive: true };

      em.findOne
        .mockResolvedValueOnce(deptWithParent) // find dept
        .mockResolvedValueOnce(activePart); // find parent

      const result = await service.reactivateDepartment(
        'dept-inactive',
        'actor',
        {},
      );

      expect(result.isActive).toBe(true);
    });

    it('[BR-07] đã active → ném ConflictException DEPARTMENT_ALREADY_ACTIVE', async () => {
      em.findOne.mockResolvedValue({ ...inactiveDept, isActive: true });

      await expect(
        service.reactivateDepartment('dept-inactive', 'actor', {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({ code: 'DEPARTMENT_ALREADY_ACTIVE' }),
        }),
      });
    });

    it('[BR-08] cha đang inactive → ném ConflictException PARENT_DEPARTMENT_INACTIVE', async () => {
      const deptWithParent = {
        ...inactiveDept,
        parentDepartmentId: 'parent-uuid',
      };
      const inactiveParent = { id: 'parent-uuid', isActive: false };

      em.findOne
        .mockResolvedValueOnce(deptWithParent)
        .mockResolvedValueOnce(inactiveParent);

      await expect(
        service.reactivateDepartment('dept-inactive', 'actor', {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({
            code: 'PARENT_DEPARTMENT_INACTIVE',
          }),
        }),
      });
    });

    it('[BR-06] phòng ban không tồn tại → ném NotFoundException DEPARTMENT_NOT_FOUND', async () => {
      em.findOne.mockResolvedValue(null);

      await expect(
        service.reactivateDepartment('nonexistent', 'actor', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('[spec §1 quyết định 4] PARTNER_DEPARTMENT_ID không bị chặn khi reactivate', async () => {
      const partnerDeptInactive = {
        ...inactiveDept,
        id: PARTNER_DEPARTMENT_ID,
      };
      em.findOne.mockResolvedValue(partnerDeptInactive);

      // Không throw ForbiddenException — chỉ kiểm tra không bị lỗi 403
      const result = await service.reactivateDepartment(
        PARTNER_DEPARTMENT_ID,
        'actor',
        {},
      );
      expect(result.isActive).toBe(true);
    });
  });
});
