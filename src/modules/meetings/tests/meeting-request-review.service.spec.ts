/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { MeetingRequestReviewService } from '../services/meeting-request-review.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { MeetingEntity, MeetingStatus } from '../entities/meeting.entity.js';
import {
  MeetingRequestEntity,
  MeetingRequestType,
  ApprovalStatus,
  ConflictCheckStatus,
} from '../entities/meeting-request.entity.js';
import { MeetingParticipantEntity } from '../entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../entities/meeting-external-participant.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../entities/meeting-event.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
} from '../../rooms/entities/room-booking.entity.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import { ApproveMeetingRequestDto } from '../dto/approve-meeting-request.dto.js';
import { RejectMeetingRequestDto } from '../dto/reject-meeting-request.dto.js';
import { GuestInviteService } from '../../guest-access/services/guest-invite.service.js';
import { GuestEmailService } from '../../guest-access/services/guest-email.service.js';
import { MeetingsService } from '../services/meetings.service.js';

describe('MeetingRequestReviewService', () => {
  let service: MeetingRequestReviewService;
  let dataSource: jest.Mocked<DataSource>;
  let notificationsService: jest.Mocked<NotificationsService>;
  let guestInviteService: jest.Mocked<GuestInviteService>;
  let guestEmailService: jest.Mocked<GuestEmailService>;
  let meetingsService: jest.Mocked<MeetingsService>;
  let em: jest.Mocked<EntityManager>;

  const authUser = { userId: 'approver-uuid' };
  const creatorUser = { userId: 'creator-uuid' };
  const clientContext = { ipAddress: '127.0.0.1', userAgent: 'test' };

  const mockRequest = (
    overrides: Partial<MeetingRequestEntity> = {},
  ): MeetingRequestEntity =>
    ({
      id: 'request-uuid',
      requestCode: 'MT-20260715-001',
      meetingId: 'meeting-uuid',
      requestType: MeetingRequestType.CREATE_MEETING,
      requestedBy: creatorUser.userId,
      requestedAt: new Date('2026-07-15T09:00:00Z'),
      targetRoomId: 'room-uuid',
      requestedStartTime: new Date('2026-07-15T10:00:00Z'),
      requestedEndTime: new Date('2026-07-15T11:00:00Z'),
      approvalMode: 'manual' as any,
      approvalStatus: ApprovalStatus.PENDING,
      conflictCheckStatus: ConflictCheckStatus.CLEAR,
      conflictCheckedAt: null,
      conflictSummaryJson: null,
      decisionBy: null,
      decisionAt: null,
      rejectionReason: null,
      requestPayloadJson: {},
      ruleSnapshotJson: null,
      appliedAt: null,
      notes: null,
      ...overrides,
    }) as MeetingRequestEntity;

  const mockMeeting = (overrides: Partial<MeetingEntity> = {}): MeetingEntity =>
    ({
      id: 'meeting-uuid',
      meetingCode: 'MT-20260715-001',
      title: 'Test Meeting',
      organizerId: creatorUser.userId,
      hostId: creatorUser.userId,
      roomId: 'room-uuid',
      startTime: new Date('2026-07-15T10:00:00Z'),
      endTime: new Date('2026-07-15T11:00:00Z'),
      status: MeetingStatus.PENDING_APPROVAL,
      cancellationReason: null,
      updatedBy: null,
      updatedAt: new Date('2026-07-15T09:00:00Z'),
      ...overrides,
    }) as MeetingEntity;

  const mockBooking = (
    overrides: Partial<RoomBookingEntity> = {},
  ): RoomBookingEntity =>
    ({
      id: 'booking-uuid',
      bookingCode: 'BK-20260715-001',
      meetingId: 'meeting-uuid',
      roomId: 'room-uuid',
      bookingType: 'scheduled' as any,
      reservedStartTime: new Date('2026-07-15T10:00:00Z'),
      reservedEndTime: new Date('2026-07-15T11:00:00Z'),
      status: RoomBookingStatus.PENDING,
      approvedBy: null,
      approvedAt: null,
      cancellationReason: null,
      bookedBy: creatorUser.userId,
      ...overrides,
    }) as RoomBookingEntity;

  beforeEach(async () => {
    em = {
      query: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(<T>(_: any, plain: T): T => plain),
      save: jest.fn(async (_entity: any, data: any) => {
        if (data && typeof data === 'object') {
          if (!data.id) data.id = 'saved-uuid';
          return data;
        }
        return _entity;
      }),
      getRepository: jest
        .fn()
        .mockReturnValue({ find: jest.fn().mockResolvedValue([]) }),
    } as unknown as jest.Mocked<EntityManager>;

    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (manager: EntityManager) => unknown) =>
          cb(em),
        ),
      manager: em,
      // GLA-001: sendGuestInviteEmails() goi getRepository(UserEntity).findOne()
      // de lay ten host cho email moi khach — can findOne() ngoai find().
      getRepository: jest.fn().mockReturnValue({
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
      }),
    } as unknown as jest.Mocked<DataSource>;

    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-id' }),
      enqueueEmailNotification: jest.fn().mockResolvedValue({
        notification: { id: 'notif-id' },
        jobId: 'bull-job-id',
      }),
    } as unknown as jest.Mocked<NotificationsService>;

    // GLA-001: MeetingRequestReviewService.approve() sinh + gui link moi
    // khach ngoai cong ty. Mock 2 service moi de KHONG cham DB/SMTP thuc su
    // trong regression test cua feature co san nay.
    guestInviteService = {
      issueInvite: jest.fn().mockResolvedValue({
        externalParticipantId: 'ep-uuid',
        email: 'external@test.com',
        secret: 'mock-secret',
        link: 'https://app.local/guest/join/ep-uuid.mock-secret',
        guestInvite: {
          tokenHash: 'hash',
          issuedAt: new Date().toISOString(),
          issuedBy: authUser.userId,
          expiresAt: new Date().toISOString(),
          status: 'active',
          invalidAfter: null,
          firstJoinedAt: null,
          lastJoinedAt: null,
        },
      }),
      resolveInvite: jest.fn(),
      markJoined: jest.fn(),
      markRevoked: jest.fn(),
    } as unknown as jest.Mocked<GuestInviteService>;

    guestEmailService = {
      sendInviteLink: jest.fn().mockResolvedValue(undefined),
      sendOtp: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<GuestEmailService>;

    // Nhóm E (2026-08-08): MeetingRequestReviewService giờ inject MeetingsService
    // để lấy suggestedAlternatives lúc reject() — chỉ cần mock getAvailableRooms.
    meetingsService = {
      getAvailableRooms: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<MeetingsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingRequestReviewService,
        { provide: DataSource, useValue: dataSource },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: GuestInviteService, useValue: guestInviteService },
        { provide: GuestEmailService, useValue: guestEmailService },
        { provide: MeetingsService, useValue: meetingsService },
      ],
    }).compile();

    service = module.get<MeetingRequestReviewService>(
      MeetingRequestReviewService,
    );
  });

  describe('approve', () => {
    const approveDto: ApproveMeetingRequestDto = {};

    // F-R4a: deadline duyệt = targetStartTime (mặc định 10:00 trong mockRequest).
    // Đóng băng "now" TRƯỚC deadline cho các test hiện có (chưa hết hạn).
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-07-15T09:30:00Z'));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    function setupSuccessMocks() {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(mockBooking());

      const conflictFind = jest.fn().mockResolvedValue([]);
      em.find = conflictFind as any;
    }

    it('[AC-001] should approve successfully with all state transitions', async () => {
      setupSuccessMocks();

      const result = await service.approve(
        'request-uuid',
        approveDto,
        authUser,
        clientContext,
      );

      expect(result.requestId).toBe('request-uuid');
      expect(result.approvalStatus).toBe(ApprovalStatus.APPROVED);
      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.bookingId).toBe('booking-uuid');
      expect(result.appliedAt).toBeDefined();

      expect(em.save).toHaveBeenCalledWith(
        MeetingRequestEntity,
        expect.objectContaining({
          approvalStatus: ApprovalStatus.APPROVED,
          decisionBy: authUser.userId,
        }),
      );
      expect(em.save).toHaveBeenCalledWith(
        MeetingEntity,
        expect.objectContaining({
          status: MeetingStatus.SCHEDULED,
        }),
      );
      expect(em.save).toHaveBeenCalledWith(
        RoomBookingEntity,
        expect.objectContaining({
          status: RoomBookingStatus.APPROVED,
        }),
      );
    });

    it('[AC-001] should create meeting event with type meeting_request_approved', async () => {
      setupSuccessMocks();

      await service.approve(
        'request-uuid',
        approveDto,
        authUser,
        clientContext,
      );

      expect(em.create).toHaveBeenCalledWith(
        MeetingEventEntity,
        expect.objectContaining({
          eventType: MeetingEventType.MEETING_REQUEST_APPROVED,
        }),
      );
      expect(em.save).toHaveBeenCalledWith(
        MeetingEventEntity,
        expect.any(Object),
      );
    });

    it('[AC-011] should call NotificationsService for MEETING_INVITE and MEETING_REQUEST_APPROVED', async () => {
      setupSuccessMocks();
      em.find = jest
        .fn()
        .mockResolvedValueOnce([
          { userId: 'participant-1' } as MeetingParticipantEntity,
          { userId: 'participant-2' } as MeetingParticipantEntity,
        ])
        .mockResolvedValueOnce([
          { email: 'external@test.com' } as MeetingExternalParticipantEntity,
        ]);

      await service.approve(
        'request-uuid',
        approveDto,
        authUser,
        clientContext,
      );

      // createNotification called for internal participants + requester/host
      expect(notificationsService.createNotification).toHaveBeenCalled();
      const createCalls = (
        notificationsService.createNotification as jest.Mock
      ).mock.calls.map(([arg]) => arg.notificationType);

      // Participans get MEETING_INVITE, requester gets MEETING_REQUEST_APPROVED
      expect(
        createCalls.filter((t: string) => t === NotificationType.MEETING_INVITE)
          .length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        createCalls.filter(
          (t: string) => t === NotificationType.MEETING_REQUEST_APPROVED,
        ).length,
      ).toBeGreaterThanOrEqual(1);

      // enqueueEmailNotification called for external participants
      expect(
        notificationsService.enqueueEmailNotification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_INVITE,
          toEmails: ['external@test.com'],
        }),
      );
    });

    it('[AC-011b] should NOT email internal participants on approve (in-app only, to reduce email load)', async () => {
      setupSuccessMocks();
      em.find = jest
        .fn()
        .mockResolvedValueOnce([
          { userId: 'participant-1' } as MeetingParticipantEntity,
          { userId: 'participant-2' } as MeetingParticipantEntity,
        ])
        .mockResolvedValueOnce([]);

      await service.approve(
        'request-uuid',
        approveDto,
        authUser,
        clientContext,
      );

      expect(
        notificationsService.enqueueEmailNotification,
      ).not.toHaveBeenCalled();
    });

    describe('GLA-001: guest invite issuance on approve()', () => {
      it('should issue a guest invite and send the invite email for CREATE_MEETING with an emailed external participant', async () => {
        setupSuccessMocks();
        em.find = jest
          .fn()
          .mockResolvedValueOnce([]) // internal participants
          .mockResolvedValueOnce([
            {
              id: 'ep-1',
              email: 'external@test.com',
            } as MeetingExternalParticipantEntity,
          ]);

        await service.approve(
          'request-uuid',
          approveDto,
          authUser,
          clientContext,
        );

        expect(guestInviteService.issueInvite).toHaveBeenCalledWith(
          em,
          expect.objectContaining({
            externalParticipantId: 'ep-1',
            email: 'external@test.com',
          }),
        );
        expect(guestEmailService.sendInviteLink).toHaveBeenCalledWith(
          expect.objectContaining({ to: 'external@test.com' }),
        );
      });

      it('should skip external participants without an email (no invite issued, no throw)', async () => {
        setupSuccessMocks();
        em.find = jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 'ep-1', email: null }]);

        await expect(
          service.approve('request-uuid', approveDto, authUser, clientContext),
        ).resolves.toBeDefined();

        expect(guestInviteService.issueInvite).not.toHaveBeenCalled();
        expect(guestEmailService.sendInviteLink).not.toHaveBeenCalled();
      });

      it('should NOT issue guest invites for UPDATE_TIME requests, even with emailed external participants', async () => {
        em.findOne
          .mockResolvedValueOnce(
            mockRequest({
              requestType: MeetingRequestType.UPDATE_TIME,
              requestedStartTime: new Date('2026-07-15T14:00:00Z'),
              requestedEndTime: new Date('2026-07-15T15:00:00Z'),
            }),
          )
          .mockResolvedValueOnce(
            mockMeeting({ status: MeetingStatus.PENDING_APPROVAL }),
          )
          .mockResolvedValueOnce(
            mockBooking({ status: RoomBookingStatus.APPROVED }),
          );
        em.find = jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: 'ep-1',
              email: 'external@test.com',
            } as MeetingExternalParticipantEntity,
          ]);

        await service.approve(
          'request-uuid',
          approveDto,
          authUser,
          clientContext,
        );

        expect(guestInviteService.issueInvite).not.toHaveBeenCalled();
        expect(guestEmailService.sendInviteLink).not.toHaveBeenCalled();
      });

      it('should NOT fail approve() when sending the guest invite email throws (best-effort)', async () => {
        setupSuccessMocks();
        em.find = jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: 'ep-1',
              email: 'external@test.com',
            } as MeetingExternalParticipantEntity,
          ]);
        guestEmailService.sendInviteLink.mockRejectedValueOnce(
          new Error('SMTP down'),
        );

        await expect(
          service.approve('request-uuid', approveDto, authUser, clientContext),
        ).resolves.toBeDefined();
      });
    });

    it('[AC-013] should create audit log with action_type approve', async () => {
      setupSuccessMocks();

      await service.approve(
        'request-uuid',
        approveDto,
        authUser,
        clientContext,
      );

      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          actionType: 'approve',
          entityType: 'meeting_request',
          entityId: 'request-uuid',
          userId: authUser.userId,
        }),
      );
    });

    it('[AC-003] should throw 404 when request not found', async () => {
      em.findOne.mockResolvedValueOnce(null);

      await expect(
        service.approve(
          'nonexistent-uuid',
          approveDto,
          authUser,
          clientContext,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('[AC-005] should throw 409 when request already approved', async () => {
      em.findOne.mockResolvedValueOnce(
        mockRequest({ approvalStatus: ApprovalStatus.APPROVED }),
      );

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('[AC-009b] should throw 403 when self-approval (requested_by matches)', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest({ requestedBy: authUser.userId }))
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(mockBooking());

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ForbiddenException);
    });

    it('[AC-009b] should throw 403 when self-approval (organizer matches)', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting({ organizerId: authUser.userId }))
        .mockResolvedValueOnce(mockBooking());

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw 422 when request_type is not create_meeting', async () => {
      em.findOne.mockResolvedValueOnce(
        mockRequest({ requestType: MeetingRequestType.CANCEL_MEETING }),
      );

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should handle notification failures gracefully (approve still succeeds)', async () => {
      setupSuccessMocks();
      em.find = jest
        .fn()
        .mockResolvedValueOnce([
          { userId: 'participant-1' } as MeetingParticipantEntity,
        ])
        .mockResolvedValueOnce([]);

      notificationsService.createNotification.mockRejectedValue(
        new Error('Notify service down'),
      );

      const result = await service.approve(
        'request-uuid',
        approveDto,
        authUser,
        clientContext,
      );

      // Approve still succeeds despite notification failure
      expect(result.requestId).toBe('request-uuid');
      expect(result.approvalStatus).toBe(ApprovalStatus.APPROVED);
    });

    it('should throw 409 when meeting status is not pending_approval', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting({ status: MeetingStatus.SCHEDULED }))
        .mockResolvedValueOnce(mockBooking());

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('[2026-08-16] should throw 409 MEETING_ROOM_REMOVED when room was deleted and request has no targetRoomId', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest({ targetRoomId: null }))
        .mockResolvedValueOnce(mockMeeting({ roomId: null }));

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
      // Booking lookup (em.findOne 3rd call) must never happen — guard fires first
      expect(em.findOne).toHaveBeenCalledTimes(2);
    });

    it('[2026-08-16] should allow approve when room was deleted BUT the UPDATE_ROOM request already picked a new targetRoomId', async () => {
      em.findOne
        .mockResolvedValueOnce(
          mockRequest({
            requestType: MeetingRequestType.UPDATE_ROOM,
            targetRoomId: 'new-room-uuid',
          }),
        )
        .mockResolvedValueOnce(mockMeeting({ roomId: null }))
        .mockResolvedValueOnce(
          mockBooking({ status: RoomBookingStatus.APPROVED }),
        );
      em.find = jest.fn().mockResolvedValue([]);

      const result = await service.approve(
        'request-uuid',
        approveDto,
        authUser,
        clientContext,
      );
      expect(result.requestId).toBe('request-uuid');
    });

    it('should throw 409 when booking status is not pending', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(
          mockBooking({ status: RoomBookingStatus.APPROVED }),
        );

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw 404 when meeting not found', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(null);

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 404 when booking not found', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(null);

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('[AC-007] should throw 409 when room conflict detected', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(mockBooking());

      em.getRepository = jest.fn().mockReturnValue({
        find: jest
          .fn()
          .mockResolvedValue([
            { id: 'conflicting-booking' } as RoomBookingEntity,
          ]),
      });

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('F-R4a: should throw 409 REQUEST_EXPIRED when now > targetStartTime (CREATE_MEETING)', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(mockBooking());
      jest.setSystemTime(new Date('2026-07-15T10:00:01Z')); // sau targetStartTime 10:00

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('F-R4a: should throw 409 REQUEST_EXPIRED when now > NEW requested time (UPDATE_TIME)', async () => {
      em.findOne
        .mockResolvedValueOnce(
          mockRequest({
            requestType: MeetingRequestType.UPDATE_TIME,
            requestedStartTime: new Date('2026-07-15T14:00:00Z'), // giờ MỚI xin đổi
            requestedEndTime: new Date('2026-07-15T15:00:00Z'),
          }),
        )
        .mockResolvedValueOnce(
          mockMeeting({ status: MeetingStatus.PENDING_APPROVAL }),
        )
        .mockResolvedValueOnce(
          mockBooking({ status: RoomBookingStatus.APPROVED }),
        );
      jest.setSystemTime(new Date('2026-07-15T14:00:01Z')); // sau giờ mới xin đổi

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('[AC-015] should rollback transaction on DB failure', async () => {
      setupSuccessMocks();

      dataSource.transaction.mockImplementation(async (_cb: any) => {
        throw new Error('DB Error');
      });

      await expect(
        service.approve('request-uuid', approveDto, authUser, clientContext),
      ).rejects.toThrow('DB Error');
    });
  });

  describe('reject', () => {
    const rejectDto: RejectMeetingRequestDto = {
      rejectionReason: 'Kế hoạch thay đổi',
    };

    function setupSuccessMocks() {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(mockBooking());
    }

    it('[AC-002] should reject successfully with all state transitions', async () => {
      setupSuccessMocks();

      const result = await service.reject(
        'request-uuid',
        rejectDto,
        authUser,
        clientContext,
      );

      expect(result.requestId).toBe('request-uuid');
      expect(result.approvalStatus).toBe(ApprovalStatus.REJECTED);
      expect(result.decisionAt).toBeDefined();

      expect(em.save).toHaveBeenCalledWith(
        MeetingRequestEntity,
        expect.objectContaining({
          approvalStatus: ApprovalStatus.REJECTED,
          rejectionReason: 'Kế hoạch thay đổi',
        }),
      );
      expect(em.save).toHaveBeenCalledWith(
        MeetingEntity,
        expect.objectContaining({
          status: MeetingStatus.CANCELLED,
          cancellationReason: 'Kế hoạch thay đổi',
        }),
      );
      expect(em.save).toHaveBeenCalledWith(
        RoomBookingEntity,
        expect.objectContaining({
          status: RoomBookingStatus.CANCELLED,
          cancellationReason: 'Kế hoạch thay đổi',
        }),
      );
    });

    it('[AC-002] should create meeting event with type meeting_request_rejected', async () => {
      setupSuccessMocks();

      await service.reject('request-uuid', rejectDto, authUser, clientContext);

      expect(em.create).toHaveBeenCalledWith(
        MeetingEventEntity,
        expect.objectContaining({
          eventType: MeetingEventType.MEETING_REQUEST_REJECTED,
        }),
      );
    });

    it('[AC-012] should NOT call enqueueEmailNotification for reject (in-app only)', async () => {
      setupSuccessMocks();

      await service.reject('request-uuid', rejectDto, authUser, clientContext);

      // Rejection uses createNotification (IN_APP), not enqueueEmailNotification
      expect(
        notificationsService.enqueueEmailNotification,
      ).not.toHaveBeenCalled();
    });

    it('[AC-012] should call createNotification with MEETING_REQUEST_REJECTED for creator', async () => {
      setupSuccessMocks();

      await service.reject('request-uuid', rejectDto, authUser, clientContext);

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_REQUEST_REJECTED,
          channel: NotificationChannel.IN_APP,
          recipientUserIds: expect.arrayContaining([creatorUser.userId]),
        }),
      );
    });

    it('[AC-012] should notify only the host, not the requester, when they differ', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest({ requestedBy: 'requester-uuid' }))
        .mockResolvedValueOnce(mockMeeting({ hostId: 'host-uuid' }))
        .mockResolvedValueOnce(mockBooking());

      await service.reject('request-uuid', rejectDto, authUser, clientContext);

      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: NotificationType.MEETING_REQUEST_REJECTED,
          channel: NotificationChannel.IN_APP,
          recipientUserIds: ['host-uuid'],
        }),
      );
    });

    it('[AC-014] should create audit log with action_type reject', async () => {
      setupSuccessMocks();

      await service.reject('request-uuid', rejectDto, authUser, clientContext);

      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          actionType: 'reject',
          entityType: 'meeting_request',
          entityId: 'request-uuid',
        }),
      );
    });

    it('[AC-004] should throw 404 when request not found', async () => {
      em.findOne.mockResolvedValueOnce(null);

      await expect(
        service.reject('nonexistent-uuid', rejectDto, authUser, clientContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('[AC-006] should throw 409 when request already approved', async () => {
      em.findOne.mockResolvedValueOnce(
        mockRequest({ approvalStatus: ApprovalStatus.APPROVED }),
      );

      await expect(
        service.reject('request-uuid', rejectDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('[AC-009b] should throw 403 when self-approval', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest({ requestedBy: authUser.userId }))
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(mockBooking());

      await expect(
        service.reject('request-uuid', rejectDto, authUser, clientContext),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw 422 when request_type is not create_meeting', async () => {
      em.findOne.mockResolvedValueOnce(
        mockRequest({ requestType: MeetingRequestType.CANCEL_MEETING }),
      );

      await expect(
        service.reject('request-uuid', rejectDto, authUser, clientContext),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw 404 when meeting not found', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(null);

      await expect(
        service.reject('request-uuid', rejectDto, authUser, clientContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 404 when booking not found', async () => {
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(mockMeeting())
        .mockResolvedValueOnce(null);

      await expect(
        service.reject('request-uuid', rejectDto, authUser, clientContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle notification failure gracefully (reject still succeeds)', async () => {
      setupSuccessMocks();

      notificationsService.createNotification.mockRejectedValue(
        new Error('Notify service down'),
      );

      const result = await service.reject(
        'request-uuid',
        rejectDto,
        authUser,
        clientContext,
      );

      expect(result.requestId).toBe('request-uuid');
      expect(result.approvalStatus).toBe(ApprovalStatus.REJECTED);
    });

    it('should NOT save NotificationEntity inside transaction', async () => {
      setupSuccessMocks();

      await service.reject('request-uuid', rejectDto, authUser, clientContext);

      // No NotificationEntity save inside transaction
      const saveCalls = (em.save as jest.Mock).mock.calls;
      const notifSaves = saveCalls.filter(
        ([entity]) => entity === 'NotificationEntity',
      );
      expect(notifSaves).toHaveLength(0);
    });
  });

  describe('expireOverdueBatch (F-R4b)', () => {
    it('CREATE_MEETING PENDING quá deadline → meeting CANCELLED, booking CANCELLED, request EXPIRED', async () => {
      dataSource.getRepository = jest.fn().mockReturnValue({
        find: jest.fn().mockResolvedValue([mockRequest()]),
      });
      em.findOne
        .mockResolvedValueOnce(mockRequest())
        .mockResolvedValueOnce(
          mockMeeting({ status: MeetingStatus.PENDING_APPROVAL }),
        )
        .mockResolvedValueOnce(
          mockBooking({ status: RoomBookingStatus.PENDING }),
        );

      const result = await service.expireOverdueBatch();

      expect(result).toEqual({ scanned: 1, expired: 1, failed: 0 });
      expect(em.save).toHaveBeenCalledWith(
        MeetingRequestEntity,
        expect.objectContaining({ approvalStatus: ApprovalStatus.EXPIRED }),
      );
      expect(em.save).toHaveBeenCalledWith(
        MeetingEntity,
        expect.objectContaining({ status: MeetingStatus.CANCELLED }),
      );
      expect(em.save).toHaveBeenCalledWith(
        RoomBookingEntity,
        expect.objectContaining({ status: RoomBookingStatus.CANCELLED }),
      );
    });

    it('UPDATE_TIME PENDING quá giờ MỚI → request EXPIRED, meeting revert SCHEDULED, KHÔNG đụng start_time/room_id/booking', async () => {
      const oldStart = new Date('2026-07-15T10:00:00Z');
      dataSource.getRepository = jest.fn().mockReturnValue({
        find: jest
          .fn()
          .mockResolvedValue([
            mockRequest({ requestType: MeetingRequestType.UPDATE_TIME }),
          ]),
      });
      em.findOne
        .mockResolvedValueOnce(
          mockRequest({ requestType: MeetingRequestType.UPDATE_TIME }),
        )
        .mockResolvedValueOnce(
          mockMeeting({
            status: MeetingStatus.PENDING_APPROVAL,
            startTime: oldStart,
            roomId: 'room-uuid',
          }),
        );

      const result = await service.expireOverdueBatch();

      expect(result).toEqual({ scanned: 1, expired: 1, failed: 0 });
      expect(em.save).toHaveBeenCalledWith(
        MeetingEntity,
        expect.objectContaining({
          status: MeetingStatus.SCHEDULED,
          startTime: oldStart,
          roomId: 'room-uuid',
        }),
      );
      expect(em.save).not.toHaveBeenCalledWith(
        RoomBookingEntity,
        expect.anything(),
      );
    });

    it('candidate đã được duyệt/từ chối ở tick khác (không còn PENDING) → skip, expired=0', async () => {
      dataSource.getRepository = jest.fn().mockReturnValue({
        find: jest.fn().mockResolvedValue([mockRequest()]),
      });
      em.findOne.mockResolvedValueOnce(
        mockRequest({ approvalStatus: ApprovalStatus.APPROVED }),
      );

      const result = await service.expireOverdueBatch();

      expect(result).toEqual({ scanned: 1, expired: 0, failed: 0 });
      expect(em.save).not.toHaveBeenCalled();
    });

    it('1 candidate lỗi (transaction throw) KHÔNG chặn batch → failed=1', async () => {
      dataSource.getRepository = jest.fn().mockReturnValue({
        find: jest.fn().mockResolvedValue([mockRequest()]),
      });
      dataSource.transaction.mockImplementationOnce(async () => {
        throw new Error('boom');
      });

      const result = await service.expireOverdueBatch();

      expect(result).toEqual({ scanned: 1, expired: 0, failed: 1 });
    });
  });
});
