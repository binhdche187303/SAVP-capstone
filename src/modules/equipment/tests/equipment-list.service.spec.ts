import { EquipmentService } from '../services/equipment.service.js';
import {
  EquipmentType,
  AssetStatus,
  HealthStatus,
} from '../entities/equipment.entity.js';
import { ListEquipmentsQueryDto } from '../dto/list-equipments-query.dto.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

/**
 * UC-64 — EquipmentService.listEquipments: filter AND + Brackets search + SORT_MAP + phân trang.
 * File test RIÊNG, không đụng test UC-61/62/63.
 */
describe('EquipmentService.listEquipments (UC-64)', () => {
  function makeRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'eq-1',
      equipmentCode: 'EQP-001',
      equipmentName: 'May chieu',
      equipmentType: EquipmentType.DISPLAY,
      serialNumber: 'SN-1',
      brand: 'Epson',
      model: 'X1',
      purchaseDate: null,
      assetStatus: AssetStatus.AVAILABLE,
      healthStatus: HealthStatus.UNKNOWN,
      currentRoomId: null,
      createdAt: new Date('2026-07-13T00:00:00Z'),
      ...overrides,
    };
  }

  function setup(rows: unknown[] = [makeRow()], total = 1) {
    const qb: Record<string, jest.Mock> = {};
    for (const m of [
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ]) {
      qb[m] = jest.fn(() => qb);
    }
    qb.getManyAndCount = jest.fn().mockResolvedValue([rows, total]);

    const equipmentRepo = {
      createQueryBuilder: jest.fn(() => qb),
    } as unknown as import('typeorm').Repository<never>;
    const dataSource = {} as unknown as import('typeorm').DataSource;

    const notificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-noop' }),
    } as unknown as NotificationsService;
    const service = new EquipmentService(
      equipmentRepo,
      dataSource,
      notificationsService,
    );
    return { service, qb };
  }

  function q(
    overrides: Partial<ListEquipmentsQueryDto> = {},
  ): ListEquipmentsQueryDto {
    return { ...overrides };
  }

  // Lấy các câu andWhere dạng string (bỏ qua Brackets)
  function andWhereStrings(qb: Record<string, jest.Mock>): string[] {
    return qb.andWhere.mock.calls
      .map((c: unknown[]) => c[0])
      .filter((x): x is string => typeof x === 'string');
  }

  it('[S1] khong filter → where deletedAt IS NULL + getManyAndCount + map 12 field DTO', async () => {
    const { service, qb } = setup();
    const res = await service.listEquipments(q());
    expect(qb.where).toHaveBeenCalledWith('e.deletedAt IS NULL');
    expect(qb.getManyAndCount).toHaveBeenCalled();
    expect(res.total).toBe(1);
    expect(res.data[0]).toEqual({
      id: 'eq-1',
      equipmentCode: 'EQP-001',
      equipmentName: 'May chieu',
      equipmentType: EquipmentType.DISPLAY,
      serialNumber: 'SN-1',
      brand: 'Epson',
      model: 'X1',
      purchaseDate: null,
      assetStatus: AssetStatus.AVAILABLE,
      healthStatus: HealthStatus.UNKNOWN,
      currentRoomId: null,
      createdAt: new Date('2026-07-13T00:00:00Z'),
    });
  });

  it('[S2] equipmentType → andWhere e.equipmentType IN', async () => {
    const { service, qb } = setup();
    await service.listEquipments(q({ equipmentType: EquipmentType.CAMERA }));
    expect(andWhereStrings(qb)).toContain(
      'e.equipmentType IN (:...equipmentType)',
    );
  });

  it('[S3] assetStatus → andWhere e.assetStatus', async () => {
    const { service, qb } = setup();
    await service.listEquipments(q({ assetStatus: AssetStatus.MAINTENANCE }));
    expect(andWhereStrings(qb)).toContain('e.assetStatus = :assetStatus');
  });

  it('[S4] healthStatus → andWhere e.healthStatus IN', async () => {
    const { service, qb } = setup();
    await service.listEquipments(q({ healthStatus: HealthStatus.FAULTY }));
    expect(andWhereStrings(qb)).toContain(
      'e.healthStatus IN (:...healthStatus)',
    );
  });

  it('[S5] currentRoomId → andWhere e.currentRoomId', async () => {
    const { service, qb } = setup();
    await service.listEquipments(q({ currentRoomId: 'room-1' }));
    expect(andWhereStrings(qb)).toContain('e.currentRoomId = :currentRoomId');
  });

  it('[S6] search → andWhere(Brackets) ILIKE 3 cot', async () => {
    const { service, qb } = setup();
    await service.listEquipments(q({ search: 'EQP' }));
    // arg cuoi cua andWhere la Brackets (co whereFactory)
    const bracketsArg = qb.andWhere.mock.calls
      .map((c: unknown[]) => c[0])
      .find((x) => x && typeof x === 'object' && 'whereFactory' in x) as
      | { whereFactory: (w: unknown) => void }
      | undefined;
    expect(bracketsArg).toBeDefined();

    // Chay callback de bat cot ILIKE
    const sqls: string[] = [];
    const fakeW: Record<string, (s: string) => unknown> = {
      where: (s: string) => {
        sqls.push(s);
        return fakeW;
      },
      orWhere: (s: string) => {
        sqls.push(s);
        return fakeW;
      },
    };
    bracketsArg!.whereFactory(fakeW);
    expect(sqls).toEqual([
      'e.equipmentCode ILIKE :s',
      'e.equipmentName ILIKE :s',
      'e.serialNumber ILIKE :s',
    ]);
  });

  it('[S7] SORT_MAP — sortBy hop le map dung cot; sortBy la → fallback createdAt', async () => {
    const a = setup();
    await a.service.listEquipments(
      q({ sortBy: 'equipmentName', sortOrder: 'asc' }),
    );
    expect(a.qb.orderBy).toHaveBeenCalledWith('e.equipmentName', 'ASC');

    const b = setup();
    // sortBy la (nhu the input vuot DTO) → fallback e.createdAt (KHONG dung input tho)
    await b.service.listEquipments(q({ sortBy: 'e.id; DROP TABLE' }));
    expect(b.qb.orderBy).toHaveBeenCalledWith('e.createdAt', 'DESC');
  });

  it('[S8] sort mac dinh createdAt desc', async () => {
    const { service, qb } = setup();
    await service.listEquipments(q());
    expect(qb.orderBy).toHaveBeenCalledWith('e.createdAt', 'DESC');
  });

  it('[S8b] sort theo loai thi tiep tuc sort ten thiet bi A-Z', async () => {
    const { service, qb } = setup();
    await service.listEquipments(
      q({ sortBy: 'equipmentType', sortOrder: 'asc' }),
    );
    expect(qb.orderBy).toHaveBeenCalledWith('e.equipmentType', 'ASC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('e.equipmentName', 'ASC');
  });

  it('[S9] phan trang — skip/take + total tu getManyAndCount', async () => {
    const { service, qb } = setup([makeRow(), makeRow({ id: 'eq-2' })], 25);
    const res = await service.listEquipments(q({ page: 3, limit: 5 }));
    expect(qb.skip).toHaveBeenCalledWith(10); // (3-1)*5
    expect(qb.take).toHaveBeenCalledWith(5);
    expect(res.total).toBe(25);
  });

  it('[S10] ket hop nhieu filter → nhieu andWhere (AND)', async () => {
    const { service, qb } = setup();
    await service.listEquipments(
      q({
        equipmentType: EquipmentType.DISPLAY,
        assetStatus: AssetStatus.AVAILABLE,
        healthStatus: HealthStatus.HEALTHY,
      }),
    );
    const strs = andWhereStrings(qb);
    expect(strs).toContain('e.equipmentType IN (:...equipmentType)');
    expect(strs).toContain('e.assetStatus = :assetStatus');
    expect(strs).toContain('e.healthStatus IN (:...healthStatus)');
  });
});
