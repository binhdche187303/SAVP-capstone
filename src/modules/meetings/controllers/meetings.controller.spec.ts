import { MeetingSeriesService } from '../services/meeting-series.service.js';
import { MeetingPrepService } from '../services/meeting-prep.service.js';
import { MeetingUpdateService } from '../services/meeting-update.service.js';
import { MeetingListService } from '../services/meeting-list.service.js';
import { ParticipantImportService } from '../services/participant-import.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { MeetingsController } from './meetings.controller.js';
import { MeetingsService } from '../services/meetings.service.js';
import { MeetingRequestReviewService } from '../services/meeting-request-review.service.js';
import { CreateMeetingDto } from '../dto/create-meeting.dto.js';
import { UpdateMeetingRoomDto } from '../dto/update-meeting-room.dto.js';
import { AddInternalParticipantDto } from '../dto/add-internal-participant.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { CreateMeetingResponseDto } from '../dto/create-meeting-response.dto.js';
import { CancelMeetingResponseDto } from '../dto/cancel-meeting-response.dto.js';

describe('MeetingsController', () => {
  let controller: MeetingsController;
  let service: {
    create: jest.Mock;
    getAvailableRooms: jest.Mock;
    getAvailableRoomsForMeeting: jest.Mock;
    updateMeetingRoom: jest.Mock;
    cancelMeeting: jest.Mock;
    addInternalParticipant: jest.Mock;
  };
  let reviewService: { approve: jest.Mock; reject: jest.Mock };

  const mockMeetingResponse = new CreateMeetingResponseDto({
    id: 'meeting-uuid',
    meetingCode: 'MT-20260715-001',
    title: 'Họp dự án',
    status: 'pending_approval',
    approvalStatus: 'pending',
    startTime: new Date('2026-07-15T10:00:00Z'),
    endTime: new Date('2026-07-15T11:00:00Z'),
    roomId: 'room-uuid',
    roomName: 'Phòng A',
    organizerId: 'auth-user-uuid',
    hostId: 'auth-user-uuid',
    participantCount: 3,
    bookingStatus: 'pending',
    bookingCode: 'BK-20260715-001',
    createdAt: new Date(),
  });

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      getAvailableRooms: jest.fn(),
      getAvailableRoomsForMeeting: jest.fn(),
      updateMeetingRoom: jest.fn(),
      cancelMeeting: jest.fn(),
      addInternalParticipant: jest.fn(),
    };

    reviewService = {
      approve: jest.fn(),
      reject: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeetingsController],
      providers: [
        { provide: MeetingSeriesService, useValue: {} },
        { provide: MeetingPrepService, useValue: { applyCreateOptions: jest.fn().mockResolvedValue(undefined) } },
        { provide: MeetingUpdateService, useValue: {} },
        { provide: MeetingListService, useValue: {} },
        { provide: ParticipantImportService, useValue: {} },
        {
          provide: MeetingsService,
          useValue: Object.assign(service, { getPendingRoomConflictsMap: jest.fn().mockResolvedValue(new Map()), getFaultyEquipmentsMap: jest.fn().mockResolvedValue(new Map()) }),
        },
        {
          provide: MeetingRequestReviewService,
          useValue: reviewService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MeetingsController>(MeetingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createMeeting', () => {
    it('[T030] should call service.create and return 201 response', async () => {
      const dto: CreateMeetingDto = {
        title: 'Họp dự án',
        startTime: '2026-07-15T10:00:00.000Z',
        endTime: '2026-07-15T11:00:00.000Z',
        roomId: 'room-uuid',
        participantUserIds: ['user-p1', 'user-p2'],
      };

      service.create.mockResolvedValue(mockMeetingResponse);

      const request = {
        user: { userId: 'auth-user-uuid' },
      } as unknown as Request;

      const result = await controller.createMeeting(
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(service.create).toHaveBeenCalledWith(
        dto,
        { userId: 'auth-user-uuid' },
        { ipAddress: '127.0.0.1', userAgent: 'Mozilla/5.0' },
      );
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.id).toBe('meeting-uuid');
    });
  });

  describe('getAvailableRooms', () => {
    it('[T017c] should return available rooms list', async () => {
      const mockRooms = [
        {
          id: 'room-1',
          roomCode: 'R01',
          roomName: 'Phòng A',
          capacity: 10,
          roomType: 'meeting_room',
          siteName: null,
          areaName: null,
          locationDescription: null,
          hasCamera: false,
          hasMicrophone: false,
          hasDisplay: true,
          allowRecording: false,
        },
      ];

      service.getAvailableRooms.mockResolvedValue(mockRooms);

      const result = await controller.getAvailableRooms(
        '2026-07-15T10:00:00Z',
        '2026-07-15T11:00:00Z',
        undefined,
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(service.getAvailableRooms).toHaveBeenCalled();
    });
  });

  describe('getAvailableRoomsForMeeting', () => {
    it('[T015-1] should return 200 with available rooms list', async () => {
      const mockRooms = [
        {
          roomId: 'room-2',
          roomName: 'Phòng B',
          roomCode: 'R02',
          capacity: 20,
          location: null,
          equipmentFlags: [],
          availabilityStatus: 'available',
          isCurrentRoom: false,
          capacityWarning: null,
        },
      ];

      service.getAvailableRoomsForMeeting.mockResolvedValue(mockRooms);

      const result = await controller.getAvailableRoomsForMeeting(
        'meeting-uuid',
        undefined,
        undefined,
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].roomId).toBe('room-2');
      expect(service.getAvailableRoomsForMeeting).toHaveBeenCalledWith(
        'meeting-uuid',
        { capacityWarningMode: false, includeCurrentRoom: false },
      );
    });
  });

  describe('updateMeetingRoom', () => {
    it('[T015-3] should return 200 with update response', async () => {
      const dto: UpdateMeetingRoomDto = {
        newRoomId: 'new-room-uuid',
        confirmCapacityOverride: false,
      };

      const mockResponse = {
        meetingId: 'meeting-uuid',
        oldRoom: { id: 'old-room-uuid', name: 'Old Room' },
        newRoom: { id: 'new-room-uuid', name: 'New Room' },
        oldBookingId: 'booking-1',
        newBookingId: 'booking-2',
        startTime: '2026-07-01T10:00:00.000Z',
        endTime: '2026-07-01T11:00:00.000Z',
        notificationStatus: 'sent',
        updatedAt: '2026-06-11T10:00:00.000Z',
      };

      service.updateMeetingRoom.mockResolvedValue(mockResponse);

      const request = {
        user: { userId: 'auth-user-uuid' },
      } as unknown as Request;

      const result = await controller.updateMeetingRoom(
        'meeting-uuid',
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(result.success).toBe(true);
      expect(result.data.meetingId).toBe('meeting-uuid');
      expect(service.updateMeetingRoom).toHaveBeenCalledWith(
        'meeting-uuid',
        dto,
        { userId: 'auth-user-uuid' },
        { ipAddress: '127.0.0.1', userAgent: 'Mozilla/5.0' },
      );
    });
  });

  describe('cancelMeeting', () => {
    const mockCancelResponse = new CancelMeetingResponseDto({
      meetingId: 'meeting-uuid',
      status: 'cancelled',
      cancelledAt: new Date('2026-06-01T12:00:00Z'),
      cancelledBy: 'auth-user-uuid',
      roomReleased: true,
      releasedBookingId: 'booking-uuid',
      notificationStatus: 'queued',
    });

    it('[T008-1] should cancel meeting successfully and return 200', async () => {
      const dto = { cancellationReason: 'Phòng không phù hợp' };

      service.cancelMeeting.mockResolvedValue(mockCancelResponse);

      const request = {
        user: { userId: 'auth-user-uuid' },
      } as unknown as Request;

      const result = await controller.cancelMeeting(
        'meeting-uuid',
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(service.cancelMeeting).toHaveBeenCalledWith(
        'meeting-uuid',
        { userId: 'auth-user-uuid' },
        { ipAddress: '127.0.0.1', userAgent: 'Mozilla/5.0' },
        'Phòng không phù hợp',
      );
      expect(result.success).toBe(true);
      expect(result.data.meetingId).toBe('meeting-uuid');
      expect(result.data.status).toBe('cancelled');
    });

    it('[T008-2] should pass undefined reason when dto is empty', async () => {
      service.cancelMeeting.mockResolvedValue(mockCancelResponse);

      const request = {
        user: { userId: 'auth-user-uuid' },
      } as unknown as Request;

      const result = await controller.cancelMeeting(
        'meeting-uuid',
        {},
        request,
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(service.cancelMeeting).toHaveBeenCalledWith(
        'meeting-uuid',
        { userId: 'auth-user-uuid' },
        { ipAddress: '127.0.0.1', userAgent: 'Mozilla/5.0' },
        undefined,
      );
      expect(result.success).toBe(true);
    });

    it('[T008-3] should return 404 when service throws NotFoundException', async () => {
      service.cancelMeeting.mockRejectedValue(
        new (require('@nestjs/common').NotFoundException)({
          success: false,
          message: 'Cuộc họp không tồn tại',
          error: { code: 'MEETING_NOT_FOUND' },
        }),
      );

      const request = {
        user: { userId: 'auth-user-uuid' },
      } as unknown as Request;

      await expect(
        controller.cancelMeeting(
          'nonexistent-uuid',
          {},
          request,
          '127.0.0.1',
          'Mozilla/5.0',
        ),
      ).rejects.toThrow();
    });

    it('[T008-4] should return 403 when service throws ForbiddenException', async () => {
      service.cancelMeeting.mockRejectedValue(
        new (require('@nestjs/common').ForbiddenException)({
          success: false,
          message: 'Bạn không có quyền hủy cuộc họp này',
          error: { code: 'FORBIDDEN' },
        }),
      );

      const request = {
        user: { userId: 'participant-uuid' },
      } as unknown as Request;

      await expect(
        controller.cancelMeeting(
          'meeting-uuid',
          {},
          request,
          '127.0.0.1',
          'Mozilla/5.0',
        ),
      ).rejects.toThrow();
    });

    it('[T008-5] should return 409 when service throws ConflictException', async () => {
      service.cancelMeeting.mockRejectedValue(
        new (require('@nestjs/common').ConflictException)({
          success: false,
          message: 'Trạng thái cuộc họp không hợp lệ',
          error: { code: 'INVALID_MEETING_STATUS' },
        }),
      );

      const request = {
        user: { userId: 'auth-user-uuid' },
      } as unknown as Request;

      await expect(
        controller.cancelMeeting(
          'meeting-uuid',
          {},
          request,
          '127.0.0.1',
          'Mozilla/5.0',
        ),
      ).rejects.toThrow();
    });
  });

  describe('addInternalParticipant', () => {
    const mockResponse = {
      participantId: 'saved-participant-id',
      meetingId: 'meeting-uuid',
      userId: 'invited-user-uuid',
      role: 'attendee',
      status: 'pending',
    };

    it('should return 200 with success response', async () => {
      const dto: AddInternalParticipantDto = {
        userId: 'invited-user-uuid',
      };

      service.addInternalParticipant.mockResolvedValue(mockResponse);

      const request = {
        user: { userId: 'auth-user-uuid' },
      } as unknown as Request;

      const result = await controller.addInternalParticipant(
        'meeting-uuid',
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(service.addInternalParticipant).toHaveBeenCalledWith(
        'meeting-uuid',
        dto,
        { userId: 'auth-user-uuid' },
        { ipAddress: '127.0.0.1', userAgent: 'Mozilla/5.0' },
      );
      expect(result.success).toBe(true);
      expect(result.data.participantId).toBe('saved-participant-id');
      expect(result.data.userId).toBe('invited-user-uuid');
    });

    it('should return 422 when service throws UnprocessableEntityException', async () => {
      const dto: AddInternalParticipantDto = {
        userId: 'invited-user-uuid',
      };

      service.addInternalParticipant.mockRejectedValue(
        new (require('@nestjs/common').UnprocessableEntityException)({
          success: false,
          message: 'Phát hiện xung đột lịch hoặc cảnh báo sức chứa',
          error: { code: 'WARNING_CONFIRMATION_REQUIRED' },
        }),
      );

      const request = {
        user: { userId: 'auth-user-uuid' },
      } as unknown as Request;

      await expect(
        controller.addInternalParticipant(
          'meeting-uuid',
          dto,
          request,
          '127.0.0.1',
          'Mozilla/5.0',
        ),
      ).rejects.toThrow();
    });

    it('should return 404 when service throws NotFoundException', async () => {
      const dto: AddInternalParticipantDto = {
        userId: 'nonexistent-user',
      };

      service.addInternalParticipant.mockRejectedValue(
        new (require('@nestjs/common').NotFoundException)({
          success: false,
          message: 'Không tìm thấy cuộc họp',
          error: { code: 'MEETING_NOT_FOUND' },
        }),
      );

      const request = {
        user: { userId: 'auth-user-uuid' },
      } as unknown as Request;

      await expect(
        controller.addInternalParticipant(
          'meeting-uuid',
          dto,
          request,
          '127.0.0.1',
          'Mozilla/5.0',
        ),
      ).rejects.toThrow();
    });

    it('should return 409 when service throws ConflictException', async () => {
      const dto: AddInternalParticipantDto = {
        userId: 'existing-user-uuid',
      };

      service.addInternalParticipant.mockRejectedValue(
        new (require('@nestjs/common').ConflictException)({
          success: false,
          message: 'Người dùng đã có trong danh sách tham gia cuộc họp',
          error: { code: 'PARTICIPANT_ALREADY_EXISTS' },
        }),
      );

      const request = {
        user: { userId: 'auth-user-uuid' },
      } as unknown as Request;

      await expect(
        controller.addInternalParticipant(
          'meeting-uuid',
          dto,
          request,
          '127.0.0.1',
          'Mozilla/5.0',
        ),
      ).rejects.toThrow();
    });
  });
  describe('getMySchedule', () => {
    beforeEach(() => {
      service.getMySchedule = jest.fn();
    });

    it('[T039] should return 200 with correct response structure', async () => {
      const mockResponse = {
        items: [],
        range: {
          view: 'week',
          from: '2026-06-08T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
          timezone: 'Asia/Ho_Chi_Minh',
        },
        empty: true,
      };
      service.getMySchedule.mockResolvedValue(mockResponse);

      const result = await controller.getMySchedule(
        { userId: 'auth-user-uuid' },
        {
          view: 'week',
          from: '2026-06-08T00:00:00+07:00',
          to: '2026-06-15T00:00:00+07:00',
        } as any,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.empty).toBe(true);
    });
  });

  describe('getMyScheduleDetail', () => {
    beforeEach(() => {
      service.getMyScheduleDetail = jest.fn();
    });

    it('[T041] should throw 403 for non-participant', async () => {
      const meetingId = '550e8400-e29b-41d4-a716-446655440000';
      const forbiddenError = new (require('@nestjs/common').ForbiddenException)(
        {
          success: false,
          message: 'Bạn không có quyền xem cuộc họp này',
          error: { code: 'FORBIDDEN_NOT_PARTICIPANT', details: { meetingId } },
        },
      );
      service.getMyScheduleDetail.mockRejectedValue(forbiddenError);

      await expect(
        controller.getMyScheduleDetail(
          { userId: 'other-user-uuid' },
          meetingId,
        ),
      ).rejects.toThrow(require('@nestjs/common').ForbiddenException);
    });

    it('[T042] should throw 404 for non-existent meeting', async () => {
      const meetingId = '550e8400-e29b-41d4-a716-446655440000';
      const notFoundError = new (require('@nestjs/common').NotFoundException)({
        success: false,
        message: 'Không tìm thấy cuộc họp',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
      service.getMyScheduleDetail.mockRejectedValue(notFoundError);

      await expect(
        controller.getMyScheduleDetail({ userId: 'auth-user-uuid' }, meetingId),
      ).rejects.toThrow(require('@nestjs/common').NotFoundException);
    });
  });
});

describe('[BE-06] MeetingsController route path prefix "meetings/"', () => {
  // Doc metadata truc tiep tren prototype, KHONG qua TestingModule.compile()
  // vi describe('MeetingsController') o tren dang loi DI san co (thieu
  // provider ParticipantImportService trong beforeEach) - khong lien quan
  // den BE-06. Tach thanh describe rieng de test nay khong bi anh huong.
  const PATH_METADATA = require('@nestjs/common/constants').PATH_METADATA;

  const getPath = (methodName: keyof MeetingsController) =>
    Reflect.getMetadata(
      PATH_METADATA,
      MeetingsController.prototype[methodName],
    );

  it('removeParticipant dang ky path co prefix meetings/', () => {
    expect(getPath('removeParticipant')).toBe(
      'meetings/:meetingId/participants/:participantUserId',
    );
  });

  it('getAgendas dang ky path co prefix meetings/', () => {
    expect(getPath('getAgendas')).toBe('meetings/:meetingId/agendas');
  });

  it('replaceAgendas dang ky path co prefix meetings/', () => {
    expect(getPath('replaceAgendas')).toBe('meetings/:meetingId/agendas');
  });

  it('updateAgendaItem dang ky path co prefix meetings/', () => {
    expect(getPath('updateAgendaItem')).toBe(
      'meetings/:meetingId/agendas/:agendaId',
    );
  });

  it('deleteAgendaItem dang ky path co prefix meetings/', () => {
    expect(getPath('deleteAgendaItem')).toBe(
      'meetings/:meetingId/agendas/:agendaId',
    );
  });

  it('khong con route nao dang ky path cu KHONG co prefix meetings/', () => {
    const legacyPaths = [
      getPath('removeParticipant'),
      getPath('getAgendas'),
      getPath('replaceAgendas'),
      getPath('updateAgendaItem'),
      getPath('deleteAgendaItem'),
    ];
    legacyPaths.forEach((p) => {
      expect(p.startsWith('meetings/')).toBe(true);
    });
  });
});
