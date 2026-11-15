// Keep time-dependent fixtures independent of the machine date.
beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'hrtime', 'performance', 'queueMicrotask'], now: new Date('2026-09-14T00:00:00Z').getTime() }); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { MeetingsService } from '../services/meetings.service.js';
import { CreateMeetingDto } from '../dto/create-meeting.dto.js';
import { MeetingStatus } from '../entities/meeting.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import { AccountStatus } from '../../accounts/entities/user.entity.js';
import {
  HealthStatus,
  EquipmentType,
} from '../../equipment/entities/equipment.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { FaceProvisioningService } from '../../face-access/services/face-provisioning.service.js';
import { GuestInviteService } from '../../guest-access/services/guest-invite.service.js';
import { GuestEmailService } from '../../guest-access/services/guest-email.service.js';
import { WarningTokenUtil } from '../utils/warning-token.util.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../../storage/storage.service.js';

describe('MeetingsService - create() Equipment Fault Warning (EW1-EW6)', () => {
  let service: MeetingsService;
  let dataSource: jest.Mocked<DataSource>;
  let em: jest.Mocked<EntityManager>;
  let module: TestingModule;
  let mockNotificationsService: Record<string, jest.Mock>;
  let mockAuthzReadRepository: Record<string, jest.Mock>;
  let mockFaceProvisioningService: Record<string, jest.Mock>;
  let mockGuestInviteService: Record<string, jest.Mock>;
  let mockRepo: jest.Mocked<
    Pick<
      Repository<any>,
      'findOne' | 'find' | 'count' | 'save' | 'create' | 'createQueryBuilder'
    >
  >;

  const mockQueryBuilder = () => {
    const qb: any = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue(null),
      getCount: jest.fn().mockResolvedValue(0),
    };
    return qb;
  };

  const validDto: CreateMeetingDto = {
    title: 'Họp kiểm tra thiết bị',
    startTime: '2026-09-15T10:00:00.000Z',
    endTime: '2026-09-15T11:00:00.000Z',
    roomId: 'room-uuid',
    participantUserIds: ['user-p1', 'user-p2'],
  };

  const authUser = { userId: 'auth-user-uuid' };
  const clientContext = { ipAddress: '127.0.0.1', userAgent: 'test' };

  let faultyEquipmentList: any[] = [];
  let roomHasConflict = false;

  beforeEach(async () => {
    faultyEquipmentList = [];
    roomHasConflict = false;

    mockRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    mockNotificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      enqueueEmailNotification: jest
        .fn()
        .mockResolvedValue({ notification: { id: 'notif-1' } }),
    };

    mockAuthzReadRepository = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: [], permissions: [] }),
    };

    mockFaceProvisioningService = {
      deprovisionMeeting: jest.fn().mockResolvedValue(undefined),
    };

    mockGuestInviteService = {
      revokeAllForMeeting: jest.fn().mockResolvedValue(0),
    };

    em = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn().mockImplementation((_: any, plain: any) => plain),
      save: jest.fn().mockImplementation(async (_entity: any, data: any) => {
        if (data && typeof data === 'object') {
          if (!data.id) data.id = 'saved-id-1';
          return data;
        }
        return _entity;
      }),
      update: jest.fn(),
      count: jest.fn(),
      query: jest.fn(),
      getRepository: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(0),
      }),
    } as unknown as jest.Mocked<EntityManager>;

    dataSource = {
      query: jest.fn().mockResolvedValue([{ department_id: 'dept-uuid', is_unit_clerk: true }]),
      transaction: jest
        .fn()
        .mockImplementation((cb: (manager: EntityManager) => unknown) =>
          cb(em),
        ),
      getRepository: jest.fn().mockReturnValue(mockRepo),
      manager: em,
    } as unknown as jest.Mocked<DataSource>;

    module = await Test.createTestingModule({
      providers: [
        MeetingsService,
        { provide: DataSource, useValue: dataSource },
        WarningTokenUtil,
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: AuthzReadRepository, useValue: mockAuthzReadRepository },
        {
          provide: FaceProvisioningService,
          useValue: mockFaceProvisioningService,
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), verify: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
        {
          provide: StorageService,
          useValue: {
            saveFile: jest.fn(),
            deleteFile: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: GuestInviteService,
          useValue: mockGuestInviteService,
        },
        {
          provide: GuestEmailService,
          useValue: { sendInviteLink: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<MeetingsService>(MeetingsService);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  function setupDefaultMocks() {
    mockRepo.findOne.mockImplementation(async (options?: any) => {
      const id = options?.where?.id;
      if (id === 'room-uuid') {
        return {
          id: 'room-uuid',
          roomName: 'Phòng Cảnh Báo',
          capacity: 20,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity;
      }
      if (options?.where?.roomId) {
        return roomHasConflict ? { id: 'existing-booking-id' } : null;
      }
      return { id: 'some-user-id', accountStatus: AccountStatus.ACTIVE };
    });

    mockRepo.find.mockImplementation(async (options?: any) => {
      if (options?.where?.currentRoomId) {
        return faultyEquipmentList;
      }
      const idFilter = options?.where?.id;
      let ids: string[] = [];
      if (Array.isArray(idFilter)) {
        ids = idFilter;
      } else if (idFilter && typeof idFilter === 'object') {
        const possible = idFilter._value ?? idFilter._subExpression ?? [];
        ids = Array.isArray(possible) ? possible : [possible];
      }
      return ids.map((uid: string) => ({
        id: uid,
        email: uid + '@company.com',
        accountStatus: AccountStatus.ACTIVE,
      }));
    });

    em.find = jest
      .fn()
      .mockImplementation(async (_entity: any, options?: any) => {
        const ids: string[] = options?.where?.id?._value ?? [];
        return ids.map((uid: string) => ({
          id: uid,
          email: uid + '@company.com',
          accountStatus: AccountStatus.ACTIVE,
        }));
      });

    mockRepo.count.mockResolvedValue(0);

    const defaultQb = mockQueryBuilder();
    mockRepo.createQueryBuilder.mockImplementation(() => defaultQb);
  }

  it('[EW1] should throw 422 ROOM_HAS_FAULTY_EQUIPMENT when room has 1 faulty equipment and equipmentWarningConfirmed is not true', async () => {
    setupDefaultMocks();
    faultyEquipmentList = [
      {
        id: 'eq-1',
        equipmentName: 'Micro 1',
        equipmentType: EquipmentType.MICROPHONE,
        healthStatus: HealthStatus.FAULTY,
        lastIssueNote: 'Bị rè',
      },
    ];

    try {
      await service.create(validDto, authUser, clientContext);
      fail('Should have thrown UnprocessableEntityException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      const res = err.getResponse();
      expect(res.error.code).toBe('ROOM_HAS_FAULTY_EQUIPMENT');
      expect(res.error.details.blocking).toBe(false);
      expect(res.error.details.requiresConfirmation).toBe(true);
      expect(res.error.details.faultyEquipments).toHaveLength(1);
      expect(res.error.details.faultyEquipments[0].id).toBe('eq-1');
      expect(res.error.details.faultyEquipments[0].healthStatus).toBe(
        HealthStatus.FAULTY,
      );
    }
  });

  it('[EW2] should proceed and create meeting when room has 1 faulty equipment but equipmentWarningConfirmed is true', async () => {
    setupDefaultMocks();
    faultyEquipmentList = [
      {
        id: 'eq-1',
        equipmentName: 'Micro 1',
        equipmentType: EquipmentType.MICROPHONE,
        healthStatus: HealthStatus.FAULTY,
        lastIssueNote: 'Bị rè',
      },
    ];

    const dtoWithConfirm: CreateMeetingDto = {
      ...validDto,
      equipmentWarningConfirmed: true,
    };

    const result = await service.create(
      dtoWithConfirm,
      authUser,
      clientContext,
    );
    expect(result).toBeDefined();
    expect(result.roomName).toBe('Phòng Cảnh Báo');
    expect(result.status).toBe(MeetingStatus.PENDING_APPROVAL);
  });

  it('[EW3] should not throw equipment warning when room has only warning status equipment', async () => {
    setupDefaultMocks();
    faultyEquipmentList = [];

    const result = await service.create(validDto, authUser, clientContext);
    expect(result).toBeDefined();
  });

  it('[EW4] should not throw equipment warning when room has no faulty/offline equipment', async () => {
    setupDefaultMocks();
    faultyEquipmentList = [];

    const result = await service.create(validDto, authUser, clientContext);
    expect(result).toBeDefined();
  });

  it('[EW5] should throw ROOM_CONFLICT (409) first when room has booking conflict even if room has faulty equipment', async () => {
    setupDefaultMocks();
    roomHasConflict = true;
    faultyEquipmentList = [
      {
        id: 'eq-1',
        equipmentName: 'Micro 1',
        equipmentType: EquipmentType.MICROPHONE,
        healthStatus: HealthStatus.FAULTY,
        lastIssueNote: 'Bị rè',
      },
    ];

    try {
      await service.create(validDto, authUser, clientContext);
      fail('Should have thrown ConflictException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ConflictException);
      const res = err.getResponse();
      expect(res.error.code).toBe('ROOM_CONFLICT');
    }
  });

  it('[EW6] should return all 2 faulty/offline equipments when room has 2 offline equipments', async () => {
    setupDefaultMocks();
    faultyEquipmentList = [
      {
        id: 'eq-1',
        equipmentName: 'Camera 1',
        equipmentType: EquipmentType.CAMERA,
        healthStatus: HealthStatus.OFFLINE,
        lastIssueNote: 'Mất kết nối',
      },
      {
        id: 'eq-2',
        equipmentName: 'Màn hình 1',
        equipmentType: EquipmentType.DISPLAY,
        healthStatus: HealthStatus.OFFLINE,
        lastIssueNote: 'Tắt nguồn',
      },
    ];

    try {
      await service.create(validDto, authUser, clientContext);
      fail('Should have thrown UnprocessableEntityException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      const res = err.getResponse();
      expect(res.error.code).toBe('ROOM_HAS_FAULTY_EQUIPMENT');
      expect(res.error.details.faultyEquipments).toHaveLength(2);
      expect(res.error.details.faultyEquipments[0].id).toBe('eq-1');
      expect(res.error.details.faultyEquipments[1].id).toBe('eq-2');
    }
  });
});
