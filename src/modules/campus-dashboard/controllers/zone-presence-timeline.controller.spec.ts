/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { ZonePresenceTimelineController } from './zone-presence-timeline.controller.js';

describe('ZonePresenceTimelineController (ZPT-001 / UC-119)', () => {
  let controller: ZonePresenceTimelineController;
  let service: any;

  const responseData = {
    events: [],
    personDataAvailable: null,
    sightingCount: null,
  };

  beforeEach(() => {
    service = { getTimeline: jest.fn().mockResolvedValue(responseData) };
    controller = new ZonePresenceTimelineController(service);
  });

  it('route được bảo vệ bởi JwtAuthGuard + PermissionsGuard + permission đúng', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.getTimeline) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, controller.getTimeline),
    ).toEqual(['campus_dashboard.timeline.read']);
  });

  it('GET timeline → chuyển đổi from/to thành Date, gọi service đúng tham số, trả envelope chuẩn', async () => {
    const result = await controller.getTimeline('zone-1', {
      from: '2026-07-01T00:00:00Z',
      to: '2026-07-02T00:00:00Z',
      userId: 'u1',
    });

    expect(service.getTimeline).toHaveBeenCalledWith(
      'zone-1',
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-02T00:00:00Z'),
      'u1',
      undefined, // status (không lọc)
    );
    expect(result).toEqual({
      success: true,
      message: 'Zone presence timeline retrieved successfully',
      data: responseData,
    });
  });
});
