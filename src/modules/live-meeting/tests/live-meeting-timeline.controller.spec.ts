import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ParseUUIDPipe, HttpStatus } from '@nestjs/common';
import { LiveMeetingController } from '../controllers/live-meeting.controller.js';
import { LiveMeetingService } from '../services/live-meeting.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

describe('LiveMeetingController.getMeetingTimeline (UC-99)', () => {
  let controller: LiveMeetingController;
  const mockService = { getMeetingTimeline: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LiveMeetingController],
      providers: [
        { provide: LiveMeetingService, useValue: mockService },
        { provide: AuthzReadRepository, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get<LiveMeetingController>(LiveMeetingController);
  });

  afterEach(() => jest.clearAllMocks());

  const validMeetingId = '550e8400-e29b-41d4-a716-446655440000';

  it('[C1] Success — gọi service đúng params & trả { success, message, data, meta }', async () => {
    const data = [
      {
        time: '2026-07-13T09:00:00.000Z',
        category: 'meeting_event',
        type: 'meeting_started',
        actorUserId: 'host-1',
        actorName: 'Host',
        detail: 'start',
        refId: 'e1',
      },
    ];
    mockService.getMeetingTimeline.mockResolvedValue({
      data,
      total: 12,
      page: 2,
      limit: 5,
    });

    const request = { user: { userId: 'host-1' } } as any;

    const result = await controller.getMeetingTimeline(
      validMeetingId,
      { page: 2, limit: 5 },
      request,
    );

    expect(mockService.getMeetingTimeline).toHaveBeenCalledWith(
      validMeetingId,
      { page: 2, limit: 5 },
      'host-1',
    );
    expect(result).toEqual({
      success: true,
      message: 'Lấy dòng thời gian cuộc họp thành công',
      data,
      meta: { page: 2, limit: 5, total: 12, totalPages: 3 },
    });
  });

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { getMeetingTimeline } = LiveMeetingController.prototype;

  it('[C2] Endpoint áp dụng JwtAuthGuard + PermissionsGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      getMeetingTimeline,
    ) as unknown[];
    expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it('[C3] Yêu cầu permission meeting.timeline.read', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      getMeetingTimeline,
    ) as string[];
    expect(permissions).toEqual(['meeting.timeline.read']);
  });

  it('[C4] meetingId sai UUID → ParseUUIDPipe reject (400)', async () => {
    const pipe = new ParseUUIDPipe({
      errorHttpStatusCode: HttpStatus.BAD_REQUEST,
    });
    await expect(
      pipe.transform('not-a-uuid', { type: 'param', data: 'meetingId' } as any),
    ).rejects.toBeDefined();
  });
});
