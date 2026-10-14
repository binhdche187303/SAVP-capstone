/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import {
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from '../../auth/decorators/require-permissions.decorator.js';
import { GateAccessLogController } from './gate-access-log.controller.js';

describe('GateAccessLogController (GAL-001 / UC-107)', () => {
  let controller: GateAccessLogController;
  let service: any;

  const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };
  const log = {
    id: 'log1',
    zoneId: 'z1',
    userId: 'u1',
    plateNumber: '29A12345',
    direction: 'enter',
    accessTime: new Date('2026-07-23T08:00:00Z'),
    pairedLogId: null,
    durationSeconds: null,
    vehicleRegistrationId: 'vr1',
    zone: { zoneCode: 'GATE-01', zoneName: 'Cong chinh' },
    user: { id: 'u1', fullName: 'Nguyen Van A', email: 'a@example.com' },
  };

  beforeEach(() => {
    service = {
      listForUser: jest.fn().mockResolvedValue({ items: [log], meta }),
      listAll: jest.fn().mockResolvedValue({ items: [log], meta }),
    };
    controller = new GateAccessLogController(service);
  });

  describe('route USER GET /gate-access-logs', () => {
    it('gọi service.listForUser(currentUser.userId, query); mapper user; KHÔNG khoá user', async () => {
      const r = await controller.listForUser(
        { userId: 'u-jwt' },
        { page: 1, limit: 20 },
      );
      expect(service.listForUser).toHaveBeenCalledWith('u-jwt', {
        page: 1,
        limit: 20,
      });
      expect(service.listAll).not.toHaveBeenCalled();
      expect(r.data[0]).not.toHaveProperty('user');
      expect(r.data[0]).toMatchObject({ id: 'log1', zone_name: 'Cong chinh' });
      expect(r.meta).toEqual(meta);
      expect(r.message).toBe('Gate access logs retrieved successfully');
    });

    it('guard chỉ JwtAuthGuard; KHÔNG PERMISSIONS_KEY', () => {
      const guards =
        Reflect.getMetadata('__guards__', controller.listForUser) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).not.toContain(PermissionsGuard);
      const perms = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.listForUser,
      );
      expect(perms).toBeUndefined();
    });
  });

  describe('route ADMIN GET /admin/gate-access-logs', () => {
    it('gọi service.listAll(query); mapper admin (có khối user + zone_code)', async () => {
      const query = { page: 1, limit: 20, user_id: 'u1' };
      const r = await controller.listAll(query);
      expect(service.listAll).toHaveBeenCalledWith(query);
      expect(r.data[0]).toMatchObject({
        id: 'log1',
        zone_code: 'GATE-01',
        user: {
          user_id: 'u1',
          full_name: 'Nguyen Van A',
          email: 'a@example.com',
        },
      });
      expect(r.meta).toEqual(meta);
    });

    it('admin-gate THẬT: JwtAuthGuard + PermissionsGuard + zones.gate_log.read hoặc gate.access.read', () => {
      const guards =
        Reflect.getMetadata('__guards__', controller.listAll) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(PermissionsGuard);
      const perms = Reflect.getMetadata(
        ANY_PERMISSIONS_KEY,
        controller.listAll,
      );
      expect(perms).toEqual(['zones.gate_log.read', 'gate.access.read']);
    });
  });

  it('list rỗng → 200 + data:[] + meta.total=0', async () => {
    service.listForUser.mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    const r = await controller.listForUser(
      { userId: 'u-jwt' },
      { page: 1, limit: 20 },
    );
    expect(r.data).toEqual([]);
    expect(r.meta.total).toBe(0);
  });
});
