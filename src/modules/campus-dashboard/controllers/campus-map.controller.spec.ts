/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { CampusMapController } from './campus-map.controller.js';

describe('CampusMapController (Bản đồ GIS)', () => {
  let controller: CampusMapController;
  let service: any;

  beforeEach(() => {
    service = { getMap: jest.fn().mockResolvedValue({ zones: [] }) };
    controller = new CampusMapController(service);
  });

  it('route được bảo vệ bởi JwtAuthGuard + PermissionsGuard + permission overview', () => {
    const guards = Reflect.getMetadata('__guards__', controller.getMap) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.getMap)).toEqual([
      'campus_dashboard.overview.read',
    ]);
  });

  it('GET map → truyền query xuống service + trả envelope chuẩn', async () => {
    const result = await controller.getMap({ hours: 12, building: 'Tòa A' });
    expect(service.getMap).toHaveBeenCalledWith({
      hours: 12,
      building: 'Tòa A',
    });
    expect(result).toEqual({
      success: true,
      message: 'Campus map retrieved successfully',
      data: { zones: [] },
    });
  });
});
