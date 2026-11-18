import { MeetingMinutesListController } from './minutes-list.controller.js';
import { MinutesShareResponseDto } from '../dto/minutes-share-response.dto.js';

describe('MeetingMinutesListController — share routes', () => {
  let controller: MeetingMinutesListController;
  let minutesService: any;

  const currentUser = { userId: 'host-1' };
  const minutesId = 'minutes-1';

  beforeEach(() => {
    minutesService = {
      shareMinutes: jest.fn().mockResolvedValue(
        new MinutesShareResponseDto({
          id: 'share-1',
          minutesId,
          userId: 'target-1',
          userFullName: 'Target User',
          grantedBy: 'host-1',
          grantedAt: new Date('2026-07-17T00:00:00Z'),
        }),
      ),
      listMinutesShares: jest.fn().mockResolvedValue({ minutesId, shares: [] }),
      unshareMinutes: jest
        .fn()
        .mockResolvedValue({ minutesId, userId: 'target-1', revoked: true }),
    };
    controller = new MeetingMinutesListController(minutesService, {
      createExportJob: jest.fn(),
    } as any);
  });

  it('POST :id/shares calls shareMinutes and wraps 201 response', async () => {
    const res = await controller.shareMinutes(
      minutesId,
      { userId: 'target-1' },
      currentUser,
    );
    expect(minutesService.shareMinutes).toHaveBeenCalledWith(
      minutesId,
      { userId: 'target-1' },
      { userId: 'host-1' },
    );
    expect(res).toEqual({
      success: true,
      message: 'Đã chia sẻ biên bản thành công',
      data: expect.objectContaining({ userId: 'target-1' }),
    });
  });

  it('GET :id/shares calls listMinutesShares and wraps response', async () => {
    const res = await controller.listMinutesShares(minutesId, currentUser);
    expect(minutesService.listMinutesShares).toHaveBeenCalledWith(minutesId, {
      userId: 'host-1',
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ minutesId, shares: [] });
  });

  it('DELETE :id/shares/:userId calls unshareMinutes and wraps response', async () => {
    const res = await controller.unshareMinutes(
      minutesId,
      'target-1',
      currentUser,
    );
    expect(minutesService.unshareMinutes).toHaveBeenCalledWith(
      minutesId,
      'target-1',
      { userId: 'host-1' },
    );
    expect(res).toEqual({
      success: true,
      message: 'Đã thu hồi quyền xem biên bản',
      data: { minutesId, userId: 'target-1', revoked: true },
    });
  });

  it('propagates errors from service (e.g. 403)', async () => {
    minutesService.shareMinutes.mockRejectedValue(
      new Error('NOT_MINUTES_OWNER'),
    );
    await expect(
      controller.shareMinutes(minutesId, { userId: 'x' }, currentUser),
    ).rejects.toThrow('NOT_MINUTES_OWNER');
  });
});
