import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '../../redis/redis.service.js';
import { NotificationReadStateService } from './notification-read-state.service.js';

describe('NotificationReadStateService (BE-07)', () => {
  let service: NotificationReadStateService;
  let redisService: jest.Mocked<RedisService>;

  beforeEach(async () => {
    redisService = {
      sadd: jest.fn(),
      sismember: jest.fn(),
      smembers: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      expire: jest.fn(),
    } as unknown as jest.Mocked<RedisService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationReadStateService,
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get(NotificationReadStateService);
  });

  describe('markRead', () => {
    it('sadd vào notif:read:{userId} rồi refresh TTL 90 ngày', async () => {
      redisService.sadd.mockResolvedValue(1);
      redisService.expire.mockResolvedValue(undefined);

      await service.markRead('u1', 'n1');

      expect(redisService.sadd).toHaveBeenCalledWith('notif:read:u1', 'n1');
      expect(redisService.expire).toHaveBeenCalledWith(
        'notif:read:u1',
        90 * 24 * 60 * 60,
      );
    });

    it('idempotent: gọi 2 lần không lỗi (sadd không trùng lặp thêm)', async () => {
      redisService.sadd.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      redisService.expire.mockResolvedValue(undefined);

      await service.markRead('u1', 'n1');
      await service.markRead('u1', 'n1');

      expect(redisService.sadd).toHaveBeenCalledTimes(2);
    });

    it('Redis lỗi → fail-soft, KHÔNG throw', async () => {
      redisService.sadd.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.markRead('u1', 'n1')).resolves.toBeUndefined();
    });
  });

  describe('markAllRead', () => {
    it('ghi mốc ISO timestamp vào notif:readall:{userId}', async () => {
      redisService.set.mockResolvedValue(undefined);
      await service.markAllRead('u1');
      expect(redisService.set).toHaveBeenCalledWith(
        'notif:readall:u1',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      );
    });

    it('Redis lỗi → fail-soft, KHÔNG throw', async () => {
      redisService.set.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.markAllRead('u1')).resolves.toBeUndefined();
    });
  });

  describe('getReadState', () => {
    it('đọc SET + mốc readAll 1 lần, trả Set + Date', async () => {
      redisService.smembers.mockResolvedValue(['n1', 'n2']);
      redisService.get.mockResolvedValue('2026-07-01T00:00:00.000Z');

      const state = await service.getReadState('u1');

      expect(state.readIds).toEqual(new Set(['n1', 'n2']));
      expect(state.readAllAt).toEqual(new Date('2026-07-01T00:00:00.000Z'));
    });

    it('chưa có mốc readAll → readAllAt=null', async () => {
      redisService.smembers.mockResolvedValue([]);
      redisService.get.mockResolvedValue(null);

      const state = await service.getReadState('u1');
      expect(state.readAllAt).toBeNull();
    });

    it('Redis lỗi → fail-soft, trả trạng thái coi như chưa đọc gì', async () => {
      redisService.smembers.mockRejectedValue(new Error('ECONNREFUSED'));

      const state = await service.getReadState('u1');
      expect(state.readIds.size).toBe(0);
      expect(state.readAllAt).toBeNull();
    });
  });

  describe('markGroupRead (đọc cả nhóm loại + ngày)', () => {
    it('sadd "type|YYYY-MM-DD" vào notif:readgrp:{userId} + TTL 90 ngày', async () => {
      await service.markGroupRead('u1', 'unknown_vehicle_alert', '2026-10-26');
      expect(redisService.sadd).toHaveBeenCalledWith(
        'notif:readgrp:u1',
        'unknown_vehicle_alert|2026-10-26',
      );
      expect(redisService.expire).toHaveBeenCalledWith(
        'notif:readgrp:u1',
        90 * 24 * 60 * 60,
      );
    });

    it('getReadState đọc thêm tập nhóm đã đọc', async () => {
      redisService.smembers.mockImplementation((key: string) =>
        Promise.resolve(
          key === 'notif:readgrp:u1'
            ? ['unknown_vehicle_alert|2026-10-26']
            : [],
        ),
      );
      redisService.get.mockResolvedValue(null);
      const state = await service.getReadState('u1');
      expect(state.readGroups).toEqual(
        new Set(['unknown_vehicle_alert|2026-10-26']),
      );
    });

    it('computeIsRead: thuộc nhóm đã đọc (theo ngày giờ VN) → true', () => {
      const state = {
        readIds: new Set<string>(),
        readAllAt: null,
        readGroups: new Set(['unknown_vehicle_alert|2026-10-26']),
      };
      // 2026-10-25T18:30Z = 01:30 ngày 26/10 giờ VN
      expect(
        service.computeIsRead(
          state,
          'x',
          new Date('2026-10-25T18:30:00Z'),
          'unknown_vehicle_alert',
        ),
      ).toBe(true);
      expect(
        service.computeIsRead(
          state,
          'y',
          new Date('2026-10-26T18:30:00Z'),
          'unknown_vehicle_alert',
        ),
      ).toBe(false);
      expect(
        service.computeIsRead(
          state,
          'z',
          new Date('2026-10-25T18:30:00Z'),
          'late_checkin_alert',
        ),
      ).toBe(false);
    });
  });

  describe('computeIsRead', () => {
    it('id nằm trong SET đã đọc → true', () => {
      const result = service.computeIsRead(
        { readIds: new Set(['n1']), readAllAt: null },
        'n1',
        new Date('2026-07-20T00:00:00Z'),
      );
      expect(result).toBe(true);
    });

    it('createdAt <= readAllAt → true (đã đọc tất cả tới mốc đó)', () => {
      const result = service.computeIsRead(
        {
          readIds: new Set(),
          readAllAt: new Date('2026-07-20T00:00:00Z'),
        },
        'n-old',
        new Date('2026-07-19T00:00:00Z'),
      );
      expect(result).toBe(true);
    });

    it('createdAt > readAllAt và không trong SET → false (notification mới hơn mốc)', () => {
      const result = service.computeIsRead(
        {
          readIds: new Set(),
          readAllAt: new Date('2026-07-20T00:00:00Z'),
        },
        'n-new',
        new Date('2026-07-21T00:00:00Z'),
      );
      expect(result).toBe(false);
    });

    it('không có gì (SET rỗng, readAllAt null) → false', () => {
      const result = service.computeIsRead(
        { readIds: new Set(), readAllAt: null },
        'n1',
        new Date(),
      );
      expect(result).toBe(false);
    });
  });

  describe('isRead', () => {
    it('gọi getReadState rồi computeIsRead cho 1 notification', async () => {
      redisService.smembers.mockResolvedValue(['n1']);
      redisService.get.mockResolvedValue(null);

      const result = await service.isRead('u1', 'n1', new Date());
      expect(result).toBe(true);
    });
  });
});
