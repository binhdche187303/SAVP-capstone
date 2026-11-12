import { MeetingSeriesService } from '../services/meeting-series.service.js';
import { MeetingPrepService } from '../services/meeting-prep.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { MeetingsController } from '../controllers/meetings.controller.js';
import { MeetingsService } from '../services/meetings.service.js';
import { MeetingRequestReviewService } from '../services/meeting-request-review.service.js';
import { ParticipantImportService } from '../services/participant-import.service.js';
import { MeetingListService } from '../services/meeting-list.service.js';
import { MeetingUpdateService } from '../services/meeting-update.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { DeleteAgendaItemResponseDto } from '../dto/agenda-response.dto.js';

describe('MeetingsController.deleteAgendaItem', () => {
  let controller: MeetingsController;
  let meetingsService: { deleteAgendaItem: jest.Mock };

  const meetingId = 'meeting-uuid';
  const agendaId = 'agenda-uuid';

  const mockResponse = new DeleteAgendaItemResponseDto({
    deleted: true,
    agendaId,
    meetingId,
    totalPlannedDurationMinutes: 20,
    remainingDurationMinutes: 40,
    remainingItemCount: 1,
  });

  beforeEach(async () => {
    meetingsService = {
      deleteAgendaItem: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeetingsController],
      providers: [
        { provide: MeetingSeriesService, useValue: {} },
        { provide: MeetingPrepService, useValue: {} },
        { provide: MeetingsService, useValue: meetingsService },
        { provide: MeetingRequestReviewService, useValue: {} },
        { provide: ParticipantImportService, useValue: {} },
        { provide: MeetingListService, useValue: {} },
        { provide: MeetingUpdateService, useValue: {} },
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

  it('calls service.deleteAgendaItem and returns a standard success envelope', async () => {
    meetingsService.deleteAgendaItem.mockResolvedValue(mockResponse);

    const result = await controller.deleteAgendaItem(
      meetingId,
      agendaId,
      { userId: 'organizer-uuid' },
      '127.0.0.1',
      'Mozilla/5.0',
    );

    expect(meetingsService.deleteAgendaItem).toHaveBeenCalledWith(
      meetingId,
      agendaId,
      'organizer-uuid',
      { ipAddress: '127.0.0.1', userAgent: 'Mozilla/5.0' },
    );
    expect(result).toEqual({
      success: true,
      message: 'Xoa muc agenda thanh cong',
      data: mockResponse,
    });
  });

  it('propagates 403 AGENDA_WRITE_FORBIDDEN from the service', async () => {
    meetingsService.deleteAgendaItem.mockRejectedValue(
      new ForbiddenException('AGENDA_WRITE_FORBIDDEN'),
    );

    await expect(
      controller.deleteAgendaItem(
        meetingId,
        agendaId,
        { userId: 'participant-uuid' },
        '127.0.0.1',
        'Mozilla/5.0',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('propagates 404 AGENDA_ITEM_NOT_FOUND from the service', async () => {
    meetingsService.deleteAgendaItem.mockRejectedValue(
      new NotFoundException('AGENDA_ITEM_NOT_FOUND'),
    );

    await expect(
      controller.deleteAgendaItem(
        meetingId,
        'nonexistent',
        { userId: 'organizer-uuid' },
        '127.0.0.1',
        'Mozilla/5.0',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('propagates 409 AGENDA_MEETING_STATUS_BLOCKED from the service', async () => {
    meetingsService.deleteAgendaItem.mockRejectedValue(
      new ConflictException('AGENDA_MEETING_STATUS_BLOCKED'),
    );

    await expect(
      controller.deleteAgendaItem(
        meetingId,
        agendaId,
        { userId: 'organizer-uuid' },
        '127.0.0.1',
        'Mozilla/5.0',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
