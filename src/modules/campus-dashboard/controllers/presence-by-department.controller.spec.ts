/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { PresenceByDepartmentController } from './presence-by-department.controller.js';

describe('PresenceByDepartmentController (2.12)', () => {
  let controller: PresenceByDepartmentController;
  let service: any;

  beforeEach(() => {
    service = {
      getPresence: jest.fn().mockResolvedValue({
        generatedAt: 'x',
        totalPresent: 0,
        departments: [],
      }),
    };
    controller = new PresenceByDepartmentController(service);
  });

  it('route được bảo vệ bởi JwtAuthGuard + PermissionsGuard + permission overview', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.getPresenceByDepartment) ??
      [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, controller.getPresenceByDepartment),
    ).toEqual(['campus_dashboard.overview.read']);
  });

  it('GET presence-by-department → gọi service + trả envelope chuẩn', async () => {
    const result = await controller.getPresenceByDepartment();
    expect(service.getPresence).toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Presence by department retrieved successfully',
      data: { generatedAt: 'x', totalPresent: 0, departments: [] },
    });
  });
});
