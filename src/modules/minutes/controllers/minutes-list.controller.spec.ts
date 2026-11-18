import { MeetingMinutesListController } from './minutes-list.controller.js';
import { MinutesService } from '../services/minutes.service.js';
import { MinutesListItemDto } from '../dto/minutes-list-item.dto.js';
import { MinutesMeetingSummaryDto } from '../dto/minutes-meeting-summary.dto.js';
import { UserSummaryDto } from '../../meetings/dto/user-summary.dto.js';
import { MeetingMinutesStatus } from '../entities/meeting-minutes.entity.js';
import { IssueMinutesResponseDto } from '../dto/issue-minutes-response.dto.js';
import { MeetingMode } from '../../meetings/entities/meeting.entity.js';
import { MinutesQueryDto } from '../dto/minutes-query.dto.js';

describe('MeetingMinutesListController', () => {
  let controller: MeetingMinutesListController;
  let minutesService: any;

  const currentUser = { userId: 'user-1' };

  const sampleItem = new MinutesListItemDto({
    id: 'minutes-1',
    title: 'Bien ban hop A',
    status: MeetingMinutesStatus.PUBLISHED,
    versionNo: 1,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    issuedAt: null,
    meeting: new MinutesMeetingSummaryDto({
      id: 'meeting-1',
      title: 'Sprint Planning',
      status: 'completed' as any,
      startTime: new Date('2026-06-30T09:00:00Z'),
      endTime: new Date('2026-06-30T10:00:00Z'),
      actualStartTime: new Date('2026-06-30T09:00:00Z'),
      actualEndTime: new Date('2026-06-30T10:00:00Z'),
      meetingMode: MeetingMode.OFFLINE,
      room: null,
      organizer: null,
    }),
    host: new UserSummaryDto('host-1', 'Nguyen Van A', 'a@company.com'),
    issuedBy: null,
    preparedBy: null,
    isAiGenerated: false,
  });

  beforeEach(() => {
    minutesService = {
      findMinutesList: jest.fn().mockResolvedValue({
        items: [sampleItem],
        total: 1,
        page: 1,
        limit: 20,
      }),
      updateDraft: jest
        .fn()
        .mockResolvedValue({ id: 'min-1', title: 'Updated' }),
      deleteDraft: jest
        .fn()
        .mockResolvedValue({ deleted: true, minutesId: 'min-1' }),
      searchMinutesByPerson: jest.fn().mockResolvedValue({
        items: [sampleItem],
        total: 1,
        page: 1,
        limit: 20,
        person: { id: 'target-1', fullName: 'Target', email: 't@test.com' },
      }),
      findMinutesDetail: jest.fn().mockResolvedValue({ id: 'min-1' }),
    };
    controller = new MeetingMinutesListController(minutesService, {
      createExportJob: jest.fn(),
    } as any);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('gọi MinutesService.findMinutesList với query + currentUser và bọc response chuẩn', async () => {
    const query: MinutesQueryDto = { status: 'published' };

    const result = await controller.findAll(query, currentUser);

    expect(minutesService.findMinutesList).toHaveBeenCalledWith(query, {
      userId: 'user-1',
    });
    expect(result).toEqual({
      success: true,
      message: 'Danh sách biên bản họp',
      data: [sampleItem],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  it('trả totalPages=0 khi danh sách rỗng', async () => {
    minutesService.findMinutesList.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });

    const result = await controller.findAll({}, currentUser);

    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    expect(result.data).toEqual([]);
  });

  it('tính đúng totalPages khi total không chia hết cho limit', async () => {
    minutesService.findMinutesList.mockResolvedValue({
      items: [sampleItem],
      total: 41,
      page: 1,
      limit: 20,
    });

    const result = await controller.findAll({}, currentUser);

    expect(result.meta.totalPages).toBe(3);
  });

  describe('updateDraft', () => {
    it('should update draft minutes', async () => {
      const dto = { versionNo: 1, title: 'Updated' };
      const result = await controller.updateDraft('min-1', dto, currentUser);
      expect(minutesService.updateDraft).toHaveBeenCalledWith('min-1', dto, {
        userId: 'user-1',
      });
      expect(result.success).toBe(true);
      expect(result.data.title).toBe('Updated');
    });
  });

  describe('toggleLiveShare (MKM-LIVE-01)', () => {
    it('goi minutesService.toggleLiveShare voi dung tham so va tra ve response bat', async () => {
      minutesService.toggleLiveShare = jest.fn().mockResolvedValue({
        id: 'min-1',
        isLiveShared: true,
        versionNo: 3,
      });

      const dto = { enabled: true };
      const result = await controller.toggleLiveShare(
        'min-1',
        dto,
        currentUser,
      );

      expect(minutesService.toggleLiveShare).toHaveBeenCalledWith(
        'min-1',
        dto,
        { userId: 'user-1' },
      );
      expect(result).toEqual({
        success: true,
        message: 'Da bat che do chia se truc tiep',
        data: { id: 'min-1', isLiveShared: true, versionNo: 3 },
      });
    });

    it('tra ve thong bao tat khi isLiveShared=false', async () => {
      minutesService.toggleLiveShare = jest.fn().mockResolvedValue({
        id: 'min-1',
        isLiveShared: false,
        versionNo: 4,
      });

      const result = await controller.toggleLiveShare(
        'min-1',
        { enabled: false },
        currentUser,
      );

      expect(result.message).toBe('Da tat che do chia se truc tiep');
      expect(result.data.isLiveShared).toBe(false);
    });
  });

  describe('deleteDraft', () => {
    it('should delete draft minutes', async () => {
      const result = await controller.deleteDraft('min-1', currentUser);
      expect(minutesService.deleteDraft).toHaveBeenCalledWith('min-1', {
        userId: 'user-1',
      });
      expect(result.success).toBe(true);
      expect(result.data.deleted).toBe(true);
    });
  });

  describe('searchByPerson', () => {
    it('should search minutes by person', async () => {
      const query = { userId: 'target-1', page: 1, limit: 20 };
      const result = await controller.searchByPerson(query, currentUser);
      expect(minutesService.searchMinutesByPerson).toHaveBeenCalledWith(query, {
        userId: 'user-1',
      });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('should find minutes detail', async () => {
      const result = await controller.findOne('min-1', currentUser);
      expect(minutesService.findMinutesDetail).toHaveBeenCalledWith('min-1', {
        userId: 'user-1',
      });
      expect(result.success).toBe(true);
      expect(result.data.id).toBe('min-1');
    });
  });

  describe('issue', () => {
    it('should issue (publish) minutes successfully', async () => {
      const mockResult = new IssueMinutesResponseDto({
        id: 'min-1',
        meetingId: 'meet-1',
        title: 'Bien ban hop A',
        status: 'published',
        versionNo: 1,
        issuedBy: 'user-1',
        issuedAt: new Date('2026-07-02T10:00:00Z'),
        updatedAt: new Date('2026-07-02T10:00:00Z'),
        notifiedParticipantCount: 2,
      });
      minutesService.issueMinutes = jest.fn().mockResolvedValue(mockResult);

      const result = await controller.issue('min-1', currentUser);
      expect(minutesService.issueMinutes).toHaveBeenCalledWith('min-1', {
        userId: 'user-1',
      });
      expect(result.success).toBe(true);
      expect(result.data.status).toBe('published');
      expect(result.data.issuedBy).toBe('user-1');
      expect(result.data.notifiedParticipantCount).toBe(2);
    });
  });

  describe('linkResources', () => {
    it('should link resources and wrap response (UC-141)', async () => {
      const mockResult = {
        id: 'min-1',
        linkedRecordingFileId: 'file-1',
        linkedTranscriptId: null,
        updatedAt: new Date('2026-07-17T10:00:00Z'),
      };
      minutesService.linkResources = jest.fn().mockResolvedValue(mockResult);

      const dto = { recordingFileId: 'file-1' };
      const result = await controller.linkResources('min-1', dto, currentUser);

      expect(minutesService.linkResources).toHaveBeenCalledWith('min-1', dto, {
        userId: 'user-1',
      });
      expect(result.success).toBe(true);
      expect(result.data.linkedRecordingFileId).toBe('file-1');
    });
  });

  describe('MeetingMinutesListController - compare endpoint (MKM-MANUAL-01)', () => {
    it('compare route is defined and accessible', () => {
      expect(controller.compare).toBeDefined();
    });

    it('calls minutesService.compareMinutes with correct parameters', async () => {
      const meetingId = 'test-meeting-id';
      minutesService.compareMinutes = jest
        .fn()
        .mockResolvedValue({ manual: null, ai: null });

      await controller.compare(meetingId, currentUser);

      expect(minutesService.compareMinutes).toHaveBeenCalledWith(meetingId, {
        userId: currentUser.userId,
      });
    });

    it('returns success response with correct shape', async () => {
      const meetingId = 'test-meeting-id';
      const mockResult = { manual: { id: '1' }, ai: { id: '2' } };
      minutesService.compareMinutes = jest.fn().mockResolvedValue(mockResult);

      const response = await controller.compare(meetingId, currentUser);

      expect(response).toEqual({
        success: true,
        message: 'So sánh biên bản thủ công và AI',
        data: mockResult,
      });
    });
  });
});
