/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { ZoneTrafficHeatmapController } from './zone-traffic-heatmap.controller.js';

describe('ZoneTrafficHeatmapController (ZTH-001 / UC-120)', () => {
  let controller: ZoneTrafficHeatmapController;
  let service: any;

  const responseData = { series: [], heatmap: [] };

  beforeEach(() => {
    service = { getTraffic: jest.fn().mockResolvedValue(responseData) };
    controller = new ZoneTrafficHeatmapController(service);
  });

  it('route được bảo vệ bởi JwtAuthGuard + PermissionsGuard + permission đúng', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.getTraffic) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.getTraffic)).toEqual(
      ['campus_dashboard.traffic.read'],
    );
  });

  it('GET traffic → chuyển đổi from/to thành Date, gọi service đúng tham số, trả envelope chuẩn', async () => {
    const result = await controller.getTraffic({
      from: '2026-07-01T00:00:00Z',
      to: '2026-07-02T00:00:00Z',
      building: 'Tòa A',
      floor: '1',
    });

    expect(service.getTraffic).toHaveBeenCalledWith(
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-02T00:00:00Z'),
      'Tòa A',
      '1',
      { bucket: undefined, groupId: undefined },
    );
    expect(result).toEqual({
      success: true,
      message: 'Zone traffic & heatmap retrieved successfully',
      data: responseData,
    });
  });
});
