/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ControlListSyncHook } from './control-list-sync.hook.js';
import { ILike } from 'typeorm';
import { VehicleRegistrationEntity } from '../entities/vehicle-registration.entity.js';
import { VehicleRegistrationService } from './vehicle-registration.service.js';

describe('VehicleRegistrationService (VPR-001 / UC1)', () => {
  let service: VehicleRegistrationService;
  let repo: any;
  let hook: ControlListSyncHook;
  let qb: any; // UC-101: mock QueryBuilder cho listAll (dựng mock — không đụng test cũ)

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
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve({ id: 'veh1', ...x })),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      createQueryBuilder: jest.fn(() => qb),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleRegistrationService,
        ControlListSyncHook,
        {
          provide: getRepositoryToken(VehicleRegistrationEntity),
          useValue: repo,
        },
      ],
    }).compile();
    service = module.get(VehicleRegistrationService);
    hook = module.get(ControlListSyncHook);
  });

  it('ok → save với plate_number chuẩn + status active + userId', async () => {
    const r = await service.register('u1', {
      plateRaw: '30A-123.45',
      vehicleType: 'car',
    });
    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = repo.save.mock.calls[0][0];
    expect(saved.plateNumber).toBe('30A12345');
    expect(saved.plateRaw).toBe('30A-123.45');
    expect(saved.status).toBe('active');
    expect(saved.userId).toBe('u1');
    expect(r.id).toBe('veh1');
  });

  it('pre-check trùng (findOne trả row) → ConflictException PLATE_ALREADY_REGISTERED, KHÔNG save', async () => {
    repo.findOne.mockResolvedValue({ id: 'old' });
    await expect(
      service.register('u1', { plateRaw: '30A12345' }),
    ).rejects.toMatchObject({
      response: { code: 'PLATE_ALREADY_REGISTERED' },
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('SEC: message conflict KHÔNG chứa thông tin user khác', async () => {
    repo.findOne.mockResolvedValue({ id: 'old', userId: 'other-user-999' });
    try {
      await service.register('u1', { plateRaw: '30A12345' });
      fail('should throw');
    } catch (e: any) {
      expect(JSON.stringify(e.response)).not.toContain('other-user-999');
      expect(e).toBeInstanceOf(ConflictException);
    }
  });

  it('save ném 23505 (race) → safety-net ConflictException, KHÔNG ném lỗi thô', async () => {
    repo.save.mockRejectedValue({ driverError: { code: '23505' } });
    await expect(
      service.register('u1', { plateRaw: '30A12345' }),
    ).rejects.toMatchObject({ response: { code: 'PLATE_ALREADY_REGISTERED' } });
  });

  it('save ném lỗi khác (không phải 23505) → ném lại nguyên lỗi', async () => {
    const boom = new Error('db down');
    repo.save.mockRejectedValue(boom);
    await expect(service.register('u1', { plateRaw: '30A12345' })).rejects.toBe(
      boom,
    );
  });

  describe('format validate (OQ-4) → BadRequestException INVALID_PLATE, KHÔNG save', () => {
    const bad: Array<[string, string]> = [
      ['quá ngắn (5)', '30A12'],
      ['quá dài (11)', '30A12345678'],
      ['toàn chữ', 'ABCDEF'],
      ['toàn số', '123456'],
    ];
    it.each(bad)('%s', async (_label, plateRaw) => {
      await expect(service.register('u1', { plateRaw })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  it('biên hợp lệ: dài 6 và 10 (có cả chữ+số) → save', async () => {
    await service.register('u1', { plateRaw: '12345A' }); // 6
    await service.register('u1', {
      plateRaw: '99MD123456'.slice(0, 10),
    }); // 10
    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  // ── UC2 (VPM-001): sửa / disable / xóa-mềm — ownership ──
  describe('UC2 ownership + sửa/status/xóa', () => {
    const owned = () => ({
      id: 'veh1',
      userId: 'u1',
      plateNumber: '30A12345',
      plateRaw: '30A-123.45',
      vehicleType: 'car',
      note: 'old',
      status: 'active',
    });

    // CRUX: lookup luôn kèm userId + deletedAt IsNull → fold ownership.
    it('loadOwned query lọc {id, userId, deletedAt:IsNull} (đi qua updateMetadata)', async () => {
      repo.findOne.mockResolvedValue(owned());
      await service.updateMetadata('veh1', 'u1', { note: 'x' });
      const where = repo.findOne.mock.calls[0][0].where;
      expect(where.id).toBe('veh1');
      expect(where.userId).toBe('u1');
      expect(where.deletedAt).toBeDefined(); // IsNull()
    });

    describe('OWNERSHIP: user A đụng biển user B → 404, KHÔNG mutate', () => {
      beforeEach(() => repo.findOne.mockResolvedValue(null)); // không khớp userId

      it('updateMetadata → 404, KHÔNG save', async () => {
        await expect(
          service.updateMetadata('veh1', 'attacker', { note: 'x' }),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(repo.save).not.toHaveBeenCalled();
      });
      it('setStatus → 404, KHÔNG save', async () => {
        await expect(
          service.setStatus('veh1', 'attacker', 'disabled'),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(repo.save).not.toHaveBeenCalled();
      });
      it('softDeleteOwned → 404, KHÔNG softDelete', async () => {
        await expect(
          service.softDeleteOwned('veh1', 'attacker'),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(repo.softDelete).not.toHaveBeenCalled();
      });
      it('404 code=VEHICLE_NOT_FOUND, message trung tính (KHÔNG lộ tồn tại/owner)', async () => {
        try {
          await service.updateMetadata('veh1', 'attacker', { note: 'x' });
          fail('should throw');
        } catch (e: any) {
          expect(e.response.code).toBe('VEHICLE_NOT_FOUND');
          expect(JSON.stringify(e.response)).not.toContain('u1');
        }
      });
    });

    it('biển đã xóa-mềm (findOne null) → softDeleteOwned 404, KHÔNG xóa 2 lần', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.softDeleteOwned('veh1', 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('updateMetadata: đổi note + vehicle_type, KHÔNG đụng plateNumber/userId/status', async () => {
      const e = owned();
      repo.findOne.mockResolvedValue(e);
      await service.updateMetadata('veh1', 'u1', {
        note: 'new',
        vehicleType: 'truck',
      });
      const saved = repo.save.mock.calls[0][0];
      expect(saved.note).toBe('new');
      expect(saved.vehicleType).toBe('truck');
      expect(saved.plateNumber).toBe('30A12345'); // nguyên
      expect(saved.userId).toBe('u1');
      expect(saved.status).toBe('active');
    });

    it('undefined: KHÔNG gửi note → giữ nguyên', async () => {
      const e = owned();
      repo.findOne.mockResolvedValue(e);
      await service.updateMetadata('veh1', 'u1', { vehicleType: 'truck' });
      expect(repo.save.mock.calls[0][0].note).toBe('old'); // giữ
    });

    it('null: gửi note=null → set null (xóa note)', async () => {
      const e = owned();
      repo.findOne.mockResolvedValue(e);
      await service.updateMetadata('veh1', 'u1', { note: null });
      expect(repo.save.mock.calls[0][0].note).toBeNull();
    });

    it('rỗng: cả note+vehicle_type absent → no-op, KHÔNG save, trả nguyên trạng', async () => {
      const e = owned();
      repo.findOne.mockResolvedValue(e);
      const r = await service.updateMetadata('veh1', 'u1', {});
      expect(repo.save).not.toHaveBeenCalled();
      expect(r).toBe(e);
    });

    it('setStatus: active & disabled → save status mới', async () => {
      repo.findOne.mockResolvedValue(owned());
      await service.setStatus('veh1', 'u1', 'disabled');
      expect(repo.save.mock.calls[0][0].status).toBe('disabled');
      repo.findOne.mockResolvedValue(owned());
      await service.setStatus('veh1', 'u1', 'active');
      expect(repo.save.mock.calls[1][0].status).toBe('active');
    });

    it('softDeleteOwned: loadOwned ok → repo.softDelete(id)', async () => {
      repo.findOne.mockResolvedValue(owned());
      repo.softDelete = jest.fn().mockResolvedValue({ affected: 1 });
      await service.softDeleteOwned('veh1', 'u1');
      expect(repo.softDelete).toHaveBeenCalledWith('veh1');
    });
  });

  // ── UC3 (VPL-001): list + getDetail ──
  describe('UC3 list + getDetail', () => {
    const owned = () => ({ id: 'veh1', userId: 'u1', plateNumber: '30A12345' });
    const q = (over: any = {}) => ({ page: 1, limit: 20, ...over });

    it('SEC (BẮT BUỘC): findAndCount where lọc cứng userId=current + deletedAt:IsNull', async () => {
      repo.findAndCount.mockResolvedValue([[owned()], 1]);
      await service.list('u1', q());
      const arg = repo.findAndCount.mock.calls[0][0];
      expect(arg.where.userId).toBe('u1');
      expect(arg.where.deletedAt).toBeDefined(); // IsNull()
      expect(arg.order).toEqual({ createdAt: 'DESC' }); // OQ-5
    });

    it('meta đúng: total=25 limit=20 → totalPages=2', async () => {
      const rows = Array.from({ length: 20 }, () => owned());
      repo.findAndCount.mockResolvedValue([rows, 25]);
      const r = await service.list('u1', q({ page: 1, limit: 20 }));
      expect(r.meta).toEqual({ page: 1, limit: 20, total: 25, totalPages: 2 });
      expect(r.items).toHaveLength(20);
    });

    it('pagination: page=2 limit=20 → skip=20, take=20', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.list('u1', q({ page: 2, limit: 20 }));
      const arg = repo.findAndCount.mock.calls[0][0];
      expect(arg.skip).toBe(20);
      expect(arg.take).toBe(20);
    });

    it('filter status set → where.status; không set → where KHÔNG có khóa status', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.list('u1', q({ status: 'disabled' }));
      expect(repo.findAndCount.mock.calls[0][0].where.status).toBe('disabled');

      repo.findAndCount.mockClear();
      await service.list('u1', q());
      expect('status' in repo.findAndCount.mock.calls[0][0].where).toBe(false);
    });

    it('list rỗng: findAndCount [[],0] → items:[], meta.total=0, totalPages=0 (KHÔNG throw)', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      const r = await service.list('u1', q());
      expect(r.items).toEqual([]);
      expect(r.meta.total).toBe(0);
      expect(r.meta.totalPages).toBe(0);
    });

    it('getDetail: tái dùng loadOwned → biển của mình → trả entity', async () => {
      const e = owned();
      repo.findOne.mockResolvedValue(e);
      expect(await service.getDetail('veh1', 'u1')).toBe(e);
      // chứng minh đi qua loadOwned (findOne where id+userId+deletedAt).
      expect(repo.findOne.mock.calls[0][0].where).toMatchObject({
        id: 'veh1',
        userId: 'u1',
      });
    });

    it('getDetail: biển người khác/không tồn tại (findOne null) → 404 VEHICLE_NOT_FOUND', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.getDetail('veh1', 'attacker'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // ── UC-101 (VPL-002): filter THÊM cho list() — vẫn findAndCount, KHÔNG QueryBuilder ──

    it('UC-101: plate → where.plateNumber = ILike(%NORMALIZED%) (normalize trước match)', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.list('u1', q({ plate: '29a-123' }));
      const where = repo.findAndCount.mock.calls[0][0].where;
      // ILike('%29A123%') — chứng minh normalize (strip '-', upper) + không phải '%29a-123%'.
      expect(where.plateNumber).toEqual(ILike('%29A123%'));
    });

    it('UC-101: vehicle_type → where.vehicleType exact', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.list('u1', q({ vehicleType: 'car' }));
      expect(repo.findAndCount.mock.calls[0][0].where.vehicleType).toBe('car');
    });

    it('UC-101: filter kết hợp status+vehicleType+plate → where đủ 3 khóa + userId + deletedAt', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.list(
        'u1',
        q({ status: 'active', vehicleType: 'car', plate: '30A1' }),
      );
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect(where.status).toBe('active');
      expect(where.vehicleType).toBe('car');
      expect(where.plateNumber).toEqual(ILike('%30A1%'));
      expect(where.userId).toBe('u1');
      expect(where.deletedAt).toBeDefined();
    });

    it('UC-101: filter vắng mặt KHÔNG lọt vào where (chỉ gửi plate)', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.list('u1', q({ plate: '30A1' }));
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect('status' in where).toBe(false);
      expect('vehicleType' in where).toBe(false);
    });

    it('UC-101: list() KHÔNG dùng createQueryBuilder (giữ findAndCount)', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.list('u1', q({ plate: '30A1', vehicleType: 'car' }));
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // ── UC-101 (VPL-002): listAll (route admin) — QueryBuilder, KHÔNG fold userId ──
  describe('UC-101 listAll (admin)', () => {
    const q = (over: any = {}) => ({ page: 1, limit: 20, ...over });
    // Tìm lần gọi andWhere theo mảnh chuỗi SQL.
    const findCall = (frag: string) =>
      qb.andWhere.mock.calls.find((c: any[]) => String(c[0]).includes(frag));

    it('LUÔN leftJoinAndSelect(vr.user) kể cả KHÔNG gửi owner', async () => {
      await service.listAll(q());
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('vr.user', 'u');
    });

    it('KHÔNG fold userId: where chỉ deletedAt IS NULL, không userId từ current', async () => {
      await service.listAll(q());
      expect(qb.where).toHaveBeenCalledWith('vr.deletedAt IS NULL');
      // không có andWhere userId khi client không gửi user_id
      expect(findCall('vr.userId')).toBeUndefined();
    });

    it('user_id exact → andWhere vr.userId bound param', async () => {
      await service.listAll(q({ userId: 'u9' }));
      const call = findCall('vr.userId');
      expect(call).toBeDefined();
      expect(call[1]).toEqual({ uid: 'u9' });
    });

    it('search → OR tên (unaccent) / email / biển số đã normalize', async () => {
      await service.listAll(q({ search: '30a-12' }));
      const call = findCall('unaccent(u.fullName)');
      expect(call).toBeDefined();
      expect(String(call[0])).toContain('u.email ILIKE :s');
      expect(String(call[0])).toContain('vr.plateNumber ILIKE :sp');
      expect(call[1]).toEqual({ s: '%30a-12%', sp: '%30A12%' });
    });

    it('search không có ký tự biển số → bỏ điều kiện plate; escape % _', async () => {
      await service.listAll(q({ search: 'Đinh 5%_' }));
      const call = findCall('unaccent(u.fullName)');
      expect(String(call[0])).toContain('vr.plateNumber'); // '5' vẫn là ký tự biển số
      await service.listAll(q({ search: 'Đỗ' }));
      const last = qb.andWhere.mock.calls.at(-1);
      expect(String(last[0])).not.toContain('vr.plateNumber');
      expect(last[1]).toEqual({ s: '%Đỗ%' });
      expect(call[1].s).toBe('%Đinh 5\\%\\_%');
    });

    it('owner → ILIKE trên full_name OR email, KHÔNG normalize', async () => {
      await service.listAll(q({ owner: 'Nguyen Van' }));
      const call = findCall('u.fullName ILIKE');
      expect(call).toBeDefined();
      expect(String(call[0])).toContain('u.email ILIKE');
      expect(call[1]).toEqual({ o: '%Nguyen Van%' }); // giữ hoa/thường/dấu cách
    });

    it('plate → normalize + ILIKE (khác owner)', async () => {
      await service.listAll(q({ plate: '29a-123' }));
      const call = findCall('vr.plateNumber ILIKE');
      expect(call[1]).toEqual({ p: '%29A123%' });
    });

    it('search + filter KẾT HỢP: gắn CẢ ILIKE LẪN filter (bài học UC-93)', async () => {
      await service.listAll(
        q({ plate: '29A', userId: 'u9', status: 'active' }),
      );
      expect(findCall('vr.plateNumber ILIKE')).toBeDefined(); // search
      expect(findCall('vr.userId')).toBeDefined(); // filter
      expect(findCall('vr.status')).toBeDefined(); // filter
    });

    it('deletedAt IS NULL tường minh + sort createdAt DESC + skip/take', async () => {
      await service.listAll(q({ page: 2, limit: 10 }));
      expect(qb.where).toHaveBeenCalledWith('vr.deletedAt IS NULL');
      expect(qb.orderBy).toHaveBeenCalledWith('vr.createdAt', 'DESC');
      expect(qb.skip).toHaveBeenCalledWith(10);
      expect(qb.take).toHaveBeenCalledWith(10);
    });

    it('list rỗng → items:[], meta.total=0, totalPages=0 (KHÔNG throw)', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      const r = await service.listAll(q());
      expect(r.items).toEqual([]);
      expect(r.meta.total).toBe(0);
      expect(r.meta.totalPages).toBe(0);
    });

    it('meta đúng: total=25 limit=20 → totalPages=2', async () => {
      qb.getManyAndCount.mockResolvedValue([[{ id: 'v1' }], 25]);
      const r = await service.listAll(q({ page: 1, limit: 20 }));
      expect(r.meta).toEqual({ page: 1, limit: 20, total: 25, totalPages: 2 });
    });
  });

  // ── VPT-BE-05: adminSoftDelete (VPT-001) ──
  describe('adminSoftDelete()', () => {
    it('id tồn tại (deletedAt IS NULL) → softDelete gọi với đúng id', async () => {
      const entity = { id: 'veh1', deletedAt: null };
      repo.findOne.mockResolvedValue(entity);
      await service.adminSoftDelete('veh1');
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'veh1', deletedAt: expect.anything() },
      });
      expect(repo.softDelete).toHaveBeenCalledWith('veh1');
    });

    it('id không tồn tại / đã xóa (findOne null) → ném NotFoundException code VEHICLE_NOT_FOUND_OR_FORBIDDEN, softDelete KHÔNG gọi', async () => {
      repo.findOne.mockResolvedValue(undefined);
      await expect(service.adminSoftDelete('not-exist')).rejects.toMatchObject({
        response: {
          code: 'VEHICLE_NOT_FOUND_OR_FORBIDDEN',
          message: 'Không tìm thấy biển số',
        },
      });
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('đồng bộ HGVision (xe đăng ký → Bình thường)', () => {
    let syncPlate: jest.Mock;
    const live = {
      id: 'veh1',
      userId: 'u1',
      plateNumber: '30A12345',
      status: 'active',
    };
    beforeEach(() => {
      syncPlate = jest.fn().mockResolvedValue(undefined);
      hook.register({ syncPlate });
    });

    it('register → báo hook theo biển đã chuẩn hoá, trả dòng đọc lại (có trạng thái)', async () => {
      repo.findOne
        .mockResolvedValueOnce(null) // pre-check trùng
        .mockResolvedValueOnce({ ...live, hgvisionSyncStatus: 'synced' });
      const r = await service.register('u1', { plateRaw: '30A-123.45' });
      expect(syncPlate).toHaveBeenCalledWith('30A12345');
      expect(r.hgvisionSyncStatus).toBe('synced');
    });

    it('HGVision lỗi → đăng ký ở SAVP vẫn thành công', async () => {
      syncPlate.mockRejectedValue(new Error('boom'));
      await expect(
        service.register('u1', { plateRaw: '30A-123.45' }),
      ).resolves.toMatchObject({ plateNumber: '30A12345' });
    });

    it('setStatus / softDeleteOwned / adminSoftDelete → báo hook', async () => {
      repo.findOne.mockResolvedValue({ ...live });
      await service.setStatus('veh1', 'u1', 'disabled');
      await service.softDeleteOwned('veh1', 'u1');
      await service.adminSoftDelete('veh1');
      expect(syncPlate).toHaveBeenCalledTimes(3);
      expect(syncPlate).toHaveBeenCalledWith('30A12345');
    });

    describe('đổi biển (plate_raw)', () => {
      let tx: { insert: jest.Mock; save: jest.Mock };
      const synced = () => ({
        ...live,
        plateRaw: '30A-123.45',
        vehicleType: 'car',
        note: null,
        hgvisionSyncStatus: 'synced',
        hgvisionSyncedAt: new Date('2026-11-19T00:00:00Z'),
        hgvisionSyncError: null,
      });
      beforeEach(() => {
        tx = {
          insert: jest.fn().mockResolvedValue({}),
          save: jest.fn((x: any) => Promise.resolve({ ...x })),
        };
        repo.manager = {
          transaction: jest.fn((cb: any) => cb({ getRepository: () => tx })),
        };
      });

      it('biển sai định dạng → 400 INVALID_PLATE, không lưu, không báo hook', async () => {
        repo.findOne.mockResolvedValue(synced());
        for (const bad of ['ABCDEF', '123456', '30A1', '30A-123.456789']) {
          await expect(
            service.updateMetadata('veh1', 'u1', { plateRaw: bad }),
          ).rejects.toBeInstanceOf(BadRequestException);
        }
        expect(repo.manager.transaction).not.toHaveBeenCalled();
        expect(repo.save).not.toHaveBeenCalled();
        expect(syncPlate).not.toHaveBeenCalled();
      });

      it('biển mới trùng xe khác đang sống → 409 PLATE_ALREADY_REGISTERED', async () => {
        repo.findOne
          .mockResolvedValueOnce(synced()) // loadOwned
          .mockResolvedValueOnce({ id: 'other', plateNumber: '30A99999' }); // trùng
        await expect(
          service.updateMetadata('veh1', 'u1', { plateRaw: '30A-999.99' }),
        ).rejects.toMatchObject({
          response: { code: 'PLATE_ALREADY_REGISTERED' },
        });
        expect(repo.manager.transaction).not.toHaveBeenCalled();
      });

      it('chỉ đổi cách viết (cùng biển chuẩn) → lưu plate_raw, không bia mộ, không kiểm trùng', async () => {
        repo.findOne.mockResolvedValue(synced());
        await service.updateMetadata('veh1', 'u1', { plateRaw: '30a12345' });
        expect(repo.findOne).toHaveBeenCalledTimes(2); // loadOwned + đọc lại sau sync
        expect(repo.manager.transaction).not.toHaveBeenCalled();
        expect(repo.save.mock.calls[0][0]).toMatchObject({
          plateNumber: '30A12345',
          plateRaw: '30a12345',
          hgvisionSyncStatus: 'synced',
        });
        expect(syncPlate).toHaveBeenCalledWith('30A12345');
      });

      it('đổi biển đã đồng bộ → bia mộ giữ dấu biển cũ, dòng sống reset đồng bộ, sync biển cũ rồi biển mới', async () => {
        repo.findOne
          .mockResolvedValueOnce(synced()) // loadOwned
          .mockResolvedValueOnce(null) // kiểm trùng
          .mockResolvedValueOnce({ id: 'veh1', plateNumber: '30A12346' }); // đọc lại
        const r = await service.updateMetadata('veh1', 'u1', {
          plateRaw: '30A-123.46',
        });
        const tomb = tx.insert.mock.calls[0][0];
        expect(tomb).toMatchObject({
          userId: 'u1',
          plateNumber: '30A12345',
          plateRaw: '30A-123.45',
          hgvisionSyncedAt: new Date('2026-11-19T00:00:00Z'),
          note: 'Biển cũ, đã đổi sang 30A12346',
        });
        expect(tomb.deletedAt).toBeInstanceOf(Date);
        expect(tomb.id).toBeUndefined(); // dòng mới, không đè id xe
        expect(tx.save.mock.calls[0][0]).toMatchObject({
          id: 'veh1',
          plateNumber: '30A12346',
          plateRaw: '30A-123.46',
          hgvisionSyncStatus: null,
          hgvisionSyncedAt: null,
          hgvisionSyncError: null,
        });
        expect(syncPlate.mock.calls.map((c) => c[0])).toEqual([
          '30A12345',
          '30A12346',
        ]);
        expect(r.plateNumber).toBe('30A12346');
      });

      it('đổi biển chưa từng đồng bộ → không tạo bia mộ', async () => {
        repo.findOne
          .mockResolvedValueOnce({ ...synced(), hgvisionSyncedAt: null })
          .mockResolvedValueOnce(null);
        await service.updateMetadata('veh1', 'u1', { plateRaw: '30A12346' });
        expect(tx.insert).not.toHaveBeenCalled();
        expect(tx.save).toHaveBeenCalledTimes(1);
      });

      it('race: unique violation lúc lưu → 409, không báo hook', async () => {
        repo.findOne
          .mockResolvedValueOnce(synced())
          .mockResolvedValueOnce(null);
        tx.save.mockRejectedValue({ driverError: { code: '23505' } });
        await expect(
          service.updateMetadata('veh1', 'u1', { plateRaw: '30A12346' }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(syncPlate).not.toHaveBeenCalled();
      });
    });

    it('updateMetadata no-op → KHÔNG báo hook', async () => {
      repo.findOne.mockResolvedValue({ ...live });
      await service.updateMetadata('veh1', 'u1', {});
      expect(syncPlate).not.toHaveBeenCalled();
    });

    it('resync: id không tồn tại → 404; có → báo hook', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.resync('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      repo.findOne.mockResolvedValue({ ...live });
      await service.resync('veh1');
      expect(syncPlate).toHaveBeenCalledWith('30A12345');
    });
  });

  describe('resyncAll (admin đẩy hàng loạt sang HGVision)', () => {
    it('chưa dùng HGVision (hook chưa đăng ký) → enabled=false, không đọc DB', async () => {
      repo.findAndCount = jest.fn();
      await expect(service.resyncAll()).resolves.toMatchObject({
        enabled: false,
        total: 0,
      });
      expect(repo.findAndCount).not.toHaveBeenCalled();
    });

    it('đẩy từng biển chưa đồng bộ rồi đếm kết quả', async () => {
      const syncPlate = jest.fn().mockResolvedValue(undefined);
      hook.register({ syncPlate });
      repo.findAndCount = jest.fn().mockResolvedValue([
        [
          { id: 'a', plateNumber: '30A11111' },
          { id: 'b', plateNumber: '30A22222' },
        ],
        5,
      ]);
      repo.find = jest.fn().mockResolvedValue([
        { id: 'a', hgvisionSyncStatus: 'synced' },
        { id: 'b', hgvisionSyncStatus: 'failed' },
      ]);
      const r = await service.resyncAll();
      expect(syncPlate.mock.calls).toEqual([['30A11111'], ['30A22222']]);
      expect(r).toEqual({
        enabled: true,
        total: 2,
        synced: 1,
        failed: 1,
        pending: 0,
        remaining: 3,
      });
    });
  });
});
