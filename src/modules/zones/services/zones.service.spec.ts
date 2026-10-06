/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Not, DataSource } from 'typeorm';
import { ZoneEntity } from '../entities/zone.entity.js';
import { ZonesService } from './zones.service.js';
import { ZonesAuditRepository } from '../repositories/zones-audit.repository.js';
import { IotDevicesService } from '../../iot/services/iot-devices.service.js';
import type { CreateZoneDto } from '../dto/create-zone.dto.js';

const dto = (over: Partial<CreateZoneDto> = {}): CreateZoneDto => ({
  zoneCode: 'GATE-01',
  zoneName: 'Cổng chính',
  zoneType: 'gate',
  ...over,
});

describe('ZonesService (ZNC-001 / UC-90)', () => {
  let service: ZonesService;
  let repo: any;
  let queryBuilder: any;
  let queryRunner: any;
  let dataSource: any;
  let auditRepo: any;
  let iotDevicesService: any;

  beforeEach(async () => {
    // UC-93 (read-only): bổ sung findAndCount + createQueryBuilder vào mock repo dùng chung.
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve({ id: 'z1', ...x })),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    // UC-92: ghi DB chuyển vào transaction ⇒ save/softDelete nằm ở qr.manager.
    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        save: jest.fn((_entity: any, x: any) =>
          Promise.resolve({ id: 'z1', ...x }),
        ),
        softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
        query: jest.fn(),
      },
    };
    dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    auditRepo = {
      logZoneCreation: jest.fn(),
      logZoneUpdate: jest.fn(),
      logZoneDeletion: jest.fn(),
      // UC-94.
      logZoneAssignDevices: jest.fn(),
      logZoneUnassignDevice: jest.fn(),
    };
    iotDevicesService = {
      countByZoneId: jest.fn().mockResolvedValue(0),
      // UC-94: API đọc + ghi cho cross-module.
      findAssignableByIds: jest.fn().mockResolvedValue([]),
      setZoneForDevices: jest.fn().mockResolvedValue({ affected: 0 }),
      // UC-93 (BE-fix): GET /zones/:id trả kèm danh sách thiết bị.
      findByZoneId: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZonesService,
        { provide: getRepositoryToken(ZoneEntity), useValue: repo },
        { provide: DataSource, useValue: dataSource },
        { provide: ZonesAuditRepository, useValue: auditRepo },
        { provide: IotDevicesService, useValue: iotDevicesService },
      ],
    }).compile();
    service = module.get(ZonesService);
  });

  // Case 1
  it('happy path → save 1 lần, zone_code chuẩn hóa, optional = null, KHÔNG set status/id/deletedAt', async () => {
    const result = await service.create(dto({ zoneCode: ' gate-01 ' }), 'u1');

    expect(queryRunner.manager.save).toHaveBeenCalledTimes(1);
    const created = repo.create.mock.calls[0][0];
    expect(created.zoneCode).toBe('GATE-01');
    expect(created.zoneName).toBe('Cổng chính');
    expect(created.zoneType).toBe('gate');
    expect(created.building).toBeNull();
    expect(created.floor).toBeNull();
    expect(created.description).toBeNull();
    expect(created.metadataJson).toBeNull();
    expect(created.latitude).toBeNull();
    expect(created.longitude).toBeNull();
    // status/id/timestamps/deletedAt do DB + entity default lo — service KHÔNG đụng.
    expect(created).not.toHaveProperty('status');
    expect(created).not.toHaveProperty('id');
    expect(created).not.toHaveProperty('deletedAt');
    expect(result.id).toBe('z1');
  });

  // Case 2
  it('trùng zone_code đang sống → 409 ZONE_CODE_EXISTS, KHÔNG save', async () => {
    repo.findOne.mockResolvedValue({ id: 'old', zoneCode: 'GATE-01' });

    await expect(service.create(dto(), 'u1')).rejects.toMatchObject({
      response: { code: 'ZONE_CODE_EXISTS' },
    });
    await expect(service.create(dto(), 'u1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(queryRunner.manager.save).not.toHaveBeenCalled();
  });

  // Case 3
  it('race 23505 (pre-check lọt, DB chặn) → 409 ZONE_CODE_EXISTS, không rò driverError/stack', async () => {
    repo.findOne.mockResolvedValue(null);
    queryRunner.manager.save.mockRejectedValue(
      Object.assign(
        new Error('duplicate key value violates unique constraint'),
        {
          driverError: {
            code: '23505',
            detail: 'Key (zone_code)=(GATE-01) exists.',
          },
        },
      ),
    );

    try {
      await service.create(dto(), 'u1');
      fail('should throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      // Cùng payload với nhánh pre-check (case 2).
      expect(e.response).toMatchObject({
        code: 'ZONE_CODE_EXISTS',
        message: 'Mã khu vực đã tồn tại',
      });
      const serialized = JSON.stringify(e.response);
      expect(serialized).not.toContain('23505');
      expect(serialized).not.toContain('duplicate key');
    }
  });

  // Case 4
  it('lỗi DB khác 23505 (vd 23503) → ném NGUYÊN lỗi, KHÔNG nuốt thành 409', async () => {
    const dbError = Object.assign(new Error('fk violation'), {
      driverError: { code: '23503' },
    });
    queryRunner.manager.save.mockRejectedValue(dbError);

    await expect(service.create(dto(), 'u1')).rejects.toBe(dbError);
    await expect(service.create(dto(), 'u1')).rejects.not.toBeInstanceOf(
      ConflictException,
    );
  });

  // Case 5 — bảo vệ OQ-3
  it('mã của zone đã soft-delete vẫn tạo được: pre-check lọc deletedAt IS NULL', async () => {
    repo.findOne.mockResolvedValue(null); // bản ghi cũ đã xóa-mềm → không lọt vào where

    const result = await service.create(dto({ zoneCode: 'GATE-01' }), 'u1');

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { zoneCode: 'GATE-01', deletedAt: IsNull() },
    });
    expect(queryRunner.manager.save).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('z1');
  });

  // Case 6
  it('chuẩn hóa nhất quán: cùng giá trị dùng cho CẢ pre-check và bản ghi lưu', async () => {
    await service.create(dto({ zoneCode: '  gate-01  ' }), 'u1');

    expect(repo.findOne.mock.calls[0][0].where.zoneCode).toBe('GATE-01');
    expect(repo.create.mock.calls[0][0].zoneCode).toBe('GATE-01');

    jest.clearAllMocks();
    repo.findOne.mockResolvedValue(null);
    repo.create.mockImplementation((x: any) => x);
    queryRunner.manager.save.mockImplementation((_e: any, x: any) =>
      Promise.resolve({ id: 'z2', ...x }),
    );
    dataSource.createQueryRunner.mockReturnValue(queryRunner);

    await service.create(dto({ zoneCode: 'GATE-01' }), 'u1');
    expect(repo.findOne.mock.calls[0][0].where.zoneCode).toBe('GATE-01');
    expect(repo.create.mock.calls[0][0].zoneCode).toBe('GATE-01');
  });

  it('field optional có giá trị → giữ nguyên (không ép null)', async () => {
    await service.create(
      dto({
        building: 'A',
        floor: 'B1',
        description: 'Cổng phía Đông',
        metadataJson: { lane: 2 },
      }),
      'u1',
    );

    const created = repo.create.mock.calls[0][0];
    expect(created.building).toBe('A');
    expect(created.floor).toBe('B1');
    expect(created.description).toBe('Cổng phía Đông');
    expect(created.metadataJson).toEqual({ lane: 2 });
  });

  it('tạo kèm toạ độ đủ cặp → ghi latitude/longitude', async () => {
    await service.create(dto({ latitude: 21.0285, longitude: 105.8542 }), 'u1');

    const created = repo.create.mock.calls[0][0];
    expect(created.latitude).toBe(21.0285);
    expect(created.longitude).toBe(105.8542);
  });

  it('tạo với toạ độ thiếu 1 nửa → 400 ZONE_COORDINATES_INCOMPLETE, KHÔNG save', async () => {
    await expect(
      service.create(dto({ longitude: 105.8542 }), 'u1'),
    ).rejects.toMatchObject({
      response: { code: 'ZONE_COORDINATES_INCOMPLETE' },
    });
    expect(queryRunner.manager.save).not.toHaveBeenCalled();
  });

  // ── UC-91 (ZNU-001): update ──
  describe('update (ZNU-001 / UC-91)', () => {
    const makeZone = (over: Record<string, any> = {}) => ({
      id: 'z1',
      zoneCode: 'GATE-01',
      zoneName: 'Cổng chính',
      zoneType: 'gate',
      status: 'active',
      building: null,
      floor: null,
      description: null,
      metadataJson: null,
      deletedAt: null,
      ...over,
    });

    beforeEach(() => {
      // UC-92: ghi chuyển vào transaction ⇒ mock target là qr.manager.save(Entity, obj).
      queryRunner.manager.save = jest.fn((_e: any, x: any) =>
        Promise.resolve(x),
      );
    });

    // Case 1
    it('happy path: đổi zone_name + building → save 1 lần, field khác giữ nguyên', async () => {
      const zone = makeZone();
      repo.findOne.mockResolvedValueOnce(zone);

      const r = await service.update(
        'z1',
        { zoneName: 'Cổng chính (mới)', building: 'A' },
        'u1',
      );

      expect(queryRunner.manager.save).toHaveBeenCalledTimes(1);
      expect(r.zoneName).toBe('Cổng chính (mới)');
      expect(r.building).toBe('A');
      expect(r.zoneCode).toBe('GATE-01');
      expect(r.zoneType).toBe('gate');
      expect(r.status).toBe('active');
    });

    // Case 2
    it('404 ZONE_NOT_FOUND khi zone không tồn tại, KHÔNG save', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.update('missing', { zoneName: 'x' }, 'u1'),
      ).rejects.toMatchObject({ response: { code: 'ZONE_NOT_FOUND' } });
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
    });

    // Case 3
    it('404 khi zone đã soft-delete: lookup lọc deletedAt IS NULL', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.update('z-deleted', { zoneName: 'x' }, 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'z-deleted', deletedAt: IsNull() },
      });
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
    });

    // Case 4
    it('đổi zone_code trùng zone khác → 409 ZONE_CODE_EXISTS, KHÔNG save', async () => {
      repo.findOne
        .mockResolvedValueOnce(makeZone()) // load
        .mockResolvedValueOnce({ id: 'z2', zoneCode: 'GATE-02' }); // pre-check

      await expect(
        service.update('z1', { zoneCode: 'GATE-02' }, 'u1'),
      ).rejects.toMatchObject({ response: { code: 'ZONE_CODE_EXISTS' } });

      // Pre-check PHẢI loại chính bản ghi đang sửa + lọc soft-delete.
      expect(repo.findOne).toHaveBeenLastCalledWith({
        where: { zoneCode: 'GATE-02', deletedAt: IsNull(), id: Not('z1') },
      });
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
    });

    // Case 5 — bảo vệ Not(id) + điều kiện "mã thực sự đổi"
    it('gửi lại ĐÚNG zone_code của chính nó → KHÔNG 409, KHÔNG chạy pre-check', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone());

      const r = await service.update('z1', { zoneCode: 'gate-01' }, 'u1');

      // Chỉ 1 lần findOne = chỉ có lượt load, pre-check bị bỏ qua.
      expect(repo.findOne).toHaveBeenCalledTimes(1);
      expect(queryRunner.manager.save).not.toHaveBeenCalled(); // mã sau chuẩn hóa không đổi → no-op
      expect(r.zoneCode).toBe('GATE-01');
    });

    // Case 6
    it('race 23505 → 409 ZONE_CODE_EXISTS, không rò driverError/stack', async () => {
      repo.findOne
        .mockResolvedValueOnce(makeZone())
        .mockResolvedValueOnce(null);
      queryRunner.manager.save.mockRejectedValue(
        Object.assign(
          new Error('duplicate key value violates unique constraint'),
          { driverError: { code: '23505' } },
        ),
      );

      try {
        await service.update('z1', { zoneCode: 'GATE-09' }, 'u1');
        fail('should throw');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.response).toMatchObject({
          code: 'ZONE_CODE_EXISTS',
          message: 'Mã khu vực đã tồn tại',
        });
        const serialized = JSON.stringify(e.response);
        expect(serialized).not.toContain('23505');
        expect(serialized).not.toContain('duplicate key');
      }
    });

    // Case 7
    it('lỗi DB khác 23505 → ném NGUYÊN lỗi, KHÔNG thành 409', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone());
      const dbError = Object.assign(new Error('fk violation'), {
        driverError: { code: '23503' },
      });
      queryRunner.manager.save.mockRejectedValue(dbError);

      await expect(service.update('z1', { zoneName: 'x' }, 'u1')).rejects.toBe(
        dbError,
      );
    });

    // Case 8
    it('no-op: body rỗng → KHÔNG save, trả entity nguyên trạng', async () => {
      const zone = makeZone();
      repo.findOne.mockResolvedValueOnce(zone);

      const r = await service.update('z1', {}, 'u1');

      expect(queryRunner.manager.save).not.toHaveBeenCalled();
      expect(r).toBe(zone);
    });

    // Case 9 — chứng minh so-sánh-giá-trị-thật (không chỉ dựa vào undefined)
    it('no-op: gửi đúng giá trị đang có → KHÔNG save', async () => {
      const zone = makeZone();
      repo.findOne.mockResolvedValueOnce(zone);

      const r = await service.update(
        'z1',
        { zoneName: 'Cổng chính', zoneType: 'gate', status: 'active' },
        'u1',
      );

      expect(queryRunner.manager.save).not.toHaveBeenCalled();
      expect(r).toBe(zone);
    });

    // Case 10
    it('undefined → giữ nguyên field không gửi', async () => {
      const zone = makeZone({
        building: 'A',
        floor: 'B1',
        description: 'desc',
        metadataJson: { lane: 1 },
      });
      repo.findOne.mockResolvedValueOnce(zone);

      const r = await service.update('z1', { zoneName: 'Tên mới' }, 'u1');

      expect(r.zoneName).toBe('Tên mới');
      expect(r.building).toBe('A');
      expect(r.floor).toBe('B1');
      expect(r.description).toBe('desc');
      expect(r.metadataJson).toEqual({ lane: 1 });
      expect(r.zoneType).toBe('gate');
      expect(r.status).toBe('active');
    });

    // Case 11
    it('null → xóa giá trị (set NULL) cho field nullable', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone({ building: 'A' }));

      const r = await service.update('z1', { building: null }, 'u1');

      expect(queryRunner.manager.save).toHaveBeenCalledTimes(1);
      expect(r.building).toBeNull();
    });

    // Case 12
    it('chuẩn hóa zone_code: cùng giá trị dùng cho CẢ pre-check và save', async () => {
      repo.findOne
        .mockResolvedValueOnce(makeZone())
        .mockResolvedValueOnce(null);

      const r = await service.update('z1', { zoneCode: '  gate-02  ' }, 'u1');

      expect(repo.findOne.mock.calls[1][0].where.zoneCode).toBe('GATE-02');
      expect(queryRunner.manager.save.mock.calls[0][1].zoneCode).toBe(
        'GATE-02',
      );
      expect(r.zoneCode).toBe('GATE-02');
    });

    // Case 13
    it('metadata_json REPLACE toàn bộ (không merge sâu)', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone({ metadataJson: { a: 1 } }));

      const r = await service.update('z1', { metadataJson: { b: 2 } }, 'u1');

      expect(queryRunner.manager.save).toHaveBeenCalledTimes(1);
      expect(r.metadataJson).toEqual({ b: 2 });
      expect(r.metadataJson).not.toHaveProperty('a');
    });

    // Case 14 — OQ-3: status đi chung route update
    it('đổi status active → inactive: save được gọi, field khác giữ nguyên', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone());

      const r = await service.update('z1', { status: 'inactive' }, 'u1');

      expect(queryRunner.manager.save).toHaveBeenCalledTimes(1);
      expect(r.status).toBe('inactive');
      expect(r.zoneCode).toBe('GATE-01');
      expect(r.zoneName).toBe('Cổng chính');
      expect(r.zoneType).toBe('gate');
    });

    // Case 15 — OQ-1: cho phép sửa zone_type
    it('đổi zone_type room → gate: save được gọi, giá trị mới được ghi', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone({ zoneType: 'room' }));

      const r = await service.update('z1', { zoneType: 'gate' }, 'u1');

      expect(queryRunner.manager.save).toHaveBeenCalledTimes(1);
      expect(r.zoneType).toBe('gate');
      expect(r.zoneCode).toBe('GATE-01');
    });

    // ── Toạ độ GPS (Bản đồ khuôn viên) ──
    it('đặt toạ độ lần đầu (đủ cặp) → save với latitude/longitude mới', async () => {
      repo.findOne.mockResolvedValueOnce(
        makeZone({ latitude: null, longitude: null }),
      );

      const r = await service.update(
        'z1',
        { latitude: 21.0285, longitude: 105.8542 },
        'u1',
      );

      expect(queryRunner.manager.save).toHaveBeenCalledTimes(1);
      expect(r.latitude).toBe(21.0285);
      expect(r.longitude).toBe(105.8542);
    });

    it('chỉ gửi 1 nửa cặp khi zone chưa có toạ độ → 400 ZONE_COORDINATES_INCOMPLETE, KHÔNG save', async () => {
      repo.findOne.mockResolvedValueOnce(
        makeZone({ latitude: null, longitude: null }),
      );

      await expect(
        service.update('z1', { latitude: 21.0285 }, 'u1'),
      ).rejects.toMatchObject({
        response: { code: 'ZONE_COORDINATES_INCOMPLETE' },
      });
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
    });

    it('zone đã có toạ độ: sửa riêng latitude → hợp lệ (gộp với longitude đang có)', async () => {
      repo.findOne.mockResolvedValueOnce(
        makeZone({ latitude: 21, longitude: 105 }),
      );

      const r = await service.update('z1', { latitude: 21.5 }, 'u1');

      expect(r.latitude).toBe(21.5);
      expect(r.longitude).toBe(105);
    });

    it('xoá chỉ 1 nửa cặp → 400; xoá cả cặp (null, null) → OK', async () => {
      repo.findOne.mockResolvedValueOnce(
        makeZone({ latitude: 21, longitude: 105 }),
      );
      await expect(
        service.update('z1', { latitude: null }, 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);

      repo.findOne.mockResolvedValueOnce(
        makeZone({ latitude: 21, longitude: 105 }),
      );
      const r = await service.update(
        'z1',
        { latitude: null, longitude: null },
        'u1',
      );
      expect(r.latitude).toBeNull();
      expect(r.longitude).toBeNull();
    });

    it('gửi lại đúng toạ độ đang có → no-op, KHÔNG save', async () => {
      repo.findOne.mockResolvedValueOnce(
        makeZone({ latitude: 21.0285, longitude: 105.8542 }),
      );

      await service.update(
        'z1',
        { latitude: 21.0285, longitude: 105.8542 },
        'u1',
      );

      expect(queryRunner.manager.save).not.toHaveBeenCalled();
    });
  });

  // ── UC-93 (ZNL-001): list & detail (READ-ONLY) ──
  describe('list (ZNL-001 / UC-93)', () => {
    const zone = (over: Record<string, any> = {}) => ({
      id: 'z1',
      zoneCode: 'GATE-01',
      zoneName: 'Cổng chính',
      zoneType: 'gate',
      status: 'active',
      building: null,
      floor: null,
      description: null,
      metadataJson: null,
      deletedAt: null,
      ...over,
    });

    const q = (over: Record<string, any> = {}) => over as any;

    // Case 1
    it('list rỗng → 200 với items: [], meta.total = 0, KHÔNG ném 404', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);

      const r = await service.list(q());

      expect(r.items).toEqual([]);
      expect(r.meta.total).toBe(0);
      expect(r.meta.totalPages).toBe(0);
    });

    // Case 2
    it('phân trang: page=3, limit=10 → skip=20, take=10', async () => {
      repo.findAndCount.mockResolvedValue([[zone()], 1]);

      await service.list(q({ page: 3, limit: 10 }));

      const arg = repo.findAndCount.mock.calls[0][0];
      expect(arg.skip).toBe(20);
      expect(arg.take).toBe(10);
    });

    // Case 3
    it('meta.totalPages = ceil(total/limit)', async () => {
      repo.findAndCount.mockResolvedValue([[zone()], 25]);

      const r = await service.list(q({ page: 1, limit: 10 }));

      expect(r.meta.totalPages).toBe(3);
      expect(r.meta.total).toBe(25);
    });

    // Case 4
    it('default: không truyền page/limit → skip=0, take=20, meta 1/20', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);

      const r = await service.list(q());

      const arg = repo.findAndCount.mock.calls[0][0];
      expect(arg.skip).toBe(0);
      expect(arg.take).toBe(20);
      expect(r.meta.page).toBe(1);
      expect(r.meta.limit).toBe(20);
    });

    // Case 5
    it('filter đơn: zone_type → where có zoneType + deletedAt IS NULL', async () => {
      await service.list(q({ zoneType: 'gate' }));

      const where = repo.findAndCount.mock.calls[0][0].where;
      expect(where.zoneType).toBe('gate');
      expect(where.deletedAt).toEqual(IsNull());
    });

    // Case 6
    it('filter kết hợp (AND): building + floor + status', async () => {
      await service.list(q({ building: 'A', floor: 'B1', status: 'active' }));

      const where = repo.findAndCount.mock.calls[0][0].where;
      expect(where.building).toBe('A');
      expect(where.floor).toBe('B1');
      expect(where.status).toBe('active');
      expect(where.deletedAt).toEqual(IsNull());
    });

    // Case 7
    it('filter KHÔNG gửi thì KHÔNG lọt vào where (kể cả undefined)', async () => {
      await service.list(q({ zoneType: 'gate' }));

      const where = repo.findAndCount.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('building');
      expect(where).not.toHaveProperty('floor');
      expect(where).not.toHaveProperty('status');
      expect(Object.keys(where).sort()).toEqual(['deletedAt', 'zoneType']);
    });

    // Case 8
    it('soft-delete không lọt: where luôn có deletedAt IS NULL', async () => {
      await service.list(q());
      expect(repo.findAndCount.mock.calls[0][0].where.deletedAt).toEqual(
        IsNull(),
      );
    });

    // Case 9
    it('sort zone_code ASC ở CẢ hai nhánh', async () => {
      await service.list(q());
      expect(repo.findAndCount.mock.calls[0][0].order).toEqual({
        zoneCode: 'ASC',
      });

      await service.list(q({ search: 'gate' }));
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('z.zoneCode', 'ASC');
    });

    // Case 10
    it('search dùng BOUND PARAM (assert tham số, không assert chuỗi nối)', async () => {
      await service.list(q({ search: 'gate' }));

      const ilikeCall = queryBuilder.andWhere.mock.calls.find((c: any[]) =>
        String(c[0]).includes('ILIKE'),
      );
      expect(ilikeCall).toBeDefined();
      expect(ilikeCall[0]).toContain('ILIKE :s');
      expect(ilikeCall[1]).toEqual({ s: '%gate%' });
      // Giá trị input KHÔNG được nội suy vào câu SQL.
      expect(String(ilikeCall[0])).not.toContain('gate');
    });

    // Case 10b — nhánh QueryBuilder phải gắn ĐỦ filter, không chỉ ILIKE
    it('search KẾT HỢP filter: QueryBuilder nhận CẢ filter LẪN ILIKE', async () => {
      await service.list(
        q({ search: 'hall', zoneType: 'corridor', building: 'A' }),
      );

      // Filter đi vào qb.where(...) dưới dạng object điều kiện.
      const whereArg = queryBuilder.where.mock.calls[0][0];
      expect(whereArg.zoneType).toBe('corridor');
      expect(whereArg.building).toBe('A');
      expect(whereArg.deletedAt).toEqual(IsNull());

      // Và điều kiện ILIKE vẫn được gắn kèm.
      const ilikeCall = queryBuilder.andWhere.mock.calls.find((c: any[]) =>
        String(c[0]).includes('ILIKE'),
      );
      expect(ilikeCall).toBeDefined();
      expect(ilikeCall[1]).toEqual({ s: '%hall%' });

      expect(queryBuilder.orderBy).toHaveBeenCalledWith('z.zoneCode', 'ASC');
    });

    // Case 11
    it('search KHÔNG normalize: gate vẫn là %gate%, không thành %GATE%', async () => {
      await service.list(q({ search: 'gate' }));

      const ilikeCall = queryBuilder.andWhere.mock.calls.find((c: any[]) =>
        String(c[0]).includes('ILIKE'),
      );
      expect(ilikeCall[1]).toEqual({ s: '%gate%' });
      expect(ilikeCall[1].s).not.toBe('%GATE%');
    });

    // Case 12
    it('nhánh QueryBuilder vẫn lọc soft-delete', async () => {
      await service.list(q({ search: 'gate' }));

      const whereArg = queryBuilder.where.mock.calls[0][0];
      expect(whereArg.deletedAt).toEqual(IsNull());
    });

    // Case 13
    it('chọn đúng nhánh: không search → findAndCount; có search → QueryBuilder', async () => {
      await service.list(q());
      expect(repo.findAndCount).toHaveBeenCalledTimes(1);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();

      jest.clearAllMocks();
      repo.createQueryBuilder.mockReturnValue(queryBuilder);
      queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.list(q({ search: 'gate' }));
      expect(repo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(repo.findAndCount).not.toHaveBeenCalled();
    });

    // READ-ONLY
    it('READ-ONLY: KHÔNG mở transaction, KHÔNG ghi audit (cả 2 nhánh)', async () => {
      await service.list(q());
      await service.list(q({ search: 'gate' }));

      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
      expect(auditRepo.logZoneCreation).not.toHaveBeenCalled();
      expect(auditRepo.logZoneUpdate).not.toHaveBeenCalled();
      expect(auditRepo.logZoneDeletion).not.toHaveBeenCalled();
    });
  });

  describe('getDetail (ZNL-001 / UC-93)', () => {
    // Case 14
    it('200: trả entity, lookup lọc deletedAt IS NULL', async () => {
      const entity = { id: 'z1', zoneCode: 'GATE-01' };
      repo.findOne.mockResolvedValueOnce(entity);

      const r = await service.getDetail('z1');

      expect(r.zone).toBe(entity);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'z1', deletedAt: IsNull() },
      });
    });

    // BE-fix: response kèm danh sách thiết bị gán vào zone (qua IotDevicesService, ARCH-01).
    it('200: kèm danh sách thiết bị lấy từ IotDevicesService.findByZoneId', async () => {
      const entity = { id: 'z1', zoneCode: 'GATE-01' };
      const devices = [{ id: 'd1' }, { id: 'd2' }];
      repo.findOne.mockResolvedValueOnce(entity);
      iotDevicesService.findByZoneId.mockResolvedValueOnce(devices);

      const r = await service.getDetail('z1');

      expect(r.devices).toBe(devices);
      expect(iotDevicesService.findByZoneId).toHaveBeenCalledWith('z1');
    });

    // Case 15
    it('404 ZONE_NOT_FOUND khi không tồn tại / đã xoá mềm', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(service.getDetail('missing')).rejects.toMatchObject({
        response: { code: 'ZONE_NOT_FOUND' },
      });
      await expect(service.getDetail('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('READ-ONLY: KHÔNG mở transaction, KHÔNG ghi audit', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'z1' });

      await service.getDetail('z1');

      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
      expect(auditRepo.logZoneDeletion).not.toHaveBeenCalled();
    });
  });

  // ── UC-94 (ZNA-001): gán / gỡ thiết bị ──
  describe('assignDevices (ZNA-001 / UC-94)', () => {
    const zone = (over: Record<string, any> = {}) => ({
      id: 'z1',
      zoneCode: 'GATE-01',
      zoneName: 'Cổng chính',
      zoneType: 'gate',
      status: 'active',
      deletedAt: null,
      ...over,
    });
    const device = (id: string, over: Record<string, any> = {}) => ({
      id,
      deviceType: 'ip_camera',
      zoneId: null,
      ...over,
    });
    const dtoOf = (ids: string[]) => ({ deviceIds: ids }) as any;

    // Case 1
    it('gán thành công (batch 3) → setZoneForDevices + audit trong transaction, có release', async () => {
      repo.findOne.mockResolvedValueOnce(zone());
      iotDevicesService.findAssignableByIds.mockResolvedValue([
        device('d1'),
        device('d2'),
        device('d3'),
      ]);

      const r = await service.assignDevices(
        'z1',
        dtoOf(['d1', 'd2', 'd3']),
        'u1',
      );

      expect(iotDevicesService.setZoneForDevices).toHaveBeenCalledWith(
        ['d1', 'd2', 'd3'],
        'z1',
        queryRunner.manager,
      );
      expect(auditRepo.logZoneAssignDevices).toHaveBeenCalledTimes(1);
      expect(
        auditRepo.logZoneAssignDevices.mock.invocationCallOrder[0],
      ).toBeLessThan(queryRunner.commitTransaction.mock.invocationCallOrder[0]);
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
      expect(r.assignedDeviceIds).toEqual(['d1', 'd2', 'd3']);
    });

    // Case 2
    it('404 zone → không validate thiết bị, không mở transaction', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.assignDevices('missing', dtoOf(['d1']), 'u1'),
      ).rejects.toMatchObject({ response: { code: 'ZONE_NOT_FOUND' } });
      expect(iotDevicesService.findAssignableByIds).not.toHaveBeenCalled();
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    // Case 3 — all-or-nothing
    it('1 id trong lô không tồn tại → CẢ LÔ fail, details nêu đúng id thiếu', async () => {
      repo.findOne.mockResolvedValueOnce(zone());
      iotDevicesService.findAssignableByIds.mockResolvedValue([
        device('d1'),
        device('d2'),
      ]);

      await expect(
        service.assignDevices('z1', dtoOf(['d1', 'd2', 'd3']), 'u1'),
      ).rejects.toMatchObject({
        response: {
          code: 'IOT_DEVICE_NOT_FOUND',
          details: { device_ids: ['d3'] },
        },
      });
      expect(iotDevicesService.setZoneForDevices).not.toHaveBeenCalled();
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    // Case 3b — hiệu tập hợp: input trùng KHÔNG được coi là thiếu id
    it('input trùng lặp (nếu lọt DTO) vẫn KHÔNG báo 404 sai — kiểm bằng hiệu tập hợp', async () => {
      repo.findOne.mockResolvedValueOnce(zone());
      // SQL In() khử trùng: [d1, d1, d2] → chỉ 2 bản ghi.
      iotDevicesService.findAssignableByIds.mockResolvedValue([
        device('d1'),
        device('d2'),
      ]);

      await expect(
        service.assignDevices('z1', dtoOf(['d1', 'd1', 'd2']), 'u1'),
      ).resolves.toBeDefined();
      expect(iotDevicesService.setZoneForDevices).toHaveBeenCalledTimes(1);
    });

    // Case 4
    it('409 DEVICE_TYPE_NOT_ASSIGNABLE_TO_ZONE khi sai loại, và 5 loại allowlist đều pass', async () => {
      repo.findOne.mockResolvedValueOnce(zone());
      iotDevicesService.findAssignableByIds.mockResolvedValue([
        device('d1', { deviceType: 'microphone' }),
      ]);

      await expect(
        service.assignDevices('z1', dtoOf(['d1']), 'u1'),
      ).rejects.toMatchObject({
        response: {
          code: 'DEVICE_TYPE_NOT_ASSIGNABLE_TO_ZONE',
          details: { device_ids: ['d1'] },
        },
      });
      expect(iotDevicesService.setZoneForDevices).not.toHaveBeenCalled();

      // Case dương: cả 5 loại allowlist.
      for (const deviceType of [
        'ip_camera',
        'door_camera',
        'room_camera',
        'occupancy_sensor',
        'face_server',
      ]) {
        jest.clearAllMocks();
        repo.findOne.mockResolvedValueOnce(zone());
        iotDevicesService.findAssignableByIds.mockResolvedValue([
          device('d1', { deviceType }),
        ]);
        dataSource.createQueryRunner.mockReturnValue(queryRunner);

        await expect(
          service.assignDevices('z1', dtoOf(['d1']), 'u1'),
        ).resolves.toBeDefined();
      }
    });

    // Case 5
    it('409 ZONE_INACTIVE → không validate thiết bị, không mở transaction', async () => {
      repo.findOne.mockResolvedValueOnce(zone({ status: 'inactive' }));

      await expect(
        service.assignDevices('z1', dtoOf(['d1']), 'u1'),
      ).rejects.toMatchObject({ response: { code: 'ZONE_INACTIVE' } });
      expect(iotDevicesService.findAssignableByIds).not.toHaveBeenCalled();
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    // Case 6 — idempotent
    it('cả lô đã đúng zone → NO-OP: không transaction, không ghi, không audit', async () => {
      repo.findOne.mockResolvedValueOnce(zone());
      iotDevicesService.findAssignableByIds.mockResolvedValue([
        device('d1', { zoneId: 'z1' }),
        device('d2', { zoneId: 'z1' }),
      ]);

      const r = await service.assignDevices('z1', dtoOf(['d1', 'd2']), 'u1');

      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
      expect(iotDevicesService.setZoneForDevices).not.toHaveBeenCalled();
      expect(auditRepo.logZoneAssignDevices).not.toHaveBeenCalled();
      expect(r.assignedDeviceIds).toEqual(['d1', 'd2']);
    });

    // Case 7 — đè zone khác (OQ-3)
    it('thiết bị đang thuộc zone KHÁC → đè thành công, audit có old_zone_id', async () => {
      repo.findOne.mockResolvedValueOnce(zone());
      iotDevicesService.findAssignableByIds.mockResolvedValue([
        device('d1', { zoneId: 'z-old' }),
      ]);

      await service.assignDevices('z1', dtoOf(['d1']), 'u1');

      expect(iotDevicesService.setZoneForDevices).toHaveBeenCalledWith(
        ['d1'],
        'z1',
        queryRunner.manager,
      );
      expect(auditRepo.logZoneAssignDevices).toHaveBeenCalledWith(
        queryRunner.manager,
        {
          userId: 'u1',
          zoneId: 'z1',
          deviceIds: ['d1'],
          oldZoneIds: { d1: 'z-old' },
        },
      );
    });

    // Case 8
    it('audit lỗi → rollback, không commit, vẫn release', async () => {
      repo.findOne.mockResolvedValueOnce(zone());
      iotDevicesService.findAssignableByIds.mockResolvedValue([device('d1')]);
      const auditError = new Error('audit failed');
      auditRepo.logZoneAssignDevices.mockRejectedValue(auditError);

      await expect(
        service.assignDevices('z1', dtoOf(['d1']), 'u1'),
      ).rejects.toBe(auditError);

      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
    });

    // Case 9
    it('setZoneForDevices lỗi → rollback, không commit, vẫn release', async () => {
      repo.findOne.mockResolvedValueOnce(zone());
      iotDevicesService.findAssignableByIds.mockResolvedValue([device('d1')]);
      const writeError = new Error('update failed');
      iotDevicesService.setZoneForDevices.mockRejectedValue(writeError);

      await expect(
        service.assignDevices('z1', dtoOf(['d1']), 'u1'),
      ).rejects.toBe(writeError);

      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
      expect(auditRepo.logZoneAssignDevices).not.toHaveBeenCalled();
    });

    // Case 11 — ARCH-01
    it('ARCH-01: không query thẳng bảng iot_devices (chỉ qua IotDevicesService)', async () => {
      repo.findOne.mockResolvedValueOnce(zone());
      iotDevicesService.findAssignableByIds.mockResolvedValue([device('d1')]);

      await service.assignDevices('z1', dtoOf(['d1']), 'u1');

      // repo của zones chỉ được dùng cho bảng `zones` (1 lần findOne ở loadActive).
      expect(repo.findOne).toHaveBeenCalledTimes(1);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
      expect(queryRunner.manager.query).not.toHaveBeenCalled();
    });
  });

  describe('unassignDevice (ZNA-001 / UC-94)', () => {
    const zone = (over: Record<string, any> = {}) => ({
      id: 'z1',
      zoneCode: 'GATE-01',
      zoneType: 'gate',
      status: 'active',
      deletedAt: null,
      ...over,
    });

    // Case 12
    it('gỡ thành công → setZoneForDevices với null + audit + commit + release', async () => {
      repo.findOne.mockResolvedValueOnce(zone());
      iotDevicesService.findAssignableByIds.mockResolvedValue([
        { id: 'd1', deviceType: 'ip_camera', zoneId: 'z1' },
      ]);

      const r = await service.unassignDevice('z1', 'd1', 'u1');

      expect(iotDevicesService.setZoneForDevices).toHaveBeenCalledWith(
        ['d1'],
        null,
        queryRunner.manager,
      );
      expect(auditRepo.logZoneUnassignDevice).toHaveBeenCalledWith(
        queryRunner.manager,
        { userId: 'u1', zoneId: 'z1', deviceId: 'd1' },
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
      expect(r.unassignedDeviceId).toBe('d1');
    });

    // Case 12b — bất đối xứng có chủ đích với route gán
    it('zone inactive VẪN gỡ được (không chặn) — tránh kẹt cứng với UC-92', async () => {
      repo.findOne.mockResolvedValueOnce(zone({ status: 'inactive' }));
      iotDevicesService.findAssignableByIds.mockResolvedValue([
        { id: 'd1', deviceType: 'ip_camera', zoneId: 'z1' },
      ]);

      await expect(
        service.unassignDevice('z1', 'd1', 'u1'),
      ).resolves.toBeDefined();
      expect(iotDevicesService.setZoneForDevices).toHaveBeenCalledWith(
        ['d1'],
        null,
        queryRunner.manager,
      );
    });

    // Case 13
    it('404 zone → ZONE_NOT_FOUND', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.unassignDevice('missing', 'd1', 'u1'),
      ).rejects.toMatchObject({ response: { code: 'ZONE_NOT_FOUND' } });
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    // Case 14
    it('404 thiết bị không tồn tại → IOT_DEVICE_NOT_FOUND', async () => {
      repo.findOne.mockResolvedValueOnce(zone());
      iotDevicesService.findAssignableByIds.mockResolvedValue([]);

      await expect(
        service.unassignDevice('z1', 'd-missing', 'u1'),
      ).rejects.toMatchObject({ response: { code: 'IOT_DEVICE_NOT_FOUND' } });
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    // Case 15
    it('404 DEVICE_NOT_IN_ZONE khi thiết bị thuộc zone khác → không ghi gì', async () => {
      repo.findOne.mockResolvedValueOnce(zone());
      iotDevicesService.findAssignableByIds.mockResolvedValue([
        { id: 'd1', deviceType: 'ip_camera', zoneId: 'z-other' },
      ]);

      await expect(
        service.unassignDevice('z1', 'd1', 'u1'),
      ).rejects.toMatchObject({ response: { code: 'DEVICE_NOT_IN_ZONE' } });
      expect(iotDevicesService.setZoneForDevices).not.toHaveBeenCalled();
      expect(auditRepo.logZoneUnassignDevice).not.toHaveBeenCalled();
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });
  });

  // ── UC-92 (ZND-001): audit cho create/update (OQ-2 mức 2) ──
  describe('audit create/update (ZND-001 / UC-92)', () => {
    const makeZone = (over: Record<string, any> = {}) => ({
      id: 'z1',
      zoneCode: 'GATE-01',
      zoneName: 'Cổng chính',
      zoneType: 'gate',
      status: 'active',
      building: null,
      floor: null,
      description: null,
      metadataJson: null,
      deletedAt: null,
      ...over,
    });

    // Case 8
    it('create() thành công → logZoneCreation 1 lần trong transaction + commit', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.create(dto(), 'u-actor');

      expect(auditRepo.logZoneCreation).toHaveBeenCalledTimes(1);
      expect(auditRepo.logZoneCreation).toHaveBeenCalledWith(
        queryRunner.manager,
        expect.objectContaining({ userId: 'u-actor', zoneId: 'z1' }),
      );
      expect(
        auditRepo.logZoneCreation.mock.invocationCallOrder[0],
      ).toBeLessThan(queryRunner.commitTransaction.mock.invocationCallOrder[0]);
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
    });

    // Case 9
    it('create() trùng mã (pre-check) → 409 và KHÔNG audit, KHÔNG mở transaction', async () => {
      repo.findOne.mockResolvedValue({ id: 'old', zoneCode: 'GATE-01' });

      await expect(service.create(dto(), 'u1')).rejects.toMatchObject({
        response: { code: 'ZONE_CODE_EXISTS' },
      });
      expect(auditRepo.logZoneCreation).not.toHaveBeenCalled();
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    // Case 12b — đối xứng case 12: race 23505 của create() PHẢI rollback
    it('create() race 23505 → 409 cùng payload, rollback, không commit, vẫn release, KHÔNG audit', async () => {
      repo.findOne.mockResolvedValue(null);
      queryRunner.manager.save.mockRejectedValue(
        Object.assign(new Error('duplicate key'), {
          driverError: { code: '23505' },
        }),
      );

      await expect(service.create(dto(), 'u1')).rejects.toMatchObject({
        response: {
          code: 'ZONE_CODE_EXISTS',
          message: 'Mã khu vực đã tồn tại',
        },
      });

      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
      expect(auditRepo.logZoneCreation).not.toHaveBeenCalled();
    });

    // Case 10
    it('update() có thay đổi → logZoneUpdate với changes đúng field đã đổi', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone());
      queryRunner.manager.save.mockImplementation((_e: any, x: any) =>
        Promise.resolve(x),
      );

      await service.update('z1', { zoneName: 'Tên mới' }, 'u-actor');

      expect(auditRepo.logZoneUpdate).toHaveBeenCalledTimes(1);
      expect(auditRepo.logZoneUpdate).toHaveBeenCalledWith(
        queryRunner.manager,
        {
          userId: 'u-actor',
          zoneId: 'z1',
          changes: { zoneName: { old: 'Cổng chính', new: 'Tên mới' } },
        },
      );
    });

    // Case 11 — bất biến UC-91
    it('update() no-op → KHÔNG save VÀ KHÔNG audit', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone());

      await service.update('z1', {}, 'u1');

      expect(queryRunner.manager.save).not.toHaveBeenCalled();
      expect(auditRepo.logZoneUpdate).not.toHaveBeenCalled();
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    // Case 12
    it('update() race 23505 → rollback + 409 cùng payload, vẫn release', async () => {
      repo.findOne
        .mockResolvedValueOnce(makeZone())
        .mockResolvedValueOnce(null);
      queryRunner.manager.save.mockRejectedValue(
        Object.assign(new Error('duplicate key'), {
          driverError: { code: '23505' },
        }),
      );

      await expect(
        service.update('z1', { zoneCode: 'GATE-09' }, 'u1'),
      ).rejects.toMatchObject({
        response: {
          code: 'ZONE_CODE_EXISTS',
          message: 'Mã khu vực đã tồn tại',
        },
      });

      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
    });
  });

  // ── UC-92 (ZND-001): xoá khu vực ──
  describe('remove (ZND-001 / UC-92)', () => {
    const makeZone = (over: Record<string, any> = {}) => ({
      id: 'z1',
      zoneCode: 'GATE-01',
      zoneName: 'Cổng chính',
      zoneType: 'gate',
      status: 'active',
      deletedAt: null,
      ...over,
    });

    // Case 1
    it('xoá thành công: softDelete + audit trong transaction, có commit và release', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone());
      iotDevicesService.countByZoneId.mockResolvedValue(0);

      await service.remove('z1', 'u1');

      expect(queryRunner.manager.softDelete).toHaveBeenCalledWith(
        ZoneEntity,
        'z1',
      );
      expect(auditRepo.logZoneDeletion).toHaveBeenCalledWith(
        queryRunner.manager,
        {
          userId: 'u1',
          zoneId: 'z1',
          zoneCode: 'GATE-01',
          zoneType: 'gate',
        },
      );
      // audit phải ghi TRƯỚC khi commit
      expect(
        auditRepo.logZoneDeletion.mock.invocationCallOrder[0],
      ).toBeLessThan(queryRunner.commitTransaction.mock.invocationCallOrder[0]);
      expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
    });

    // Case 2
    it('404 zone không tồn tại: KHÔNG đếm thiết bị, KHÔNG mở transaction', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(service.remove('missing', 'u1')).rejects.toMatchObject({
        response: { code: 'ZONE_NOT_FOUND' },
      });
      expect(iotDevicesService.countByZoneId).not.toHaveBeenCalled();
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    // Case 3
    it('404 zone đã xoá mềm (gồm DELETE lần 2): lookup lọc deletedAt IS NULL', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(service.remove('z-deleted', 'u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'z-deleted', deletedAt: IsNull() },
      });
    });

    // Case 4 — crux OQ-1 (vế chặn)
    it('409 ZONE_HAS_DEVICES khi còn thiết bị: không mở transaction, không softDelete, không audit', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone());
      iotDevicesService.countByZoneId.mockResolvedValue(3);

      await expect(service.remove('z1', 'u1')).rejects.toMatchObject({
        response: {
          code: 'ZONE_HAS_DEVICES',
          details: { device_count: 3 },
        },
      });
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
      expect(queryRunner.manager.softDelete).not.toHaveBeenCalled();
      expect(auditRepo.logZoneDeletion).not.toHaveBeenCalled();
    });

    // Case 5 — crux OQ-1 (vế KHÔNG chặn theo log)
    it('còn LOG nhưng hết thiết bị → VẪN XOÁ (không chặn theo log)', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone());
      iotDevicesService.countByZoneId.mockResolvedValue(0);

      await service.remove('z1', 'u1');

      // Service KHÔNG được truy vấn gate_access_logs / zone_presence_events:
      // chỉ có đúng 1 findOne (lượt loadActive) và 0 query thô nào khác.
      expect(repo.findOne).toHaveBeenCalledTimes(1);
      expect(queryRunner.manager.query).not.toHaveBeenCalled();
      expect(queryRunner.manager.softDelete).toHaveBeenCalledTimes(1);
    });

    // Case 6
    it('audit lỗi → rollback, KHÔNG commit, vẫn release, lỗi propagate', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone());
      iotDevicesService.countByZoneId.mockResolvedValue(0);
      const auditError = new Error('audit insert failed');
      auditRepo.logZoneDeletion.mockRejectedValue(auditError);

      await expect(service.remove('z1', 'u1')).rejects.toBe(auditError);

      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
    });

    // Case 7
    it('countByZoneId được gọi đúng 1 lần với đúng id', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone());
      iotDevicesService.countByZoneId.mockResolvedValue(0);

      await service.remove('z1', 'u1');

      expect(iotDevicesService.countByZoneId).toHaveBeenCalledTimes(1);
      expect(iotDevicesService.countByZoneId).toHaveBeenCalledWith('z1');
    });
  });
});
