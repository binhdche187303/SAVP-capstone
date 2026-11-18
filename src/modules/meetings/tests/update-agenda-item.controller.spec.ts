import { MeetingSeriesService } from '../services/meeting-series.service.js';
import { MeetingPrepService } from '../services/meeting-prep.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { MeetingsController } from '../controllers/meetings.controller.js';
import { MeetingsService } from '../services/meetings.service.js';
import { MeetingRequestReviewService } from '../services/meeting-request-review.service.js';
import { ParticipantImportService } from '../services/participant-import.service.js';
import { MeetingListService } from '../services/meeting-list.service.js';
import { MeetingUpdateService } from '../services/meeting-update.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { AgendaItemUpdateResponseDto } from '../dto/agenda-response.dto.js';
import { UpdateAgendaItemDto } from '../dto/update-agenda-item.dto.js';

describe('MeetingsController.updateAgendaItem', () => {
  let controller: MeetingsController;
  let meetingsService: { updateAgendaItem: jest.Mock };

  const meetingId = 'meeting-uuid';
  const agendaId = 'agenda-uuid';

  const mockResponse = new AgendaItemUpdateResponseDto({
    id: agendaId,
    meetingId,
    agendaOrder: 1,
    title: 'Updated title',
    description: null,
    ownerId: null,
    ownerName: null,
    plannedDurationMinutes: 30,
    status: 'planned',
    updatedAt: new Date('2026-07-17T10:00:00Z'),
    totalPlannedDurationMinutes: 30,
    remainingDurationMinutes: 30,
  });

  beforeEach(async () => {
    meetingsService = {
      updateAgendaItem: jest.fn(),
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

  it('calls service.updateAgendaItem and returns a standard success envelope', async () => {
    meetingsService.updateAgendaItem.mockResolvedValue(mockResponse);
    const dto: UpdateAgendaItemDto = { title: 'Updated title' };

    const result = await controller.updateAgendaItem(
      meetingId,
      agendaId,
      dto,
      { userId: 'organizer-uuid' },
      '127.0.0.1',
      'Mozilla/5.0',
    );

    expect(meetingsService.updateAgendaItem).toHaveBeenCalledWith(
      meetingId,
      agendaId,
      dto,
      'organizer-uuid',
      { ipAddress: '127.0.0.1', userAgent: 'Mozilla/5.0' },
    );
    expect(result).toEqual({
      success: true,
      message: 'Cập nhật chương trình họp thành công',
      data: mockResponse,
    });
  });

  it('propagates errors thrown by the service (e.g. AGENDA_WRITE_FORBIDDEN)', async () => {
    meetingsService.updateAgendaItem.mockRejectedValue(
      new Error('AGENDA_WRITE_FORBIDDEN'),
    );
    const dto: UpdateAgendaItemDto = { title: 'Blocked' };

    await expect(
      controller.updateAgendaItem(
        meetingId,
        agendaId,
        dto,
        { userId: 'participant-uuid' },
        '127.0.0.1',
        'Mozilla/5.0',
      ),
    ).rejects.toThrow('AGENDA_WRITE_FORBIDDEN');
  });
});
