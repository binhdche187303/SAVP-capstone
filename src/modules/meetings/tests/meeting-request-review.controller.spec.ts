import { MeetingSeriesService } from '../services/meeting-series.service.js';
import { MeetingPrepService } from '../services/meeting-prep.service.js';
import { MeetingUpdateService } from '../services/meeting-update.service.js';
import { MeetingListService } from '../services/meeting-list.service.js';
import { ParticipantImportService } from '../services/participant-import.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { MeetingsController } from '../controllers/meetings.controller.js';
import { MeetingsService } from '../services/meetings.service.js';
import { MeetingRequestReviewService } from '../services/meeting-request-review.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { ApproveMeetingRequestDto } from '../dto/approve-meeting-request.dto.js';
import { RejectMeetingRequestDto } from '../dto/reject-meeting-request.dto.js';
import { ApproveResponseDto } from '../dto/approve-response.dto.js';
import { RejectResponseDto } from '../dto/reject-response.dto.js';

describe('MeetingRequestReviewController', () => {
  let controller: MeetingsController;
  let reviewService: {
    approve: jest.Mock;
    reject: jest.Mock;
  };
  let meetingsService: { create: jest.Mock; getAvailableRooms: jest.Mock };

  const mockApproveResponse = new ApproveResponseDto({
    requestId: 'request-uuid',
    approvalStatus: 'approved',
    meetingId: 'meeting-uuid',
    bookingId: 'booking-uuid',
    appliedAt: new Date('2026-07-15T10:00:00Z'),
  });

  const mockRejectResponse = new RejectResponseDto({
    requestId: 'request-uuid',
    approvalStatus: 'rejected',
    decisionAt: new Date('2026-07-15T10:00:00Z'),
  });

  beforeEach(async () => {
    reviewService = {
      approve: jest.fn(),
      reject: jest.fn(),
    };

    meetingsService = {
      create: jest.fn(),
      getAvailableRooms: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeetingsController],
      providers: [
        { provide: MeetingSeriesService, useValue: {} },
        { provide: MeetingPrepService, useValue: {} },
        { provide: MeetingUpdateService, useValue: {} },
        { provide: MeetingListService, useValue: {} },
        { provide: ParticipantImportService, useValue: {} },
        {
          provide: MeetingsService,
          useValue: meetingsService,
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

  describe('approveMeetingRequest', () => {
    it('[AC-008] should call service.approve and return success response', async () => {
      const dto: ApproveMeetingRequestDto = { decisionNote: 'Chấp thuận' };

      reviewService.approve.mockResolvedValue(mockApproveResponse);

      const request = {
        user: { userId: 'approver-uuid' },
      } as unknown as Request;

      const result = await controller.approveMeetingRequest(
        'request-uuid',
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(reviewService.approve).toHaveBeenCalledWith(
        'request-uuid',
        dto,
        { userId: 'approver-uuid' },
        { ipAddress: '127.0.0.1', userAgent: 'Mozilla/5.0' },
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'Yêu cầu cuộc họp đã được phê duyệt thành công',
      );
      expect(result.data).toBeDefined();
      expect(result.data.requestId).toBe('request-uuid');
      expect(result.data.approvalStatus).toBe('approved');
    });

    it('should pass empty decisionNote when not provided', async () => {
      const dto: ApproveMeetingRequestDto = {};

      reviewService.approve.mockResolvedValue(mockApproveResponse);

      const request = {
        user: { userId: 'approver-uuid' },
      } as unknown as Request;

      await controller.approveMeetingRequest(
        'request-uuid',
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(reviewService.approve).toHaveBeenCalledWith(
        'request-uuid',
        {},
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe('rejectMeetingRequest', () => {
    it('[AC-009] should call service.reject and return success response', async () => {
      const dto: RejectMeetingRequestDto = {
        rejectionReason: 'Kế hoạch thay đổi',
      };

      reviewService.reject.mockResolvedValue(mockRejectResponse);

      const request = {
        user: { userId: 'approver-uuid' },
      } as unknown as Request;

      const result = await controller.rejectMeetingRequest(
        'request-uuid',
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(reviewService.reject).toHaveBeenCalledWith(
        'request-uuid',
        dto,
        { userId: 'approver-uuid' },
        { ipAddress: '127.0.0.1', userAgent: 'Mozilla/5.0' },
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe('Yêu cầu cuộc họp đã bị từ chối');
      expect(result.data).toBeDefined();
      expect(result.data.requestId).toBe('request-uuid');
      expect(result.data.approvalStatus).toBe('rejected');
    });
  });
});
