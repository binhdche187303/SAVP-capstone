import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
﻿import { Test, type TestingModule } from '@nestjs/testing';
import { LiveMeetingController } from '../controllers/live-meeting.controller.js';
import { LiveMeetingService } from '../services/live-meeting.service.js';
import { StartMeetingResponseDto } from '../dto/start-meeting-response.dto.js';
import { MeetingStatus } from '../../meetings/entities/meeting.entity.js';

describe('LiveMeetingController', () => {
  let controller: LiveMeetingController;
  let service: LiveMeetingService;

  const mockService = {
    startMeeting: jest.fn(),
    endMeeting: jest.fn(),
    getPresentAttendees: jest.fn(),
    createMeetingNote: jest.fn(),
    viewMeetingNotes: jest.fn(),
  };

  const mockLiveMeetingService = mockService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LiveMeetingController],
      providers: [
        { provide: AuthzReadRepository, useValue: {} },
        {
          provide: LiveMeetingService,
          useValue: mockService,
        },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard).useValue({ canActivate: () => true }).compile();

    controller = module.get<LiveMeetingController>(LiveMeetingController);
    service = module.get<LiveMeetingService>(LiveMeetingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call service.startMeeting and return success response', async () => {
    const dto = new StartMeetingResponseDto({
      meetingId: 'm-001',
      status: MeetingStatus.IN_PROGRESS,
      actualStartTime: new Date().toISOString(),
      alreadyStarted: false,
    });
    mockService.startMeeting.mockResolvedValue(dto);

    const requestMock = { user: { userId: 'host-1' } } as any;

    const result = await controller.startMeeting(
      'm-001',
      requestMock,
      '127.0.0.1',
      'test-agent',
    );

    expect(result.success).toBe(true);
    expect(result.data.meetingId).toBe('m-001');
    expect(result.data.alreadyStarted).toBe(false);
    expect(mockService.startMeeting).toHaveBeenCalledWith(
      'm-001',
      { userId: 'host-1' },
      { ipAddress: '127.0.0.1', userAgent: 'test-agent' },
    );
  });

  it('should return alreadyStarted message when applicable', async () => {
    const dto = new StartMeetingResponseDto({
      meetingId: 'm-001',
      status: MeetingStatus.IN_PROGRESS,
      actualStartTime: new Date().toISOString(),
      alreadyStarted: true,
    });
    mockService.startMeeting.mockResolvedValue(dto);

    const requestMock = { user: { userId: 'host-1' } } as any;

    const result = await controller.startMeeting(
      'm-001',
      requestMock,
      '127.0.0.1',
      undefined,
    );

    expect(result.success).toBe(true);
    expect(result.message).toBe('Phiên họp đã được bắt đầu trước đó');
    expect(result.data.alreadyStarted).toBe(true);
  });

  // ───────────────────────────────────────────────────────────
  //  UC-IMM-05: End Meeting Session — Controller Tests
  // ───────────────────────────────────────────────────────────

  describe('LiveMeetingController - endMeeting', () => {
    it('T014-01: should call service.endMeeting and return 200 with correct response format', async () => {
      const meetingId = 'm-001';
      const now = new Date().toISOString();

      mockLiveMeetingService.endMeeting.mockResolvedValue({
        meetingId,
        status: 'completed',
        actualEndTime: now,
        duration: 85,
        roomReleased: true,
      });

      const result = await controller.endMeeting(
        meetingId,
        { user: { userId: 'host-1' } } as any,
        '127.0.0.1',
        'test-agent',
      );

      expect(mockLiveMeetingService.endMeeting).toHaveBeenCalledWith(
        meetingId,
        { userId: 'host-1' },
        { ipAddress: '127.0.0.1', userAgent: 'test-agent' },
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Phiên họp đã kết thúc thành công');
      expect(result.data.meetingId).toBe(meetingId);
      expect(result.data.status).toBe('completed');
      expect(result.data.duration).toBe(85);
      expect(result.data.roomReleased).toBe(true);
    });

      // ========================================================
      //  UC-IMM-07: getPresentAttendees
      // ========================================================

      describe('getPresentAttendees', () => {
        const meetingId = 'm-pa-001';
        const mockResponse = {
          data: {
            meetingId,
            occupancyCount: 2,
            presentUsers: [
              { userId: 'u1', fullName: 'A', presenceStatus: 'present' },
              { userId: 'u2', fullName: 'B', presenceStatus: 'present' },
            ],
            updatedAt: new Date().toISOString(),
          },
          meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
        };

        it('should return present attendees list with correct shape', async () => {
          mockLiveMeetingService.getPresentAttendees.mockResolvedValue(
            mockResponse,
          );

          const result = await controller.getPresentAttendees(
            meetingId,
            { user: { userId: 'host-1' } } as any,
            '127.0.0.1',
            'test-agent',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
          );

          expect(result.success).toBe(true);
          expect(result.message).toBe('Danh sách người tham dự đang có mặt');
          expect(result.data.meetingId).toBe(meetingId);
          expect(result.data.occupancyCount).toBe(2);
          expect(result.meta.page).toBe(1);
          expect(result.meta.total).toBe(2);
        });

        it('should return 200 with limited fields for participant', async () => {
          const participantResponse = {
            data: {
              meetingId,
              occupancyCount: 2,
              presentUsers: [
                {
                  userId: 'u1',
                  fullName: 'A',
                  presenceStatus: 'present',
                  presenceSource: null,
                },
              ],
              updatedAt: new Date().toISOString(),
            },
            meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
          };
          mockLiveMeetingService.getPresentAttendees.mockResolvedValue(
            participantResponse,
          );

          const result = await controller.getPresentAttendees(
            meetingId,
            { user: { userId: 'attendee-1' } } as any,
            '127.0.0.1',
            'test-agent',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
          );

          expect(result.success).toBe(true);
          // presenceSource should be null for non-host viewing others
          expect(result.data.presentUsers[0].presenceSource).toBeNull();
        });
      });
    // ------------------------------------------------------------------
    //  UC-IMM-09: Create / List Meeting Notes
    // ------------------------------------------------------------------

    describe('createNote', () => {
      it('should respond with 201 for valid request', async () => {
        const mockResult = {
          id: 'note-1',
          meetingId: 'm-001',
          noteType: 'in_meeting',
          content: 'Test',
          pinned: false,
          visibilityLevel: 'participants',
          author: { id: 'user-1', fullName: 'User' },
          createdAt: new Date().toISOString(),
        };
        jest.spyOn(service, 'createMeetingNote').mockResolvedValue(mockResult);

        const response = await controller.createNote(
          'm-001',
          {
            noteType: 'in_meeting',
            content: 'Test',
            pinned: false,
            visibilityLevel: 'participants',
          },
          { user: { userId: 'user-1' } } as any,
        );

        expect(response.success).toBe(true);
        expect(response.data).toBeDefined();
        expect(response.data.noteType).toBe('in_meeting');
      });
    });

    describe('listNotes', () => {
      it('should respond with 200 and meta for valid request', async () => {
        const mockResult = {
          data: [
            {
              id: 'note-1',
              meetingId: 'm-001',
              noteType: 'in_meeting',
              content: 'Test',
              pinned: false,
              visibilityLevel: 'participants',
              author: { id: 'user-1', fullName: 'User' },
              sourceEventId: null,
              noteTimestamp: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
          message: 'Lấy danh sách ghi chú thành công',
        };
        jest.spyOn(service, 'viewMeetingNotes').mockResolvedValue(mockResult);

        const response = await controller.listNotes(
          'm-001',
          { page: 1, limit: 20 },
          { user: { userId: 'user-1' } } as any,
        );

        expect(response.success).toBe(true);
        expect(response.data).toHaveLength(1);
        expect(response.meta).toBeDefined();
        expect(response.meta.total).toBe(1);
      });
    });
  });
});
