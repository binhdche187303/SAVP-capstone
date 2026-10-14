/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/unbound-method */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import {
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from '../../auth/decorators/require-permissions.decorator.js';
import { ZonesController } from './zones.controller.js';
import type { CreateZoneDto } from '../dto/create-zone.dto.js';
import type { UpdateZoneDto } from '../dto/update-zone.dto.js';

describe('ZonesController (ZNC-001 / UC-90)', () => {
  let controller: ZonesController;
  let service: any;

  const entity = {
    id: 'z1',
    zoneCode: 'GATE-01',
    zoneName: 'Cổng chính',
    zoneType: 'gate',
    building: null,
    floor: null,
    description: null,
    metadataJson: null,
    status: 'active',
    createdAt: new Date('2026-07-22T00:00:00Z'),
    updatedAt: new Date('2026-07-22T00:00:00Z'),
    deletedAt: null,
  };

  const dto = {
    zoneCode: 'GATE-01',
    zoneName: 'Cổng chính',
    zoneType: 'gate',
  } as CreateZoneDto;

  beforeEach(() => {
    service = { create: jest.fn().mockResolvedValue(entity) };
    controller = new ZonesController(service);
  });

  it('POST /zones → service.create(dto) 1 lần + envelope {success,message,data} qua mapper', async () => {
    const r = await controller.create({ userId: 'u1' }, dto);

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create).toHaveBeenCalledWith(dto, 'u1');
    expect(r.success).toBe(true);
    expect(r.message).toBe('Zone created successfully');
    expect(r.data).toMatchObject({
      id: 'z1',
      zone_code: 'GATE-01',
      zone_name: 'Cổng chính',
      zone_type: 'gate',
      status: 'active',
    });
    // Mapper KHÔNG lộ deleted_at.
    expect(r.data).not.toHaveProperty('deleted_at');
  });

  it('gate THẬT: JwtAuthGuard + PermissionsGuard + @RequirePermissions("zones.zone.create")', () => {
    const guards = Reflect.getMetadata('__guards__', controller.create) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);

    // Thiếu metadata này = endpoint hở im lặng (PermissionsGuard return true).
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.create);
    expect(perms).toEqual(['zones.zone.create']);
  });

  it('route trả HTTP 201 (@HttpCode CREATED)', () => {
    const status = Reflect.getMetadata('__httpCode__', controller.create);
    expect(status).toBe(201);
  });

  it('service ném ConflictException → controller KHÔNG nuốt, lỗi propagate nguyên trạng', async () => {
    const conflict = new ConflictException({
      code: 'ZONE_CODE_EXISTS',
      message: 'Mã khu vực đã tồn tại',
    });
    service.create.mockRejectedValue(conflict);

    await expect(controller.create({ userId: 'u1' }, dto)).rejects.toBe(
      conflict,
    );
  });

  // ── UC-91 (ZNU-001): route PATCH /zones/:id ──
  describe('update (ZNU-001 / UC-91)', () => {
    const updateDto = { zoneName: 'Cổng chính (mới)' } as UpdateZoneDto;

    beforeEach(() => {
      service.update = jest
        .fn()
        .mockResolvedValue({ ...entity, zoneName: 'Cổng chính (mới)' });
    });

    it('gọi service.update(id, dto) 1 lần + envelope qua mapper', async () => {
      const r = await controller.update({ userId: 'u1' }, 'z1', updateDto);

      expect(service.update).toHaveBeenCalledTimes(1);
      expect(service.update).toHaveBeenCalledWith('z1', updateDto, 'u1');
      expect(r.success).toBe(true);
      expect(r.message).toBe('Zone updated successfully');
      expect(r.data).toMatchObject({
        id: 'z1',
        zone_code: 'GATE-01',
        zone_name: 'Cổng chính (mới)',
        status: 'active',
      });
      expect(r.data).not.toHaveProperty('deleted_at');
    });

    it('gate THẬT: JwtAuthGuard + PermissionsGuard + @RequirePermissions("zones.zone.update")', () => {
      const guards = Reflect.getMetadata('__guards__', controller.update) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(PermissionsGuard);

      const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.update);
      expect(perms).toEqual(['zones.zone.update']);
    });

    it('service ném NotFoundException → propagate nguyên trạng', async () => {
      const notFound = new NotFoundException({
        code: 'ZONE_NOT_FOUND',
        message: 'Không tìm thấy khu vực',
      });
      service.update.mockRejectedValue(notFound);

      await expect(
        controller.update({ userId: 'u1' }, 'missing', updateDto),
      ).rejects.toBe(notFound);
    });

    it('service ném ConflictException → propagate nguyên trạng', async () => {
      const conflict = new ConflictException({
        code: 'ZONE_CODE_EXISTS',
        message: 'Mã khu vực đã tồn tại',
      });
      service.update.mockRejectedValue(conflict);

      await expect(
        controller.update({ userId: 'u1' }, 'z1', updateDto),
      ).rejects.toBe(conflict);
    });

    it(':id không phải UUID → ParseUUIDPipe reject (400)', async () => {
      await expect(
        new ParseUUIDPipe().transform('abc', { type: 'param' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── UC-93 (ZNL-001): route GET /zones và GET /zones/:id ──
  describe('list & detail (ZNL-001 / UC-93)', () => {
    beforeEach(() => {
      service.list = jest.fn().mockResolvedValue({
        items: [entity],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
      service.getDetail = jest
        .fn()
        .mockResolvedValue({ zone: entity, devices: [] });
    });

    // Case 22
    it('GET /zones → service.list(query) 1 lần, envelope có meta NGANG HÀNG data', async () => {
      const query = { page: 1, limit: 20 } as any;

      const r = await controller.list(query);

      expect(service.list).toHaveBeenCalledTimes(1);
      expect(service.list).toHaveBeenCalledWith(query);
      expect(r.success).toBe(true);
      expect(r.message).toBe('Zones retrieved successfully');
      expect(Array.isArray(r.data)).toBe(true);
      expect(r.data[0]).toMatchObject({ id: 'z1', zone_code: 'GATE-01' });
      expect(r.data[0]).not.toHaveProperty('deleted_at');
      // meta ngang hàng data, KHÔNG lồng trong data.
      expect(r.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });

    it('GET /zones rỗng → data: [] và meta.total = 0 (không 404)', async () => {
      service.list.mockResolvedValue({
        items: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });

      const r = await controller.list({} as any);

      expect(r.data).toEqual([]);
      expect(r.meta.total).toBe(0);
    });

    // Case 23
    it('GET /zones/:id → service.getDetail(id), envelope KHÔNG có meta', async () => {
      const r = await controller.detail('z1');

      expect(service.getDetail).toHaveBeenCalledWith('z1');
      expect(r.message).toBe('Zone retrieved successfully');
      expect(r.data).toMatchObject({ id: 'z1', zone_code: 'GATE-01' });
      expect(r).not.toHaveProperty('meta');
    });

    // Case 24
    it('gate THẬT trên CẢ 2 handler: 2 guard + zones.zone.read hoặc gate.access.monitor', () => {
      for (const handler of [controller.list, controller.detail]) {
        const guards = Reflect.getMetadata('__guards__', handler) ?? [];
        expect(guards).toContain(JwtAuthGuard);
        expect(guards).toContain(PermissionsGuard);
        expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler)).toEqual([
          'zones.zone.read',
          'gate.access.monitor',
        ]);
      }
    });

    // Case 25
    it('service.getDetail ném NotFoundException → propagate nguyên trạng', async () => {
      const notFound = new NotFoundException({
        code: 'ZONE_NOT_FOUND',
        message: 'Không tìm thấy khu vực',
      });
      service.getDetail.mockRejectedValue(notFound);

      await expect(controller.detail('missing')).rejects.toBe(notFound);
    });
  });

  // ── UC-94 (ZNA-001): route gán / gỡ thiết bị ──
  describe('assignDevices & unassignDevice (ZNA-001 / UC-94)', () => {
    const dto = { deviceIds: ['d1', 'd2'] } as any;

    beforeEach(() => {
      service.assignDevices = jest
        .fn()
        .mockResolvedValue({ zone: entity, assignedDeviceIds: ['d1', 'd2'] });
      service.unassignDevice = jest
        .fn()
        .mockResolvedValue({ zone: entity, unassignedDeviceId: 'd1' });
    });

    // Case 20
    it('PATCH :id/devices → service.assignDevices(id, dto, userId) + envelope không lộ dữ liệu thiết bị', async () => {
      const r = await controller.assignDevices({ userId: 'u1' }, 'z1', dto);

      expect(service.assignDevices).toHaveBeenCalledTimes(1);
      expect(service.assignDevices).toHaveBeenCalledWith('z1', dto, 'u1');
      expect(r.success).toBe(true);
      expect(r.message).toBe('Devices assigned to zone successfully');
      expect(r.data.zone).toMatchObject({ id: 'z1', zone_code: 'GATE-01' });
      expect(r.data.zone).not.toHaveProperty('deleted_at');
      expect(r.data.assigned_device_ids).toEqual(['d1', 'd2']);
      // OQ-9: chỉ id, KHÔNG có tên/loại/trạng thái thiết bị.
      expect(JSON.stringify(r.data)).not.toContain('device_type');
      expect(JSON.stringify(r.data)).not.toContain('device_name');
    });

    // Case 21
    it('DELETE :id/devices/:deviceId → service.unassignDevice(id, deviceId, userId)', async () => {
      const r = await controller.unassignDevice({ userId: 'u1' }, 'z1', 'd1');

      expect(service.unassignDevice).toHaveBeenCalledWith('z1', 'd1', 'u1');
      expect(r.message).toBe('Device unassigned from zone successfully');
      expect(r.data.unassigned_device_id).toBe('d1');
      expect(r.data.zone).toMatchObject({ id: 'z1' });
    });

    // Case 22
    it('gate THẬT trên CẢ 2 handler: 2 guard + @RequirePermissions("zones.zone.assign_device")', () => {
      for (const handler of [
        controller.assignDevices,
        controller.unassignDevice,
      ]) {
        const guards = Reflect.getMetadata('__guards__', handler) ?? [];
        expect(guards).toContain(JwtAuthGuard);
        expect(guards).toContain(PermissionsGuard);
        expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
          'zones.zone.assign_device',
        ]);
      }
    });

    // Case 23
    it('lỗi từ service propagate nguyên trạng (404 và 409)', async () => {
      const notFound = new NotFoundException({ code: 'DEVICE_NOT_IN_ZONE' });
      service.unassignDevice.mockRejectedValue(notFound);
      await expect(
        controller.unassignDevice({ userId: 'u1' }, 'z1', 'd1'),
      ).rejects.toBe(notFound);

      const conflict = new ConflictException({ code: 'ZONE_INACTIVE' });
      service.assignDevices.mockRejectedValue(conflict);
      await expect(
        controller.assignDevices({ userId: 'u1' }, 'z1', dto),
      ).rejects.toBe(conflict);
    });
  });

  // ── UC-92 (ZND-001): route DELETE /zones/:id ──
  describe('remove (ZND-001 / UC-92)', () => {
    beforeEach(() => {
      service.remove = jest.fn().mockResolvedValue(undefined);
    });

    it('gọi service.remove(id, userId) 1 lần + envelope data:null', async () => {
      const r = await controller.remove({ userId: 'u1' }, 'z1');

      expect(service.remove).toHaveBeenCalledTimes(1);
      expect(service.remove).toHaveBeenCalledWith('z1', 'u1');
      expect(r).toEqual({
        success: true,
        message: 'Zone deleted successfully',
        data: null,
      });
    });

    it('gate THẬT: JwtAuthGuard + PermissionsGuard + @RequirePermissions("zones.zone.delete")', () => {
      const guards = Reflect.getMetadata('__guards__', controller.remove) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(PermissionsGuard);

      const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.remove);
      expect(perms).toEqual(['zones.zone.delete']);
    });

    it('service ném NotFoundException → propagate nguyên trạng', async () => {
      const notFound = new NotFoundException({
        code: 'ZONE_NOT_FOUND',
        message: 'Không tìm thấy khu vực',
      });
      service.remove.mockRejectedValue(notFound);

      await expect(controller.remove({ userId: 'u1' }, 'missing')).rejects.toBe(
        notFound,
      );
    });

    it('service ném ConflictException ZONE_HAS_DEVICES → propagate nguyên trạng', async () => {
      const conflict = new ConflictException({
        code: 'ZONE_HAS_DEVICES',
        message: 'Khu vực còn thiết bị được gán, hãy gỡ thiết bị trước khi xoá',
      });
      service.remove.mockRejectedValue(conflict);

      await expect(controller.remove({ userId: 'u1' }, 'z1')).rejects.toBe(
        conflict,
      );
    });
  });
});
