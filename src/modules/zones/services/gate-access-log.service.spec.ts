/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GateAccessLogEntity } from '../entities/gate-access-log.entity.js';
import { GateAccessLogService } from './gate-access-log.service.js';
import { HgVisionService } from '../../academic/services/hgvision.service.js';

describe('GateAccessLogService (GAL-001 / UC-107)', () => {
  let service: GateAccessLogService;
  let repo: any;
  let qb: any;
  let ds: any;
  let qr: any;
  let hgVision: any;

  beforeEach(async () => {
    qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    repo = { createQueryBuilder: jest.fn(() => qb) };
    // queryRunner mock (writeGateLog dùng cho INSERT). manager.query đặt per-test.
    qr = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: { query: jest.fn().mockResolvedValue([{ id: 'gate-log-1' }]) },
    };
    ds = {
      manager: { query: jest.fn().mockResolvedValue([{ zone_type: 'gate' }]) },
      createQueryRunner: jest.fn(() => qr),
    };
    hgVision = {
      isConfigured: jest.fn().mockReturnValue(false),
      isMockFallbackEnabled: jest.fn().mockReturnValue(false),
      searchFaceFromDataUrl: jest.fn(),
      readLicensePlateFromDataUrl: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GateAccessLogService,
        { provide: getRepositoryToken(GateAccessLogEntity), useValue: repo },
        { provide: DataSource, useValue: ds },
        {
          provide: HgVisionService,
          useValue: hgVision,
        },
      ],
    }).compile();
    service = module.get(GateAccessLogService);
  });

  const q = (over: any = {}) => ({ page: 1, limit: 20, ...over });
  // Gộp mọi chuỗi SQL đã truyền vào where/andWhere để soát từ khoá.
  const allSql = () =>
    [...qb.where.mock.calls, ...qb.andWhere.mock.calls]
      .map((c) => String(c[0]))
      .join(' | ');
  const findAndWhere = (frag: string) =>
    qb.andWhere.mock.calls.find((c: any[]) => String(c[0]).includes(frag));

  // ⭐ Chốt chặn append-only: KHÔNG deletedAt trên gal, VÀ cố ý không lọc z/u.deletedAt.
  it('KHÔNG có "deleted" ở bất kỳ where/andWhere nào (cả 2 method, phủ gal/z/u)', async () => {
    await service.listForUser('u1', q());
    await service.listAll(q());
    expect(allSql().toLowerCase()).not.toContain('deleted');
  });

  describe('listForUser', () => {
    it('fold cứng userId + join zone, KHÔNG join user', async () => {
      await service.listForUser('u1', q());
      expect(qb.where).toHaveBeenCalledWith('gal.userId = :userId', {
        userId: 'u1',
      });
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('gal.zone', 'z');
      const joinedUser = qb.leftJoinAndSelect.mock.calls.some(
        (c: any[]) => c[0] === 'gal.user',
      );
      expect(joinedUser).toBe(false);
    });

    it('filter from/to/direction/zone_id → andWhere bound param', async () => {
      await service.listForUser(
        'u1',
        q({
          from: '2026-07-01T00:00:00Z',
          to: '2026-07-31T00:00:00Z',
          direction: 'enter',
          zoneId: 'z9',
        }),
      );
      expect(findAndWhere('gal.accessTime >= :from')[1]).toEqual({
        from: '2026-07-01T00:00:00Z',
      });
      expect(findAndWhere('gal.accessTime <= :to')[1]).toEqual({
        to: '2026-07-31T00:00:00Z',
      });
      expect(findAndWhere('gal.direction = :direction')[1]).toEqual({
        direction: 'enter',
      });
      expect(findAndWhere('gal.zoneId = :zoneId')[1]).toEqual({ zoneId: 'z9' });
    });

    it('filter vắng mặt KHÔNG lọt: chỉ gửi direction → không andWhere from/to/zone_id', async () => {
      await service.listForUser('u1', q({ direction: 'enter' }));
      expect(findAndWhere('gal.accessTime')).toBeUndefined();
      expect(findAndWhere('gal.zoneId')).toBeUndefined();
    });

    it('sort accessTime DESC + skip/take + meta', async () => {
      qb.getManyAndCount.mockResolvedValue([[{ id: 'l1' }], 25]);
      const r = await service.listForUser('u1', q({ page: 2, limit: 10 }));
      expect(qb.orderBy).toHaveBeenCalledWith('gal.accessTime', 'DESC');
      expect(qb.skip).toHaveBeenCalledWith(10);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(r.meta).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
    });

    it('list rỗng → items:[], meta.total=0, totalPages=0 (KHÔNG throw)', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      const r = await service.listForUser('u1', q());
      expect(r.items).toEqual([]);
      expect(r.meta.total).toBe(0);
      expect(r.meta.totalPages).toBe(0);
    });

    it('page/limit vắng mặt → default 1/20 (nhánh ?? )', async () => {
      const r = await service.listForUser('u1', {} as never);
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(r.meta.page).toBe(1);
      expect(r.meta.limit).toBe(20);
    });
  });

  describe('listAll (admin)', () => {
    it('KHÔNG fold userId + LUÔN join zone và user', async () => {
      await service.listAll(q());
      // Không có where/andWhere userId khi client không gửi user_id.
      expect(findAndWhere('gal.userId')).toBeUndefined();
      expect(qb.where).not.toHaveBeenCalled();
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('gal.zone', 'z');
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('gal.user', 'u');
    });

    it('user_id exact → andWhere gal.userId = :uid', async () => {
      await service.listAll(q({ userId: 'u9' }));
      expect(findAndWhere('gal.userId = :uid')[1]).toEqual({ uid: 'u9' });
    });

    it('plate normalize trước so exact: "29a-123" → {plate:"29A123"}', async () => {
      await service.listAll(q({ plate: '29a-123' }));
      const call = findAndWhere('gal.plateNumber = :plate');
      expect(call[1]).toEqual({ plate: '29A123' });
    });

    it('search + filter KẾT HỢP: plate + from + user_id → cả 3 andWhere gắn', async () => {
      await service.listAll(
        q({ plate: '29A', from: '2026-07-01T00:00:00Z', userId: 'u9' }),
      );
      expect(findAndWhere('gal.plateNumber = :plate')).toBeDefined();
      expect(findAndWhere('gal.accessTime >= :from')).toBeDefined();
      expect(findAndWhere('gal.userId = :uid')).toBeDefined();
    });

    it('sort accessTime DESC + meta đúng', async () => {
      qb.getManyAndCount.mockResolvedValue([[{ id: 'l1' }], 5]);
      const r = await service.listAll(q({ page: 1, limit: 20 }));
      expect(qb.orderBy).toHaveBeenCalledWith('gal.accessTime', 'DESC');
      expect(r.meta).toEqual({ page: 1, limit: 20, total: 5, totalPages: 1 });
    });

    it('page/limit vắng mặt → default 1/20 (nhánh ?? )', async () => {
      const r = await service.listAll({} as never);
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(r.meta.limit).toBe(20);
    });

    it('to filter đơn lẻ → andWhere gal.accessTime <= :to', async () => {
      await service.listAll(q({ to: '2026-07-31T00:00:00Z' }));
      expect(findAndWhere('gal.accessTime <= :to')[1]).toEqual({
        to: '2026-07-31T00:00:00Z',
      });
    });
  });

  describe('scanFromGuardDashboard', () => {
    const mockGuardAndGateQueries = () => {
      ds.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT r.role_code')) {
          return Promise.resolve([{ role_code: 'GUARD' }]);
        }
        if (sql.includes('FROM zones')) {
          return Promise.resolve([
            {
              id: 'gate-1',
              zone_code: 'GATE_MAIN',
              zone_name: 'Cổng chính',
            },
          ]);
        }
        return Promise.resolve([]);
      });
    };

    it('không có ảnh camera thì không lấy tài khoản bảo vệ làm người được quét', async () => {
      mockGuardAndGateQueries();

      const result = await service.scanFromGuardDashboard('guard-user-id', {
        gateId: 'main-in',
        direction: 'in',
        scenario: 'authorized',
      });

      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          message: 'Cần ảnh từ camera để xác định người qua cổng.',
        }),
      );
      expect(hgVision.searchFaceFromDataUrl).not.toHaveBeenCalled();
      expect(ds.createQueryRunner).not.toHaveBeenCalled();
    });

    it('FaceID engine chưa cấu hình thì không tạo log bằng danh tính bảo vệ', async () => {
      mockGuardAndGateQueries();

      const result = await service.scanFromGuardDashboard('guard-user-id', {
        gateId: 'main-in',
        direction: 'in',
        scenario: 'authorized',
        snapshotImageBase64: 'data:image/jpeg;base64,/9j/2Q==',
      });

      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          message:
            'Dịch vụ đối chiếu FaceID chưa sẵn sàng nên chưa thể xác định người trước camera.',
        }),
      );
      expect(ds.createQueryRunner).not.toHaveBeenCalled();
    });

    it('mock FaceID dùng người có hồ sơ active khác tài khoản bảo vệ', async () => {
      hgVision.isMockFallbackEnabled.mockReturnValue(true);
      ds.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT r.role_code')) {
          return Promise.resolve([{ role_code: 'GUARD' }]);
        }
        if (sql.includes('zone_name')) {
          return Promise.resolve([
            {
              id: 'gate-1',
              zone_code: 'GATE_MAIN',
              zone_name: 'Cổng chính',
            },
          ]);
        }
        if (sql.includes('JOIN face_profiles fp')) {
          return Promise.resolve([
            {
              id: 'student-user-id',
              full_name: 'Lê Minh Sinh',
              person_code: 'SV001',
              person_role: 'Sinh viên',
              plate_number: null,
            },
          ]);
        }
        if (sql.includes('SELECT direction')) return Promise.resolve([]);
        if (sql.includes('SELECT id')) return Promise.resolve([]);
        if (sql.includes('SELECT zone_type')) {
          return Promise.resolve([{ zone_type: 'gate' }]);
        }
        return Promise.resolve([]);
      });

      const result = await service.scanFromGuardDashboard('guard-user-id', {
        gateId: 'main-in',
        direction: 'in',
        scenario: 'authorized',
        snapshotImageBase64: 'data:image/jpeg;base64,/9j/2Q==',
      });

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          event: expect.objectContaining({
            user_id: 'student-user-id',
            person_code: 'SV001',
            person_role: 'Sinh viên',
            metadata_json: expect.objectContaining({
              recognitionProvider: 'mock-faceid',
            }),
          }),
        }),
      );
      expect(result.event.user_id).not.toBe('guard-user-id');
    });
  });

  // ── writeGateLog (GAW-001 / UC-105) — WRITER ──
  describe('writeGateLog (GAW-001 / UC-105)', () => {
    const input = (over: any = {}) => ({
      zoneId: 'z-gate',
      direction: 'enter' as const,
      accessTime: new Date('2026-07-24T09:00:00.000Z'),
      deviceId: 'dev1',
      eventId: 'evt1',
      userId: 'u1',
      vehicleRegistrationId: 'reg1',
      plateNumber: '51F12345',
      metadata: { channelId: 3, plateRaw: '51F-123.45' },
      ...over,
    });

    it('zone gate hợp lệ → INSERT + trả logId; access_time = accessTime truyền vào', async () => {
      const r = await service.writeGateLog(input());
      expect(r).toEqual({ written: true, logId: 'gate-log-1' });
      // INSERT gọi qua queryRunner (KHÔNG raw ngoài tx), có RETURNING id.
      const insertCall = qr.manager.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('INSERT INTO gate_access_logs'),
      );
      expect(insertCall).toBeDefined();
      expect(String(insertCall[0])).toContain('RETURNING id');
      // access_time (param thứ 8, index 7) = accessTime truyền vào (KHÔNG now()).
      expect(insertCall[1][7]).toEqual(new Date('2026-07-24T09:00:00.000Z'));
      expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
      expect(qr.release).toHaveBeenCalledTimes(1);
    });

    it('zone type=room → zone_not_gate, KHÔNG insert, KHÔNG mở queryRunner', async () => {
      ds.manager.query.mockResolvedValueOnce([{ zone_type: 'room' }]);
      const r = await service.writeGateLog(input());
      expect(r).toEqual({ written: false, skipReason: 'zone_not_gate' });
      expect(ds.createQueryRunner).not.toHaveBeenCalled();
    });

    it('zone không tồn tại / đã xoá mềm → zone_not_gate (SELECT lọc deleted_at IS NULL)', async () => {
      ds.manager.query.mockResolvedValueOnce([]);
      const r = await service.writeGateLog(input());
      expect(r).toEqual({ written: false, skipReason: 'zone_not_gate' });
      const zoneSql = String(ds.manager.query.mock.calls[0][0]);
      expect(zoneSql).toContain('deleted_at IS NULL');
      expect(ds.createQueryRunner).not.toHaveBeenCalled();
    });

    it('23505 → duplicate, rollback + release, KHÔNG ném', async () => {
      qr.manager.query.mockRejectedValueOnce({
        driverError: { code: '23505' },
      });
      const r = await service.writeGateLog(input());
      expect(r).toEqual({ written: false, skipReason: 'duplicate' });
      expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(qr.commitTransaction).not.toHaveBeenCalled();
      expect(qr.release).toHaveBeenCalledTimes(1);
    });

    it('lỗi THƯỜNG (không 23505) → rollback + release + NÉM lại', async () => {
      qr.manager.query.mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.writeGateLog(input())).rejects.toThrow(
        'connection lost',
      );
      expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(qr.release).toHaveBeenCalledTimes(1);
    });

    it('plateNumber=null → INSERT vẫn chạy (param plate = null)', async () => {
      const r = await service.writeGateLog(input({ plateNumber: null }));
      expect(r.written).toBe(true);
      const insertCall = qr.manager.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('INSERT INTO gate_access_logs'),
      );
      // plate_number là param thứ 6 (index 5).
      expect(insertCall[1][5]).toBeNull();
    });

    it('metadata rỗng → metadata_json param = null (không ép jsonb rỗng)', async () => {
      const r = await service.writeGateLog(input({ metadata: {} }));
      expect(r.written).toBe(true);
      const insertCall = qr.manager.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('INSERT INTO gate_access_logs'),
      );
      // metadata_json là param thứ 9 (index 8).
      expect(insertCall[1][8]).toBeNull();
    });
  });
});
