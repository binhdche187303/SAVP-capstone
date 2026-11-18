import { MinutesController } from './minutes.controller.js';
import { MinutesService } from '../services/minutes.service.js';
import { DraftMinutesResponseDto } from '../dto/draft-minutes-response.dto.js';
import {
  MeetingMinutesStatus,
  MeetingMinutesVisibilityLevel,
} from '../entities/meeting-minutes.entity.js';

describe('MinutesController', () => {
  let controller: MinutesController;
  let minutesService: { createDraft: jest.Mock };

  const currentUser = { userId: 'host-1' };

  const sampleResponse = new DraftMinutesResponseDto({
    id: 'minutes-1',
    meetingId: 'meeting-1',
    title: 'Biên bản họp: Họp review',
    status: MeetingMinutesStatus.DRAFT,
    visibilityLevel: MeetingMinutesVisibilityLevel.PRIVATE,
    versionNo: 1,
    minutesContent: 'noi dung mac dinh',
    preparedBy: 'host-1',
    createdAt: new Date('2026-07-02T09:15:00Z'),
    meetingSnapshot: {
      meetingTitle: 'Họp review',
      actualStartTime: new Date('2026-07-02T09:00:00Z'),
      actualEndTime: null,
      roomId: 'room-1',
      meetingStatus: 'in_progress',
      attendees: [],
    },
  });

  beforeEach(() => {
    minutesService = {
      createDraft: jest.fn().mockResolvedValue(sampleResponse),
    };
    controller = new MinutesController(
      minutesService as unknown as MinutesService,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates to MinutesService.createDraft with correct params and wraps response', async () => {
    const dto = { title: 'Custom' };

    const result = await controller.createDraftMinutes(
      'meeting-1',
      dto,
      currentUser,
    );

    expect(minutesService.createDraft).toHaveBeenCalledWith('meeting-1', dto, {
      userId: 'host-1',
    });
    expect(result).toEqual({
      success: true,
      message: 'Biên bản họp nháp đã được tạo thành công',
      data: sampleResponse,
    });
  });
});
