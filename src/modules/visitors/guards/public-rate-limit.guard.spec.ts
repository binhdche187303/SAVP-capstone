import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PublicRateLimitGuard, PUBLIC_RATE_LIMIT_KEY } from './public-rate-limit.guard.js';
import { VISITOR_CONFIG_DEFAULTS } from '../config/visitor-config.service.js';

const ctx = (headers: Record<string, string> = {}, ip = '1.1.1.1') => {
  const res = { setHeader: jest.fn() };
  const handler = () => undefined;
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ headers, ip }), getResponse: () => res }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  return { context, res, handler };
};

const make = (bucket: string | undefined, redis: Partial<Record<'incr' | 'expire' | 'ttl', jest.Mock>>, hops = 1) => {
  const reflector = { getAllAndOverride: jest.fn(() => bucket) } as unknown as Reflector;
  const config = { get: jest.fn(async () => VISITOR_CONFIG_DEFAULTS) };
  const appConfig = { get: jest.fn((_key: string, fallback: unknown) => (_key === 'TRUST_PROXY_HOPS' ? hops : fallback)) };
  return new PublicRateLimitGuard(reflector, redis as never, config as never, appConfig as never);
};

describe('PublicRateLimitGuard', () => {
  it('5 lần đầu qua, lần 6 → 429 kèm Retry-After', async () => {
    let n = 0;
    const redis = { incr: jest.fn(async () => ++n), expire: jest.fn(async () => undefined), ttl: jest.fn(async () => 420) };
    const guard = make('register', redis);
    for (let i = 0; i < 5; i += 1) await expect(guard.canActivate(ctx().context)).resolves.toBe(true);
    const c = ctx();
    await expect(guard.canActivate(c.context)).rejects.toMatchObject({ status: 429 });
    expect(c.res.setHeader).toHaveBeenCalledWith('Retry-After', '420');
    expect(redis.expire).toHaveBeenCalledTimes(1); // chỉ đặt hạn ở lần đầu
  });

  it('khóa theo IP do proxy đáng tin nối thêm (phần tử cuối), không theo phần client tự điền', async () => {
    const redis = { incr: jest.fn(async () => 1), expire: jest.fn(), ttl: jest.fn() };
    await make('lookup', redis).canActivate(ctx({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }).context);
    expect(redis.incr).toHaveBeenCalledWith('visitor:rl:lookup:10.0.0.1');
  });

  it('giả X-Forwarded-For mỗi lần KHÔNG né được giới hạn: lần 6 từ cùng IP thật vẫn bị 429', async () => {
    const counts = new Map<string, number>();
    const redis = {
      incr: jest.fn(async (k: string) => { counts.set(k, (counts.get(k) ?? 0) + 1); return counts.get(k) as number; }),
      expire: jest.fn(async () => undefined),
      ttl: jest.fn(async () => 300),
    };
    const guard = make('register', redis);
    for (let i = 0; i < 5; i += 1) {
      await expect(guard.canActivate(ctx({ 'x-forwarded-for': `10.9.9.${i}, 203.0.113.7` }).context)).resolves.toBe(true);
    }
    await expect(guard.canActivate(ctx({ 'x-forwarded-for': '10.9.9.99, 203.0.113.7' }).context)).rejects.toMatchObject({ status: 429 });
  });

  it('Redis lỗi → cho qua', async () => {
    const redis = { incr: jest.fn(async () => { throw new Error('redis down'); }), expire: jest.fn(), ttl: jest.fn() };
    await expect(make('register', redis).canActivate(ctx().context)).resolves.toBe(true);
  });

  it('endpoint không gắn nhóm giới hạn → cho qua, không đụng Redis', async () => {
    const redis = { incr: jest.fn(), expire: jest.fn(), ttl: jest.fn() };
    await expect(make(undefined, redis).canActivate(ctx().context)).resolves.toBe(true);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('khóa metadata dùng chung', () => {
    expect(PUBLIC_RATE_LIMIT_KEY).toBe('visitor:public-rate-limit');
  });
});
