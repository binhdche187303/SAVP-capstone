import { ConfigService } from '@nestjs/config';
import { AuthConfigService } from './auth-config.service';
import { RateLimitService } from './rate-limit.service';
import { RedisService } from '../../redis/redis.service';

/** Redis giả trong bộ nhớ: đủ cho get/incr/expire/del/ttl/setWithTtl. */
function fakeRedis() {
  const store = new Map<string, { v: string; ttl: number }>();
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k)?.v ?? null),
    incr: jest.fn(async (k: string) => {
      const n = Number(store.get(k)?.v ?? 0) + 1;
      store.set(k, { v: String(n), ttl: store.get(k)?.ttl ?? -1 });
      return n;
    }),
    expire: jest.fn(async (k: string, s: number) => {
      const e = store.get(k);
      if (e) e.ttl = s;
    }),
    del: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    ttl: jest.fn(async (k: string) => (store.has(k) ? store.get(k)!.ttl : -2)),
    setWithTtl: jest.fn(async (k: string, v: string, s: number) => {
      store.set(k, { v, ttl: s });
    }),
  };
}

describe('RateLimitService — chỉ đếm lần sai + khoá tạm theo tài khoản', () => {
  const IP = '10.0.0.1';
  const EMAIL = 'user@uel.edu.vn';
  let redis: ReturnType<typeof fakeRedis>;
  let service: RateLimitService;

  const build = (overrides: Record<string, number> = {}) => {
    redis = fakeRedis();
    const cfg = new AuthConfigService({
      get: jest.fn((key: string, def: number) => (key in overrides ? overrides[key] : def)),
    } as unknown as ConfigService);
    service = new RateLimitService(cfg, redis as unknown as RedisService);
  };

  beforeEach(() => build());

  it('đăng nhập ĐÚNG nhiều lần không bao giờ bị chặn', async () => {
    for (let i = 0; i < 20; i++) {
      await expect(service.assertAllowed(IP, EMAIL)).resolves.toBeUndefined();
      await service.recordSuccess(IP, EMAIL);
    }
  });

  it('sai 5 lần (mặc định) theo IP+email → lần kế tiếp bị AUTH_TOO_MANY_ATTEMPTS', async () => {
    for (let i = 0; i < 5; i++) {
      await service.assertAllowed(IP, EMAIL);
      await service.recordFailure(IP, EMAIL);
    }
    await expect(service.assertAllowed(IP, EMAIL)).rejects.toMatchObject({ name: 'AUTH_TOO_MANY_ATTEMPTS' });
    // IP khác chưa bị chặn bởi lớp IP
    await expect(service.assertAllowed('10.0.0.2', EMAIL)).resolves.toBeUndefined();
  });

  it('đăng nhập đúng xoá bộ đếm sai', async () => {
    for (let i = 0; i < 4; i++) await service.recordFailure(IP, EMAIL);
    await service.recordSuccess(IP, EMAIL);
    await service.recordFailure(IP, EMAIL);
    await expect(service.assertAllowed(IP, EMAIL)).resolves.toBeUndefined();
  });

  it('sai 10 lần từ NHIỀU IP khác nhau → khoá tạm tài khoản (AUTH_ACCOUNT_TEMP_LOCKED, có thời gian chờ)', async () => {
    for (let i = 0; i < 10; i++) await service.recordFailure(`10.0.1.${i}`, EMAIL);
    const err = await service.assertAllowed('10.9.9.9', EMAIL).catch((e) => e);
    expect(err).toMatchObject({ name: 'AUTH_ACCOUNT_TEMP_LOCKED', retryAfterSeconds: 15 * 60 });
    // Tài khoản khác không bị ảnh hưởng
    await expect(service.assertAllowed('10.9.9.9', 'other@uel.edu.vn')).resolves.toBeUndefined();
  });

  it('AUTH_LOCKOUT_THRESHOLD = 0 → tắt khoá theo tài khoản', async () => {
    build({ AUTH_LOCKOUT_THRESHOLD: 0 });
    for (let i = 0; i < 30; i++) await service.recordFailure(`10.0.2.${i}`, EMAIL);
    await expect(service.assertAllowed('10.9.9.9', EMAIL)).resolves.toBeUndefined();
  });
});
