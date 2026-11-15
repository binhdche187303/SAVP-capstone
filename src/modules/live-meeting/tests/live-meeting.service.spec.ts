import { HgVisionService } from '../../academic/services/hgvision.service.js';
import { FaceProvisioningService } from '../../face-access/services/face-provisioning.service.js';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type EntityManager, type Repository } from 'typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { LiveMeetingService } from '../services/live-meeting.service.js';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import { MeetingEventEntity } from '../../meetings/entities/meeting-event.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
} from '../../rooms/entities/room-booking.entity.js';
import { RoomEventEntity } from '../../rooms/entities/room-event.entity.js';
import {
  RoomBookingUsageEntity,
  RoomUsageStatus,
  OccupancySource,
} from '../../rooms/entities/room-booking-usage.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { StartMeetingResponseDto } from '../dto/start-meeting-response.dto.js';
import { EndMeetingResponseDto } from '../dto/end-meeting-response.dto.js';
import { QueueService } from '../../queue/queue.service.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { ConfigService } from '@nestjs/config';
import { GuestInviteService } from '../../guest-access/services/guest-invite.service.js';
import { RecordingSessionService } from '../../recording/services/recording-session.service.js';

describe('LiveMeetingService', () => {
  let service: LiveMeetingService;
  let dataSource: DataSource;
  let meetingRepo: Repository<MeetingEntity>;

  const mockWebsocketService = {
    emitToRoom: jest.fn(),
  };

  const mockGuestInviteService = {
    revokeAllForMeeting: jest.fn().mockResolvedValue(0),
  };

  // [FIX 2026-08-12, R9 — Lớp 1] endMeeting() gọi stopAllActiveForMeeting() best-effort sau
  // transaction — mock để không phá vỡ toàn bộ suite hiện có (default: không session nào active).
  const mockRecordingSessionService = {
    stopAllActiveForMeeting: jest
      .fn()
      .mockResolvedValue({ scanned: 0, stopped: 0, failed: 0 }),
  };

  const now = new Date();
  const baseMeeting = {
    id: 'm-001',
    meetingCode: 'MTG-001',
    title: 'Test meeting',
    organizerId: 'org-1',
    hostId: 'host-1',
    roomId: 'room-1',
    status: MeetingStatus.SCHEDULED,
    startTime: new Date(now.getTime() - 5 * 60 * 1000), // 30 phút sau
    endTime: new Date(now.getTime() + 90 * 60 * 1000), // 90 phút sau
    actualStartTime: null,
    actualEndTime: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  // Mock entity manager
  const mockQueryBuilder = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };

  const mockQueueService = {
    addJob: jest.fn().mockResolvedValue('mock-job-id'),
    getQueue: jest.fn().mockReturnValue(undefined),
  };

  const mockBackgroundJobsService = {
    createQueuedJob: jest.fn().mockResolvedValue({ id: 'bg-job-id' }),
    findByIdOrNull: jest.fn().mockResolvedValue(null),
    cancelJob: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('scheduler'),
  };

  const mockTransactionalEm = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    // [FIX 2026-08-13, Fix A] executeEndMeetingInTransaction() giờ SELECT
    // trước khi release room_bookings (để ghi đúng oldStatus vào room_events) —
    // mặc định trả 1 booking 'active' để các test endMeeting() hiện có (không
    // quan tâm chi tiết room booking) không vỡ; test riêng cho Fix A override.
    findOne: jest.fn().mockResolvedValue({
      id: 'booking-1',
      status: RoomBookingStatus.ACTIVE,
    }),
    create: jest.fn(),
    save: jest.fn().mockResolvedValue({}),
  } as unknown as EntityManager;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: HgVisionService, useValue: {} },
        { provide: FaceProvisioningService, useValue: { provisionMeeting: jest.fn().mockResolvedValue(undefined), deprovisionMeeting: jest.fn().mockResolvedValue(undefined), provisionParticipant: jest.fn().mockResolvedValue(undefined), deprovisionParticipant: jest.fn().mockResolvedValue(undefined) } },
        LiveMeetingService,
        {
          provide: DataSource,
          useValue: {
            getRepository: jest.fn().mockReturnValue({
              findOne: jest.fn(),
              find: jest.fn(),
            }),
            transaction: jest.fn().mockImplementation(async (cb: Function) => {
              return cb(mockTransactionalEm);
            }),
            // notifyAudioTrackUploadNeeded (Gap fix Nhóm A) dùng manager.query
            // trực tiếp (ngoài transaction) — mặc định trả [] để mọi test
            // endMeeting hiện có không bị ảnh hưởng (no config → bỏ qua).
            manager: {
              query: jest.fn().mockResolvedValue([]),
              create: jest.fn((_entity: unknown, obj: any) => obj),
              save: jest.fn().mockResolvedValue({}),
            },
          },
        },
        {
          provide: WebsocketService,
          useValue: mockWebsocketService,
        },
        {
          provide: QueueService,
          useValue: mockQueueService,
        },
        {
          provide: BackgroundJobsService,
          useValue: mockBackgroundJobsService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          // GLA-001: endMeeting() gọi revokeAllForMeeting() best-effort sau
          // transaction — mock để không phá vỡ toàn bộ suite hiện có.
          provide: GuestInviteService,
          useValue: mockGuestInviteService,
        },
        {
          provide: RecordingSessionService,
          useValue: mockRecordingSessionService,
        },
      ],
    }).compile();

    service = module.get<LiveMeetingService>(LiveMeetingService);
    dataSource = module.get<DataSource>(DataSource);
    meetingRepo = dataSource.getRepository(MeetingEntity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ────────────────────────────────────────
  //  Happy path
  // ────────────────────────────────────────
  it('T001: should start meeting successfully (happy path)', async () => {
    jest
      .spyOn(meetingRepo, 'findOne')
      .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
    mockQueryBuilder.getOne.mockResolvedValue({
      ...baseMeeting,
    });

    const result = await service.startMeeting(
      'm-001',
      { userId: 'host-1' },
      {},
    );

    expect(result.status).toBe(MeetingStatus.IN_PROGRESS);
    expect(result.alreadyStarted).toBe(false);
    expect(result.actualStartTime).toBeTruthy();
    expect(mockQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
  });

  // ────────────────────────────────────────
  //  Meeting not found
  // ────────────────────────────────────────
  it('T002: should throw MEETING_NOT_FOUND when meeting does not exist', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue(null);

    await expect(
      service.startMeeting('invalid', { userId: 'host-1' }, {}),
    ).rejects.toThrow(NotFoundException);
  });

  it('T002b: should throw MEETING_NOT_FOUND when meeting is soft-deleted', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      deletedAt: new Date(),
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(NotFoundException);
  });

  // ────────────────────────────────────────
  //  Authorization
  // ────────────────────────────────────────
  it('T003: should throw FORBIDDEN when user is not host or organizer', async () => {
    jest
      .spyOn(meetingRepo, 'findOne')
      .mockResolvedValue({ ...baseMeeting } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'stranger' }, {}),
    ).rejects.toThrow(ForbiddenException);
  });

  // ────────────────────────────────────────
  //  Status validation
  // ────────────────────────────────────────
  it('T004: should throw when meeting is completed', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.COMPLETED,
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  it('T005: should throw when meeting is cancelled', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.CANCELLED,
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  it('T006: should throw when meeting is pending_approval', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.PENDING_APPROVAL,
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  it('T007: should throw when meeting is draft', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.DRAFT,
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  // ────────────────────────────────────────
  //  Time window
  // ────────────────────────────────────────
  it('T008: should throw MEETING_START_TOO_EARLY when before start_time - 15m', async () => {
    const farFuture = new Date(now.getTime() + 120 * 60 * 1000);
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      startTime: farFuture,
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  it('T009: should throw MEETING_START_WINDOW_EXPIRED when after end_time', async () => {
    const pastEnd = new Date(now.getTime() - 10 * 60 * 1000);
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      startTime: new Date(now.getTime() - 60 * 60 * 1000),
      endTime: pastEnd,
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  // ────────────────────────────────────────
  //  Idempotent
  // ────────────────────────────────────────
  it('T010: should return idempotent response when already started', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.IN_PROGRESS,
      actualStartTime: new Date(),
    } as MeetingEntity);

    const result = await service.startMeeting(
      'm-001',
      { userId: 'host-1' },
      {},
    );

    expect(result.alreadyStarted).toBe(true);
    expect(result.status).toBe(MeetingStatus.IN_PROGRESS);
  });

  // ────────────────────────────────────────
  //  Transaction lock re-validation
  // ────────────────────────────────────────
  it('T011: should throw MEETING_ALREADY_STARTED when lock re-validation finds actualStartTime set', async () => {
    jest
      .spyOn(meetingRepo, 'findOne')
      .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
    mockQueryBuilder.getOne.mockResolvedValue({
      ...baseMeeting,
      actualStartTime: new Date(),
    });

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  // ────────────────────────────────────────
  //  AF1 Device flow
  // ────────────────────────────────────────
  it('T012: AF1 should start meeting when exactly 1 meeting matches', async () => {
    const matchedMeeting = {
      ...baseMeeting,
      hostId: 'dev-host',
      roomId: 'dev-room',
    };
    jest
      .spyOn(meetingRepo, 'find')
      .mockResolvedValue([matchedMeeting] as MeetingEntity[]);
    mockQueryBuilder.getOne.mockResolvedValue(matchedMeeting);

    const result = await service.startMeetingFromDeviceCheckIn({
      deviceId: 'dev-1',
      roomId: 'dev-room',
      recognizedUserId: 'dev-host',
      sourceType: 'device',
    });

    expect(result.status).toBe(MeetingStatus.IN_PROGRESS);
    expect(result.alreadyStarted).toBe(false);
  });

  it('T013: AF1 should throw when no meeting matches', async () => {
    jest.spyOn(meetingRepo, 'find').mockResolvedValue([]);

    await expect(
      service.startMeetingFromDeviceCheckIn({
        deviceId: 'dev-1',
        roomId: 'dev-room',
        recognizedUserId: 'nobody',
        sourceType: 'device',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('T014: AF1 should throw when multiple meetings match', async () => {
    const m1 = {
      ...baseMeeting,
      hostId: 'dev-host',
      roomId: 'dev-room',
    } as MeetingEntity;
    const m2 = {
      ...baseMeeting,
      id: 'm-002',
      hostId: 'dev-host',
      roomId: 'dev-room',
    } as MeetingEntity;
    jest.spyOn(meetingRepo, 'find').mockResolvedValue([m1, m2]);

    await expect(
      service.startMeetingFromDeviceCheckIn({
        deviceId: 'dev-1',
        roomId: 'dev-room',
        recognizedUserId: 'dev-host',
        sourceType: 'device',
      }),
    ).rejects.toThrow(ConflictException);
  });

  // ────────────────────────────────────────
  //  WebSocket best-effort
  // ────────────────────────────────────────
  it('T015: should emit WebSocket event after successful start', async () => {
    jest
      .spyOn(meetingRepo, 'findOne')
      .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
    mockQueryBuilder.getOne.mockResolvedValue({
      ...baseMeeting,
    });

    await service.startMeeting('m-001', { userId: 'host-1' }, {});

    expect(mockWebsocketService.emitToRoom).toHaveBeenCalledWith(
      'meeting:m-001',
      'meeting.session.started',
      expect.objectContaining({
        eventType: 'meeting.session.started',
        data: expect.objectContaining({
          meetingId: 'm-001',
          status: MeetingStatus.IN_PROGRESS,
        }),
      }),
    );
  });

  it('T015b: should not throw when WebSocket push fails', async () => {
    mockWebsocketService.emitToRoom.mockImplementationOnce(() => {
      throw new Error('WS unavailable');
    });

    jest
      .spyOn(meetingRepo, 'findOne')
      .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
    mockQueryBuilder.getOne.mockResolvedValue({
      ...baseMeeting,
    });

    const result = await service.startMeeting(
      'm-001',
      { userId: 'host-1' },
      {},
    );

    expect(result.status).toBe(MeetingStatus.IN_PROGRESS);
  });

  // ───────────────────────────────────────────────────────────
  //  UC-IMM-05: End Meeting Session Tests
  // ───────────────────────────────────────────────────────────

  describe('LiveMeetingService - endMeeting', () => {
    const now = new Date();
    const baseMeeting = {
      id: 'm-001',
      meetingCode: 'MTG-001',
      title: 'Test meeting',
      organizerId: 'org-1',
      hostId: 'host-1',
      roomId: 'room-1',
      status: MeetingStatus.IN_PROGRESS,
      startTime: new Date(now.getTime() - 60 * 60 * 1000), // 1 hour ago
      endTime: new Date(now.getTime() + 30 * 60 * 1000), // 30 min later
      actualStartTime: new Date(now.getTime() - 60 * 60 * 1000),
      actualEndTime: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    // ────────────────────────────────────────
    //  Happy path — end on time
    // ────────────────────────────────────────
    it('T013-01: should end meeting successfully (on time, room NOT released)', async () => {
      // now() >= endTime
      jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
        ...baseMeeting,
        endTime: new Date(now.getTime() - 1000),
      } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        endTime: new Date(now.getTime() - 1000),
      });

      const result = await service.endMeeting(
        'm-001',
        { userId: 'host-1' },
        {},
      );

      expect(result.status).toBe(MeetingStatus.COMPLETED);
      expect(result.meetingId).toBe('m-001');
      expect(result.roomReleased).toBe(false);
      expect(result.actualEndTime).toBeTruthy();
      expect(result.duration).toBeGreaterThan(0);
      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
    });

    // ────────────────────────────────────────
    //  Happy path — end early
    // ────────────────────────────────────────
    it('T013-02: should end meeting early (room RELEASED)', async () => {
      // now() < endTime
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
      });

      const result = await service.endMeeting(
        'm-001',
        { userId: 'host-1' },
        {},
      );

      expect(result.status).toBe(MeetingStatus.COMPLETED);
      expect(result.roomReleased).toBe(true);
      expect(result.duration).toBeGreaterThan(0);
    });

    // ────────────────────────────────────────
    //  [FIX 2026-08-13, Fix A] room_bookings PHẢI được giải phóng dù kết
    //  thúc ĐÚNG/TRỄ giờ (trước đây chỉ chạy khi isEarlyEnd=true, bug thật
    //  đêm nay) — và WHERE chấp nhận cả 'approved' (tự phục hồi cho ca
    //  Fix B chưa kịp chạy/lỗi transient), không chỉ 'active'.
    //  Lưu ý: `result.roomReleased` (DTO) vẫn giữ nguyên nghĩa "kết thúc
    //  SỚM" — KHÔNG đổi, đó là câu hỏi nghiệp vụ khác (có tái dùng được
    //  phần giờ còn lại của booking không), độc lập với việc room_bookings
    //  có được release trong DB hay không.
    // ────────────────────────────────────────
    it('[Fix A] kết thúc ĐÚNG giờ (không sớm) → room_bookings vẫn release thành completed', async () => {
      jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
        ...baseMeeting,
        endTime: new Date(now.getTime() - 1000), // đã qua giờ → không phải "sớm"
      } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        endTime: new Date(now.getTime() - 1000),
      });
      (mockTransactionalEm.findOne as jest.Mock).mockResolvedValueOnce({
        id: 'booking-1',
        status: RoomBookingStatus.ACTIVE,
      });

      const result = await service.endMeeting(
        'm-001',
        { userId: 'host-1' },
        {},
      );

      expect(result.roomReleased).toBe(false); // DTO field: nghĩa "sớm", KHÔNG đổi
      expect(mockTransactionalEm.update).toHaveBeenCalledWith(
        RoomBookingEntity,
        { id: 'booking-1' },
        { status: RoomBookingStatus.COMPLETED },
      );
      const eventArg = (
        mockTransactionalEm.create as jest.Mock
      ).mock.calls.find((c) => c[0] === RoomEventEntity)?.[1];
      expect(eventArg?.eventType).toBe('room_released_on_end');
    });

    it('[Fix A] kết thúc TRỄ giờ (mirror autoCompleteOverdueMeetings) → vẫn release room_bookings', async () => {
      const overdueMeeting = {
        ...baseMeeting,
        endTime: new Date(now.getTime() - 60 * 60 * 1000), // trễ 1 tiếng
      };
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue(overdueMeeting as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue(overdueMeeting);

      await service.endMeeting('m-001', { userId: 'host-1' }, {});

      expect(mockTransactionalEm.update).toHaveBeenCalledWith(
        RoomBookingEntity,
        { id: 'booking-1' },
        { status: RoomBookingStatus.COMPLETED },
      );
    });

    it('[Fix A] kết thúc SỚM → vẫn hoạt động đúng như cũ (release + roomReleased=true)', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting });

      const result = await service.endMeeting(
        'm-001',
        { userId: 'host-1' },
        {},
      );

      expect(result.roomReleased).toBe(true);
      expect(mockTransactionalEm.update).toHaveBeenCalledWith(
        RoomBookingEntity,
        { id: 'booking-1' },
        { status: RoomBookingStatus.COMPLETED },
      );
    });

    it('[Fix A] TÁI HIỆN bug thật: booking kẹt ở approved (autoStartDueMeetings tự-start, chưa qua Fix B) → endMeeting VẪN release đúng nhờ WHERE nới status IN (approved, active)', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting });
      (mockTransactionalEm.findOne as jest.Mock).mockResolvedValueOnce({
        id: 'booking-stuck',
        status: RoomBookingStatus.APPROVED, // đúng bug thật: chưa từng thành 'active'
      });

      await service.endMeeting('m-001', { userId: 'host-1' }, {});

      expect(mockTransactionalEm.findOne).toHaveBeenCalledWith(
        RoomBookingEntity,
        expect.objectContaining({
          where: expect.objectContaining({ meetingId: 'm-001' }),
        }),
      );
      expect(mockTransactionalEm.update).toHaveBeenCalledWith(
        RoomBookingEntity,
        { id: 'booking-stuck' },
        { status: RoomBookingStatus.COMPLETED },
      );
      const eventArg = (
        mockTransactionalEm.create as jest.Mock
      ).mock.calls.find((c) => c[0] === RoomEventEntity)?.[1];
      expect(eventArg?.oldStatus).toBe(RoomBookingStatus.APPROVED);
    });

    it('[Fix A] regression: không còn booking approved/active nào cho meeting này (đã cancelled/completed từ trước) → KHÔNG update, KHÔNG ghi đè', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting });
      (mockTransactionalEm.findOne as jest.Mock).mockResolvedValueOnce(null);

      const updateCallsBefore = (mockTransactionalEm.update as jest.Mock).mock
        .calls.length;
      await service.endMeeting('m-001', { userId: 'host-1' }, {});

      const roomBookingUpdateCalls = (
        mockTransactionalEm.update as jest.Mock
      ).mock.calls
        .slice(updateCallsBefore)
        .filter((c) => c[0] === RoomBookingEntity);
      expect(roomBookingUpdateCalls).toHaveLength(0);
    });

    // ────────────────────────────────────────
    //  GLA-001: thu hồi phiên khách khi meeting completed
    // ────────────────────────────────────────
    it('[GLA-001] should revoke all guest sessions for the meeting after ending it (best-effort)', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting });

      await service.endMeeting('m-001', { userId: 'host-1' }, {});

      expect(mockGuestInviteService.revokeAllForMeeting).toHaveBeenCalledWith(
        'm-001',
      );
    });

    it('[GLA-001] should NOT fail endMeeting when revokeAllForMeeting throws (best-effort)', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting });

      mockGuestInviteService.revokeAllForMeeting.mockRejectedValueOnce(
        new Error('Redis down'),
      );

      await expect(
        service.endMeeting('m-001', { userId: 'host-1' }, {}),
      ).resolves.toBeDefined();
    });

    // ────────────────────────────────────────
    //  [FIX 2026-08-12, R9 — Lớp 1] Auto-stop recording khi meeting kết thúc
    //  (đường THỦ CÔNG — host bấm "Kết thúc họp" → controller → endMeeting()
    //  trực tiếp; đường CRON được test riêng ở
    //  live-meeting-status-advance.service.spec.ts vì dùng chung endMeeting()).
    // ────────────────────────────────────────
    it('[R9] should call stopAllActiveForMeeting(meetingId, null) after ending the meeting', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting });

      await service.endMeeting('m-001', { userId: 'host-1' }, {});

      expect(
        mockRecordingSessionService.stopAllActiveForMeeting,
      ).toHaveBeenCalledWith('m-001', null, 'meeting_ended');
    });

    it('[R9] should NOT fail endMeeting when stopAllActiveForMeeting throws (best-effort)', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting });

      mockRecordingSessionService.stopAllActiveForMeeting.mockRejectedValueOnce(
        new Error('recording service down'),
      );

      const result = await service.endMeeting(
        'm-001',
        { userId: 'host-1' },
        {},
      );
      expect(result.status).toBe(MeetingStatus.COMPLETED);
    });

    it('[R9] should NOT call stopAllActiveForMeeting-triggered stopVideo when there are no active sessions (mock trả scanned=0)', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting });
      mockRecordingSessionService.stopAllActiveForMeeting.mockResolvedValueOnce(
        { scanned: 0, stopped: 0, failed: 0 },
      );

      await expect(
        service.endMeeting('m-001', { userId: 'host-1' }, {}),
      ).resolves.toBeDefined();
      expect(
        mockRecordingSessionService.stopAllActiveForMeeting,
      ).toHaveBeenCalledTimes(1);
    });

    // ────────────────────────────────────────
    //  Meeting not found
    // ────────────────────────────────────────
    it('T013-03: should throw MEETING_NOT_FOUND when meeting does not exist', async () => {
      jest.spyOn(meetingRepo, 'findOne').mockResolvedValue(null);

      await expect(
        service.endMeeting('invalid', { userId: 'host-1' }, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('T013-03b: should throw MEETING_NOT_FOUND when meeting is soft-deleted', async () => {
      jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
        ...baseMeeting,
        deletedAt: new Date(),
      } as MeetingEntity);

      await expect(
        service.endMeeting('m-001', { userId: 'host-1' }, {}),
      ).rejects.toThrow(NotFoundException);
    });

    // ────────────────────────────────────────
    //  Authorization
    // ────────────────────────────────────────
    it('T013-04: should throw FORBIDDEN when user is not host or organizer', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);

      await expect(
        service.endMeeting('m-001', { userId: 'stranger' }, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    // ────────────────────────────────────────
    //  Status validation
    // ────────────────────────────────────────
    it('T013-05: should throw when meeting is SCHEDULED', async () => {
      jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
        ...baseMeeting,
        status: MeetingStatus.SCHEDULED,
      } as MeetingEntity);

      await expect(
        service.endMeeting('m-001', { userId: 'host-1' }, {}),
      ).rejects.toThrow(ConflictException);
    });

    it('T013-06: should throw when meeting is COMPLETED (already has actualEndTime)', async () => {
      jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
        ...baseMeeting,
        status: MeetingStatus.COMPLETED,
        actualEndTime: new Date(),
      } as MeetingEntity);

      await expect(
        service.endMeeting('m-001', { userId: 'host-1' }, {}),
      ).rejects.toThrow(ConflictException);
    });

    it('T013-07: should throw when meeting is CANCELLED', async () => {
      jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
        ...baseMeeting,
        status: MeetingStatus.CANCELLED,
      } as MeetingEntity);

      await expect(
        service.endMeeting('m-001', { userId: 'host-1' }, {}),
      ).rejects.toThrow(ConflictException);
    });

    // ────────────────────────────────────────
    //  Transaction lock re-validation
    // ────────────────────────────────────────
    it('T013-08: should throw MEETING_ALREADY_COMPLETED when lock re-validation finds actualEndTime set', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        actualEndTime: new Date(),
      });

      await expect(
        service.endMeeting('m-001', { userId: 'host-1' }, {}),
      ).rejects.toThrow(ConflictException);
    });

    // ────────────────────────────────────────
    //  WebSocket best-effort
    // ────────────────────────────────────────
    it('T013-09: should emit WebSocket event after successful end', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
      });

      await service.endMeeting('m-001', { userId: 'host-1' }, {});

      expect(mockWebsocketService.emitToRoom).toHaveBeenCalledWith(
        'meeting:m-001',
        'meeting.session.ended',
        expect.objectContaining({
          eventType: 'meeting.session.ended',
          data: expect.objectContaining({
            meetingId: 'm-001',
            status: MeetingStatus.COMPLETED,
          }),
        }),
      );
    });

    // ────────────────────────────────────────
    //  Gap fix (Nhóm A) — notifyAudioTrackUploadNeeded best-effort
    // ────────────────────────────────────────
    it('T013-11: should create AUDIO_TRACK_UPLOAD_REQUESTED notification when channel_by_zone enabled', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting });

      const queryMock = (dataSource.manager as any).query as jest.Mock;
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM recording_configs')) {
          return Promise.resolve([
            {
              enable_transcription: true,
              audio_source_mode: 'channel_by_zone',
            },
          ]);
        }
        if (sql.includes('FROM meeting_participants')) {
          return Promise.resolve([
            { user_id: 'host-1' },
            { user_id: 'attendee-1' },
          ]);
        }
        return Promise.resolve([]);
      });
      const saveMock = (dataSource.manager as any).save as jest.Mock;

      await service.endMeeting('m-001', { userId: 'host-1' }, {});

      expect(saveMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          notificationType: 'audio_track_upload_requested',
          recipientUserIdsJson: ['host-1', 'attendee-1'],
        }),
      );
    });

    it('T013-12: should NOT create notification when recording_configs has no row', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting });
      // manager.query mặc định trả [] (setup ở beforeEach) → không config.

      const saveMock = (dataSource.manager as any).save as jest.Mock;
      await service.endMeeting('m-001', { userId: 'host-1' }, {});

      expect(saveMock).not.toHaveBeenCalled();
    });

    it('T013-13: should NOT create notification when audio_source_mode is room_mix', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting });

      const queryMock = (dataSource.manager as any).query as jest.Mock;
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM recording_configs')) {
          return Promise.resolve([
            { enable_transcription: true, audio_source_mode: 'room_mix' },
          ]);
        }
        return Promise.resolve([]);
      });
      const saveMock = (dataSource.manager as any).save as jest.Mock;

      await service.endMeeting('m-001', { userId: 'host-1' }, {});

      expect(saveMock).not.toHaveBeenCalled();
    });

    it('T013-14: should not throw when notifyAudioTrackUploadNeeded query fails (best-effort)', async () => {
      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting });

      const queryMock = (dataSource.manager as any).query as jest.Mock;
      queryMock.mockRejectedValue(new Error('db down'));

      const result = await service.endMeeting(
        'm-001',
        { userId: 'host-1' },
        {},
      );

      expect(result.status).toBe(MeetingStatus.COMPLETED);
    });

    it('T013-10: should not throw when WebSocket push fails', async () => {
      mockWebsocketService.emitToRoom.mockImplementationOnce(() => {
        throw new Error('WS unavailable');
      });

      jest
        .spyOn(meetingRepo, 'findOne')
        .mockResolvedValue({ ...baseMeeting } as MeetingEntity);
      mockQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
      });

      const result = await service.endMeeting(
        'm-001',
        { userId: 'host-1' },
        {},
      );

      expect(result.status).toBe(MeetingStatus.COMPLETED);
    });

      // ========================================================
      //  UC-IMM-07: getPresentAttendees
      // ========================================================

      describe('getPresentAttendees', () => {
        const baseMeetingPA = {
          id: 'm-pa-001',
          meetingCode: 'MTG-PA-001',
          title: 'Test present attendees meeting',
          organizerId: 'org-pa-1',
          hostId: 'host-pa-1',
          roomId: 'room-pa-1',
          status: MeetingStatus.IN_PROGRESS,
          startTime: new Date(now.getTime() - 30 * 60 * 1000),
          endTime: new Date(now.getTime() + 30 * 60 * 1000),
          actualStartTime: new Date(now.getTime() - 30 * 60 * 1000),
          actualEndTime: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        };

        const mockParticipantUser = {
          id: 'user-pa-1',
          fullName: 'Nguyen Van A',
          email: 'nva@company.com',
          avatarUrl: 'https://avatar.com/a.png',
          departmentId: 'dept-pa-1',
          department: { id: 'dept-pa-1', departmentName: 'Phong IT' },
        };

        const mockParticipants = [
          {
            userId: 'user-pa-1',
            meetingId: 'm-pa-001',
            participantRole: 'host',
            invitationStatus: 'accepted',
            joinedAt: now,
            user: mockParticipantUser,
          },
          {
            userId: 'user-pa-2',
            meetingId: 'm-pa-001',
            participantRole: 'attendee',
            invitationStatus: 'accepted',
            joinedAt: now,
            user: {
              id: 'user-pa-2',
              fullName: 'Tran Thi B',
              email: 'ttb@company.com',
              departmentId: 'dept-pa-1',
              department: { id: 'dept-pa-1', departmentName: 'Phong IT' },
            },
          },
        ];

        beforeEach(() => {
          const participantQb: any = {};
          for (const method of ['innerJoinAndSelect', 'leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'skip', 'take']) {
            participantQb[method] = jest.fn().mockReturnValue(participantQb);
          }
          participantQb.getMany = jest.fn().mockResolvedValue(mockParticipants);
          participantQb.getCount = jest.fn().mockResolvedValue(mockParticipants.length);
          (meetingRepo as any).create = jest.fn((data) => data);
          (meetingRepo as any).save = jest.fn().mockResolvedValue({});
          (meetingRepo as any).createQueryBuilder = jest.fn().mockReturnValue(participantQb);
          (meetingRepo.findOne as jest.Mock).mockResolvedValue(null);
        });

        it('T014-01: should return present attendees for host (full access)', async () => {
          jest
            .spyOn(meetingRepo, 'findOne')
            .mockResolvedValue(baseMeetingPA as any);

          const result = await service.getPresentAttendees(
            'm-pa-001',
            { userId: 'host-pa-1' },
            {},
            {
              search: undefined,
              departmentId: undefined,
              page: 1,
              limit: 20,
              sortBy: 'u.fullName',
              sortOrder: 'asc',
            },
          );

          expect(result.data.meetingId).toBe('m-pa-001');
          expect(result.data.occupancyCount).toBeGreaterThanOrEqual(0);
          expect(result.meta.total).toBeGreaterThanOrEqual(0);
          expect(result.meta.page).toBe(1);
          expect(result.meta.limit).toBe(20);
        });

        it('T014-02: should throw MEETING_NOT_FOUND when meeting does not exist', async () => {
          jest.spyOn(meetingRepo, 'findOne').mockResolvedValue(null);

          await expect(
            service.getPresentAttendees(
              'm-none',
              { userId: 'host-pa-1' },
              {},
              {
                search: undefined,
                departmentId: undefined,
                page: 1,
                limit: 20,
                sortBy: 'u.fullName',
                sortOrder: 'asc',
              },
            ),
          ).rejects.toThrow(NotFoundException);
        });

        it('T014-03: should throw MEETING_NOT_IN_PROGRESS when meeting is scheduled but out of window', async () => {
          jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
            ...baseMeetingPA,
            status: MeetingStatus.SCHEDULED,
            startTime: new Date(now.getTime() + 60 * 60 * 1000),
            endTime: new Date(now.getTime() + 120 * 60 * 1000),
          } as any);

          await expect(
            service.getPresentAttendees(
              'm-pa-001',
              { userId: 'host-pa-1' },
              {},
              {
                search: undefined,
                departmentId: undefined,
                page: 1,
                limit: 20,
                sortBy: 'u.fullName',
                sortOrder: 'asc',
              },
            ),
          ).rejects.toThrow(ConflictException);
        });

        it('T014-04: should allow access when meeting is scheduled and now is in grace window', async () => {
          jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
            ...baseMeetingPA,
            status: MeetingStatus.SCHEDULED,
            startTime: new Date(now.getTime() - 5 * 60 * 1000),
            endTime: new Date(now.getTime() + 55 * 60 * 1000),
            actualStartTime: null,
          } as any);

          const result = await service.getPresentAttendees(
            'm-pa-001',
            { userId: 'host-pa-1' },
            {},
            {
              search: undefined,
              departmentId: undefined,
              page: 1,
              limit: 20,
              sortBy: 'u.fullName',
              sortOrder: 'asc',
            },
          );

          expect(result.data.meetingId).toBe('m-pa-001');
        });

        it('T014-05: non-blocking audit - should return 200 even when audit write fails', async () => {
          jest
            .spyOn(meetingRepo, 'findOne')
            .mockResolvedValue(baseMeetingPA as any);

          const result = await service.getPresentAttendees(
            'm-pa-001',
            { userId: 'host-pa-1' },
            {},
            {
              search: undefined,
              departmentId: undefined,
              page: 1,
              limit: 20,
              sortBy: 'u.fullName',
              sortOrder: 'asc',
            },
          );

          // Audit failure should not affect response
          expect(result.data.meetingId).toBe('m-pa-001');
          expect(result.meta).toBeDefined();
        });
      });
    // ------------------------------------------------------------------
    //  UC-IMM-09: Create Meeting Note
    // ------------------------------------------------------------------

    describe('createMeetingNote', () => {
      const meetingId = 'm-001';
      const currentUserId = 'user-1';
      const baseNoteDto = {
        noteType: 'in_meeting',
        content: 'Test note content',
        pinned: false,
      };

      beforeEach(() => {
        jest.clearAllMocks();
      });

      it('should create in_meeting note successfully (AC-001/004)', async () => {
        const mockQueryBuilder = {
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({
            id: meetingId,
            status: 'in_progress',
            deletedAt: null,
          }),
        };
        const mockEm = {
          createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
          create: jest.fn().mockReturnValue({ id: 'note-1' }),
          save: jest.fn().mockResolvedValue({
            id: 'note-1',
            meetingId,
            authorId: currentUserId,
            noteType: 'in_meeting',
            content: 'Test note content',
            pinned: false,
            visibilityLevel: 'participants',
            createdAt: new Date(),
          }),
          getCount: jest.fn().mockResolvedValue(0),
        };

        (mockQueryBuilder as any).andWhere = jest.fn().mockReturnValue(mockQueryBuilder);
        (mockQueryBuilder as any).getCount = mockEm.getCount;

        jest
          .spyOn(dataSource, 'transaction')
          .mockImplementation(async (cb) => cb(mockEm));

        const mockNoteRepo = {
          findOne: jest.fn().mockResolvedValue({
            id: 'note-1',
            meetingId,
            authorId: currentUserId,
            noteType: 'in_meeting',
            content: 'Test note content',
            pinned: false,
            visibilityLevel: 'participants',
            createdAt: new Date(),
            author: { id: currentUserId, fullName: 'Test User' },
          }),
        };
        jest.spyOn(dataSource, 'getRepository').mockReturnValue(mockNoteRepo);

        const result = await service.createMeetingNote(meetingId, baseNoteDto, {
          userId: currentUserId,
        });

        expect(result).toBeDefined();
        expect(result.noteType).toBe('in_meeting');
        expect(result.visibilityLevel).toBe('participants');
        expect(result.author.id).toBe(currentUserId);
      });

      it('should create host_note with default private visibility (AC-003)', async () => {
        const mockQueryBuilder = {
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({
            id: meetingId,
            status: 'in_progress',
            deletedAt: null,
          }),
        };
        const mockEm = {
          createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
          create: jest.fn().mockReturnValue({ id: 'note-1' }),
          save: jest.fn().mockResolvedValue({
            id: 'note-1',
            meetingId,
            authorId: currentUserId,
            noteType: 'host_note',
            content: 'Host note',
            pinned: false,
            visibilityLevel: 'private',
            createdAt: new Date(),
          }),
          getCount: jest.fn().mockResolvedValue(1),
        };

        (mockQueryBuilder as any).andWhere = jest.fn().mockReturnValue(mockQueryBuilder);
        (mockQueryBuilder as any).getCount = mockEm.getCount;

        jest
          .spyOn(dataSource, 'transaction')
          .mockImplementation(async (cb) => cb(mockEm));

        const mockNoteRepo = {
          findOne: jest.fn().mockResolvedValue({
            id: 'note-1',
            meetingId,
            authorId: currentUserId,
            noteType: 'host_note',
            content: 'Host note',
            pinned: false,
            visibilityLevel: 'private',
            createdAt: new Date(),
            author: { id: currentUserId, fullName: 'Host' },
          }),
        };
        jest.spyOn(dataSource, 'getRepository').mockReturnValue(mockNoteRepo);

        const result = await service.createMeetingNote(
          meetingId,
          { noteType: 'host_note', content: 'Host note' },
          { userId: currentUserId },
        );
        expect(result.visibilityLevel).toBe('private');
      });

      it('should throw NOTE_HOST_ONLY when non-host sends host_note (AC-007)', async () => {
        const mockQueryBuilder = {
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({
            id: meetingId,
            status: 'in_progress',
            deletedAt: null,
          }),
        };
        const mockEm = {
          createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
          getCount: jest.fn().mockResolvedValue(0),
        };

        (mockQueryBuilder as any).andWhere = jest.fn().mockReturnValue(mockQueryBuilder);
        (mockQueryBuilder as any).getCount = mockEm.getCount;

        jest
          .spyOn(dataSource, 'transaction')
          .mockImplementation(async (cb) => cb(mockEm));

        await expect(
          service.createMeetingNote(
            meetingId,
            { noteType: 'host_note', content: 'Test' },
            { userId: 'non-host' },
          ),
        ).rejects.toThrow(ForbiddenException);
      });

      it('should throw MEETING_NOT_IN_PROGRESS when meeting is completed (AC-009)', async () => {
        const mockQueryBuilder = {
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({
            id: meetingId,
            status: 'completed',
            deletedAt: null,
          }),
        };
        const mockEm = {
          createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        };

        (mockQueryBuilder as any).andWhere = jest.fn().mockReturnValue(mockQueryBuilder);
        (mockQueryBuilder as any).getCount = mockEm.getCount;

        jest
          .spyOn(dataSource, 'transaction')
          .mockImplementation(async (cb) => cb(mockEm));

        await expect(
          service.createMeetingNote(meetingId, baseNoteDto, {
            userId: currentUserId,
          }),
        ).rejects.toThrow(ConflictException);
      });
    });
  });
});
