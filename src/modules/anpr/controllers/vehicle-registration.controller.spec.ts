/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import {
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from '../../auth/decorators/require-permissions.decorator.js';
import { ALLOW_PARTNER_ACCOUNT_KEY } from '../../../common/decorators/allow-partner-account.decorator.js';
import { VehicleRegistrationController } from './vehicle-registration.controller.js';

describe('VehicleRegistrationController (VPR-001 / UC1)', () => {
  let controller: VehicleRegistrationController;
  let service: any;

  const entity = {
    id: 'veh1',
    userId: 'u1',
    plateRaw: '30A-123.45',
    plateNumber: '30A12345',
    vehicleType: 'car',
    note: null,
    status: 'active',
    createdAt: new Date('2026-06-24T00:00:00Z'),
    updatedAt: new Date('2026-06-24T00:00:00Z'),
  };

  let unknownService: any;
  let historyService: any;

  beforeEach(() => {
    service = { register: jest.fn().mockResolvedValue(entity) };
    unknownService = { listUnknown: jest.fn() };
    historyService = { listForUser: jest.fn(), listAll: jest.fn() };
    controller = new VehicleRegistrationController(
      service,
      unknownService,
      historyService,
    );
  });

  it('USER route: register với @CurrentUser().userId (KHÔNG body user_id) + envelope 201 shape', async () => {
    const r = await controller.registerOwn(
      { userId: 'u-jwt' },
      { plateRaw: '30A-123.45' },
    );
    expect(service.register).toHaveBeenCalledWith('u-jwt', {
      plateRaw: '30A-123.45',
    });
    expect(r.success).toBe(true);
    expect(r.message).toBe('Vehicle registered successfully');
    expect(r.data).toMatchObject({
      id: 'veh1',
      user_id: 'u1',
      plate_number: '30A12345',
      status: 'active',
    });
  });

  it('ADMIN route: register với dto.userId (từ body) + cùng mapper/envelope', async () => {
    const r = await controller.registerForUser({
      userId: 'target-user',
      plateRaw: '30A-123.45',
    });
    expect(service.register).toHaveBeenCalledWith('target-user', {
      userId: 'target-user',
      plateRaw: '30A-123.45',
    });
    expect(r.data).toMatchObject({ plate_number: '30A12345' });
    expect(r.message).toBe('Vehicle registered successfully');
  });

  it('USER route guard = chỉ JwtAuthGuard (KHÔNG PermissionsGuard)', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.registerOwn) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).not.toContain(PermissionsGuard);
  });

  it('ADMIN route gate THẬT: JwtAuthGuard + PermissionsGuard + @RequirePermissions', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.registerForUser) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
    const perms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller.registerForUser,
    );
    expect(perms).toEqual(['anpr.vehicle.admin_register']);
  });

  // ── UC2 (VPM-001): sửa / status / xóa-mềm ──
  describe('UC2 routes', () => {
    beforeEach(() => {
      service.updateMetadata = jest.fn().mockResolvedValue(entity);
      service.setStatus = jest.fn().mockResolvedValue(entity);
      service.softDeleteOwned = jest.fn().mockResolvedValue(undefined);
    });

    it('PATCH update → service.updateMetadata(id, @CurrentUser().userId, dto), envelope + mapper', async () => {
      const r = await controller.update({ userId: 'u-jwt' }, 'veh1', {
        note: 'x',
      });
      expect(service.updateMetadata).toHaveBeenCalledWith('veh1', 'u-jwt', {
        note: 'x',
      });
      expect(r.message).toBe('Vehicle updated successfully');
      expect(r.data).toMatchObject({ id: 'veh1', plate_number: '30A12345' });
    });

    it('PATCH status → service.setStatus(id, userId, dto.status)', async () => {
      const r = await controller.updateStatus({ userId: 'u-jwt' }, 'veh1', {
        status: 'disabled',
      });
      expect(service.setStatus).toHaveBeenCalledWith(
        'veh1',
        'u-jwt',
        'disabled',
      );
      expect(r.message).toBe('Vehicle status updated successfully');
    });

    it('DELETE → service.softDeleteOwned(id, userId) + trả data:null', async () => {
      const r = await controller.remove({ userId: 'u-jwt' }, 'veh1');
      expect(service.softDeleteOwned).toHaveBeenCalledWith('veh1', 'u-jwt');
      expect(r).toEqual({
        success: true,
        message: 'Vehicle deleted successfully',
        data: null,
      });
    });

    it('cả 3 route UC2 guard = JwtAuthGuard (KHÔNG PermissionsGuard)', () => {
      for (const h of [
        controller.update,
        controller.updateStatus,
        controller.remove,
      ]) {
        const guards = Reflect.getMetadata('__guards__', h) ?? [];
        expect(guards).toContain(JwtAuthGuard);
        expect(guards).not.toContain(PermissionsGuard);
      }
    });
  });

  // ── UC3 (VPL-001): list + detail ──
  describe('UC3 routes', () => {
    const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };
    beforeEach(() => {
      service.list = jest.fn().mockResolvedValue({ items: [entity], meta });
      service.getDetail = jest.fn().mockResolvedValue(entity);
    });

    it('GET list → service.list(@CurrentUser().userId, query), map mapper + meta', async () => {
      const r = await controller.list(
        { userId: 'u-jwt' },
        { page: 1, limit: 20 },
      );
      expect(service.list).toHaveBeenCalledWith('u-jwt', {
        page: 1,
        limit: 20,
      });
      expect(r.data).toHaveLength(1);
      expect(r.data[0]).toMatchObject({ id: 'veh1', plate_number: '30A12345' });
      expect(r.meta).toEqual(meta);
      expect(r.message).toBe('Vehicle registrations retrieved');
    });

    it('GET detail → service.getDetail(id, userId) + mapper', async () => {
      const r = await controller.detail({ userId: 'u-jwt' }, 'veh1');
      expect(service.getDetail).toHaveBeenCalledWith('veh1', 'u-jwt');
      expect(r.data).toMatchObject({ id: 'veh1' });
      expect(r.message).toBe('Vehicle registration retrieved');
    });

    it('userId từ @CurrentUser (KHÔNG query/body); guard list = JwtAuthGuard', () => {
      const guards = Reflect.getMetadata('__guards__', controller.list) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).not.toContain(PermissionsGuard);
    });

    it('SEC-01: response route USER KHÔNG có khóa owner + KHÔNG gọi service.listAll', async () => {
      service.listAll = jest.fn();
      const r = await controller.list(
        { userId: 'u-jwt' },
        { page: 1, limit: 20 },
      );
      expect(r.data[0]).not.toHaveProperty('owner'); // dùng mapper user, không mapper admin
      expect(service.list).toHaveBeenCalledTimes(1);
      expect(service.list).toHaveBeenCalledWith('u-jwt', {
        page: 1,
        limit: 20,
      });
      expect(service.listAll).not.toHaveBeenCalled();
    });
  });

  // ── UC-101 (VPL-002): ADMIN list & tra cứu phương tiện ──
  describe('UC-101 admin vehicle-registrations', () => {
    const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };
    const adminEntity = {
      ...entity,
      user: { id: 'u1', fullName: 'Nguyen Van A', email: 'a@example.com' },
    };
    beforeEach(() => {
      service.listAll = jest
        .fn()
        .mockResolvedValue({ items: [adminEntity], meta });
    });

    it('GET admin/vehicle-registrations → service.listAll(query) + mapper admin (có owner) + meta', async () => {
      const query = { page: 1, limit: 20, user_id: 'u1' };
      const r = await controller.listAll(query);
      expect(service.listAll).toHaveBeenCalledWith(query);
      expect(r.data).toHaveLength(1);
      expect(r.data[0]).toMatchObject({
        id: 'veh1',
        plate_number: '30A12345',
        owner: {
          user_id: 'u1',
          full_name: 'Nguyen Van A',
          email: 'a@example.com',
        },
      });
      expect(r.meta).toEqual(meta);
      expect(r.message).toBe('Vehicle registrations retrieved');
    });

    it('admin-gate THẬT: JwtAuthGuard + PermissionsGuard + @RequirePermissions(admin_read)', () => {
      const guards =
        Reflect.getMetadata('__guards__', controller.listAll) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(PermissionsGuard);
      const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.listAll);
      expect(perms).toEqual(['anpr.vehicle.admin_read']);
    });

    it('route USER list KHÔNG có PERMISSIONS_KEY (chỉ JwtAuthGuard)', () => {
      const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.list);
      expect(perms).toBeUndefined();
    });
  });

  // ── UC6 (VUN-001): admin xem biển lạ ──
  describe('UC6 unknown vehicles', () => {
    const meta = { page: 1, limit: 20, total: 2, totalPages: 1 };
    const items = [{ plateNumber: '30A12345', channelId: 5 }];
    beforeEach(() => {
      unknownService.listUnknown = jest.fn().mockResolvedValue({ items, meta });
    });

    it('GET admin/unknown-vehicles → service.listUnknown(query) + envelope + meta', async () => {
      const r = await controller.listUnknown({ page: 1, limit: 20 });
      expect(unknownService.listUnknown).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
      });
      expect(r.data).toBe(items);
      expect(r.meta).toEqual(meta);
      expect(r.message).toBe('Unknown vehicles retrieved');
    });

    it('admin-gate THẬT: JwtAuthGuard + PermissionsGuard + @RequirePermissions(unknown_view)', () => {
      const guards =
        Reflect.getMetadata('__guards__', controller.listUnknown) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(PermissionsGuard);
      const perms = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.listUnknown,
      );
      expect(perms).toEqual([
        'anpr.vehicle.unknown_view',
        'vehicle_alert.read',
      ]);
    });
  });

  // ── UC7 (VHI-001): lịch sử ra/vào ──
  describe('UC7 vehicle history', () => {
    const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };
    const items = [{ plateNumber: '30A12345', direction: 'enter' }];
    beforeEach(() => {
      historyService.listForUser = jest.fn().mockResolvedValue({ items, meta });
      historyService.listAll = jest.fn().mockResolvedValue({ items, meta });
    });

    it('USER /vehicle-history → listForUser(@CurrentUser().userId, query) + envelope+meta', async () => {
      const r = await controller.historyOwn(
        { userId: 'u-jwt' },
        { page: 1, limit: 20 },
      );
      expect(historyService.listForUser).toHaveBeenCalledWith('u-jwt', {
        page: 1,
        limit: 20,
      });
      expect(r.data).toBe(items);
      expect(r.meta).toEqual(meta);
      expect(r.message).toBe('Vehicle history retrieved');
    });

    it('ADMIN /admin/vehicle-history → listAll(query) + envelope+meta', async () => {
      const r = await controller.historyAll({ page: 1, limit: 20 });
      expect(historyService.listAll).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
      });
      expect(r.data).toBe(items);
      expect(r.message).toBe('Vehicle history retrieved');
    });

    it('user route guard = chỉ JwtAuthGuard (KHÔNG PermissionsGuard)', () => {
      const guards =
        Reflect.getMetadata('__guards__', controller.historyOwn) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).not.toContain(PermissionsGuard);
    });

    it('admin route gate THẬT: PermissionsGuard + history_view hoặc gate.access.read', () => {
      const guards =
        Reflect.getMetadata('__guards__', controller.historyAll) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(PermissionsGuard);
      const perms = Reflect.getMetadata(
        ANY_PERMISSIONS_KEY,
        controller.historyAll,
      );
      expect(perms).toEqual(['anpr.vehicle.history_view', 'gate.access.read']);
    });
  });

  // ── T3b: @AllowPartnerAccount metadata (VPT-BE-07 / VPT-001) ──
  describe('T3b — @AllowPartnerAccount() metadata', () => {
    it('historyOwn() có metadata ALLOW_PARTNER_ACCOUNT_KEY = true', () => {
      expect(
        Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, controller.historyOwn),
      ).toBe(true);
    });

    it('list() có metadata ALLOW_PARTNER_ACCOUNT_KEY = true', () => {
      expect(
        Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, controller.list),
      ).toBe(true);
    });

    it('historyAll() KHÔNG có metadata ALLOW_PARTNER_ACCOUNT_KEY', () => {
      expect(
        Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, controller.historyAll),
      ).toBeFalsy();
    });

    it('listAll() KHÔNG có metadata ALLOW_PARTNER_ACCOUNT_KEY', () => {
      expect(
        Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, controller.listAll),
      ).toBeFalsy();
    });

    it('registerForUser() KHÔNG có metadata ALLOW_PARTNER_ACCOUNT_KEY', () => {
      expect(
        Reflect.getMetadata(
          ALLOW_PARTNER_ACCOUNT_KEY,
          controller.registerForUser,
        ),
      ).toBeFalsy();
    });
  });

  // ── T4b: removeAsAdmin (VPT-BE-05 / VPT-001) ──
  describe('T4b — removeAsAdmin()', () => {
    beforeEach(() => {
      service.adminSoftDelete = jest.fn().mockResolvedValue(undefined);
    });

    it('adminSoftDelete được gọi với đúng id + response envelope {success, message, data:null}', async () => {
      const r = await controller.removeAsAdmin('veh1');
      expect(service.adminSoftDelete).toHaveBeenCalledWith('veh1');
      expect(r).toEqual({
        success: true,
        message: 'Vehicle deleted successfully',
        data: null,
      });
    });

    it('id không tồn tại → service ném NotFoundException — controller không hòa tan exception', async () => {
      service.adminSoftDelete = jest.fn().mockRejectedValue(
        new NotFoundException({
          code: 'VEHICLE_NOT_FOUND_OR_FORBIDDEN',
          message: 'Không tìm thấy biển số',
        }),
      );
      await expect(
        controller.removeAsAdmin('not-exist'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(service.adminSoftDelete).toHaveBeenCalledWith('not-exist');
    });

    it('guard = JwtAuthGuard + PermissionsGuard; permission = [anpr.vehicle.admin_delete]', () => {
      const guards =
        Reflect.getMetadata('__guards__', controller.removeAsAdmin) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(PermissionsGuard);
      const perms = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.removeAsAdmin,
      );
      expect(perms).toEqual(['anpr.vehicle.admin_delete']);
    });
  });
});
