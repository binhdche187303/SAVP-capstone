// Keep time-dependent fixtures independent of the machine date.
beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'hrtime', 'performance', 'queueMicrotask'], now: new Date('2026-06-30T00:00:00Z').getTime() }); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import {
  DataSource,
  EntityManager,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';

import { MeetingsService } from './meetings.service.js';
import { CreateMeetingDto } from '../dto/create-meeting.dto.js';
import {
  MeetingEntity,
  MeetingStatus,
  MeetingType,
  MeetingMode,
} from '../entities/meeting.entity.js';
import {
  MeetingRequestEntity,
  MeetingRequestType,
  ApprovalMode,
  ApprovalStatus,
  ConflictCheckStatus,
} from '../entities/meeting-request.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
  InvitationStatus,
  ParticipantAttendanceStatus,
} from '../entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../entities/meeting-external-participant.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
} from '../entities/meeting-event.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
  BookingType,
} from '../../rooms/entities/room-booking.entity.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import {
  UserEntity,
  AccountStatus,
} from '../../accounts/entities/user.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import { WarningTokenUtil } from '../utils/warning-token.util.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { FaceProvisioningService } from '../../face-access/services/face-provisioning.service.js';
import { GuestInviteService } from '../../guest-access/services/guest-invite.service.js';
import { GuestEmailService } from '../../guest-access/services/guest-email.service.js';
import { StorageService } from '../../storage/storage.service.js';

describe('MeetingsService', () => {
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
      // Bug 1: generateMeetingCode dùng withDeleted() (bản soft-delete vẫn chiếm
      // ux_meetings_code) + getCount() để kiểm tồn tại trước khi trả mã.
      withDeleted: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      getOne: jest.fn(),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn(),
      getCount: jest.fn(),
    };
    return qb;
  };

  /** yyyyMMdd hôm nay — mã sinh ra gắn ngày nên test phải dựng prefix cùng cách. */
  const todayStamp = () => {
    const d = new Date();
    return (
      d.getFullYear().toString() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0')
    );
  };

  beforeEach(async () => {
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
      issueInvite: jest.fn(),
    };

    em = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      query: jest.fn().mockResolvedValue([]),
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
          // GLA-001: cancelMeeting() gọi revokeAllForMeeting() best-effort
          // sau transaction — mock để không phá vỡ toàn bộ suite hiện có.
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
    jest.spyOn(service as any, 'getIneligibleMeetingUserIds').mockResolvedValue(new Set());
    jest.spyOn(service as any, 'getActiveRoleCodes').mockResolvedValue(['EMPLOYEE']);
    jest.spyOn(service as any, 'generateRequestCodeTransaction').mockResolvedValue('RQ-20260630-001');
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRoomAvailability', () => {
    it('[T013] should return no conflict when room is available', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      const result = await service.getRoomAvailability(
        'room-uuid',
        new Date('2026-07-01T10:00:00Z'),
        new Date('2026-07-01T11:00:00Z'),
      );

      expect(result.hasConflict).toBe(false);
      expect(result.conflictingBookingId).toBeNull();
    });

    it('[T013] should return conflict when room has overlapping booking', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'booking-uuid' });

      const result = await service.getRoomAvailability(
        'room-uuid',
        new Date('2026-07-01T10:00:00Z'),
        new Date('2026-07-01T11:00:00Z'),
      );

      expect(result.hasConflict).toBe(true);
      expect(result.conflictingBookingId).toBe('booking-uuid');
    });
  });

  describe('generateMeetingCode', () => {
    /** existing = mã đã tồn tại hôm nay; takenCodes = mã bị coi là đã chiếm khi kiểm. */
    const wireCodes = (existing: string[], takenCodes: string[] = []) => {
      const qb = mockQueryBuilder();
      qb.getRawMany.mockResolvedValue(existing.map((code) => ({ code })));
      qb.getCount.mockImplementation(() => {
        const called = qb.where.mock.calls.at(-1);
        const code = called?.[1]?.code as string | undefined;
        return Promise.resolve(code && takenCodes.includes(code) ? 1 : 0);
      });
      mockRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    };

    it('[T014] should generate code in MT-YYYYMMDD-NNN format', async () => {
      wireCodes([]);
      const code = await service.generateMeetingCode();
      expect(code).toMatch(/^MT-\d{8}-001$/);
    });

    it('[T014] should increment sequence number', async () => {
      wireCodes([`MT-${todayStamp()}-005`]);
      const code = await service.generateMeetingCode();
      expect(code).toMatch(/^MT-\d{8}-006$/);
    });

    // Bug 1 (regression): bản cũ dùng count() bản ghi ĐANG SỐNG nên xóa 1 họp là seq
    // tụt lại, sinh trùng mã đã cấp → 23505 ux_meetings_code.
    it('Bug1: tính cả mã của bản ghi soft-delete (withDeleted) — KHÔNG cấp lại seq cũ', async () => {
      const qb = wireCodes([
        `MT-${todayStamp()}-001`,
        `MT-${todayStamp()}-002`, // giả sử họp này đã bị xóa mềm
      ]);
      const code = await service.generateMeetingCode();
      expect(code).toBe(`MT-${todayStamp()}-003`);
      expect(qb.withDeleted).toHaveBeenCalled();
    });

    it('Bug1: mã dự kiến đã bị chiếm (race) → tự tăng tiếp, không trả mã trùng', async () => {
      const taken = `MT-${todayStamp()}-001`;
      wireCodes([], [taken]);
      const code = await service.generateMeetingCode();
      expect(code).not.toBe(taken);
      expect(code).toBe(`MT-${todayStamp()}-002`);
    });
  });

  describe('generateBookingCode', () => {
    const wireBooking = (existing: string[]) => {
      const qb = mockQueryBuilder();
      qb.getRawMany.mockResolvedValue(existing.map((code) => ({ code })));
      qb.getCount.mockResolvedValue(0);
      mockRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    };

    it('[T015] should generate code in BK-YYYYMMDD-NNN format', async () => {
      wireBooking([`BK-${todayStamp()}-002`]);
      const code = await service.generateBookingCode();
      expect(code).toMatch(/^BK-\d{8}-003$/);
    });

    it('Bug1: mã đầu tiên trong ngày → 001', async () => {
      wireBooking([]);
      const code = await service.generateBookingCode();
      expect(code).toBe(`BK-${todayStamp()}-001`);
    });
  });

  describe('checkParticipantConflicts', () => {
    const startTime = new Date('2026-07-01T10:00:00Z');
    const endTime = new Date('2026-07-01T11:00:00Z');

    it('[T015b] should return empty conflicts when no participants', async () => {
      const result = await service.checkParticipantConflicts(
        [],
        startTime,
        endTime,
      );

      expect(result.conflicts).toHaveLength(0);
    });

    it('[T015b] should return empty conflicts when no time overlap', async () => {
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.checkParticipantConflicts(
        ['user-1'],
        startTime,
        endTime,
      );

      expect(result.conflicts).toHaveLength(0);
    });

    it('[T015b] should detect participant conflict', async () => {
      const qb = mockQueryBuilder();
      const mockMeeting = {
        title: 'Conflicting Meeting',
        id: 'meeting-2',
        startTime: new Date('2026-07-01T09:00:00Z'),
        endTime: new Date('2026-07-01T12:00:00Z'),
      };
      qb.getMany.mockResolvedValue([
        {
          userId: 'user-1',
          meeting: mockMeeting,
        } as MeetingParticipantEntity,
      ]);
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.checkParticipantConflicts(
        ['user-1'],
        startTime,
        endTime,
      );

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].userId).toBe('user-1');
      expect(result.conflicts[0].busyFrom).toBe('2026-07-01T09:00:00.000Z');
      expect(result.conflicts[0].busyTo).toBe('2026-07-01T12:00:00.000Z');
    });
  });

  describe('getAvailableRooms', () => {
    const startTime = new Date('2026-07-01T10:00:00Z');
    const endTime = new Date('2026-07-01T11:00:00Z');

    it('[T017d] should return active rooms with no conflicts', async () => {
      const roomsQb = mockQueryBuilder();
      const availableRoom = {
        id: 'room-1',
        roomCode: 'R01',
        roomName: 'Phòng A',
        capacity: 10,
        isActive: true,
        currentStatus: 'available',
      } as RoomEntity;
      roomsQb.getMany.mockResolvedValue([availableRoom]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb);

      const rooms = await service.getAvailableRooms(startTime, endTime);

      expect(rooms).toHaveLength(1);
      expect(rooms[0].id).toBe('room-1');
    });

    it('[T017d] should exclude rooms with conflicting bookings', async () => {
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([
        {
          id: 'room-1',
          capacity: 10,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
        {
          id: 'room-2',
          capacity: 15,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
      ]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([{ rb_room_id: 'room-2' }]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb);

      const rooms = await service.getAvailableRooms(startTime, endTime);

      expect(rooms).toHaveLength(1);
      expect(rooms[0].id).toBe('room-1');
    });

    it('[T017d] should filter by min capacity', async () => {
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([
        {
          id: 'room-2',
          capacity: 20,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
      ]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb);

      const rooms = await service.getAvailableRooms(startTime, endTime, 10);

      expect(rooms).toHaveLength(1);
      expect(rooms[0].id).toBe('room-2');
    });

    it('[T017d] should exclude inactive rooms', async () => {
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb);

      const rooms = await service.getAvailableRooms(startTime, endTime);

      expect(rooms).toHaveLength(0);
    });
  });

  describe('create', () => {
    beforeEach(() => {
      jest.spyOn(service, 'generateMeetingCode').mockResolvedValue('MT-20260630-001');
      jest.spyOn(service, 'generateBookingCode').mockResolvedValue('BK-20260630-001');
      jest.spyOn(service, 'generateRequestCode').mockResolvedValue('RQ-20260630-001');
    });
    const validDto: CreateMeetingDto = {
      title: 'Họp dự án',
      startTime: '2026-07-15T10:00:00.000Z',
      endTime: '2026-07-15T11:00:00.000Z',
      roomId: 'room-uuid',
      participantUserIds: ['user-p1', 'user-p2'],
    };

    const authUser = { userId: 'auth-user-uuid' };
    const clientContext = { ipAddress: '127.0.0.1', userAgent: 'test' };

    let saveSeq = 0;

    function setupDefaultMocks() {
      saveSeq = 0;
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockImplementation(async (_entity: any, data: any) => {
        if (data && typeof data === 'object') {
          if (!data.id) data.id = `saved-${++saveSeq}`;
          return data;
        }
        return _entity;
      });

      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        if (id === 'room-uuid') {
          return {
            id: 'room-uuid',
            roomName: 'Phòng A',
            capacity: 20,
            isActive: true,
            currentStatus: 'available',
          } as RoomEntity;
        }
        if (options?.where?.roomId) {
          return null;
        }
        if (options?.where?.configKey) {
          return null;
        }
        return { id: 'some-id', accountStatus: AccountStatus.ACTIVE };
      });

      mockRepo.find.mockImplementation(async (options?: any) => {
        let ids: string[] = [];
        const idFilter = options?.where?.id;
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
        .mockImplementation(async (entity: any, options?: any) => {
          const ids: string[] = options?.where?.id?._value ?? [];
          return ids.map((uid: string) => ({
            id: uid,
            email: uid + '@company.com',
            accountStatus: AccountStatus.ACTIVE,
          }));
        });
      mockRepo.count.mockResolvedValue(0);

      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      const approverQb = mockQueryBuilder();
      approverQb.getMany.mockResolvedValue([
        { id: 'approver-1' } as UserEntity,
      ]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(conflictQb)
        .mockReturnValueOnce(approverQb);
    }

    it('[T021] should create meeting successfully with all records', async () => {
      setupDefaultMocks();

      const result = await service.create(validDto, authUser, clientContext);

      expect(result).toBeDefined();
      expect(result.title).toBe('Họp dự án');
      expect(result.status).toBe(MeetingStatus.PENDING_APPROVAL);
      expect(result.approvalStatus).toBe(ApprovalStatus.PENDING);
      expect(result.bookingStatus).toBe(RoomBookingStatus.PENDING);
      expect(result.roomName).toBe('Phòng A');
      expect(result.meetingCode).toMatch(/^MT-\d{8}-\d{3}$/);
      expect(result.bookingCode).toMatch(/^BK-\d{8}-\d{3}$/);
      expect(result.hostId).toBe(authUser.userId);
      expect(result.organizerId).toBe(authUser.userId);
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('[T026] should default host to authUser when hostId not provided', async () => {
      const dto = { ...validDto, hostId: undefined };
      setupDefaultMocks();
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      const approverQb = mockQueryBuilder();
      approverQb.getMany.mockResolvedValue([]);

      const result = await service.create(dto, authUser, clientContext);

      expect(result.hostId).toBe(authUser.userId);
    });

    it('[T026] should auto-add host to participants', async () => {
      setupDefaultMocks();

      const result = await service.create(
        { ...validDto, participantUserIds: [] },
        authUser,
        clientContext,
      );

      expect(result.participantCount).toBe(1);
    });

    it('[FIX 2026-08-19] should throw ROOM_NOT_FOUND when room.administrativeStatus is inactive', async () => {
      setupDefaultMocks();
      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        if (id === 'room-uuid') {
          return {
            id: 'room-uuid',
            roomName: 'Phòng A',
            capacity: 20,
            isActive: true,
            currentStatus: 'available',
            administrativeStatus: 'inactive',
          } as RoomEntity;
        }
        return { id: 'some-id', accountStatus: AccountStatus.ACTIVE };
      });

      // Dung future date dong (khong hardcode) — tranh phu thuoc vao thoi diem
      // chay test, chi test rieng nhanh administrativeStatus.
      const future = new Date(Date.now() + 24 * 3600_000);
      const futureDto = {
        ...validDto,
        startTime: future.toISOString(),
        endTime: new Date(future.getTime() + 3600_000).toISOString(),
      };

      await expect(
        service.create(futureDto, authUser, clientContext),
      ).rejects.toThrow('Phòng họp không tồn tại hoặc không khả dụng');
    });

    it('[T022] should throw 409 when room has conflict', async () => {
      setupDefaultMocks();
      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        if (id === 'room-uuid') {
          return {
            id: 'room-uuid',
            roomName: 'Phòng A',
            capacity: 20,
            isActive: true,
            currentStatus: 'available',
          } as RoomEntity;
        }
        if (options?.where?.roomId) {
          return { id: 'booking-1' };
        }
        if (options?.where?.configKey) {
          return null;
        }
        return { id: 'some-id', accountStatus: AccountStatus.ACTIVE };
      });
      mockRepo.find.mockImplementation(async (options?: any) => {
        let ids: string[] = [];
        const idFilter = options?.where?.id;
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
      mockRepo.count.mockResolvedValue(0);
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      const approverQb = mockQueryBuilder();
      approverQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(conflictQb)
        .mockReturnValueOnce(approverQb);

      await expect(
        service.create(validDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('[T023] should throw 422 when capacity exceeded without override', async () => {
      const dto = {
        ...validDto,
        participantUserIds: [
          'user-p1',
          'user-p2',
          'user-p3',
          'user-p4',
          'user-p5',
          'user-p6',
          'user-p7',
          'user-p8',
          'user-p9',
          'user-p10',
          'user-p11',
          'user-p12',
          'user-p13',
          'user-p14',
          'user-p15',
          'user-p16',
          'user-p17',
          'user-p18',
          'user-p19',
          'user-p20',
        ],
      };

      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        if (id === 'room-uuid') {
          return {
            id: 'room-uuid',
            roomName: 'Phòng A',
            capacity: 10,
            isActive: true,
            currentStatus: 'available',
          } as RoomEntity;
        }
        if (options?.where?.roomId) {
          return null;
        }
        if (options?.where?.configKey) {
          return null;
        }
        return { id: 'some-id', accountStatus: AccountStatus.ACTIVE };
      });
      mockRepo.find.mockImplementation(async (options?: any) => {
        let ids: string[] = [];
        const idFilter = options?.where?.id;
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
      mockRepo.count.mockResolvedValue(0);
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(conflictQb)
        .mockReturnValueOnce(conflictQb);

      await expect(
        service.create(dto, authUser, clientContext),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[T024] should allow creation with capacity override', async () => {
      const dto = {
        ...validDto,
        capacityOverrideConfirmed: true,
        participantUserIds: ['user-p1', 'user-p2'],
      };

      saveSeq = 0;
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockImplementation(async (_entity: any, data: any) => {
        if (data && typeof data === 'object') {
          if (!data.id) data.id = `saved-${++saveSeq}`;
          return data;
        }
        return _entity;
      });

      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        if (id === 'room-uuid') {
          return {
            id: 'room-uuid',
            roomName: 'Phòng A',
            capacity: 10,
            isActive: true,
            currentStatus: 'available',
          } as RoomEntity;
        }
        if (options?.where?.roomId) {
          return null;
        }
        if (options?.where?.configKey) {
          return null;
        }
        return { id: 'some-id', accountStatus: AccountStatus.ACTIVE };
      });
      mockRepo.find.mockImplementation(async (options?: any) => {
        let ids: string[] = [];
        const idFilter = options?.where?.id;
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
      mockRepo.count.mockResolvedValue(0);
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      const approverQb = mockQueryBuilder();
      approverQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(conflictQb)
        .mockReturnValueOnce(approverQb);

      const result = await service.create(dto, authUser, clientContext);

      expect(result).toBeDefined();
      expect(result.status).toBe(MeetingStatus.PENDING_APPROVAL);
    });

    it('[T025] should throw 404 when room not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(validDto, authUser, clientContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('[T027] should generate valid meeting_code and booking_code', async () => {
      setupDefaultMocks();

      const result = await service.create(validDto, authUser, clientContext);

      expect(result.meetingCode).toMatch(/^MT-\d{8}-\d{3}$/);
      expect(result.bookingCode).toMatch(/^BK-\d{8}-\d{3}$/);
    });

    it('[T028] should create notification for approvers + audit log, and NOT invite participants yet', async () => {
      setupDefaultMocks();

      await service.create(validDto, authUser, clientContext);

      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_REQUEST_CREATED,
          channel: NotificationChannel.IN_APP,
          relatedEntityType: 'meeting_request',
          recipientScope: 'user_list',
        }),
      );

      // Participants must NOT be invited at creation time — only after manager approval.
      expect(
        mockNotificationsService.createNotification,
      ).not.toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_INVITE,
        }),
      );
      expect(
        mockNotificationsService.enqueueEmailNotification,
      ).not.toHaveBeenCalled();

      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          actionType: 'create',
          entityType: 'meeting_request',
        }),
      );
    });

    it('[T029] should rollback transaction on DB failure', async () => {
      setupDefaultMocks();

      dataSource.transaction.mockImplementation(async (_cb: any) => {
        throw new Error('DB Error');
      });
      await expect(
        service.create(validDto, authUser, clientContext),
      ).rejects.toThrow('DB Error');
    });

    it('[T030] should NOT email external participants at creation time (only after approval)', async () => {
      const dtoWithExternal = {
        ...validDto,
        externalParticipants: [
          { fullName: 'Guest1', email: 'guest1@external.com' },
          { fullName: 'Guest2', email: 'guest2@external.com' },
        ],
      };
      setupDefaultMocks();

      await service.create(dtoWithExternal, authUser, clientContext);

      expect(
        mockNotificationsService.enqueueEmailNotification,
      ).not.toHaveBeenCalled();
    });

    it('[T032] should succeed even if createNotification for approvers fails', async () => {
      setupDefaultMocks();
      mockNotificationsService.createNotification.mockRejectedValue(
        new Error('Notify down'),
      );

      const result = await service.create(validDto, authUser, clientContext);

      expect(result.id).toBeDefined();
      expect(result.status).toBe(MeetingStatus.PENDING_APPROVAL);
    });

    it('should throw BadRequest for past startTime', async () => {
      const pastDto = {
        ...validDto,
        startTime: '2020-01-01T10:00:00.000Z',
        endTime: '2020-01-01T11:00:00.000Z',
      };

      await expect(
        service.create(pastDto, authUser, clientContext),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest for endTime before startTime', async () => {
      const invalidDto = {
        ...validDto,
        startTime: '2026-07-15T11:00:00.000Z',
        endTime: '2026-07-15T10:00:00.000Z',
      };

      await expect(
        service.create(invalidDto, authUser, clientContext),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAvailableRoomsForMeeting', () => {
    const fakeMeeting = {
      id: 'meeting-uuid',
      roomId: 'room-uuid',
      startTime: new Date('2026-07-01T10:00:00Z'),
      endTime: new Date('2026-07-01T11:00:00Z'),
    };

    beforeEach(() => {
      mockRepo.findOne.mockImplementation(async (options?: any) => {
        if (options?.where?.id === 'meeting-uuid') return fakeMeeting;
        if (options?.where?.id === 'nonexistent-uuid') return null;
        return null;
      });

      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      const pendingConflictsQb = mockQueryBuilder();
      pendingConflictsQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb)
        .mockReturnValueOnce(pendingConflictsQb);
    });

    it('[T013-1] should return available rooms excluding current room', async () => {
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([
        {
          id: 'room-other',
          roomCode: 'R02',
          roomName: 'Phòng B',
          capacity: 20,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
        {
          id: 'room-uuid',
          roomCode: 'R01',
          roomName: 'Phòng A',
          capacity: 10,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
      ]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      const pendingConflictsQb = mockQueryBuilder();
      pendingConflictsQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReset()
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb)
        .mockReturnValueOnce(pendingConflictsQb);

      const rooms = await service.getAvailableRoomsForMeeting('meeting-uuid');

      expect(rooms).toHaveLength(1);
      expect(rooms[0].roomId).toBe('room-other');
      expect(rooms[0].isCurrentRoom).toBe(false);
    });

    it('[T013-2] should include current room when includeCurrentRoom=true', async () => {
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([
        {
          id: 'room-uuid',
          roomCode: 'R01',
          roomName: 'Phòng A',
          capacity: 10,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
      ]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      const pendingConflictsQb = mockQueryBuilder();
      pendingConflictsQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReset()
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb)
        .mockReturnValueOnce(pendingConflictsQb);

      const rooms = await service.getAvailableRoomsForMeeting('meeting-uuid', {
        includeCurrentRoom: true,
      });

      expect(rooms).toHaveLength(1);
      expect(rooms[0].isCurrentRoom).toBe(true);
    });

    it('[T013-3] should attach capacityWarning when capacityWarningMode=true', async () => {
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([
        {
          id: 'room-small',
          roomCode: 'R02',
          roomName: 'Small Room',
          capacity: 3,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
      ]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      const pendingConflictsQb = mockQueryBuilder();
      pendingConflictsQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReset()
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb)
        .mockReturnValueOnce(pendingConflictsQb);

      mockRepo.count.mockResolvedValue(3);

      const rooms = await service.getAvailableRoomsForMeeting('meeting-uuid', {
        capacityWarningMode: true,
      });

      expect(rooms).toHaveLength(1);
      expect(rooms[0].capacityWarning).toBeDefined();
      expect(rooms[0].capacityWarning!.roomCapacity).toBe(3);
      expect(rooms[0].capacityWarning!.attendeeCount).toBe(6);
    });

    it('[T013-4] should throw when meeting not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getAvailableRoomsForMeeting('nonexistent-uuid'),
      ).rejects.toThrow(NotFoundException);
    });

    it('[T013-5] should check against overridden startTime/endTime instead of meeting saved time', async () => {
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([
        {
          id: 'room-uuid',
          roomCode: 'R01',
          roomName: 'Phòng A',
          capacity: 10,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
      ]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      const pendingConflictsQb = mockQueryBuilder();
      pendingConflictsQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReset()
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb)
        .mockReturnValueOnce(pendingConflictsQb);

      const overrideStart = new Date('2026-07-01T14:00:00Z');
      const overrideEnd = new Date('2026-07-01T15:00:00Z');

      const rooms = await service.getAvailableRoomsForMeeting('meeting-uuid', {
        includeCurrentRoom: true,
        startTime: overrideStart,
        endTime: overrideEnd,
      });

      expect(rooms).toHaveLength(1);
      expect(rooms[0].isCurrentRoom).toBe(true);
      // getRoomAvailability của MockQueryBuilder không expose trực tiếp filter,
      // nhưng bookingsQb.getRawMany được resolve rỗng nên phòng vẫn "trống" —
      // điều quan trọng là hàm không throw và chạy hết luồng override.
    });

    it('[T013-6] should throw when only startTime is provided without endTime', async () => {
      await expect(
        service.getAvailableRoomsForMeeting('meeting-uuid', {
          startTime: new Date('2026-07-01T14:00:00Z'),
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[T013-7] should throw when overridden startTime >= endTime', async () => {
      await expect(
        service.getAvailableRoomsForMeeting('meeting-uuid', {
          startTime: new Date('2026-07-01T15:00:00Z'),
          endTime: new Date('2026-07-01T14:00:00Z'),
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[T013-8] should exclude bookings of the meeting itself from the room-conflict check (regression: self-conflict bug)', async () => {
      // fakeMeeting.roomId === 'room-uuid' đang có booking CHÍNH cuộc họp này
      // chiếm chỗ trùng khung giờ đang kiểm tra — trước fix, room-conflict
      // query không loại trừ meetingId nên room-uuid luôn bị coi là "đã bận"
      // dù includeCurrentRoom=true, khiến FE báo nhầm "phòng không còn trống".
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([
        {
          id: 'room-uuid',
          roomCode: 'R01',
          roomName: 'Phòng A',
          capacity: 10,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
      ]);
      const bookingsQb = mockQueryBuilder();
      // Booking overlap query PHẢI loại trừ chính meetingId — mock trả rỗng
      // để mô phỏng đúng hành vi sau khi loại trừ đúng (booking của chính
      // meeting không được tính là "đang chiếm phòng").
      bookingsQb.getRawMany.mockResolvedValue([]);
      const pendingConflictsQb = mockQueryBuilder();
      pendingConflictsQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReset()
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb)
        .mockReturnValueOnce(pendingConflictsQb);

      const rooms = await service.getAvailableRoomsForMeeting('meeting-uuid', {
        includeCurrentRoom: true,
        startTime: new Date('2026-07-01T14:00:00Z'),
        endTime: new Date('2026-07-01T15:00:00Z'),
      });

      // Xác nhận query builder có tự loại trừ chính meetingId khỏi tập
      // booking-conflict — đây là điều kiện cốt lõi để sửa đúng bug, không
      // chỉ đơn thuần khớp giá trị mock trả về.
      expect(bookingsQb.andWhere).toHaveBeenCalledWith(
        'rb.meetingId IS DISTINCT FROM :meetingId',
        { meetingId: 'meeting-uuid' },
      );

      expect(rooms).toHaveLength(1);
      expect(rooms[0].roomId).toBe('room-uuid');
      expect(rooms[0].isCurrentRoom).toBe(true);
    });
  });

  describe('updateMeetingTime', () => {
    const authUser = { userId: 'auth-user-uuid' };
    const clientContext = { ipAddress: '127.0.0.1', userAgent: 'test' };

    function futureDate(hours: number, minutes: number = 0): Date {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      d.setHours(hours, minutes, 0, 0);
      return d;
    }

    const fakeRoom = {
      id: 'room-uuid',
      roomName: 'Room A',
      capacity: 20,
      isActive: true,
      currentStatus: 'available',
    };

    const fakeMeeting = {
      id: 'meeting-uuid',
      meetingCode: 'MT-20260701-001',
      title: 'Test Meeting',
      roomId: 'room-uuid',
      organizerId: 'auth-user-uuid',
      hostId: 'auth-user-uuid',
      startTime: futureDate(9, 0),
      endTime: futureDate(10, 0),
      status: MeetingStatus.SCHEDULED,
      recurrenceRuleId: null,
      parentMeetingId: null,
      deletedAt: null,
      organizer: {
        id: 'auth-user-uuid',
        fullName: 'Auth User',
        email: 'auth@test.com',
      },
    };

    const fakeActiveBooking = {
      id: 'booking-uuid',
      bookingCode: 'BK-001',
      meetingId: 'meeting-uuid',
      roomId: 'room-uuid',
      status: RoomBookingStatus.APPROVED,
      reservedStartTime: futureDate(9, 0),
      reservedEndTime: futureDate(10, 0),
      bookingType: BookingType.SCHEDULED,
      bookedBy: 'auth-user-uuid',
    };

    function setupMocks() {
      mockRepo.findOne.mockImplementation(async (options: any = {}) => {
        const where = options.where ?? {};
        const id = where.id;
        if (id === 'meeting-uuid') return fakeMeeting;
        if (id === 'room-uuid') return fakeRoom;
        if (where.meetingId === 'meeting-uuid' && where.status)
          return fakeActiveBooking;
        return null;
      });

      mockRepo.find.mockImplementation(async (options: any = {}) => {
        const where = options.where ?? {};
        if (where.meetingId === 'meeting-uuid' && where.roomId) return [];
        return [];
      });

      mockRepo.count.mockResolvedValue(0);

      em.findOne.mockImplementation(async (entity: any, options: any = {}) => {
        if (!options?.lock) return null;
        if (entity === MeetingEntity) return { ...fakeMeeting };
        if (entity === RoomBookingEntity) return fakeActiveBooking;
        return null;
      });
      em.find.mockResolvedValue([]);
      em.create.mockImplementation((_: any, plain: any): any => plain);
      em.save.mockImplementation(async (_entity: any, data: any) => {
        if (data && typeof data === 'object' && !data.id) data.id = 'saved-id';
        return data;
      });
      em.getRepository = jest.fn().mockImplementation((_entity: any) => {
        const requestCodeQb = mockQueryBuilder();
        requestCodeQb.getRawMany.mockResolvedValue([]);
        requestCodeQb.getCount.mockResolvedValue(0);
        return {
          count: jest.fn().mockResolvedValue(0),
          update: jest.fn().mockResolvedValue({ affected: 1 }),
          createQueryBuilder: jest.fn().mockReturnValue(requestCodeQb),
        };
      });
      em.update = jest.fn().mockResolvedValue({ affected: 1 });

      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder.mockReturnValue(qb);
    }

    const validDto = {
      startTime: futureDate(14, 0).toISOString(),
      endTime: futureDate(15, 0).toISOString(),
    };

    it('should update meeting time and return correct response', async () => {
      setupMocks();
      const result = await service.updateMeetingTime(
        'meeting-uuid',
        validDto,
        authUser,
        clientContext,
      );
      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.newStartTime).toBe(validDto.startTime);
      expect(result.newEndTime).toBe(validDto.endTime);
      expect(result.bookingId).toBe('booking-uuid');
      expect(dataSource.transaction).toHaveBeenCalled();
      // Nghiệp vụ duyệt lại: meeting đang SCHEDULED → thay đổi CHƯA áp dụng,
      // chỉ ghi MeetingRequest PENDING chờ Manager duyệt lại.
      expect(result.pendingApproval).toBe(true);
      expect(result.requestId).toBeDefined();
    });

    it('rejects a non-host without meeting.time.update.any', async () => {
      setupMocks();
      const spy = jest.spyOn(service, 'checkUserPermission').mockResolvedValue(false);
      await expect(
        service.updateMeetingTime('meeting-uuid', validDto, { userId: 'other-user' }, clientContext),
      ).rejects.toThrow('Bạn không có quyền thay đổi thời gian cuộc họp này.');
      expect(spy).toHaveBeenCalledWith('other-user', 'meeting.time.update.any');
      spy.mockRestore();
    });

    it('lets a non-host with meeting.time.update.any update the time', async () => {
      setupMocks();
      const spy = jest.spyOn(service, 'checkUserPermission').mockResolvedValue(true);
      const result = await service.updateMeetingTime('meeting-uuid', validDto, { userId: 'admin-user' }, clientContext);
      expect(result.meetingId).toBe('meeting-uuid');
      spy.mockRestore();
    });

    it('[FIX 2026-08-19] should throw ROOM_NOT_AVAILABLE when newRoomId.administrativeStatus is inactive', async () => {
      setupMocks();
      const inactiveRoom = {
        id: 'room-uuid-2',
        roomName: 'Room B',
        capacity: 20,
        isActive: true,
        currentStatus: 'available',
        administrativeStatus: 'inactive',
      };
      mockRepo.findOne.mockImplementation(async (options: any = {}) => {
        const where = options.where ?? {};
        const id = where.id;
        if (id === 'meeting-uuid') return fakeMeeting;
        if (id === 'room-uuid') return fakeRoom;
        if (id === 'room-uuid-2') return inactiveRoom;
        if (where.meetingId === 'meeting-uuid' && where.status)
          return fakeActiveBooking;
        return null;
      });

      await expect(
        service.updateMeetingTime(
          'meeting-uuid',
          { ...validDto, newRoomId: 'room-uuid-2' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow('Phòng họp không khả dụng');
    });

    it('[T040] SCHEDULED: notifies approvers (MEETING_REQUEST_CREATED), KHÔNG báo participants MEETING_TIME_UPDATED (chưa áp dụng)', async () => {
      setupMocks();
      const approverQb = mockQueryBuilder();
      approverQb.getMany.mockResolvedValue([
        { id: 'approver-uuid' } as UserEntity,
      ]);
      mockRepo.createQueryBuilder.mockReturnValue(approverQb);

      await service.updateMeetingTime(
        'meeting-uuid',
        validDto,
        authUser,
        clientContext,
      );
      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_REQUEST_CREATED,
          channel: NotificationChannel.IN_APP,
          relatedEntityType: 'meeting_request',
          recipientUserIds: ['approver-uuid'],
          payloadJson: expect.objectContaining({
            oldStartTime: expect.any(String),
            oldEndTime: expect.any(String),
            newStartTime: validDto.startTime,
            newEndTime: validDto.endTime,
          }),
        }),
      );
      expect(
        mockNotificationsService.createNotification,
      ).not.toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_TIME_UPDATED,
        }),
      );
    });

    it('[T041] SCHEDULED: KHÔNG gửi email cho participants (thay đổi chưa được áp dụng)', async () => {
      setupMocks();
      mockRepo.find.mockImplementation(async (options: any = {}) => {
        const where = options.where ?? {};
        if (where.meetingId === 'meeting-uuid' && where.roomId) return [];
        if (where.meetingId === 'meeting-uuid') {
          return [{ userId: 'user-1' } as any, { userId: 'user-2' } as any];
        }
        return [];
      });

      em.find = jest
        .fn()
        .mockImplementation(async (_entity: any, options: any = {}) => {
          const idVal = options?.where?.id;
          if (idVal && idVal._value && Array.isArray(idVal._value)) {
            return idVal._value.map((uid: string) => ({
              id: uid,
              email: uid + '@company.com',
            }));
          }
          return [];
        });

      await service.updateMeetingTime(
        'meeting-uuid',
        validDto,
        authUser,
        clientContext,
      );
      expect(
        mockNotificationsService.enqueueEmailNotification,
      ).not.toHaveBeenCalled();
    });

    it('[T042] should succeed and return notificationStatus=failed when approver notification fails', async () => {
      setupMocks();
      const approverQb = mockQueryBuilder();
      approverQb.getMany.mockResolvedValue([
        { id: 'approver-uuid' } as UserEntity,
      ]);
      mockRepo.createQueryBuilder.mockReturnValue(approverQb);
      mockNotificationsService.createNotification.mockRejectedValue(
        new Error('Notify failed'),
      );
      const result = await service.updateMeetingTime(
        'meeting-uuid',
        validDto,
        authUser,
        clientContext,
      );
      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.notificationStatus).toBe('failed');
    });

    it('[BUG-REPRO] PENDING_APPROVAL: KHÔNG gửi email cho participants khi sửa giờ (meeting chưa từng được Manager duyệt)', async () => {
      setupMocks();
      const pendingMeeting = {
        ...fakeMeeting,
        status: MeetingStatus.PENDING_APPROVAL,
      };
      mockRepo.findOne.mockImplementation(async (options: any = {}) => {
        const where = options.where ?? {};
        const id = where.id;
        if (id === 'meeting-uuid') return pendingMeeting;
        if (id === 'room-uuid') return fakeRoom;
        if (where.meetingId === 'meeting-uuid' && where.status)
          return fakeActiveBooking;
        return null;
      });
      // 2 participants khác actor — để chứng minh trước fix email THẬT SỰ sẽ
      // được gửi cho họ, không phải "vô tình pass" vì thiếu recipient.
      mockRepo.find.mockImplementation(async (options: any = {}) => {
        const where = options.where ?? {};
        if (where.meetingId === 'meeting-uuid' && where.roomId) return [];
        if (where.meetingId === 'meeting-uuid') {
          return [{ userId: 'user-1' } as any, { userId: 'user-2' } as any];
        }
        return [];
      });
      em.find = jest
        .fn()
        .mockImplementation(async (_entity: any, options: any = {}) => {
          const idVal = options?.where?.id;
          if (idVal && idVal._value && Array.isArray(idVal._value)) {
            return idVal._value.map((uid: string) => ({
              id: uid,
              email: uid + '@company.com',
            }));
          }
          return [];
        });
      const fakePendingRequest = {
        id: 'request-uuid',
        meetingId: 'meeting-uuid',
        approvalStatus: ApprovalStatus.PENDING,
        requestPayloadJson: {},
      };
      em.findOne.mockImplementation(async (entity: any, options: any = {}) => {
        if (!options?.lock) return null;
        if (entity === MeetingEntity) return { ...pendingMeeting };
        if (entity === RoomBookingEntity) return fakeActiveBooking;
        if (entity === MeetingRequestEntity) return fakePendingRequest;
        return null;
      });
      // Call #1 = participant time-conflict check (phải rỗng), các call sau
      // = resolveApproverIds() → approverQb.
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      const approverQb = mockQueryBuilder();
      approverQb.getMany.mockResolvedValue([
        { id: 'approver-uuid' } as UserEntity,
      ]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(conflictQb)
        .mockReturnValue(approverQb);

      const result = await service.updateMeetingTime(
        'meeting-uuid',
        validDto,
        authUser,
        clientContext,
      );

      expect(result.pendingApproval).toBe(false);
      expect(
        mockNotificationsService.enqueueEmailNotification,
      ).not.toHaveBeenCalled();
      expect(
        mockNotificationsService.createNotification,
      ).not.toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_TIME_UPDATED,
        }),
      );
      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_REQUEST_CREATED,
          channel: NotificationChannel.IN_APP,
          recipientUserIds: ['approver-uuid'],
        }),
      );
    });

    it('should throw 422 for past startTime', async () => {
      setupMocks();
      const pastDto = {
        startTime: new Date('2020-01-01T10:00:00Z').toISOString(),
        endTime: new Date('2020-01-01T11:00:00Z').toISOString(),
      };
      await expect(
        service.updateMeetingTime(
          'meeting-uuid',
          pastDto,
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw 422 for startTime >= endTime', async () => {
      setupMocks();
      const invalidDto = {
        startTime: futureDate(15, 0).toISOString(),
        endTime: futureDate(14, 0).toISOString(),
      };
      await expect(
        service.updateMeetingTime(
          'meeting-uuid',
          invalidDto,
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw 403 for non-owner/host', async () => {
      setupMocks();
      mockRepo.findOne.mockImplementation(async (options: any = {}) => {
        const where = options.where ?? {};
        const id = where.id;
        if (id === 'meeting-uuid') {
          return {
            ...fakeMeeting,
            organizerId: 'other-user',
            hostId: 'other-user',
          };
        }
        if (id === 'room-uuid') return fakeRoom;
        if (where.meetingId === 'meeting-uuid' && where.status)
          return fakeActiveBooking;
        return null;
      });
      await expect(
        service.updateMeetingTime(
          'meeting-uuid',
          validDto,
          { userId: 'unauth-user' },
          clientContext,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw 409 for non-SCHEDULED meeting', async () => {
      setupMocks();
      mockRepo.findOne.mockImplementation(async (options: any = {}) => {
        const where = options.where ?? {};
        const id = where.id;
        if (id === 'meeting-uuid') {
          return { ...fakeMeeting, status: MeetingStatus.IN_PROGRESS };
        }
        if (id === 'room-uuid') return fakeRoom;
        if (where.meetingId === 'meeting-uuid' && where.status)
          return fakeActiveBooking;
        return null;
      });
      await expect(
        service.updateMeetingTime(
          'meeting-uuid',
          validDto,
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateMeetingRoom', () => {
    const authUser = { userId: 'auth-user-uuid' };
    const clientContext = { ipAddress: '127.0.0.1', userAgent: 'test' };

    const fakeMeeting = {
      id: 'meeting-uuid',
      meetingCode: 'MT-20260701-001',
      title: 'Họp dự án',
      roomId: 'old-room-uuid',
      organizerId: 'auth-user-uuid',
      hostId: 'auth-user-uuid',
      startTime: new Date('2026-07-01T10:00:00Z'),
      endTime: new Date('2026-07-01T11:00:00Z'),
      status: MeetingStatus.SCHEDULED,
      recurrenceRuleId: null,
      parentMeetingId: null,
      deletedAt: null,
    };

    const fakeNewRoom = {
      id: 'new-room-uuid',
      roomName: 'New Room',
      capacity: 20,
      isActive: true,
      currentStatus: 'available',
    };

    function setupFindOneMocks(customMocks?: Record<string, any>) {
      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        if (id === 'meeting-uuid') return customMocks?.meeting ?? fakeMeeting;
        if (id === 'old-room-uuid')
          return { id: 'old-room-uuid', roomName: 'Old Room', capacity: 10 };
        if (id === 'new-room-uuid') return customMocks?.newRoom ?? fakeNewRoom;
        if (id === 'small-room')
          return {
            id: 'small-room',
            roomName: 'Small',
            capacity: 2,
            isActive: true,
            currentStatus: 'available',
          };
        if (id === 'null-cap-room')
          return {
            id: 'null-cap-room',
            roomName: 'NullCap',
            capacity: null,
            isActive: true,
            currentStatus: 'available',
          };
        return null;
      });
    }

    function setupAttendeeCountMocks(count: number) {
      mockRepo.count.mockResolvedValue(count);
      const extCountQb = mockQueryBuilder();
      extCountQb.getRawOne.mockResolvedValue({ total: 0 });
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(extCountQb)
        .mockReturnValueOnce(conflictQb);
    }

    function setupTransactionMocks() {
      em.findOne.mockResolvedValue(fakeMeeting);
      em.update.mockResolvedValue({ affected: 1 } as any);
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockImplementation(async (_entity: any, data: any) => {
        if (data && typeof data === 'object') {
          if (!data.id) data.id = 'saved-id';
          return data;
        }
        return _entity;
      });
      em.count.mockResolvedValue(0);
    }

    it('[T012-1] should update room successfully for organizer', async () => {
      setupFindOneMocks();
      setupAttendeeCountMocks(5);
      setupTransactionMocks();
      mockRepo.find.mockResolvedValue([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-id' });

      const result = await service.updateMeetingRoom(
        'meeting-uuid',
        { newRoomId: 'new-room-uuid' },
        authUser,
        clientContext,
      );

      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.oldRoom.id).toBe('old-room-uuid');
      expect(result.newRoom.id).toBe('new-room-uuid');
      expect(result.notificationStatus).toBe('queued');
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('[FIX 2026-08-19] should throw ROOM_NOT_AVAILABLE when newRoom.administrativeStatus is inactive', async () => {
      setupFindOneMocks({
        // startTime dong (future) — tranh nham voi check MEETING_ALREADY_STARTED,
        // chi test rieng nhanh administrativeStatus.
        meeting: {
          ...fakeMeeting,
          startTime: new Date(Date.now() + 24 * 3600_000),
          endTime: new Date(Date.now() + 25 * 3600_000),
        },
        newRoom: { ...fakeNewRoom, administrativeStatus: 'inactive' },
      });
      setupAttendeeCountMocks(5);
      setupTransactionMocks();
      mockRepo.find.mockResolvedValue([]);

      await expect(
        service.updateMeetingRoom(
          'meeting-uuid',
          { newRoomId: 'new-room-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow('Phòng họp này hiện không khả dụng.');
    });

    it('[T012-2] should update room successfully for host', async () => {
      setupFindOneMocks({
        meeting: {
          ...fakeMeeting,
          hostId: 'host-uuid',
          organizerId: 'other-uuid',
        },
      });
      setupAttendeeCountMocks(5);
      setupTransactionMocks();
      mockRepo.find.mockResolvedValue([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-id' });

      const result = await service.updateMeetingRoom(
        'meeting-uuid',
        { newRoomId: 'new-room-uuid' },
        { userId: 'host-uuid' },
        clientContext,
      );

      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.oldRoom.id).toBe('old-room-uuid');
    });

    it('[T012-3] should update room successfully for admin', async () => {
      setupFindOneMocks({
        meeting: {
          ...fakeMeeting,
          organizerId: 'other-uuid',
          hostId: 'other-uuid',
        },
      });

      mockRepo.count.mockResolvedValue(5);

      const permQb = mockQueryBuilder();
      permQb.getOne.mockResolvedValue({ id: 'user' } as any);
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(permQb)
        .mockReturnValueOnce(conflictQb);

      setupTransactionMocks();
      mockRepo.find.mockResolvedValue([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-id' });

      const result = await service.updateMeetingRoom(
        'meeting-uuid',
        { newRoomId: 'new-room-uuid' },
        { userId: 'admin-uuid' },
        clientContext,
      );

      expect(result.meetingId).toBe('meeting-uuid');
    });

    it('[T012-4] should throw 403 for participant', async () => {
      setupFindOneMocks({
        meeting: {
          ...fakeMeeting,
          organizerId: 'other-uuid',
          hostId: 'other-uuid',
        },
      });

      await expect(
        service.updateMeetingRoom(
          'meeting-uuid',
          { newRoomId: 'new-room-uuid' },
          { userId: 'participant-uuid' },
          clientContext,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('[T012-5] should throw 409 for non-SCHEDULED meeting', async () => {
      setupFindOneMocks({
        meeting: { ...fakeMeeting, status: MeetingStatus.COMPLETED },
      });

      await expect(
        service.updateMeetingRoom(
          'meeting-uuid',
          { newRoomId: 'new-room-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('[T012-6] should throw 409 when meeting already started', async () => {
      setupFindOneMocks({
        meeting: {
          ...fakeMeeting,
          startTime: new Date('2026-06-01T10:00:00Z'),
        },
      });

      await expect(
        service.updateMeetingRoom(
          'meeting-uuid',
          { newRoomId: 'new-room-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('[T012-7] should throw 422 when same room', async () => {
      setupFindOneMocks({
        meeting: { ...fakeMeeting, roomId: 'new-room-uuid' },
      });

      await expect(
        service.updateMeetingRoom(
          'meeting-uuid',
          { newRoomId: 'new-room-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[T012-8] should throw 409 when new room has conflict', async () => {
      setupFindOneMocks();
      mockRepo.count.mockResolvedValue(5);
      const extQb = mockQueryBuilder();
      extQb.getRawOne.mockResolvedValue({ total: 0 });
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([{ id: 'booking-1' }]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(extQb)
        .mockReturnValueOnce(conflictQb);

      await expect(
        service.updateMeetingRoom(
          'meeting-uuid',
          { newRoomId: 'new-room-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('[T012-9] should throw 422 when capacity too low without override', async () => {
      setupFindOneMocks({
        newRoom: { ...fakeNewRoom, id: 'small-room', capacity: 2 },
      });
      mockRepo.count.mockResolvedValue(10);
      const extQb = mockQueryBuilder();
      extQb.getRawOne.mockResolvedValue({ total: 0 });
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(extQb)
        .mockReturnValueOnce(conflictQb);

      await expect(
        service.updateMeetingRoom(
          'meeting-uuid',
          { newRoomId: 'small-room' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[T012-10] should override capacity warning and pass', async () => {
      setupFindOneMocks({
        meeting: { ...fakeMeeting, roomId: 'old-room-uuid' },
      });
      mockRepo.count.mockResolvedValue(10);
      const extQb = mockQueryBuilder();
      extQb.getRawOne.mockResolvedValue({ total: 0 });
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(extQb)
        .mockReturnValueOnce(conflictQb);
      setupTransactionMocks();
      mockRepo.find.mockResolvedValue([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-id' });

      const result = await service.updateMeetingRoom(
        'meeting-uuid',
        { newRoomId: 'new-room-uuid', confirmCapacityOverride: true },
        authUser,
        clientContext,
      );

      expect(result.meetingId).toBe('meeting-uuid');
    });

    it('[T012-11] should throw 422 when new room capacity is null', async () => {
      setupFindOneMocks({
        newRoom: {
          id: 'null-cap-room',
          roomName: 'NullCap',
          capacity: null,
          isActive: true,
          currentStatus: 'available',
        },
      });
      mockRepo.count.mockResolvedValue(5);
      const extQb = mockQueryBuilder();
      extQb.getRawOne.mockResolvedValue({ total: 0 });
      mockRepo.createQueryBuilder.mockReturnValueOnce(extQb);

      await expect(
        service.updateMeetingRoom(
          'meeting-uuid',
          { newRoomId: 'null-cap-room' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[T012-12] should throw 409 for recurring series master', async () => {
      setupFindOneMocks({
        meeting: {
          ...fakeMeeting,
          recurrenceRuleId: 'rule-uuid',
          parentMeetingId: null,
        },
      });

      await expect(
        service.updateMeetingRoom(
          'meeting-uuid',
          { newRoomId: 'new-room-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('[T012-13] should rollback transaction on failure', async () => {
      setupFindOneMocks();
      setupAttendeeCountMocks(5);
      setupTransactionMocks();
      em.save.mockRejectedValue(new Error('DB Error'));

      await expect(
        service.updateMeetingRoom(
          'meeting-uuid',
          { newRoomId: 'new-room-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow('DB Error');
    });

    it('[T012-14] should preserve other meeting fields', async () => {
      setupFindOneMocks();
      setupAttendeeCountMocks(5);
      setupTransactionMocks();
      mockRepo.find.mockResolvedValue([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-id' });

      const result = await service.updateMeetingRoom(
        'meeting-uuid',
        { newRoomId: 'new-room-uuid' },
        authUser,
        clientContext,
      );

      expect(result.meetingId).toBe('meeting-uuid');
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('[T012-15] should return 200 with notificationStatus= failed when notification fails', async () => {
      setupFindOneMocks();
      setupAttendeeCountMocks(5);
      setupTransactionMocks();
      jest.spyOn(service as any, 'resolveApproverIds').mockResolvedValue(['approver-1']);
      mockNotificationsService.createNotification.mockRejectedValue(
        new Error('Send failed'),
      );

      const result = await service.updateMeetingRoom(
        'meeting-uuid',
        { newRoomId: 'new-room-uuid' },
        authUser,
        clientContext,
      );

      expect(result.notificationStatus).toBe('failed');
    });

    it('[BUG-REPRO] PENDING_APPROVAL: KHÔNG gửi email cho participants khi đổi phòng (meeting chưa từng được Manager duyệt)', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 30);
      const pendingMeeting = {
        ...fakeMeeting,
        status: MeetingStatus.PENDING_APPROVAL,
        startTime: future,
        endTime: new Date(future.getTime() + 60 * 60 * 1000),
      };
      setupFindOneMocks({ meeting: pendingMeeting });
      mockRepo.count.mockResolvedValue(5);
      // 2 participants khác actor — để chứng minh trước fix email THẬT SỰ sẽ
      // được gửi cho họ, không phải "vô tình pass" vì thiếu recipient.
      mockRepo.find.mockResolvedValue([
        { userId: 'user-1' } as any,
        { userId: 'user-2' } as any,
      ]);
      em.find = jest
        .fn()
        .mockImplementation(async (_entity: any, options: any = {}) => {
          const idVal = options?.where?.id;
          if (idVal && idVal._value && Array.isArray(idVal._value)) {
            return idVal._value.map((uid: string) => ({
              id: uid,
              email: uid + '@company.com',
            }));
          }
          return [];
        });
      em.findOne.mockResolvedValue(pendingMeeting);
      em.update.mockResolvedValue({ affected: 1 } as any);
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockImplementation(async (_entity: any, data: any) => {
        if (data && typeof data === 'object') {
          if (!data.id) data.id = 'saved-id';
          return data;
        }
        return _entity;
      });
      em.count.mockResolvedValue(0);

      const approverQb = mockQueryBuilder();
      approverQb.getMany.mockResolvedValue([
        { id: 'approver-uuid' } as UserEntity,
      ]);
      mockRepo.createQueryBuilder.mockReturnValue(approverQb);

      const result = await service.updateMeetingRoom(
        'meeting-uuid',
        { newRoomId: 'new-room-uuid' },
        authUser,
        clientContext,
      );

      expect(result.pendingApproval).toBe(false);
      expect(
        mockNotificationsService.enqueueEmailNotification,
      ).not.toHaveBeenCalled();
      expect(
        mockNotificationsService.createNotification,
      ).not.toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_ROOM_UPDATED,
        }),
      );
      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_REQUEST_CREATED,
          channel: NotificationChannel.IN_APP,
          recipientUserIds: ['approver-uuid'],
        }),
      );
    });
  });

  describe('cancelMeeting', () => {
    const authUser = { userId: 'auth-user-uuid' };
    const clientContext = { ipAddress: '127.0.0.1', userAgent: 'test' };

    function buildMeeting(overrides?: Record<string, any>) {
      return {
        id: 'meeting-uuid',
        meetingCode: 'MT-20260701-001',
        title: 'Họp dự án',
        status: MeetingStatus.SCHEDULED,
        organizerId: 'auth-user-uuid',
        hostId: 'auth-user-uuid',
        roomId: 'room-uuid',
        startTime: new Date('2099-07-01T10:00:00Z'),
        endTime: new Date('2099-07-01T11:00:00Z'),
        deletedAt: null,
        cancellationReason: null,
        updatedAt: new Date('2026-06-01T00:00:00Z'),
        ...overrides,
      };
    }

    const LOCKED_MEETING = [
      {
        id: 'meeting-uuid',
        status: 'scheduled',
        start_time: '2099-07-01T10:00:00.000Z',
        end_time: '2099-07-01T11:00:00.000Z',
        organizer_id: 'auth-user-uuid',
        host_id: 'auth-user-uuid',
        title: 'Họp dự án',
        cancellation_reason: null,
        updated_at: new Date('2026-06-01T00:00:00Z'),
      },
    ];

    const FULL_BOOKING = [
      {
        id: 'booking-uuid',
        room_id: 'room-uuid',
        status: 'approved',
        start_time: '2099-07-01T10:00:00.000Z',
        end_time: '2099-07-01T11:00:00.000Z',
      },
    ];

    const FULL_USAGE = [{ id: 'usage-uuid', usage_status: 'not_started' }];

    const CANCELLED_AT = new Date('2026-06-01T12:00:00Z');

    function setupEmQueryFullFlow(cancelledAt: Date = CANCELLED_AT) {
      em.query
        .mockResolvedValueOnce(LOCKED_MEETING) // 4a: Lock meeting
        .mockResolvedValueOnce(FULL_BOOKING) // 4c: Lock bookings
        .mockResolvedValueOnce(FULL_USAGE) // 4d: Lock usages
        .mockResolvedValueOnce(undefined) // 4e: Update booking
        .mockResolvedValueOnce(undefined) // 4f: Update usage
        .mockResolvedValueOnce(undefined) // 4g: Insert room event
        .mockResolvedValueOnce(undefined) // 4h: Insert audit (release)
        .mockResolvedValueOnce(undefined) // 4i: Update meeting
        .mockResolvedValueOnce([{ updated_at: cancelledAt }]) // 4j: Select updated_at
        .mockResolvedValueOnce(undefined) // 4k: Insert meeting event
        .mockResolvedValueOnce(undefined); // 4l: Insert audit (cancel)
    }

    function setupEmQueryNoBooking() {
      em.query
        .mockResolvedValueOnce(LOCKED_MEETING) // 4a: Lock meeting
        .mockResolvedValueOnce([]) // 4c: No bookings
        .mockResolvedValueOnce(undefined) // 4i: Update meeting
        .mockResolvedValueOnce([{ updated_at: CANCELLED_AT }]) // 4j: Select updated_at
        .mockResolvedValueOnce(undefined) // 4k: Insert meeting event
        .mockResolvedValueOnce(undefined); // 4l: Insert audit (cancel)
    }

    function setupNotificationMocks() {
      mockRepo.find
        .mockResolvedValueOnce([
          { userId: 'participant-1' },
          { userId: 'participant-2' },
        ])
        .mockResolvedValueOnce([{ email: 'external@example.com' }]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-id' });
    }

    // ── Happy Path ──

    it('[T006-1] should cancel meeting as organizer (200)', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        'Lý do',
      );

      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.status).toBe('cancelled');
      expect(result.roomReleased).toBe(true);
      expect(result.releasedBookingId).toBe('booking-uuid');
      expect(result.cancelledBy).toBe('auth-user-uuid');
      expect(result.notificationStatus).toBe('queued');
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('[GLA-001] should revoke all guest sessions for the meeting after cancelling (best-effort)', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());
      setupEmQueryFullFlow();
      setupNotificationMocks();

      await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        'Ly do',
      );

      expect(mockGuestInviteService.revokeAllForMeeting).toHaveBeenCalledWith(
        'meeting-uuid',
      );
    });

    it('[GLA-001] should NOT fail cancelMeeting when revokeAllForMeeting throws (best-effort)', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());
      setupEmQueryFullFlow();
      setupNotificationMocks();
      mockGuestInviteService.revokeAllForMeeting.mockRejectedValueOnce(
        new Error('Redis down'),
      );

      await expect(
        service.cancelMeeting('meeting-uuid', authUser, clientContext, 'Ly do'),
      ).resolves.toBeDefined();
    });

    it('[T006-2] should cancel meeting as host (200)', async () => {
      const meeting = buildMeeting({
        organizerId: 'other-uuid',
        hostId: 'auth-user-uuid',
      });
      mockRepo.findOne.mockResolvedValue(meeting);

      setupEmQueryFullFlow();
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        undefined,
      );

      expect(result.status).toBe('cancelled');
      expect(result.roomReleased).toBe(true);
    });

    it('[T006-3] should cancel meeting as admin with cancel.any (200)', async () => {
      const meeting = buildMeeting({
        organizerId: 'other-uuid',
        hostId: 'other-uuid',
      });
      mockRepo.findOne.mockResolvedValue(meeting);

      const permQb = {
        ...mockQueryBuilder(),
        getOne: jest.fn().mockResolvedValue({ id: 'user' }),
      };
      mockRepo.createQueryBuilder.mockReturnValue(permQb);

      setupEmQueryFullFlow();
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid',
        { userId: 'admin-uuid' },
        clientContext,
        undefined,
      );

      expect(result.status).toBe('cancelled');
    });

    // ── Authorization ──

    it('[T006-4] should throw 403 for participant without cancel permission', async () => {
      const meeting = buildMeeting({
        organizerId: 'other-uuid',
        hostId: 'other-uuid',
      });
      mockRepo.findOne.mockResolvedValue(meeting);

      const permQb = {
        ...mockQueryBuilder(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      mockRepo.createQueryBuilder.mockReturnValue(permQb);

      await expect(
        service.cancelMeeting(
          'meeting-uuid',
          { userId: 'participant-uuid' },
          clientContext,
          undefined,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('[T006-5] should throw 403 for user with cancel.own but not owner', async () => {
      const meeting = buildMeeting({
        organizerId: 'other-uuid',
        hostId: 'other-uuid',
      });
      mockRepo.findOne.mockResolvedValue(meeting);

      const permQb = {
        ...mockQueryBuilder(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      mockRepo.createQueryBuilder.mockReturnValue(permQb);

      await expect(
        service.cancelMeeting(
          'meeting-uuid',
          { userId: 'other-with-own' },
          clientContext,
          undefined,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    // ── Business validation ──

    it('[T006-6] should throw 409 for in_progress meeting', async () => {
      mockRepo.findOne.mockResolvedValue(
        buildMeeting({ status: MeetingStatus.IN_PROGRESS }),
      );

      await expect(
        service.cancelMeeting(
          'meeting-uuid',
          authUser,
          clientContext,
          undefined,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('[T006-7] should throw 409 for completed meeting', async () => {
      mockRepo.findOne.mockResolvedValue(
        buildMeeting({ status: MeetingStatus.COMPLETED }),
      );

      await expect(
        service.cancelMeeting(
          'meeting-uuid',
          authUser,
          clientContext,
          undefined,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('[T006-8] should throw 409 for already cancelled meeting', async () => {
      mockRepo.findOne.mockResolvedValue(
        buildMeeting({ status: MeetingStatus.CANCELLED }),
      );

      await expect(
        service.cancelMeeting(
          'meeting-uuid',
          authUser,
          clientContext,
          undefined,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('[T006-9] should throw 409 for meeting where start_time <= now', async () => {
      mockRepo.findOne.mockResolvedValue(
        buildMeeting({ startTime: new Date('2020-01-01T10:00:00Z') }),
      );

      await expect(
        service.cancelMeeting(
          'meeting-uuid',
          authUser,
          clientContext,
          undefined,
        ),
      ).rejects.toThrow(ConflictException);
    });

    // ── Not found ──

    it('[T006-10] should throw 404 for non-existent meeting', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.cancelMeeting(
          'nonexistent-uuid',
          authUser,
          clientContext,
          undefined,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('[T006-10b] should throw 404 for soft-deleted meeting', async () => {
      mockRepo.findOne.mockResolvedValue(
        buildMeeting({ deletedAt: new Date() }),
      );

      await expect(
        service.cancelMeeting(
          'meeting-uuid',
          authUser,
          clientContext,
          undefined,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    // ── Room/booking state ──

    it('[T006-11] should cancel booking with reason when booking approved', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      em.query
        .mockResolvedValueOnce(LOCKED_MEETING)
        .mockResolvedValueOnce(FULL_BOOKING)
        .mockResolvedValueOnce(FULL_USAGE)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ updated_at: CANCELLED_AT }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        'Lý do cụ thể',
      );

      expect(result.roomReleased).toBe(true);
      expect(result.releasedBookingId).toBe('booking-uuid');
    });

    it('[T006-12] should set roomReleased=false when no booking exists', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting({ roomId: null }));

      setupEmQueryNoBooking();
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        undefined,
      );

      expect(result.roomReleased).toBe(false);
      expect(result.releasedBookingId).toBeNull();
    });

    it('[T006-13] should release usage when usage is not_started', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      em.query
        .mockResolvedValueOnce(LOCKED_MEETING)
        .mockResolvedValueOnce(FULL_BOOKING)
        .mockResolvedValueOnce([
          { id: 'usage-uuid', usage_status: 'not_started' },
        ])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ updated_at: CANCELLED_AT }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        undefined,
      );

      expect(result.roomReleased).toBe(true);
      expect(em.query.mock.calls[4][0]).toContain('UPDATE room_booking_usages');
    });

    it('[T006-14] should not create usage when no usage record exists', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      em.query
        .mockResolvedValueOnce(LOCKED_MEETING)
        .mockResolvedValueOnce(FULL_BOOKING)
        .mockResolvedValueOnce([]) // No usage
        .mockResolvedValueOnce(undefined) // Update booking
        .mockResolvedValueOnce(undefined) // Insert room event
        .mockResolvedValueOnce(undefined) // Insert audit (release)
        .mockResolvedValueOnce(undefined) // Update meeting
        .mockResolvedValueOnce([{ updated_at: CANCELLED_AT }])
        .mockResolvedValueOnce(undefined) // Insert meeting event
        .mockResolvedValueOnce(undefined); // Insert audit (cancel)
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        undefined,
      );

      expect(result.roomReleased).toBe(true);
    });

    // ── Events ──

    it('[T006-15] should create meeting_events with status_changed', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        undefined,
      );

      expect(result.status).toBe('cancelled');
      const meetingEventCall = em.query.mock.calls[9];
      expect(meetingEventCall[0]).toContain('INSERT INTO meeting_events');
      expect(meetingEventCall[0]).toContain('status_changed');
    });

    it('[T006-16] should create room_events with room_released', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      setupNotificationMocks();

      await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        undefined,
      );

      const roomEventCall = em.query.mock.calls[5];
      expect(roomEventCall[0]).toContain('INSERT INTO room_events');
      expect(roomEventCall[0]).toContain('room_released');
    });

    // ── Notification ──

    it('[T006-17] should create notification with [CANCELLED] subject prefix', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      mockRepo.find
        .mockResolvedValueOnce([{ userId: 'participant-1' }])
        .mockResolvedValueOnce([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'notif-id' });

      const result = await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        undefined,
      );

      expect(result.notificationStatus).toBe('queued');
      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.CANCELLATION,
          channel: NotificationChannel.IN_APP,
          subject: expect.stringContaining('[CANCELLED]'),
        }),
      );
    });

    it('[T006-18] should include reason in notification content', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      mockRepo.find
        .mockResolvedValueOnce([{ userId: 'participant-1' }])
        .mockResolvedValueOnce([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'notif-id' });

      const result = await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        'Hết giờ',
      );

      expect(result.notificationStatus).toBe('queued');
      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.CANCELLATION,
          channel: NotificationChannel.IN_APP,
          content: expect.stringContaining('Hết giờ'),
        }),
      );
    });

    // ── Audit ──

    it('[T006-19] should record audit logs for cancel and release', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      setupNotificationMocks();

      await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        undefined,
      );

      const auditCalls = em.query.mock.calls.filter((call: any[]) =>
        call[0].includes('INSERT INTO audit_logs'),
      );
      expect(auditCalls.length).toBe(2);
      expect(auditCalls[0][0]).toContain('release_room');
      expect(auditCalls[1][0]).toContain('cancel_meeting');
    });

    // ── Concurrency ──

    it('[T006-20] should throw 409 for concurrent cancel request', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      em.query.mockResolvedValueOnce([
        // 4a: Lock meeting (already cancelled)
        {
          id: 'meeting-uuid',
          status: 'cancelled',
          start_time: '2099-07-01T10:00:00.000Z',
          end_time: '2099-07-01T11:00:00.000Z',
          organizer_id: 'auth-user-uuid',
          host_id: 'auth-user-uuid',
          title: 'Họp dự án',
          cancellation_reason: null,
          updated_at: new Date('2026-06-01T00:00:00Z'),
        },
      ]);

      await expect(
        service.cancelMeeting(
          'meeting-uuid',
          authUser,
          clientContext,
          undefined,
        ),
      ).rejects.toThrow(ConflictException);
    });

    // ── Notification failure ──

    it('[T006-21] should return 200 with notificationStatus=failed_to_queue when save fails', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      mockRepo.find
        .mockResolvedValueOnce([{ userId: 'participant-1' }])
        .mockResolvedValueOnce([]);
      mockNotificationsService.createNotification.mockRejectedValue(
        new Error('DB connection lost'),
      );

      const result = await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        undefined,
      );

      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.status).toBe('cancelled');
      expect(result.notificationStatus).toBe('failed_to_queue');
    });

    it('[T006-22] should not rollback cancel when notification fails (FR-032)', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      mockRepo.find.mockRejectedValue(new Error('DB error'));

      const result = await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        undefined,
      );

      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.status).toBe('cancelled');
      expect(result.notificationStatus).toBe('failed_to_queue');
    });

    // ── Reason handling ──

    it('[T006-23] should handle cancellation reason with whitespace trim', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid',
        authUser,
        clientContext,
        '  lý do  ',
      );

      expect(result.status).toBe('cancelled');
      expect(result.meetingId).toBe('meeting-uuid');
    });
  });

  describe('addInternalParticipant', () => {
    const authUser = { userId: 'auth-user-uuid' };
    const clientContext = { ipAddress: '127.0.0.1', userAgent: 'test' };

    const fakeMeeting = {
      id: 'meeting-uuid',
      meetingCode: 'MT-20260701-001',
      title: 'Họp dự án',
      roomId: 'room-uuid',
      organizerId: 'auth-user-uuid',
      hostId: 'auth-user-uuid',
      startTime: new Date('2026-07-01T10:00:00Z'),
      endTime: new Date('2026-07-01T11:00:00Z'),
      visibilityLevel: 'PUBLIC',
      status: MeetingStatus.SCHEDULED,
      recurrenceRuleId: null,
      parentMeetingId: null,
      deletedAt: null,
    };

    function setupFindOneMocks(customMocks?: Record<string, any>) {
      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        const userId = options?.where?.userId;
        const meetingId = options?.where?.meetingId;
        const configKey = options?.where?.configKey;

        if (id === 'meeting-uuid') return customMocks?.meeting ?? fakeMeeting;
        if (id === 'invited-user-uuid')
          return {
            id: 'invited-user-uuid',
            accountStatus: AccountStatus.ACTIVE,
          };
        if (id === 'inactive-user-uuid')
          return {
            id: 'inactive-user-uuid',
            accountStatus: AccountStatus.INACTIVE,
          };
        if (id === 'room-uuid')
          return { id: 'room-uuid', capacity: 10, isActive: true };
        if (id === 'small-room')
          return { id: 'small-room', capacity: 2, isActive: true };
        if (userId === 'invited-user-uuid' && meetingId === 'meeting-uuid')
          return null;
        if (userId === 'existing-user-uuid' && meetingId === 'meeting-uuid')
          return { id: 'existing-participant-id' };
        if (configKey === 'meeting.capacity_policy')
          return customMocks?.capacityConfig ?? { configValue: 'warning' };
        return null;
      });
    }

    function setupAttendeeCountMocks(count: number) {
      mockRepo.count.mockResolvedValue(count);
    }

    function setupConflictMock(conflicts: any[] = []) {
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue(conflicts);
      return conflictQb;
    }

    function setupTransactionMocks() {
      em.findOne.mockImplementation(async (_entity: any, options?: any) => {
        if (options?.lock) return fakeMeeting;
        return null;
      });
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockImplementation(async (_entity: any, data: any) => {
        if (data && typeof data === 'object') {
          if (!data.id) data.id = 'saved-participant-id';
          return data;
        }
        return _entity;
      });
    }

    it('should add participant successfully with no warnings', async () => {
      setupFindOneMocks();
      setupAttendeeCountMocks(3);
      setupTransactionMocks();
      mockRepo.find.mockResolvedValue([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-notification-id' });
      mockRepo.createQueryBuilder.mockReturnValue(setupConflictMock([]));

      const result = await service.addInternalParticipant(
        'meeting-uuid',
        { userId: 'invited-user-uuid' },
        authUser,
        clientContext,
      );

      expect(result.participantId).toBe('saved-participant-id');
      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.userId).toBe('invited-user-uuid');
      expect(result.role).toBe('attendee');
      expect(result.status).toBe('pending');
    });

    it('should throw 404 when meeting not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.addInternalParticipant(
          'nonexistent-uuid',
          { userId: 'invited-user-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 404 when meeting is soft-deleted', async () => {
      mockRepo.findOne.mockResolvedValue({
        ...fakeMeeting,
        deletedAt: new Date(),
      });

      await expect(
        service.addInternalParticipant(
          'meeting-uuid',
          { userId: 'invited-user-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 400 when meeting status is not SCHEDULED or IN_PROGRESS', async () => {
      mockRepo.findOne.mockResolvedValue({
        ...fakeMeeting,
        status: MeetingStatus.COMPLETED,
      });

      await expect(
        service.addInternalParticipant(
          'meeting-uuid',
          { userId: 'invited-user-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw 404 when invited user not found', async () => {
      mockRepo.findOne.mockImplementation(async (options?: any) => {
        if (options?.where?.id === 'meeting-uuid') return fakeMeeting;
        return null;
      });

      await expect(
        service.addInternalParticipant(
          'meeting-uuid',
          { userId: 'nonexistent-user' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 404 when invited user is inactive', async () => {
      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        if (id === 'meeting-uuid') return fakeMeeting;
        if (id === 'inactive-user-uuid')
          return {
            id: 'inactive-user-uuid',
            accountStatus: AccountStatus.INACTIVE,
          };
        return null;
      });

      await expect(
        service.addInternalParticipant(
          'meeting-uuid',
          { userId: 'inactive-user-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 409 when participant already exists', async () => {
      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        const userId = options?.where?.userId;
        const meetingId = options?.where?.meetingId;
        if (id === 'meeting-uuid') return fakeMeeting;
        if (id === 'existing-user-uuid')
          return {
            id: 'existing-user-uuid',
            accountStatus: AccountStatus.ACTIVE,
          };
        if (userId === 'existing-user-uuid' && meetingId === 'meeting-uuid')
          return { id: 'existing-participant-id' };
        return null;
      });

      await expect(
        service.addInternalParticipant(
          'meeting-uuid',
          { userId: 'existing-user-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw 422 with warningToken when schedule conflict exists', async () => {
      setupFindOneMocks();
      mockRepo.count.mockResolvedValue(3);
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([
        {
          userId: 'invited-user-uuid',
          meeting: {
            id: 'conflict-meeting',
            title: 'Conflicting Meeting',
            startTime: new Date('2026-07-01T09:30:00Z'),
            endTime: new Date('2026-07-01T10:30:00Z'),
          },
        },
      ]);
      mockRepo.createQueryBuilder.mockReturnValue(conflictQb);

      await expect(
        service.addInternalParticipant(
          'meeting-uuid',
          { userId: 'invited-user-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should add participant when warnings are overridden with valid token', async () => {
      setupFindOneMocks();
      setupAttendeeCountMocks(3);
      setupTransactionMocks();
      mockRepo.find.mockResolvedValue([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-notification-id' });
      mockRepo.createQueryBuilder.mockReturnValue(setupConflictMock([]));
      const jwtService = module.get<JwtService>(JwtService);
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: 'warning:meet-add-participant',
        meetingId: 'meeting-uuid',
        userId: 'invited-user-uuid',
        warnings: [],
      });

      const result = await service.addInternalParticipant(
        'meeting-uuid',
        {
          userId: 'invited-user-uuid',
          overrideWarnings: true,
          warningToken: 'valid-token',
        },
        authUser,
        clientContext,
      );

      expect(result.participantId).toBe('saved-participant-id');
    });

    it('should throw 422 for room capacity policy=block', async () => {
      setupFindOneMocks({ capacityConfig: { configValue: 'block' } });
      mockRepo.count.mockResolvedValue(10);
      mockRepo.createQueryBuilder.mockReturnValue(setupConflictMock([]));

      await expect(
        service.addInternalParticipant(
          'meeting-uuid',
          { userId: 'invited-user-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw 422 with capacity warning when no override', async () => {
      setupFindOneMocks();
      mockRepo.count.mockResolvedValue(10);
      mockRepo.createQueryBuilder.mockReturnValue(setupConflictMock([]));

      await expect(
        service.addInternalParticipant(
          'meeting-uuid',
          { userId: 'invited-user-uuid' },
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });
  // ════════════════════════════════════════════════════════════════
  //  My Schedule (UC-MM-05)
  // ════════════════════════════════════════════════════════════════

  function buildScheduleQb(overrides?: Partial<Record<string, jest.Mock>>) {
    const qb: any = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue(null),
      ...overrides,
    };
    return qb;
  }

  describe('getMySchedule', () => {
    it('[T024] should return events for valid range', async () => {
      const rawEvents = [
        {
          m_id: 'meeting-1',
          m_meeting_code: 'MTG-001',
          m_title: 'Sprint Planning',
          m_start_time: new Date('2026-06-10T09:00:00Z'),
          m_end_time: new Date('2026-06-10T10:30:00Z'),
          m_timezone: 'Asia/Ho_Chi_Minh',
          m_status: 'scheduled',
          effective_user_role: 'organizer',
          room_id: 'room-1',
          room_name: 'Phong A',
          room_code: 'RM-A',
          room_location: 'Tang 5',
          is_current: false,
          is_past: false,
        },
        {
          m_id: 'meeting-2',
          m_meeting_code: 'MTG-002',
          m_title: 'Daily Standup',
          m_start_time: new Date('2026-06-09T09:00:00Z'),
          m_end_time: new Date('2026-06-09T09:15:00Z'),
          m_timezone: 'Asia/Ho_Chi_Minh',
          m_status: 'completed',
          effective_user_role: 'attendee',
          room_id: null,
          room_name: null,
          room_code: null,
          room_location: null,
          is_current: false,
          is_past: true,
        },
        {
          m_id: 'meeting-3',
          m_meeting_code: 'MTG-003',
          m_title: '1:1 with Manager',
          m_start_time: new Date('2026-06-11T14:00:00Z'),
          m_end_time: new Date('2026-06-11T14:30:00Z'),
          m_timezone: 'Asia/Ho_Chi_Minh',
          m_status: 'scheduled',
          effective_user_role: 'attendee',
          room_id: null,
          room_name: null,
          room_code: null,
          room_location: null,
          is_current: false,
          is_past: false,
        },
      ];

      const qb = buildScheduleQb({
        getRawMany: jest.fn().mockResolvedValue(rawEvents),
      });
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMySchedule('user-1', {
        view: 'week',
        from: '2026-06-08T00:00:00+07:00',
        to: '2026-06-15T00:00:00+07:00',
        timezone: 'Asia/Ho_Chi_Minh',
      } as any);

      expect(result.items).toHaveLength(3);
      expect(result.empty).toBe(false);
      expect(result.items[0].meetingId).toBe('meeting-1');
      expect(result.items[0].userRole).toBe('organizer');
      expect(result.items[1].userRole).toBe('attendee');
      expect(result.items[1].isPast).toBe(true);
      expect(result.range.view).toBe('week');
    });

    it('[T025] overlap boundary - meeting starts before from, ends after from', async () => {
      const rawEvents = [
        {
          m_id: 'meeting-1',
          m_meeting_code: 'MTG-001',
          m_title: 'Crossing Meeting',
          m_start_time: new Date('2026-06-07T23:00:00+07:00'),
          m_end_time: new Date('2026-06-08T01:00:00+07:00'),
          m_timezone: 'Asia/Ho_Chi_Minh',
          m_status: 'scheduled',
          effective_user_role: 'attendee',
          room_id: null,
          room_name: null,
          room_code: null,
          room_location: null,
          is_current: false,
          is_past: false,
        },
      ];

      const qb = buildScheduleQb({
        getRawMany: jest.fn().mockResolvedValue(rawEvents),
      });
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMySchedule('user-1', {
        view: 'day',
        from: '2026-06-08T00:00:00+07:00',
        to: '2026-06-09T00:00:00+07:00',
      } as any);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Crossing Meeting');
    });

    it('[T026] empty range returns empty items with empty=true', async () => {
      const qb = buildScheduleQb({
        getRawMany: jest.fn().mockResolvedValue([]),
      });
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMySchedule('user-1', {
        view: 'day',
        from: '2025-01-01T00:00:00+07:00',
        to: '2025-01-02T00:00:00+07:00',
      } as any);

      expect(result.items).toHaveLength(0);
      expect(result.empty).toBe(true);
    });

    it('[T027] effectiveUserRole - user is both organizer and participant, returns one event with organizer', async () => {
      const rawEvents = [
        {
          m_id: 'meeting-1',
          m_meeting_code: 'MTG-001',
          m_title: 'My Meeting',
          m_start_time: new Date('2026-06-10T09:00:00Z'),
          m_end_time: new Date('2026-06-10T10:30:00Z'),
          m_timezone: 'Asia/Ho_Chi_Minh',
          m_status: 'scheduled',
          effective_user_role: 'organizer',
          room_id: null,
          room_name: null,
          room_code: null,
          room_location: null,
          is_current: false,
          is_past: false,
        },
      ];

      const qb = buildScheduleQb({
        getRawMany: jest.fn().mockResolvedValue(rawEvents),
      });
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMySchedule('user-1', {
        view: 'week',
        from: '2026-06-08T00:00:00+07:00',
        to: '2026-06-15T00:00:00+07:00',
      } as any);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].userRole).toBe('organizer');
    });

    it('[T028] role filter - user is organizer, filter role=attendee excludes meeting', async () => {
      const rawEvents: any[] = [];

      const qb = buildScheduleQb({
        getRawMany: jest.fn().mockResolvedValue(rawEvents),
      });
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMySchedule('user-1', {
        view: 'week',
        from: '2026-06-08T00:00:00+07:00',
        to: '2026-06-15T00:00:00+07:00',
        role: 'attendee',
      } as any);

      expect(result.items).toHaveLength(0);
      expect(result.empty).toBe(true);
    });

    it('[T029] q search on meeting_code', async () => {
      const rawEvents = [
        {
          m_id: 'meeting-1',
          m_meeting_code: 'MTG-2026-001',
          m_title: 'Test Meeting',
          m_start_time: new Date('2026-06-10T09:00:00Z'),
          m_end_time: new Date('2026-06-10T10:30:00Z'),
          m_timezone: 'Asia/Ho_Chi_Minh',
          m_status: 'scheduled',
          effective_user_role: 'attendee',
          room_id: null,
          room_name: null,
          room_code: null,
          room_location: null,
          is_current: false,
          is_past: false,
        },
      ];

      const qb = buildScheduleQb({
        getRawMany: jest.fn().mockResolvedValue(rawEvents),
      });
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMySchedule('user-1', {
        view: 'week',
        from: '2026-06-08T00:00:00+07:00',
        to: '2026-06-15T00:00:00+07:00',
        q: '001',
      } as any);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].meetingCode).toBe('MTG-2026-001');
    });

    it('[T030] q whitespace-only ignored, all results returned', async () => {
      const rawEvents = [
        {
          m_id: 'meeting-1',
          m_meeting_code: 'MTG-001',
          m_title: 'Sprint Planning',
          m_start_time: new Date('2026-06-10T09:00:00Z'),
          m_end_time: new Date('2026-06-10T10:30:00Z'),
          m_timezone: 'Asia/Ho_Chi_Minh',
          m_status: 'scheduled',
          effective_user_role: 'organizer',
          room_id: null,
          room_name: null,
          room_code: null,
          room_location: null,
          is_current: false,
          is_past: false,
        },
      ];

      const qb = buildScheduleQb({
        getRawMany: jest.fn().mockResolvedValue(rawEvents),
      });
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMySchedule('user-1', {
        view: 'week',
        from: '2026-06-08T00:00:00+07:00',
        to: '2026-06-15T00:00:00+07:00',
        q: '   ',
      } as any);

      expect(result.items).toHaveLength(1);
    });

    it('[T031] invalid date range from >= to throws 422', async () => {
      await expect(
        service.getMySchedule('user-1', {
          view: 'week',
          from: '2026-06-15T00:00:00+07:00',
          to: '2026-06-08T00:00:00+07:00',
        } as any),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[T032] range too wide - 60 days for month view throws 422', async () => {
      await expect(
        service.getMySchedule('user-1', {
          view: 'month',
          from: '2026-01-01T00:00:00+07:00',
          to: '2026-03-01T00:00:00+07:00',
        } as any),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[T033] cancelled meeting still appears with status=cancelled', async () => {
      const rawEvents = [
        {
          m_id: 'meeting-cancelled',
          m_meeting_code: 'MTG-CAN',
          m_title: 'Cancelled Meeting',
          m_start_time: new Date('2026-06-10T09:00:00Z'),
          m_end_time: new Date('2026-06-10T10:30:00Z'),
          m_timezone: 'Asia/Ho_Chi_Minh',
          m_status: 'cancelled',
          effective_user_role: 'organizer',
          room_id: null,
          room_name: null,
          room_code: null,
          room_location: null,
          is_current: false,
          is_past: false,
        },
      ];

      const qb = buildScheduleQb({
        getRawMany: jest.fn().mockResolvedValue(rawEvents),
      });
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMySchedule('user-1', {
        view: 'week',
        from: '2026-06-08T00:00:00+07:00',
        to: '2026-06-15T00:00:00+07:00',
      } as any);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].status).toBe('cancelled');
      expect(result.items[0].colorKey).toBe('cancelled');
    });

    it('[T034] filter by status returns only matching meetings', async () => {
      const rawEvents = [
        {
          m_id: 'meeting-1',
          m_meeting_code: 'MTG-001',
          m_title: 'Ongoing Meeting',
          m_start_time: new Date('2026-06-10T09:00:00Z'),
          m_end_time: new Date('2026-06-10T10:30:00Z'),
          m_timezone: 'Asia/Ho_Chi_Minh',
          m_status: 'in_progress',
          effective_user_role: 'organizer',
          room_id: null,
          room_name: null,
          room_code: null,
          room_location: null,
          is_current: false,
          is_past: false,
        },
      ];

      const qb = buildScheduleQb({
        getRawMany: jest.fn().mockResolvedValue(rawEvents),
      });
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMySchedule('user-1', {
        view: 'week',
        from: '2026-06-08T00:00:00+07:00',
        to: '2026-06-15T00:00:00+07:00',
        status: ['in_progress'],
      } as any);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].status).toBe('in_progress');
    });

    it('[T035] sort by start_time ASC', async () => {
      const rawEvents = [
        {
          m_id: 'meeting-1',
          m_meeting_code: 'MTG-001',
          m_title: 'Later Meeting',
          m_start_time: new Date('2026-06-10T10:00:00Z'),
          m_end_time: new Date('2026-06-10T11:00:00Z'),
          m_timezone: 'Asia/Ho_Chi_Minh',
          m_status: 'scheduled',
          effective_user_role: 'attendee',
          room_id: null,
          room_name: null,
          room_code: null,
          room_location: null,
          is_current: false,
          is_past: false,
        },
        {
          m_id: 'meeting-2',
          m_meeting_code: 'MTG-002',
          m_title: 'Earlier Meeting',
          m_start_time: new Date('2026-06-10T09:00:00Z'),
          m_end_time: new Date('2026-06-10T09:30:00Z'),
          m_timezone: 'Asia/Ho_Chi_Minh',
          m_status: 'scheduled',
          effective_user_role: 'organizer',
          room_id: null,
          room_name: null,
          room_code: null,
          room_location: null,
          is_current: false,
          is_past: false,
        },
      ];

      const qb = buildScheduleQb({
        getRawMany: jest.fn().mockResolvedValue(rawEvents),
      });
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMySchedule('user-1', {
        view: 'week',
        from: '2026-06-08T00:00:00+07:00',
        to: '2026-06-15T00:00:00+07:00',
      } as any);

      expect(result.items).toHaveLength(2);
    });
  });

  describe('getMyScheduleDetail', () => {
    it('[T036] returns full detail for participant', async () => {
      const mockMeeting = {
        id: 'meeting-uuid',
        meetingCode: 'MTG-001',
        title: 'Test Meeting',
        description: 'A test meeting',
        startTime: new Date('2026-06-10T09:00:00Z'),
        endTime: new Date('2026-06-10T10:30:00Z'),
        timezone: 'Asia/Ho_Chi_Minh',
        status: 'scheduled',
        organizerId: 'org-user-id',
        hostId: 'host-user-id',
        roomId: 'room-uuid',
        recurrenceRuleId: null,
        parentMeetingId: null,
        deletedAt: null,
        organizer: {
          id: 'org-user-id',
          fullName: 'Org User',
          email: 'org@test.com',
        },
        host: {
          id: 'host-user-id',
          fullName: 'Host User',
          email: 'host@test.com',
        },
      };

      const mockRoom = {
        id: 'room-uuid',
        roomName: 'Phong A',
        roomCode: 'RM-A',
        siteName: 'Building B',
        areaName: 'Floor 1',
        locationDescription: 'Phong A, Tang 1',
      };

      const mockParticipants = [
        {
          id: 'part-1',
          userId: 'participant-1',
          meetingId: 'meeting-uuid',
          participantRole: 'member',
          invitationStatus: 'accepted',
          attendanceStatus: 'not_yet',
          user: {
            id: 'participant-1',
            fullName: 'Part User',
            email: 'part@test.com',
          },
        },
      ];

      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const where = options?.where ?? {};
        const id = where.id;
        if (id === 'meeting-uuid') return mockMeeting;
        if (id === 'room-uuid') return mockRoom;
        if (
          where.meetingId === 'meeting-uuid' &&
          where.userId === 'participant-1'
        )
          return mockParticipants[0];
        if (where.meetingId === 'meeting-uuid') return null;
        if (where.meetingId) return null;
        return null;
      });

      const findQb = buildScheduleQb({
        getMany: jest.fn().mockResolvedValue(mockParticipants),
      });
      mockRepo.createQueryBuilder.mockReturnValue(findQb);

      const findMock = jest.fn().mockResolvedValue([]);
      mockRepo.find = findMock;
      mockRepo.find.mockResolvedValue([]);

      const result = await service.getMyScheduleDetail(
        'participant-1',
        'meeting-uuid',
      );

      expect(result.meeting.meetingId).toBe('meeting-uuid');
      expect(result.room).toBeDefined();
      expect(result.meeting.title).toBe('Test Meeting');
      expect(result.userRole).toBe('attendee');
    });

    it('[T036b] mỗi agenda item mang theo đúng attachments của riêng nó (regression: getMyScheduleDetail trước đây query attachments theo relatedEntityType="meeting" nên agendas[].attachments luôn rỗng dù addAgendaAttachment() đã lưu đúng dữ liệu với relatedEntityType="meeting_agenda")', async () => {
      const mockMeeting = {
        id: 'meeting-uuid',
        meetingCode: 'MTG-001',
        title: 'Test Meeting',
        description: null,
        startTime: new Date('2026-06-10T09:00:00Z'),
        endTime: new Date('2026-06-10T10:30:00Z'),
        timezone: 'Asia/Ho_Chi_Minh',
        status: 'scheduled',
        organizerId: 'org-user-id',
        hostId: 'host-user-id',
        roomId: null,
        recurrenceRuleId: null,
        parentMeetingId: null,
        deletedAt: null,
        organizer: {
          id: 'org-user-id',
          fullName: 'Org User',
          email: 'org@test.com',
        },
        host: {
          id: 'host-user-id',
          fullName: 'Host User',
          email: 'host@test.com',
        },
      };

      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const where = options?.where ?? {};
        if (where.id === 'meeting-uuid') return mockMeeting;
        if (
          where.meetingId === 'meeting-uuid' &&
          where.userId === 'participant-1'
        ) {
          return {
            id: 'part-1',
            meetingId: 'meeting-uuid',
            userId: 'participant-1',
          };
        }
        return null;
      });

      const qb = buildScheduleQb({ getMany: jest.fn().mockResolvedValue([]) });
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const agendaRows = [
        {
          id: 'agenda-1',
          title: 'Start',
          plannedDurationMinutes: 15,
          agendaOrder: 0,
        },
        {
          id: 'agenda-2',
          title: 'middle',
          plannedDurationMinutes: 15,
          agendaOrder: 1,
        },
      ];
      const agendaAttachmentFiles = [
        {
          id: 'file-1',
          fileName: 'ke-hoach.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: '1024',
          fileUrl: 'https://storage.test/ke-hoach.pdf',
          uploadedBy: 'host-user-id',
          uploadedAt: new Date('2026-06-09T00:00:00Z'),
          relatedEntityId: 'agenda-1',
        },
      ];

      mockRepo.find = jest
        .fn()
        // 1. participants
        .mockResolvedValueOnce([])
        // 2. externalParticipants
        .mockResolvedValueOnce([])
        // 3. agendas
        .mockResolvedValueOnce(agendaRows)
        // 4. top-level meeting attachments (relatedEntityType='meeting')
        .mockResolvedValueOnce([])
        // 5. loadAgendaAttachmentsMap (relatedEntityType='meeting_agenda', gọi sau Promise.all)
        .mockResolvedValueOnce(agendaAttachmentFiles);

      const result = await service.getMyScheduleDetail(
        'participant-1',
        'meeting-uuid',
      );

      expect(result.agendas).toHaveLength(2);
      expect(result.agendas[0].id).toBe('agenda-1');
      expect(result.agendas[0].attachments).toHaveLength(1);
      expect(result.agendas[0].attachments[0]).toMatchObject({
        id: 'file-1',
        fileName: 'ke-hoach.pdf',
        fileType: 'application/pdf',
      });
      // agenda-2 không có file nào đính kèm → mảng rỗng, không bị lẫn file của agenda-1
      expect(result.agendas[1].attachments).toEqual([]);
    });

    it('[T037] non-participant throws 403', async () => {
      const mockMeeting = {
        id: 'meeting-uuid',
        organizerId: 'org-user-id',
        hostId: 'host-user-id',
        deletedAt: null,
      };

      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const where = options?.where ?? {};
        if (where.id === 'meeting-uuid') return mockMeeting;
        if (where.id === 'room-uuid') return null;
        if (where.meetingId === 'meeting-uuid' && where.userId === 'other-user')
          return null;
        return null;
      });

      const qb = buildScheduleQb({ getMany: jest.fn().mockResolvedValue([]) });
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.getMyScheduleDetail('other-user', 'meeting-uuid'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('[T038] meeting not found throws 404', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getMyScheduleDetail('user-1', 'non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findMeetingRequests', () => {
    // BE-fix: allowedSortFields dung snake_case nhung TypeORM orderBy('mr.<property>')
    // bat buoc property camelCase cua entity => truoc day gay 500
    // "Property 'requested_at' was not found in MeetingRequestEntity".
    const mockRequestListQb = () => {
      const qb: any = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
        // Nhóm E: findMeetingRequests giờ tự gọi findRoomConflictDetails cho
        // từng item pending — dùng LẠI createQueryBuilder mock này (không phân
        // biệt theo entity), nên cần thêm innerJoinAndSelect/getMany để không
        // vỡ các test không liên quan tới tính năng đó.
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
        // MKM-PCONF-01: thêm findParticipantConflictDetails (dùng getRawMany
        // + addSelect/innerJoin/addOrderBy) vào cùng Promise.all đó.
        innerJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      return qb;
    };

    it.each([
      ['requested_at', 'mr.requestedAt'],
      ['created_at', 'mr.requestedAt'],
      ['approval_status', 'mr.approvalStatus'],
      ['request_type', 'mr.requestType'],
    ])(
      '[BE-fix] maps sortBy=%s to entity property %s in orderBy()',
      async (sortBy, expectedColumn) => {
        const qb = mockRequestListQb();
        mockRepo.createQueryBuilder.mockReturnValue(qb);

        await service.findMeetingRequests(
          { sortBy, sortOrder: 'asc' },
          {
            userId: 'u1',
          },
        );

        expect(qb.orderBy).toHaveBeenCalledWith(expectedColumn, 'ASC');
      },
    );

    it('[BE-fix] falls back to mr.requestedAt DESC when sortBy is not provided', async () => {
      const qb = mockRequestListQb();
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findMeetingRequests({}, { userId: 'u1' });

      expect(qb.orderBy).toHaveBeenCalledWith('mr.requestedAt', 'DESC');
    });

    // F-R3: isEditRequest/displayLabel/old*/new* — chỉ populate cho UPDATE_TIME/
    // UPDATE_ROOM, không có field thừa cho CREATE_MEETING.
    it('[F-R3] CREATE_MEETING row → isEditRequest=false, old*/new* đều null', async () => {
      const qb = mockRequestListQb();
      qb.getManyAndCount.mockResolvedValue([
        [
          {
            id: 'req-1',
            requestCode: 'MT-001',
            requestType: MeetingRequestType.CREATE_MEETING,
            approvalStatus: ApprovalStatus.PENDING,
            requestedAt: new Date('2026-07-15T09:00:00Z'),
            requestedStartTime: new Date('2026-07-15T10:00:00Z'),
            requestedEndTime: new Date('2026-07-15T11:00:00Z'),
            conflictCheckStatus: ConflictCheckStatus.CLEAR,
            conflictSummaryJson: null,
            decisionAt: null,
            rejectionReason: null,
            requestedByUser: { id: 'u1', fullName: 'A', email: 'a@x.com' },
            targetRoom: { id: 'room-1', roomName: 'P.101' },
            decisionByUser: null,
            meeting: {
              id: 'm1',
              title: 'Họp mới',
              roomId: 'room-1',
              hostId: 'u1',
              startTime: new Date('2026-07-15T10:00:00Z'),
              endTime: new Date('2026-07-15T11:00:00Z'),
            },
          },
        ],
        1,
      ]);
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findMeetingRequests({}, { userId: 'u1' });

      const item = result.items[0];
      expect(item.isEditRequest).toBe(false);
      expect(item.displayLabel).toBe('Yêu cầu đặt phòng mới');
      expect(item.oldStartTime).toBeNull();
      expect(item.oldEndTime).toBeNull();
      expect(item.oldRoomId).toBeNull();
      expect(item.newStartTime).toBeNull();
      expect(item.newRoomId).toBeNull();
    });

    it('[F-R3] UPDATE_TIME row → isEditRequest=true, old* lấy từ meeting hiện tại, new* lấy từ request', async () => {
      const qb = mockRequestListQb();
      qb.getManyAndCount.mockResolvedValue([
        [
          {
            id: 'req-2',
            requestCode: 'UPD-001',
            requestType: MeetingRequestType.UPDATE_TIME,
            approvalStatus: ApprovalStatus.PENDING,
            requestedAt: new Date('2026-07-15T09:00:00Z'),
            requestedStartTime: new Date('2026-07-15T14:00:00Z'), // giờ MỚI
            requestedEndTime: new Date('2026-07-15T15:00:00Z'),
            conflictCheckStatus: ConflictCheckStatus.CLEAR,
            conflictSummaryJson: null,
            decisionAt: null,
            rejectionReason: null,
            requestedByUser: { id: 'u1', fullName: 'A', email: 'a@x.com' },
            targetRoom: { id: 'room-1', roomName: 'P.101' },
            decisionByUser: null,
            meeting: {
              id: 'm1',
              title: 'Họp đã duyệt',
              roomId: 'room-1',
              hostId: 'u1',
              startTime: new Date('2026-07-15T10:00:00Z'), // giờ CŨ
              endTime: new Date('2026-07-15T11:00:00Z'),
            },
          },
        ],
        1,
      ]);
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findMeetingRequests({}, { userId: 'u1' });

      const item = result.items[0];
      expect(item.isEditRequest).toBe(true);
      expect(item.displayLabel).toBe('Yêu cầu chỉnh sửa');
      expect(item.oldStartTime).toEqual(new Date('2026-07-15T10:00:00Z'));
      expect(item.oldEndTime).toEqual(new Date('2026-07-15T11:00:00Z'));
      expect(item.oldRoomId).toBe('room-1');
      expect(item.newStartTime).toEqual(new Date('2026-07-15T14:00:00Z'));
      expect(item.newRoomId).toBe('room-1');
    });

    // Nhóm F (2026-08-16): 2 request PENDING trùng phòng/giờ phải lộ ra
    // pendingConflictDetails (cảnh báo vàng/cam), tách biệt với conflictDetails
    // (đỏ, chỉ dành cho booking đã APPROVED/ACTIVE) — trước đây danh sách này
    // luôn coi 2 request cùng pending là "Không trùng" vì chỉ gọi
    // findRoomConflictDetails.
    it('[Nhóm F] 2 request PENDING trùng phòng/giờ → pendingConflictDetails có dữ liệu, conflictDetails vẫn null', async () => {
      const listQb = mockRequestListQb();
      listQb.getManyAndCount.mockResolvedValue([
        [
          {
            id: 'req-1',
            requestCode: 'MT-001',
            requestType: MeetingRequestType.CREATE_MEETING,
            approvalStatus: ApprovalStatus.PENDING,
            requestedAt: new Date('2026-08-16T00:00:00Z'),
            requestedStartTime: new Date('2026-08-16T01:27:00Z'),
            requestedEndTime: new Date('2026-08-16T02:27:00Z'),
            conflictCheckStatus: ConflictCheckStatus.CLEAR,
            conflictSummaryJson: null,
            decisionAt: null,
            rejectionReason: null,
            requestedByUser: { id: 'u1', fullName: 'A', email: 'a@x.com' },
            targetRoom: { id: 'room-1', roomName: 'P.A201' },
            decisionByUser: null,
            meeting: {
              id: 'm1',
              title: 'Xung đột phòng họp',
              roomId: 'room-1',
              hostId: 'u1',
              startTime: new Date('2026-08-16T01:27:00Z'),
              endTime: new Date('2026-08-16T02:27:00Z'),
            },
          },
        ],
        1,
      ]);

      const approvedConflictQb = mockRequestListQb();
      approvedConflictQb.getMany.mockResolvedValue([]);

      const pendingConflictQb = mockRequestListQb();
      pendingConflictQb.getMany.mockResolvedValue([
        {
          id: 'booking-2',
          room: { roomName: 'P.A201' },
          meeting: { title: 'Xung đột phòng họp' },
          reservedStartTime: new Date('2026-08-16T01:27:00Z'),
          reservedEndTime: new Date('2026-08-16T02:27:00Z'),
          bookedByUser: { fullName: 'Bui Van Long' },
        },
      ]);

      // findPendingRoomConflictDetails và findParticipantConflictDetails không
      // await gì trước khi gọi createQueryBuilder(), còn findRoomConflictDetails
      // await getRoomBookingBufferMs() trước — nên dù đứng trước trong
      // Promise.all([...]), nó tới createQueryBuilder() SAU (thứ tự thật khi
      // chạy, không phải thứ tự khai báo).
      const participantConflictQb = mockRequestListQb();
      participantConflictQb.getRawMany.mockResolvedValue([]);

      mockRepo.createQueryBuilder
        .mockReturnValueOnce(listQb)
        .mockReturnValueOnce(pendingConflictQb)
        .mockReturnValueOnce(participantConflictQb)
        .mockReturnValueOnce(approvedConflictQb);

      const result = await service.findMeetingRequests({}, { userId: 'u1' });

      const item = result.items[0];
      expect(item.conflictDetails).toBeNull();
      expect(item.pendingConflictDetails).toHaveLength(1);
      expect(item.pendingConflictDetails![0]).toMatchObject({
        bookingId: 'booking-2',
        roomName: 'P.A201',
        meetingTitle: 'Xung đột phòng họp',
        hostName: 'Bui Van Long',
      });
    });
  });

  // MKM-PCONF-01 (2026-08-22) — xung đột NGƯỜI THAM DỰ phải trả về đủ thông
  // tin cuộc họp gây trùng + danh sách người, gom theo cuộc họp (trước đây FE
  // chỉ có cờ conflictCheckStatus='warning', không biết trùng với ai/ở đâu).
  describe('findParticipantConflictDetails', () => {
    const makeQb = (raw: any[]) => ({
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(raw),
    });

    const conflictRow = (over: Record<string, unknown> = {}) => ({
      meetingId: 'm2',
      meetingCode: 'MT-002',
      meetingTitle: 'Họp kỹ thuật',
      meetingStatus: MeetingStatus.SCHEDULED,
      startTime: new Date('2026-08-22T03:30:00Z'),
      endTime: new Date('2026-08-22T04:30:00Z'),
      roomName: 'P.B302',
      hostName: 'Trần Host',
      userId: 'u1',
      fullName: 'Nguyễn Văn A',
      email: 'a@x.com',
      employeeCode: 'NV001',
      avatarUrl: null,
      departmentName: 'Kỹ thuật',
      isRequired: true,
      participantRole: 'attendee',
      conflictingRole: 'attendee',
      ...over,
    });

    it('trả [] khi thiếu meetingId/khung giờ (không đụng DB)', async () => {
      expect(
        await service.findParticipantConflictDetails(
          null,
          new Date(),
          new Date(),
        ),
      ).toEqual([]);
      expect(mockRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('chỉ tốn 1 query và trả [] khi không có ai bị trùng', async () => {
      mockRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));

      const result = await service.findParticipantConflictDetails(
        'm1',
        new Date('2026-08-22T03:00:00Z'),
        new Date('2026-08-22T04:00:00Z'),
      );

      expect(result).toEqual([]);
      expect(mockRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('gom theo cuộc họp gây trùng, kèm thông tin phòng/host và danh sách người', async () => {
      mockRepo.createQueryBuilder.mockReturnValueOnce(
        makeQb([
          conflictRow(),
          // Cùng người, cùng cuộc họp (dữ liệu trùng dòng) → chỉ giữ 1.
          conflictRow(),
          conflictRow({
            meetingId: 'm3',
            meetingCode: 'MT-003',
            meetingTitle: 'Họp nhân sự',
            meetingStatus: MeetingStatus.PENDING_APPROVAL,
            startTime: new Date('2026-08-22T03:00:00Z'),
            endTime: new Date('2026-08-22T03:45:00Z'),
            roomName: null,
            hostName: null,
            userId: 'u2',
            fullName: 'Lê Thị B',
            email: 'b@x.com',
            employeeCode: null,
            departmentName: null,
            isRequired: false,
            conflictingRole: 'host',
          }),
        ]),
      );

      const result = await service.findParticipantConflictDetails(
        'm1',
        new Date('2026-08-22T03:00:00Z'),
        new Date('2026-08-22T04:00:00Z'),
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        meetingId: 'm2',
        meetingCode: 'MT-002',
        meetingTitle: 'Họp kỹ thuật',
        meetingStatus: MeetingStatus.SCHEDULED,
        roomName: 'P.B302',
        hostName: 'Trần Host',
      });
      expect(result[0].participants).toHaveLength(1);
      expect(result[0].participants[0]).toMatchObject({
        userId: 'u1',
        fullName: 'Nguyễn Văn A',
        employeeCode: 'NV001',
        departmentName: 'Kỹ thuật',
        // isRequired lấy theo cuộc họp ĐANG XÉT, không phải cuộc họp gây trùng.
        isRequired: true,
        conflictingRole: 'attendee',
      });
      expect(result[1].participants[0]).toMatchObject({
        userId: 'u2',
        isRequired: false,
        conflictingRole: 'host',
      });
    });

    it('buildParticipantConflictSummary khử trùng lặp người giữa các cuộc họp', () => {
      const participant = (userId: string, isRequired: boolean) => ({
        userId,
        fullName: null,
        email: null,
        employeeCode: null,
        departmentName: null,
        avatarUrl: null,
        isRequired,
        participantRole: null,
        conflictingRole: null,
      });
      const meeting = (meetingId: string, participants: any[]) => ({
        meetingId,
        meetingCode: null,
        meetingTitle: null,
        meetingStatus: null,
        roomName: null,
        hostName: null,
        startTime: new Date(),
        endTime: new Date(),
        participants,
      });

      expect(
        service.buildParticipantConflictSummary([
          meeting('m2', [participant('u1', true)]),
          meeting('m3', [participant('u1', true), participant('u2', false)]),
        ]),
      ).toEqual({
        conflictedUserCount: 2,
        requiredUserCount: 1,
        meetingCount: 2,
      });
    });
  });
});
