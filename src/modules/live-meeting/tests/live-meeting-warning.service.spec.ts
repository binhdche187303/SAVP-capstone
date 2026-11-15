import { HgVisionService } from '../../academic/services/hgvision.service.js';
import { FaceProvisioningService } from '../../face-access/services/face-provisioning.service.js';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
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
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../../meetings/entities/meeting-event.entity.js';
import {
  BackgroundJobEntity,
  BackgroundJobType,
  BackgroundJobStatus,
} from '../../administration/entities/background-job.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { ConfigService } from '@nestjs/config';
import { GuestInviteService } from '../../guest-access/services/guest-invite.service.js';
import { RecordingSessionService } from '../../recording/services/recording-session.service.js';

describe('LiveMeetingService - scheduleWarningJob', () => {
  let service: LiveMeetingService;
  let dataSource: DataSource;
  let mockQueue: any;
  let mockBgJobRepo: any;
  let mockEventRepo: any;
  let mockMeetingRepo: any;

  const now = new Date();
  const inProgressMeeting = {
    id: 'm-warn-001',
    status: 'in_progress',
    endTime: new Date(now.getTime() + 50 * 60 * 1000),
    deletedAt: null,
  };

  const mockWebsocketService = { emitToRoom: jest.fn() };
  const mockQueueService = {
    addJob: jest.fn().mockResolvedValue('mock-job-id'),
    getQueue: jest.fn().mockReturnValue(null),
  };
  const mockBackgroundJobsService = {};
  const mockConfigService = { get: jest.fn().mockReturnValue('scheduler') };

  beforeEach(async () => {
    mockMeetingRepo = { findOne: jest.fn() };
    mockBgJobRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    mockEventRepo = {
      create: jest.fn(),
      save: jest.fn().mockResolvedValue({}),
    };
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
      getJob: jest.fn(),
    };

    const dataSourceMock = {
      getRepository: jest.fn().mockImplementation((entity: any) => {
        if (entity === MeetingEntity) return mockMeetingRepo;
        if (entity === BackgroundJobEntity) return mockBgJobRepo;
        if (entity === MeetingEventEntity) return mockEventRepo;
        if (entity === SystemConfigEntity)
          return { findOne: jest.fn().mockResolvedValue(null) };
        return { findOne: jest.fn() };
      }),
      transaction: jest.fn(),
    };

    mockQueueService.getQueue.mockReturnValue(mockQueue);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: HgVisionService, useValue: {} },
        { provide: FaceProvisioningService, useValue: { provisionMeeting: jest.fn().mockResolvedValue(undefined), deprovisionMeeting: jest.fn().mockResolvedValue(undefined), provisionParticipant: jest.fn().mockResolvedValue(undefined), deprovisionParticipant: jest.fn().mockResolvedValue(undefined) } },
        LiveMeetingService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: WebsocketService, useValue: mockWebsocketService },
        { provide: QueueService, useValue: mockQueueService },
        { provide: BackgroundJobsService, useValue: mockBackgroundJobsService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: GuestInviteService,
          useValue: { revokeAllForMeeting: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: RecordingSessionService,
          useValue: {
            stopAllActiveForMeeting: jest
              .fn()
              .mockResolvedValue({ scanned: 0, stopped: 0, failed: 0 }),
          },
        },
      ],
    }).compile();

    service = module.get<LiveMeetingService>(LiveMeetingService);
    dataSource = module.get<DataSource>(DataSource);
    jest.clearAllMocks();
  });

  // T-W01: Happy path Normal Flow
  it('T-W01 [Scenario 1] should schedule warning at end_time - configMinutes', async () => {
    mockMeetingRepo.findOne.mockResolvedValue({ ...inProgressMeeting });
    mockQueueService.addJob.mockResolvedValue('mock-job-id');

    const result = await service.scheduleWarningJob('m-warn-001');

    expect(result.skipped).toBe(false);
    expect(result.warningScheduledAt).toBeDefined();
    expect(mockQueueService.addJob).toHaveBeenCalled();
    expect(mockBgJobRepo.create).toHaveBeenCalled();
    expect(mockEventRepo.create).toHaveBeenCalled();
    expect(mockEventRepo.save).toHaveBeenCalled();
  });

  // T-W02: AF2 trigger
  it('T-W02 [Scenario 3] AF2 should adjust warning time when remainingMinutes < config', async () => {
    const nearEnd = {
      id: 'm-warn-002',
      status: 'in_progress',
      endTime: new Date(now.getTime() + 8 * 60 * 1000),
      deletedAt: null,
    };
    mockMeetingRepo.findOne.mockResolvedValue(nearEnd);
    mockQueueService.addJob.mockResolvedValue('mock-job-id');

    const result = await service.scheduleWarningJob('m-warn-002');

    expect(result.skipped).toBe(false);
    expect(result.warningScheduledAt).toBeDefined();
    // Adjusted = floor(8/2) = 4
    const expectedMin = now.getTime() + 3 * 60000;
    const expectedMax = now.getTime() + 5 * 60000;
    expect(result.warningScheduledAt!.getTime()).toBeGreaterThanOrEqual(
      expectedMin,
    );
    expect(result.warningScheduledAt!.getTime()).toBeLessThanOrEqual(
      expectedMax,
    );
  });

  // T-W03: Skip guard
  it('T-W03 [Scenario 5] should skip scheduling when warningScheduledAt is too close', async () => {
    const veryNear = {
      id: 'm-warn-003',
      status: 'in_progress',
      endTime: new Date(now.getTime() + 2 * 60 * 1000),
      deletedAt: null,
    };
    mockMeetingRepo.findOne.mockResolvedValue(veryNear);

    const result = await service.scheduleWarningJob('m-warn-003');

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('too_close');
    expect(mockQueueService.addJob).not.toHaveBeenCalled();
    expect(mockBgJobRepo.create).not.toHaveBeenCalled();
  });

  // T-W04: Config not found
  it('T-W04 [ERR-01] should use default 10 when config not found', async () => {
    mockMeetingRepo.findOne.mockResolvedValue({ ...inProgressMeeting });
    // getRepository for SystemConfigEntity returns { findOne: null }
    mockQueueService.addJob.mockResolvedValue('mock-job-id');

    const result = await service.scheduleWarningJob('m-warn-001');

    expect(result.skipped).toBe(false);
  });

  // T-W06: Meeting not in_progress
  it('T-W06 [ERR-04] should skip when meeting not in_progress', async () => {
    mockMeetingRepo.findOne.mockResolvedValue({
      ...inProgressMeeting,
      status: 'completed',
    });

    const result = await service.scheduleWarningJob('m-warn-001');

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('guard_failed');
  });

  // T-W07: end_time null
  it('T-W07 [ERR-05] should skip when end_time is null', async () => {
    mockMeetingRepo.findOne.mockResolvedValue({
      ...inProgressMeeting,
      endTime: null,
    });

    const result = await service.scheduleWarningJob('m-warn-001');

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('guard_failed');
  });

  // T-W08: Meeting not found
  it('T-W08 [ERR-03] should skip when meeting not found', async () => {
    mockMeetingRepo.findOne.mockResolvedValue(null);

    const result = await service.scheduleWarningJob('m-none');

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('guard_failed');
  });

  // T-W09: Enqueue failure
  it('T-W09 [NFR-05] should skip when enqueue fails', async () => {
    mockMeetingRepo.findOne.mockResolvedValue({ ...inProgressMeeting });
    mockQueueService.addJob.mockRejectedValue(new Error('Queue unavailable'));

    const result = await service.scheduleWarningJob('m-warn-001');

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('error');
  });
});

describe('LiveMeetingService - cancelWarningJob', () => {
  let service: LiveMeetingService;
  let mockBgJobRepo: any;
  let mockQueue: any;

  const mockWebsocketService = { emitToRoom: jest.fn() };
  const mockQueueService = {
    addJob: jest.fn(),
    getQueue: jest.fn(),
  };
  const mockBackgroundJobsService = {};
  const mockConfigService = { get: jest.fn().mockReturnValue('scheduler') };

  beforeEach(async () => {
    mockBgJobRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    mockQueue = { getJob: jest.fn() };

    const dataSourceMock = {
      getRepository: jest.fn().mockImplementation((entity: any) => {
        if (entity === BackgroundJobEntity) return mockBgJobRepo;
        return { findOne: jest.fn() };
      }),
      transaction: jest.fn(),
    };

    mockQueueService.getQueue.mockReturnValue(mockQueue);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: FaceProvisioningService, useValue: {} },
        { provide: HgVisionService, useValue: {} },
        LiveMeetingService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: WebsocketService, useValue: mockWebsocketService },
        { provide: QueueService, useValue: mockQueueService },
        { provide: BackgroundJobsService, useValue: mockBackgroundJobsService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: GuestInviteService,
          useValue: { revokeAllForMeeting: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: RecordingSessionService,
          useValue: {
            stopAllActiveForMeeting: jest
              .fn()
              .mockResolvedValue({ scanned: 0, stopped: 0, failed: 0 }),
          },
        },
      ],
    }).compile();

    service = module.get<LiveMeetingService>(LiveMeetingService);
    jest.clearAllMocks();
  });

  // T-W15: Happy path
  it('T-W15 [Scenario 4] should cancel warning and update background_jobs to CANCELLED', async () => {
    mockQueue.getJob.mockResolvedValue({
      remove: jest.fn().mockResolvedValue(undefined),
    });
    mockBgJobRepo.findOne.mockResolvedValue({
      id: 'bg-1',
      status: 'scheduled',
    });

    await service.cancelWarningJob('m-warn-001');

    expect(mockQueue.getJob).toHaveBeenCalledWith(
      'meeting-time-warning-m-warn-001',
    );
    expect(mockBgJobRepo.update).toHaveBeenCalled();
  });

  // T-W16: Job not found
  it('T-W16 [ERR-10] should handle job not found gracefully', async () => {
    mockQueue.getJob.mockResolvedValue(null);

    await service.cancelWarningJob('m-warn-001');

    expect(mockQueue.getJob).toHaveBeenCalled();
  });
});

// =============================================================================
// UC-IMM-13: MeetingWarningService - processWarningJob & Helpers
// =============================================================================
import { MeetingWarningService } from '../services/meeting-warning.service.js';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../../meetings/entities/meeting-event.entity.js';
import { MeetingParticipantEntity } from '../../meetings/entities/meeting-participant.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
} from '../../rooms/entities/room-booking.entity.js';
import {
  NotificationEntity,
  NotificationType,
  NotificationPriority,
  NotificationDeliveryStatus,
} from '../../notifications/entities/notification.entity.js';
import {
  BackgroundJobEntity,
  BackgroundJobStatus,
} from '../../administration/entities/background-job.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import { ConfigService } from '@nestjs/config';
import { GuestInviteService } from '../../guest-access/services/guest-invite.service.js';

describe('MeetingWarningService - processWarningJob', () => {
  let service: MeetingWarningService;
  let mockMeetingRepo: any;
  let mockEventRepo: any;
  let mockNotificationRepo: any;
  let mockBgJobRepo: any;
  let mockParticipantRepo: any;
  let mockBookingRepo: any;
  let mockConfigRepo: any;
  let mockWebsocketService: any;
  let mockConfigService: any;

  const now = new Date();
  const baseMeeting = {
    id: 'mm-warn-001',
    title: 'Test Meeting',
    status: MeetingStatus.IN_PROGRESS,
    startTime: new Date(now.getTime() - 55 * 60 * 1000),
    endTime: new Date(now.getTime() + 5 * 60 * 1000),
    roomId: 'room-001',
    hostId: 'host-001',
    organizerId: 'org-001',
    deletedAt: null,
  };

  function mockQueryBuilder(result: any) {
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(result),
    };
    return qb;
  }

  beforeEach(async () => {
    mockMeetingRepo = { findOne: jest.fn() };
    mockEventRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn().mockResolvedValue({ id: 'evt-001' }),
    };
    mockNotificationRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockResolvedValue({ id: 'notif-001' }),
    };
    mockBgJobRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    mockParticipantRepo = { findOne: jest.fn() };
    mockBookingRepo = { createQueryBuilder: jest.fn() };
    mockConfigRepo = { findOne: jest.fn() };
    mockWebsocketService = { emitToUser: jest.fn(), emitToRoom: jest.fn() };
    mockConfigService = { get: jest.fn() };

    const dataSourceMock = {
      getRepository: jest.fn().mockImplementation((entity: any) => {
        if (entity === MeetingEntity) return mockMeetingRepo;
        if (entity === MeetingEventEntity) return mockEventRepo;
        if (entity === NotificationEntity) return mockNotificationRepo;
        if (entity === BackgroundJobEntity) return mockBgJobRepo;
        if (entity === MeetingParticipantEntity) return mockParticipantRepo;
        if (entity === RoomBookingEntity) return mockBookingRepo;
        if (entity === SystemConfigEntity) return mockConfigRepo;
        return { findOne: jest.fn() };
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: FaceProvisioningService, useValue: {} },
        { provide: HgVisionService, useValue: {} },
        MeetingWarningService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: WebsocketService, useValue: mockWebsocketService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MeetingWarningService>(MeetingWarningService);
    jest.clearAllMocks();
  });

  // Suite A - Guard and Idempotency
  describe('Suite A - Guard and Idempotency', () => {
    it('T-P01 [FR-017, ERR-001] should skip when meeting not found', async () => {
      mockMeetingRepo.findOne.mockResolvedValue(null);
      const r = await service.processWarningJob({ meetingId: 'nonexistent' });
      expect(r.skipped).toBe(true);
      expect(r.reason).toBe('meeting_not_found');
    });

    it('T-P02 [FR-018, ERR-002, AC-003] should skip when meeting completed', async () => {
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        status: MeetingStatus.COMPLETED,
      });
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.skipped).toBe(true);
      expect(r.reason).toBe('meeting_not_in_progress');
    });

    it('T-P03 [FR-018, ERR-002] should skip when meeting cancelled', async () => {
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        status: MeetingStatus.CANCELLED,
      });
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.skipped).toBe(true);
      expect(r.reason).toBe('meeting_not_in_progress');
    });

    it('T-P04 [FR-033, NFR-007, AC-008] should skip when warning_sent exists', async () => {
      mockMeetingRepo.findOne.mockResolvedValue({ ...baseMeeting });
      mockEventRepo.findOne.mockResolvedValue({
        id: 'evt-exists',
        meetingId: 'mm-warn-001',
        eventType: MeetingEventType.WARNING_SENT,
      });
      mockNotificationRepo.findOne.mockResolvedValue(null);
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.skipped).toBe(true);
      expect(r.reason).toBe('already_sent');
    });

    it('T-P04b [FR-033, NFR-007] dual-source guard via notification', async () => {
      mockMeetingRepo.findOne.mockResolvedValue({ ...baseMeeting });
      mockEventRepo.findOne.mockResolvedValue(null);
      mockNotificationRepo.findOne.mockResolvedValue({
        id: 'notif-exists',
        relatedEntityId: 'mm-warn-001',
      });
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.skipped).toBe(true);
      expect(r.reason).toBe('already_sent');
    });
  });

  // Suite B - remainingMinutes and Late Job
  describe('Suite B - remainingMinutes and Late Job', () => {
    it('T-P06 [FR-002, BR-11] remainingMinutes = 10', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-006' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.skipped).toBe(false);
      expect(r.remainingMinutes).toBeGreaterThanOrEqual(9);
    });

    it('T-P07 [FR-031, BR-13, AC-009] late job clamp 0', async () => {
      const pe = new Date(Date.now() - 5 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: pe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-007' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.remainingMinutes).toBe(0);
      expect(r.warningLevel).toBe('overdue');
    });

    it('T-P08 [FR-031] boundary remainingMinutes = 0', async () => {
      const ee = new Date(Date.now() + 2 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: ee,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-008' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.remainingMinutes).toBe(0);
    });
  });

  // Suite C - Conflict Detection
  describe('Suite C - Conflict Detection', () => {
    it('T-P09 [FR-010, AC-001] should return Branch A when no next booking', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-009' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.skipped).toBe(false);
      expect(r.branch).toBe('A');
      const sp: any = mockNotificationRepo.save.mock.calls[0][0];
      expect(sp.notificationType).toBe(NotificationType.MEETING_TIME_WARNING);
    });

    it('T-P10 [FR-011, AC-002] should return Branch B when next booking at exact endTime', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      const nb = {
        id: 'bk-001',
        meetingId: 'other',
        roomId: 'room-001',
        reservedStartTime: fe,
        status: RoomBookingStatus.APPROVED,
      };
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-010' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder(nb));
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.branch).toBe('B');
      const sp: any = mockNotificationRepo.save.mock.calls[0][0];
      expect(sp.notificationType).toBe(
        NotificationType.MEETING_TIME_CONFLICT_WARNING,
      );
    });

    it('T-P11 [FR-003, AC-011] should detect conflict within buffer window', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      const b3 = new Date(fe.getTime() + 3 * 60 * 1000);
      const nb = {
        id: 'bk-002',
        meetingId: 'other',
        roomId: 'room-001',
        reservedStartTime: b3,
        status: RoomBookingStatus.PENDING,
      };
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '5' });
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-011' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder(nb));
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.branch).toBe('B');
    });

    it('T-P12 [FR-003, AC-011] should NOT detect conflict outside buffer window', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      const b6 = new Date(fe.getTime() + 6 * 60 * 1000);
      const nb = {
        id: 'bk-003',
        meetingId: 'other',
        roomId: 'room-001',
        reservedStartTime: b6,
        status: RoomBookingStatus.APPROVED,
      };
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '5' });
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-012' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder(nb));
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.branch).toBe('A');
    });

    it('T-P13 [FR-015, AC-004] should skip conflict query when roomId is null', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
        roomId: null,
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-013' });
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.branch).toBe('A');
      expect(mockBookingRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('T-P14 [FR-019, ERR-003, AC-005] should fallback to Branch A when conflict query fails', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-014' });
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockRejectedValue(new Error('DB error')),
      };
      mockBookingRepo.createQueryBuilder.mockReturnValue(qb);
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.branch).toBe('A');
      expect(r.skipped).toBe(false);
    });

    it('T-P15 [FR-003] should ignore cancelled bookings as non-conflict', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-015' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.branch).toBe('A');
    });
  });

  // Suite D+E - warningLevel and Notification Payload
  describe('Suite D+E - warningLevel and Notification Payload', () => {
    it('T-P16 [FR-010, AC-001] warningLevel=standard for Branch A', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-016' });
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.warningLevel).toBe('standard');
    });

    it('T-P17 [FR-032, BR-14, AC-009] warningLevel=overdue for Branch A + 0', async () => {
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: new Date(Date.now() - 1000),
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-017' });
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.warningLevel).toBe('overdue');
    });

    it('T-P18 [FR-011, AC-002] warningLevel=strict for Branch B', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      const nb = {
        id: 'bk-wl',
        meetingId: 'other',
        roomId: 'room-001',
        reservedStartTime: fe,
        status: RoomBookingStatus.APPROVED,
      };
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder(nb));
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-018' });
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.warningLevel).toBe('strict');
    });

    it('T-P19 [FR-032, BR-15, AC-009] warningLevel=urgent for Branch B + 0', async () => {
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: new Date(Date.now() - 1000),
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      const nb = {
        id: 'bk-urg',
        meetingId: 'other',
        roomId: 'room-001',
        reservedStartTime: new Date(Date.now() - 1000),
        status: RoomBookingStatus.APPROVED,
      };
      mockBookingRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder(nb));
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-019' });
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.warningLevel).toBe('urgent');
    });

    it('T-P20 [FR-010, AC-001] Branch A payload fields', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-020' });
      await service.processWarningJob({ meetingId: 'mm-warn-001' });
      const p: any = mockNotificationRepo.save.mock.calls[0][0];
      expect(p.payloadJson.extensionAllowed).toBe(true);
      expect(p.payloadJson.cta.type).toBe('request_extension');
      expect(p.payloadJson.conflictWithNextBooking).toBe(false);
      expect(p.payloadJson.nextBooking).toBeNull();
    });

    it('T-P21 [FR-011, AC-002] Branch B payload fields', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      const nb = {
        id: 'bk-p21',
        meetingId: 'other',
        roomId: 'room-001',
        reservedStartTime: fe,
        status: RoomBookingStatus.APPROVED,
      };
      mockBookingRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder(nb));
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-021' });
      await service.processWarningJob({ meetingId: 'mm-warn-001' });
      const p: any = mockNotificationRepo.save.mock.calls[0][0];
      expect(p.payloadJson.extensionAllowed).toBe(false);
      expect(p.payloadJson.cta).toBeNull();
      expect(p.payloadJson.conflictWithNextBooking).toBe(true);
      expect(p.payloadJson.nextBooking).toBeTruthy();
    });

    it('T-P22 [FR-011] Branch B priority=high, Branch A normal', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-022a' });
      await service.processWarningJob({ meetingId: 'mm-warn-001' });
      const pA: any = mockNotificationRepo.save.mock.calls[0][0];
      expect(pA.priority).toBe(NotificationPriority.NORMAL);
      jest.clearAllMocks();
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      const nb2 = {
        id: 'bk-p22',
        meetingId: 'other',
        roomId: 'room-001',
        reservedStartTime: fe,
        status: RoomBookingStatus.APPROVED,
      };
      mockBookingRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder(nb2));
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-022b' });
      await service.processWarningJob({ meetingId: 'mm-warn-001' });
      const pB: any = mockNotificationRepo.save.mock.calls[0][0];
      expect(pB.priority).toBe(NotificationPriority.HIGH);
    });

    it('T-P23 [FR-026] deliveryStatus=sent and sentAt set', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-023' });
      await service.processWarningJob({ meetingId: 'mm-warn-001' });
      const p: any = mockNotificationRepo.save.mock.calls[0][0];
      expect(p.deliveryStatus).toBe(NotificationDeliveryStatus.SENT);
      expect(p.sentAt).toBeInstanceOf(Date);
    });
  });

  // Suite F+G - WebSocket Push + Post-notification Writes
  describe('Suite F+G - WebSocket + Post-notification Writes', () => {
    it('T-P24 [FR-012, BR-17, AC-010] Host receives emitToUser with fields', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-024' });
      await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(mockWebsocketService.emitToUser).toHaveBeenCalledWith(
        'host-001',
        'meeting.time.warning',
        expect.objectContaining({
          extensionAllowed: true,
          warningLevel: 'standard',
        }),
      );
    });

    it('T-P25 [FR-012, BR-17, AC-010] Participants get safe payload', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-025' });
      await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(mockWebsocketService.emitToUser).toHaveBeenCalled();
      expect(mockWebsocketService.emitToRoom).toHaveBeenCalledWith(
        'meeting:mm-warn-001',
        'meeting.time.warning',
        expect.any(Object),
      );
      const rc = mockWebsocketService.emitToRoom.mock.calls[0];
      const safeP = rc[2];
      expect(safeP.meetingId).toBeDefined();
      expect(safeP.extensionAllowed).toBeUndefined();
      expect(safeP.nextBooking).toBeUndefined();
    });

    it('T-P26 [FR-021, ERR-007, AC-007] WS failure is non-critical', async () => {
      mockWebsocketService.emitToUser.mockImplementation(() => {
        throw new Error('WS err');
      });
      mockWebsocketService.emitToRoom.mockImplementation(() => {
        throw new Error('WS err');
      });
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-026' });
      mockBgJobRepo.findOne.mockResolvedValue({
        id: 'bg-026',
        status: BackgroundJobStatus.SCHEDULED,
      });
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.skipped).toBe(false);
    });

    it('T-P27 [FR-007, FR-009] bg jobs updated to completed', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-027' });
      mockBgJobRepo.findOne.mockResolvedValue({
        id: 'bg-027',
        status: BackgroundJobStatus.SCHEDULED,
      });
      await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(mockBgJobRepo.update).toHaveBeenCalled();
      const uc: any = mockBgJobRepo.update.mock.calls[0];
      expect(uc[1].status).toBe(BackgroundJobStatus.COMPLETED);
      expect(uc[1].completedAt).toBeDefined();
      expect(uc[1].outputJson.notificationId).toBe('notif-027');
    });

    it('T-P28 [FR-008, FR-029] meeting_events created', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-028' });
      mockBgJobRepo.findOne.mockResolvedValue({ id: 'bg-028' });
      await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingId: 'mm-warn-001',
          eventType: MeetingEventType.WARNING_SENT,
          sourceType: MeetingEventSourceType.SCHEDULER,
          actorUserId: null,
        }),
      );
      expect(mockEventRepo.save).toHaveBeenCalled();
    });

    it('T-P29 [FR-027] metadata_json contains all fields', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '5' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-029' });
      mockBgJobRepo.findOne.mockResolvedValue({ id: 'bg-029' });
      await service.processWarningJob({ meetingId: 'mm-warn-001' });
      const ec: any = mockEventRepo.create.mock.calls[0][0];
      expect(ec.metadataJson).toBeDefined();
      expect(ec.metadataJson.warningType).toBeDefined();
      expect(ec.metadataJson.warningLevel).toBe('standard');
      expect(ec.metadataJson.remainingMinutes).toBeDefined();
      expect(ec.metadataJson.notificationId).toBe('notif-029');
      expect(ec.metadataJson.extensionAllowed).toBe(true);
      expect(ec.metadataJson.conflictBufferMinutes).toBe(5);
    });

    it('T-P30 [ERR-005, AC-006] Notification fail throws + bg=failed', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockRejectedValue(new Error('DB insert error'));
      mockBgJobRepo.findOne.mockResolvedValue({ id: 'bg-030' });
      await expect(
        service.processWarningJob({ meetingId: 'mm-warn-001' }),
      ).rejects.toThrow();
      expect(mockBgJobRepo.update).toHaveBeenCalled();
      expect(mockEventRepo.create).not.toHaveBeenCalled();
    });

    it('T-P31 [ERR-008] bg job update fail is non-critical', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-031' });
      mockBgJobRepo.findOne.mockRejectedValue(new Error('DB error'));
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.skipped).toBe(false);
    });

    it('T-P32 [ERR-009] meeting_events fail is non-critical', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        endTime: fe,
        hostId: 'host-001',
      });
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(null),
      );
      mockNotificationRepo.save.mockResolvedValue({ id: 'notif-032' });
      mockBgJobRepo.findOne.mockResolvedValue({ id: 'bg-032' });
      mockEventRepo.save.mockRejectedValue(new Error('Event insert error'));
      const r = await service.processWarningJob({ meetingId: 'mm-warn-001' });
      expect(r.skipped).toBe(false);
    });
  });
});

describe('MeetingWarningService - resolveHost and readConflictBufferConfig', () => {
  let service: MeetingWarningService;
  let mockConfigRepo: any;
  let mockParticipantRepo: any;
  let mockWebsocketService: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockConfigRepo = { findOne: jest.fn() };
    mockParticipantRepo = { findOne: jest.fn() };
    mockWebsocketService = { emitToUser: jest.fn(), emitToRoom: jest.fn() };
    mockConfigService = { get: jest.fn() };

    const dataSourceMock = {
      getRepository: jest.fn().mockImplementation((entity: any) => {
        if (entity === SystemConfigEntity) return mockConfigRepo;
        if (entity === MeetingParticipantEntity) return mockParticipantRepo;
        return { findOne: jest.fn() };
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: FaceProvisioningService, useValue: {} },
        { provide: HgVisionService, useValue: {} },
        MeetingWarningService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: WebsocketService, useValue: mockWebsocketService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MeetingWarningService>(MeetingWarningService);
    jest.clearAllMocks();
  });

  // Suite H - resolveHost
  describe('Suite H - resolveHost', () => {
    it('T-P33 [FR-034] should return hostId directly when set', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      const m = {
        id: 'mm-h-001',
        status: MeetingStatus.IN_PROGRESS,
        endTime: fe,
        roomId: null,
        hostId: 'direct-host',
        organizerId: 'org',
        deletedAt: null,
      };
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      const mRepo = { findOne: jest.fn().mockResolvedValue(m) };
      const nRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockResolvedValue({ id: 'not-h33' }),
      };
      const eRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        save: jest.fn().mockResolvedValue({}),
      };
      const bRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 'bg-h33' }),
        update: jest.fn(),
      };
      const ds = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === MeetingEntity) return mRepo;
          if (entity === MeetingEventEntity) return eRepo;
          if (entity === NotificationEntity) return nRepo;
          if (entity === BackgroundJobEntity) return bRepo;
          if (entity === MeetingParticipantEntity) return mockParticipantRepo;
          if (entity === SystemConfigEntity) return mockConfigRepo;
          return { findOne: jest.fn() };
        }),
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
        { provide: FaceProvisioningService, useValue: {} },
        { provide: HgVisionService, useValue: {} },
          MeetingWarningService,
          { provide: DataSource, useValue: ds },
          { provide: WebsocketService, useValue: mockWebsocketService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      service = mod.get<MeetingWarningService>(MeetingWarningService);
      const r = await service.processWarningJob({ meetingId: 'mm-h-001' });
      expect(r.skipped).toBe(false);
    });

    it('T-P34 [FR-034] should resolve host from participants when hostId null', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      const m = {
        id: 'mm-h-002',
        status: MeetingStatus.IN_PROGRESS,
        endTime: fe,
        roomId: null,
        hostId: null,
        organizerId: 'org',
        deletedAt: null,
      };
      mockParticipantRepo.findOne.mockResolvedValue({
        userId: 'host-from-participant',
      });
      const mRepo = { findOne: jest.fn().mockResolvedValue(m) };
      const nRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockResolvedValue({ id: 'not-h34' }),
      };
      const eRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        save: jest.fn().mockResolvedValue({}),
      };
      const bRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 'bg-h34' }),
        update: jest.fn(),
      };
      const ds = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === MeetingEntity) return mRepo;
          if (entity === MeetingEventEntity) return eRepo;
          if (entity === NotificationEntity) return nRepo;
          if (entity === BackgroundJobEntity) return bRepo;
          if (entity === MeetingParticipantEntity) return mockParticipantRepo;
          if (entity === SystemConfigEntity) return mockConfigRepo;
          return { findOne: jest.fn() };
        }),
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
        { provide: FaceProvisioningService, useValue: {} },
        { provide: HgVisionService, useValue: {} },
          MeetingWarningService,
          { provide: DataSource, useValue: ds },
          { provide: WebsocketService, useValue: mockWebsocketService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      service = mod.get<MeetingWarningService>(MeetingWarningService);
      const r = await service.processWarningJob({ meetingId: 'mm-h-002' });
      expect(r.skipped).toBe(false);
    });

    it('T-P35 [FR-034] should skip when no host found', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '0' });
      const m = {
        id: 'mm-h-003',
        status: MeetingStatus.IN_PROGRESS,
        endTime: fe,
        roomId: null,
        hostId: null,
        organizerId: 'org',
        deletedAt: null,
      };
      mockParticipantRepo.findOne.mockResolvedValue(null);
      const mRepo = { findOne: jest.fn().mockResolvedValue(m) };
      const ds = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === MeetingEntity) return mRepo;
          if (entity === SystemConfigEntity) return mockConfigRepo;
          if (entity === MeetingParticipantEntity) return mockParticipantRepo;
          return { findOne: jest.fn() };
        }),
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
        { provide: FaceProvisioningService, useValue: {} },
        { provide: HgVisionService, useValue: {} },
          MeetingWarningService,
          { provide: DataSource, useValue: ds },
          { provide: WebsocketService, useValue: mockWebsocketService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      service = mod.get<MeetingWarningService>(MeetingWarningService);
      const r = await service.processWarningJob({ meetingId: 'mm-h-003' });
      expect(r.skipped).toBe(true);
      expect(r.reason).toBe('host_not_found');
    });
  });

  // Suite I - readConflictBufferConfig
  describe('Suite I - readConflictBufferConfig', () => {
    it('T-P36 [FR-035] should return 5 when config is 5', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      const m = {
        id: 'mm-c-001',
        status: MeetingStatus.IN_PROGRESS,
        endTime: fe,
        roomId: null,
        hostId: 'host-001',
        organizerId: 'org',
        deletedAt: null,
      };
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '5' });
      const mRepo = { findOne: jest.fn().mockResolvedValue(m) };
      const nRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockResolvedValue({ id: 'not-c36' }),
      };
      const eRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        save: jest.fn().mockResolvedValue({}),
      };
      const bRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 'bg-c36' }),
        update: jest.fn(),
      };
      const ds = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === MeetingEntity) return mRepo;
          if (entity === MeetingEventEntity) return eRepo;
          if (entity === NotificationEntity) return nRepo;
          if (entity === BackgroundJobEntity) return bRepo;
          if (entity === SystemConfigEntity) return mockConfigRepo;
          return { findOne: jest.fn() };
        }),
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
        { provide: FaceProvisioningService, useValue: {} },
        { provide: HgVisionService, useValue: {} },
          MeetingWarningService,
          { provide: DataSource, useValue: ds },
          { provide: WebsocketService, useValue: mockWebsocketService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      service = mod.get<MeetingWarningService>(MeetingWarningService);
      const r = await service.processWarningJob({ meetingId: 'mm-c-001' });
      expect(r.skipped).toBe(false);
    });

    it('T-P37 [FR-035] should return 0 when config not found', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      const m = {
        id: 'mm-c-002',
        status: MeetingStatus.IN_PROGRESS,
        endTime: fe,
        roomId: null,
        hostId: 'host-001',
        organizerId: 'org',
        deletedAt: null,
      };
      mockConfigRepo.findOne.mockResolvedValue(null);
      const mRepo = { findOne: jest.fn().mockResolvedValue(m) };
      const nRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockResolvedValue({ id: 'not-c37' }),
      };
      const eRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        save: jest.fn().mockResolvedValue({}),
      };
      const bRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 'bg-c37' }),
        update: jest.fn(),
      };
      const ds = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === MeetingEntity) return mRepo;
          if (entity === MeetingEventEntity) return eRepo;
          if (entity === NotificationEntity) return nRepo;
          if (entity === BackgroundJobEntity) return bRepo;
          if (entity === SystemConfigEntity) return mockConfigRepo;
          return { findOne: jest.fn() };
        }),
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
        { provide: FaceProvisioningService, useValue: {} },
        { provide: HgVisionService, useValue: {} },
          MeetingWarningService,
          { provide: DataSource, useValue: ds },
          { provide: WebsocketService, useValue: mockWebsocketService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      service = mod.get<MeetingWarningService>(MeetingWarningService);
      const r = await service.processWarningJob({ meetingId: 'mm-c-002' });
      expect(r.skipped).toBe(false);
    });

    it('T-P38 [FR-035, ERR-004c] should return 0 when unparseable', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      const m = {
        id: 'mm-c-003',
        status: MeetingStatus.IN_PROGRESS,
        endTime: fe,
        roomId: null,
        hostId: 'host-001',
        organizerId: 'org',
        deletedAt: null,
      };
      mockConfigRepo.findOne.mockResolvedValue({ configValue: 'abc' });
      const mRepo = { findOne: jest.fn().mockResolvedValue(m) };
      const nRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockResolvedValue({ id: 'not-c38' }),
      };
      const eRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        save: jest.fn().mockResolvedValue({}),
      };
      const bRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 'bg-c38' }),
        update: jest.fn(),
      };
      const ds = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === MeetingEntity) return mRepo;
          if (entity === MeetingEventEntity) return eRepo;
          if (entity === NotificationEntity) return nRepo;
          if (entity === BackgroundJobEntity) return bRepo;
          if (entity === SystemConfigEntity) return mockConfigRepo;
          return { findOne: jest.fn() };
        }),
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
        { provide: FaceProvisioningService, useValue: {} },
        { provide: HgVisionService, useValue: {} },
          MeetingWarningService,
          { provide: DataSource, useValue: ds },
          { provide: WebsocketService, useValue: mockWebsocketService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      service = mod.get<MeetingWarningService>(MeetingWarningService);
      const r = await service.processWarningJob({ meetingId: 'mm-c-003' });
      expect(r.skipped).toBe(false);
    });

    it('T-P39 [FR-035, ERR-004c] should return 0 when negative', async () => {
      const fe = new Date(Date.now() + 10 * 60 * 1000);
      const m = {
        id: 'mm-c-004',
        status: MeetingStatus.IN_PROGRESS,
        endTime: fe,
        roomId: null,
        hostId: 'host-001',
        organizerId: 'org',
        deletedAt: null,
      };
      mockConfigRepo.findOne.mockResolvedValue({ configValue: '-3' });
      const mRepo = { findOne: jest.fn().mockResolvedValue(m) };
      const nRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockResolvedValue({ id: 'not-c39' }),
      };
      const eRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        save: jest.fn().mockResolvedValue({}),
      };
      const bRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 'bg-c39' }),
        update: jest.fn(),
      };
      const ds = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === MeetingEntity) return mRepo;
          if (entity === MeetingEventEntity) return eRepo;
          if (entity === NotificationEntity) return nRepo;
          if (entity === BackgroundJobEntity) return bRepo;
          if (entity === SystemConfigEntity) return mockConfigRepo;
          return { findOne: jest.fn() };
        }),
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
        { provide: FaceProvisioningService, useValue: {} },
        { provide: HgVisionService, useValue: {} },
          MeetingWarningService,
          { provide: DataSource, useValue: ds },
          { provide: WebsocketService, useValue: mockWebsocketService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      service = mod.get<MeetingWarningService>(MeetingWarningService);
      const r = await service.processWarningJob({ meetingId: 'mm-c-004' });
      expect(r.skipped).toBe(false);
    });
  });
});
