import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EquipmentService } from '../services/equipment.service.js';
import {
  EquipmentEntity,
  EquipmentType,
  AssetStatus,
  HealthStatus,
} from '../entities/equipment.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { ReportEquipmentFaultDto } from '../dto/report-equipment-fault.dto.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

/**
 * UC-62 — EquipmentService.reportFault: validate → transaction → audit fail-separate.
 * File test RIÊNG, không đụng equipment.service.spec.ts (UC-61).
 */
describe('EquipmentService.reportFault (UC-62)', () => {
  const equipmentId = 'eq-1';
  const userId = 'user-1';
  const ip = '127.0.0.1';

  function makeEquipment(
    overrides: Partial<EquipmentEntity> = {},
  ): EquipmentEntity {
    return {
      id: equipmentId,
      equipmentCode: 'EQP-001',
      equipmentName: 'May chieu',
      equipmentType: EquipmentType.DISPLAY,
      serialNumber: null,
      brand: null,
      model: null,
      purchaseDate: null,
      assetStatus: AssetStatus.AVAILABLE,
      healthStatus: HealthStatus.UNKNOWN,
      currentRoomId: null,
      assignedBy: null,
      assignedAt: null,
      installedAt: null,
      assignmentNote: null,
      iotDeviceId: null,
      lastMaintenanceAt: null,
      lastIssueReportedAt: null,
      lastIssueNote: null,
      specificationJson: null,
      createdAt: new Date('2026-07-13T00:00:00Z'),
      updatedAt: new Date('2026-07-13T00:00:00Z'),
      deletedAt: null,
      ...overrides,
    } as unknown as EquipmentEntity;
  }

  function dto(
    overrides: Partial<ReportEquipmentFaultDto> = {},
  ): ReportEquipmentFaultDto {
    return {
      issueNote: 'Man hinh khong len',
      ...overrides,
    };
  }

  function setup(opts: {
    equipment?: EquipmentEntity | null;
    auditFails?: boolean;
    room?: Record<string, unknown> | null;
  }) {
    const equipment =
      opts.equipment === undefined ? makeEquipment() : opts.equipment;

    const findOne = jest.fn().mockResolvedValue(equipment);

    const fakeEm = {
      create: jest.fn((_e: unknown, obj: Record<string, unknown>) => obj),
      save: jest.fn((_e: unknown, obj: Record<string, unknown>) =>
        Promise.resolve(obj),
      ),
    };

    let txCall = 0;
    const transaction = jest.fn((cb: (em: typeof fakeEm) => unknown) => {
      txCall += 1;
      // lần 1 = save entity; lần 2 = audit
      if (txCall === 2 && opts.auditFails) {
        return Promise.reject(new Error('audit db down'));
      }
      return Promise.resolve(cb(fakeEm));
    });

    const repo = {
      findOne,
    } as unknown as import('typeorm').Repository<EquipmentEntity>;
    const dataSource = {
      transaction,
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(opts.room ?? null),
        find: jest.fn().mockResolvedValue([]),
      })),
    } as unknown as import('typeorm').DataSource;

    const notificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-noop' }),
    } as unknown as NotificationsService;
    const service = new EquipmentService(
      repo,
      dataSource,
      notificationsService,
    );
    return {
      service,
      findOne,
      fakeEm,
      transaction,
      equipment,
      notificationsService,
    };
  }

  it('[S1] healthStatus=faulty OK → set faulty, lastIssueReportedAt, lastIssueNote', async () => {
    const { service, equipment } = setup({});
    const res = await service.reportFault(
      equipmentId,
      dto({ healthStatus: HealthStatus.FAULTY }),
      userId,
      ip,
    );
    expect(res.healthStatus).toBe(HealthStatus.FAULTY);
    expect((equipment as EquipmentEntity).lastIssueReportedAt).toBeInstanceOf(
      Date,
    );
    expect((equipment as EquipmentEntity).lastIssueNote).toBe(
      'Man hinh khong len',
    );
  });

  it('[S2] assetStatus=maintenance OK → set maintenance', async () => {
    const { service } = setup({});
    const res = await service.reportFault(
      equipmentId,
      dto({ assetStatus: AssetStatus.MAINTENANCE }),
      userId,
      ip,
    );
    expect(res.assetStatus).toBe(AssetStatus.MAINTENANCE);
  });

  it('[S3] ca 2 status trong → 422 FAULT_NO_CHANGE (KHONG load, KHONG transaction)', async () => {
    const { service, findOne, transaction } = setup({});
    await expect(
      service.reportFault(equipmentId, dto({}), userId, ip),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(findOne).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('[S4] thiet bi khong ton tai → 404 EQUIPMENT_NOT_FOUND', async () => {
    const { service } = setup({ equipment: null });
    await expect(
      service.reportFault(
        equipmentId,
        dto({ healthStatus: HealthStatus.FAULTY }),
        userId,
        ip,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('[S5] retired/lost → 409 EQUIPMENT_NOT_REPORTABLE', async () => {
    const retired = setup({
      equipment: makeEquipment({ assetStatus: AssetStatus.RETIRED }),
    });
    await expect(
      retired.service.reportFault(
        equipmentId,
        dto({ healthStatus: HealthStatus.FAULTY }),
        userId,
        ip,
      ),
    ).rejects.toThrow(ConflictException);

    const lost = setup({
      equipment: makeEquipment({ assetStatus: AssetStatus.LOST }),
    });
    await expect(
      lost.service.reportFault(
        equipmentId,
        dto({ assetStatus: AssetStatus.MAINTENANCE }),
        userId,
        ip,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('[S6] currentRoomId giu nguyen sau khi chuyen maintenance', async () => {
    const { service } = setup({
      equipment: makeEquipment({
        assetStatus: AssetStatus.ASSIGNED,
        currentRoomId: 'room-1',
      }),
    });
    const res = await service.reportFault(
      equipmentId,
      dto({ assetStatus: AssetStatus.MAINTENANCE }),
      userId,
      ip,
    );
    expect(res.assetStatus).toBe(AssetStatus.MAINTENANCE);
    expect(res.currentRoomId).toBe('room-1');
  });

  it('[S9] assetStatus=active + currentRoomId null → AVAILABLE', async () => {
    const { service } = setup({
      equipment: makeEquipment({
        assetStatus: AssetStatus.MAINTENANCE,
        currentRoomId: null,
      }),
    });
    const res = await service.reportFault(
      equipmentId,
      dto({ assetStatus: 'active' }),
      userId,
      ip,
    );
    expect(res.assetStatus).toBe(AssetStatus.AVAILABLE);
  });

  it('[S10] assetStatus=active + currentRoomId set → ASSIGNED', async () => {
    const { service } = setup({
      equipment: makeEquipment({
        assetStatus: AssetStatus.MAINTENANCE,
        currentRoomId: 'room-1',
      }),
    });
    const res = await service.reportFault(
      equipmentId,
      dto({ assetStatus: 'active' }),
      userId,
      ip,
    );
    expect(res.assetStatus).toBe(AssetStatus.ASSIGNED);
  });

  it('[S11] assetStatus=retired → RETIRED', async () => {
    const { service } = setup({});
    const res = await service.reportFault(
      equipmentId,
      dto({ assetStatus: 'retired' }),
      userId,
      ip,
    );
    expect(res.assetStatus).toBe(AssetStatus.RETIRED);
  });

  it('[S7] KHONG set lastMaintenanceAt', async () => {
    const old = new Date('2026-01-01T00:00:00Z');
    const { service, equipment } = setup({
      equipment: makeEquipment({ lastMaintenanceAt: old }),
    });
    await service.reportFault(
      equipmentId,
      dto({ healthStatus: HealthStatus.FAULTY }),
      userId,
      ip,
    );
    // lastMaintenanceAt khong bi thay doi
    expect((equipment as EquipmentEntity).lastMaintenanceAt).toBe(old);
  });

  it('[S8] audit fail-separate → entity da luu, reportFault van resolve (khong throw)', async () => {
    const { service, transaction, fakeEm } = setup({ auditFails: true });
    const res = await service.reportFault(
      equipmentId,
      dto({ healthStatus: HealthStatus.FAULTY }),
      userId,
      ip,
    );
    expect(res.healthStatus).toBe(HealthStatus.FAULTY);
    // transaction goi 2 lan: Phase B (save) resolve + Phase C (audit) reject
    expect(transaction).toHaveBeenCalledTimes(2);
    // Phase B da luu EquipmentEntity
    const savedEntity = fakeEm.save.mock.calls.find(
      (c) => c[0] === EquipmentEntity,
    );
    expect(savedEntity).toBeDefined();
    // audit khong duoc luu (transaction reject truoc khi em.save AuditLog)
    const savedAudit = fakeEm.save.mock.calls.find(
      (c) => c[0] === AuditLogEntity,
    );
    expect(savedAudit).toBeUndefined();
  });
  it('[S12] luu vi tri (phong + site) luc bao hong vao audit + thong bao', async () => {
    const { service, fakeEm, notificationsService } = setup({
      equipment: makeEquipment({ currentRoomId: 'room-1' }),
      room: {
        id: 'room-1',
        roomName: 'Phong hop A101',
        siteName: 'Toa nha A',
        areaName: 'Tang 1',
      },
    });
    await service.reportFault(
      equipmentId,
      dto({ healthStatus: HealthStatus.FAULTY }),
      userId,
      ip,
    );
    const audit = fakeEm.save.mock.calls.find(
      (c) => c[0] === AuditLogEntity,
    )?.[1] as { newValueJson: Record<string, unknown> };
    expect(audit.newValueJson.location).toEqual({
      roomId: 'room-1',
      roomName: 'Phong hop A101',
      siteName: 'Toa nha A',
      areaName: 'Tang 1',
    });
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          'tại phòng Phong hop A101 - Toa nha A',
        ) as string,
      }),
    );
  });
});
