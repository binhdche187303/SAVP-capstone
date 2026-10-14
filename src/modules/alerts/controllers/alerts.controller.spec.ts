/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { ANY_PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { AlertsController } from './alerts.controller.js';

describe('AlertsController (ASC-001 / UC-123)', () => {
  let controller: AlertsController;
  let service: any;

  const alert = {
    id: 'a1',
    alertType: 'crowd',
    severity: 'high',
    zoneId: 'zone-1',
    status: 'new',
    triggeredAt: new Date('2026-07-23T00:00:00Z'),
    lastSeenAt: null,
    occurrenceCount: 1,
    sourceEventId: null,
    ruleId: null,
    payloadJson: null,
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: new Date('2026-07-23T00:00:00Z'),
    updatedAt: new Date('2026-07-23T00:00:00Z'),
  };

  beforeEach(() => {
    service = {
      list: jest.fn(),
      findDetail: jest.fn(),
      acknowledge: jest.fn().mockResolvedValue(alert),
      resolve: jest.fn().mockResolvedValue(alert),
      bulkAcknowledge: jest.fn(),
    };
    controller = new AlertsController(service);
  });

  it('class-level JwtAuthGuard + PermissionsGuard', () => {
    const guards = Reflect.getMetadata('__guards__', AlertsController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
  });

  it('GET list → service.list(query), envelope + meta', async () => {
    const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };
    service.list = jest.fn().mockResolvedValue({ items: [alert], meta });
    const query = { page: 1, limit: 20 } as any;
    const r = await controller.list(query);
    expect(service.list).toHaveBeenCalledWith(query);
    expect(r.data).toHaveLength(1);
    expect(r.data[0]).toMatchObject({ id: 'a1', alert_type: 'crowd' });
    expect(r.meta).toEqual(meta);
  });

  it('list route permission = security_alert.read hoặc gate.access.alert.handle', () => {
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, controller.list)).toEqual([
      'security_alert.read',
      'gate.access.alert.handle',
    ]);
  });

  it('GET detail → service.findDetail(id), gộp zone + history vào response', async () => {
    service.findDetail = jest.fn().mockResolvedValue({
      alert,
      zone: { id: 'zone-1', zoneCode: 'Z1', zoneName: 'Sảnh A' },
      history: [alert],
    });
    const r = await controller.detail('a1');
    expect(service.findDetail).toHaveBeenCalledWith('a1');
    expect(r.data).toMatchObject({ id: 'a1' });
    expect(r.data.zone).toEqual({
      id: 'zone-1',
      zone_code: 'Z1',
      zone_name: 'Sảnh A',
    });
    expect(r.data.history).toHaveLength(1);
  });

  it('detail route permission = security_alert.read hoặc gate.access.alert.handle', () => {
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, controller.detail)).toEqual(
      ['security_alert.read', 'gate.access.alert.handle'],
    );
  });

  it('POST acknowledge → service.acknowledge(id, userId)', async () => {
    const r = await controller.acknowledge({ userId: 'u1' }, 'a1');
    expect(service.acknowledge).toHaveBeenCalledWith('a1', 'u1');
    expect(r.message).toBe('Security alert acknowledged successfully');
  });

  it('acknowledge route permission = security_alert.acknowledge hoặc gate.access.alert.handle', () => {
    expect(
      Reflect.getMetadata(ANY_PERMISSIONS_KEY, controller.acknowledge),
    ).toEqual(['security_alert.acknowledge', 'gate.access.alert.handle']);
  });

  it('POST resolve → service.resolve(id, dto, userId)', async () => {
    const dto = { resolutionNote: 'báo động giả' };
    const r = await controller.resolve({ userId: 'u1' }, 'a1', dto);
    expect(service.resolve).toHaveBeenCalledWith('a1', dto, 'u1');
    expect(r.message).toBe('Security alert resolved successfully');
  });

  it('resolve route permission = security_alert.resolve hoặc gate.access.alert.handle', () => {
    expect(
      Reflect.getMetadata(ANY_PERMISSIONS_KEY, controller.resolve),
    ).toEqual(['security_alert.resolve', 'gate.access.alert.handle']);
  });

  it('POST bulk-acknowledge → service.bulkAcknowledge(ids, userId)', async () => {
    service.bulkAcknowledge = jest
      .fn()
      .mockResolvedValue({ acknowledged: ['a1'], alreadyProcessed: [] });
    const r = await controller.bulkAcknowledge(
      { userId: 'u1' },
      {
        ids: ['a1'],
      },
    );
    expect(service.bulkAcknowledge).toHaveBeenCalledWith(['a1'], 'u1');
    expect(r.data.acknowledged).toEqual(['a1']);
  });

  it('bulk-acknowledge route permission = security_alert.acknowledge hoặc gate.access.alert.handle', () => {
    expect(
      Reflect.getMetadata(ANY_PERMISSIONS_KEY, controller.bulkAcknowledge),
    ).toEqual(['security_alert.acknowledge', 'gate.access.alert.handle']);
  });
});
