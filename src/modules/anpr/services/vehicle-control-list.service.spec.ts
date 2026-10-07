/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VehicleControlListEntity } from '../entities/vehicle-control-list.entity.js';
import { VehicleControlListService } from './vehicle-control-list.service.js';

describe('VehicleControlListService (VCL-001 / UC8)', () => {
  let service: VehicleControlListService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve({ id: 'cl1', ...x })),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleControlListService,
        {
          provide: getRepositoryToken(VehicleControlListEntity),
          useValue: repo,
        },
      ],
    }).compile();
    service = module.get(VehicleControlListService);
  });

  describe('create', () => {
    it('ok → normalize plate + active=true + createdBy từ tham số, KHÔNG từ dto', async () => {
      const r = await service.create('admin1', {
        plateRaw: '30A-123.45',
        listType: 'blocklist',
        reason: 'stolen',
      } as any);
      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = repo.save.mock.calls[0][0];
      expect(saved.plateNumber).toBe('30A12345');
      expect(saved.plateRaw).toBe('30A-123.45');
      expect(saved.listType).toBe('blocklist');
      expect(saved.reason).toBe('stolen');
      expect(saved.active).toBe(true);
      expect(saved.createdBy).toBe('admin1');
      expect(r.id).toBe('cl1');
    });

    it('reason absent → lưu null', async () => {
      await service.create('admin1', {
        plateRaw: '30A12345',
        listType: 'watchlist',
      } as any);
      expect(repo.save.mock.calls[0][0].reason).toBeNull();
    });

    it('DATA-03 (crux): trùng (plate, list_type) còn sống dù bản ghi cũ active=false → 409, KHÔNG save', async () => {
      repo.findOne.mockResolvedValue({
        id: 'old',
        plateNumber: '30A12345',
        listType: 'blocklist',
        active: false,
      });
      await expect(
        service.create('admin1', {
          plateRaw: '30A12345',
          listType: 'blocklist',
        } as any),
      ).rejects.toMatchObject({
        response: { code: 'PLATE_ALREADY_IN_CONTROL_LIST' },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('conflict là ConflictException (409), KHÔNG lộ id bản ghi cũ trong message', async () => {
      repo.findOne.mockResolvedValue({ id: 'old-secret-id' });
      try {
        await service.create('admin1', {
          plateRaw: '30A12345',
          listType: 'blocklist',
        } as any);
        fail('should throw');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConflictException);
        expect(JSON.stringify(e.response)).not.toContain('old-secret-id');
      }
    });

    it('pre-check dùng đúng (plateNumber, listType, deletedAt IsNull) — KHÔNG lọc theo active', async () => {
      await service.create('admin1', {
        plateRaw: '30A12345',
        listType: 'watchlist',
      } as any);
      const where = repo.findOne.mock.calls[0][0].where;
      expect(where.plateNumber).toBe('30A12345');
      expect(where.listType).toBe('watchlist');
      expect(where.deletedAt).toBeDefined(); // IsNull()
      expect('active' in where).toBe(false);
    });

    it('save ném 23505 (race) → safety-net 409, KHÔNG ném lỗi thô', async () => {
      repo.save.mockRejectedValue({ driverError: { code: '23505' } });
      await expect(
        service.create('admin1', {
          plateRaw: '30A12345',
          listType: 'blocklist',
        } as any),
      ).rejects.toMatchObject({
        response: { code: 'PLATE_ALREADY_IN_CONTROL_LIST' },
      });
    });

    it('save ném lỗi khác (không phải 23505) → ném lại nguyên lỗi', async () => {
      const boom = new Error('db down');
      repo.save.mockRejectedValue(boom);
      await expect(
        service.create('admin1', {
          plateRaw: '30A12345',
          listType: 'blocklist',
        } as any),
      ).rejects.toBe(boom);
    });
  });

  describe('list', () => {
    const q = (over: any = {}) => ({ page: 1, limit: 20, ...over });

    it('không filter nào → where CHỈ deletedAt:IsNull, KHÔNG có plateNumber/listType/active', async () => {
      await service.list(q());
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect(where.deletedAt).toBeDefined();
      expect('plateNumber' in where).toBe(false);
      expect('listType' in where).toBe(false);
      expect('active' in where).toBe(false);
    });

    it('filter plate → normalize trước khi vào where', async () => {
      await service.list(q({ plate: '30a-123.45' }));
      expect(repo.findAndCount.mock.calls[0][0].where.plateNumber).toBe(
        '30A12345',
      );
    });

    it('filter listType → where.listType đúng giá trị', async () => {
      await service.list(q({ listType: 'watchlist' }));
      expect(repo.findAndCount.mock.calls[0][0].where.listType).toBe(
        'watchlist',
      );
    });

    it('CRUX: filter active=false PHẢI được áp dụng (không bị bỏ sót do truthy-check sai)', async () => {
      await service.list(q({ active: false }));
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect('active' in where).toBe(true);
      expect(where.active).toBe(false);
    });

    it('filter active=true → where.active=true', async () => {
      await service.list(q({ active: true }));
      expect(repo.findAndCount.mock.calls[0][0].where.active).toBe(true);
    });

    it('order createdAt DESC + phân trang skip/take đúng', async () => {
      await service.list(q({ page: 2, limit: 10 }));
      const arg = repo.findAndCount.mock.calls[0][0];
      expect(arg.order).toEqual({ createdAt: 'DESC' });
      expect(arg.skip).toBe(10);
      expect(arg.take).toBe(10);
    });

    it('meta đúng: total=25 limit=20 → totalPages=2', async () => {
      const rows = Array.from({ length: 20 }, () => ({ id: 'x' }));
      repo.findAndCount.mockResolvedValue([rows, 25]);
      const r = await service.list(q({ page: 1, limit: 20 }));
      expect(r.meta).toEqual({ page: 1, limit: 20, total: 25, totalPages: 2 });
      expect(r.items).toHaveLength(20);
    });
  });

  describe('checkControlList (VCC-001 / UC9)', () => {
    beforeEach(() => {
      repo.find = jest.fn().mockResolvedValue([]);
    });

    it('không match → null', async () => {
      expect(await service.checkControlList('30A12345')).toBeNull();
    });

    it('match → trả entity; nạp where deletedAt IsNull+active:true, order listType ASC', async () => {
      const e = { id: 'cl1', plateNumber: '30A12345', listType: 'blocklist' };
      repo.find.mockResolvedValue([e]);
      const r = await service.checkControlList('30A12345');
      expect(r).toBe(e);
      const arg = repo.find.mock.calls[0][0];
      expect(arg.where.deletedAt).toBeDefined(); // IsNull()
      expect(arg.where.active).toBe(true);
      expect(arg.order).toEqual({ listType: 'ASC' });
    });

    it('biển có cả blocklist + watchlist → ưu tiên bản đầu (blocklist, theo listType ASC)', async () => {
      const b = { id: 'b', plateNumber: '30A1', listType: 'blocklist' };
      const w = { id: 'w', plateNumber: '30A1', listType: 'watchlist' };
      repo.find.mockResolvedValue([b, w]);
      expect(await service.checkControlList('30A1')).toBe(b);
    });

    it('Đợt 3: cache — nhiều xe qua cổng chỉ 1 query trong TTL', async () => {
      await service.checkControlList('A');
      await service.checkControlList('B');
      await service.checkControlList('C');
      expect(repo.find).toHaveBeenCalledTimes(1);
    });

    it('Đợt 3: create/update/softDelete → xoá cache, lần tra sau nạp lại ngay', async () => {
      await service.checkControlList('A');
      await service.create('u1', {
        plateRaw: '30A-999',
        listType: 'blocklist',
      } as any);
      await service.checkControlList('A');
      expect(repo.find).toHaveBeenCalledTimes(2);
      repo.findOne.mockResolvedValue({
        id: 'cl1',
        plateNumber: 'A',
        active: true,
      });
      await service.update('cl1', { active: false } as any);
      await service.checkControlList('A');
      expect(repo.find).toHaveBeenCalledTimes(3);
      await service.softDelete('cl1');
      await service.checkControlList('A');
      expect(repo.find).toHaveBeenCalledTimes(4);
    });

    it('Đợt 3: hết TTL 60s → nạp lại', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-07T00:00:00Z') });
      try {
        await service.checkControlList('A');
        jest.setSystemTime(new Date('2026-10-07T00:01:01Z'));
        await service.checkControlList('A');
        expect(repo.find).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('getDetail', () => {
    it('tồn tại → trả entity', async () => {
      const e = { id: 'cl1', plateNumber: '30A12345' };
      repo.findOne.mockResolvedValue(e);
      expect(await service.getDetail('cl1')).toBe(e);
      expect(repo.findOne.mock.calls[0][0].where).toMatchObject({ id: 'cl1' });
      expect(repo.findOne.mock.calls[0][0].where.deletedAt).toBeDefined();
    });

    it('không tồn tại/đã xóa mềm → 404 CONTROL_LIST_ENTRY_NOT_FOUND', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getDetail('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      try {
        await service.getDetail('missing');
        fail('should throw');
      } catch (e: any) {
        expect(e.response.code).toBe('CONTROL_LIST_ENTRY_NOT_FOUND');
      }
    });
  });

  describe('update', () => {
    const owned = () => ({
      id: 'cl1',
      plateNumber: '30A12345',
      listType: 'blocklist',
      reason: 'old reason',
      active: true,
    });

    it('không tồn tại → 404, KHÔNG save', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.update('missing', { reason: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('đổi reason + active, KHÔNG đụng plateNumber/listType', async () => {
      repo.findOne.mockResolvedValue(owned());
      await service.update('cl1', { reason: 'new reason', active: false });
      const saved = repo.save.mock.calls[0][0];
      expect(saved.reason).toBe('new reason');
      expect(saved.active).toBe(false);
      expect(saved.plateNumber).toBe('30A12345');
      expect(saved.listType).toBe('blocklist');
    });

    it('undefined: KHÔNG gửi reason → giữ nguyên', async () => {
      repo.findOne.mockResolvedValue(owned());
      await service.update('cl1', { active: false });
      expect(repo.save.mock.calls[0][0].reason).toBe('old reason');
    });

    it('rỗng: cả reason+active absent → no-op, KHÔNG save, trả nguyên trạng', async () => {
      const e = owned();
      repo.findOne.mockResolvedValue(e);
      const r = await service.update('cl1', {});
      expect(repo.save).not.toHaveBeenCalled();
      expect(r).toBe(e);
    });
  });

  describe('softDelete', () => {
    it('tồn tại → gọi repo.softDelete(id) sau getDetail ok', async () => {
      repo.findOne.mockResolvedValue({ id: 'cl1' });
      await service.softDelete('cl1');
      expect(repo.softDelete).toHaveBeenCalledWith('cl1');
    });

    it('không tồn tại/đã xóa mềm → 404, KHÔNG softDelete', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.softDelete('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });
});
