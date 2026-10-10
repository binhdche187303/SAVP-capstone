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

const make = (bucket: string | undefined, redis: Partial<Record<'incr' | 'expire' | 'ttl', jest.Mock>>) => {
  const reflector = { getAllAndOverride: jest.fn(() => bucket) } as unknown as Reflector;
  const config = { get: jest.fn(async () => VISITOR_CONFIG_DEFAULTS) };
  return new PublicRateLimitGuard(reflector, redis as never, config as never);
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

  it('khóa theo IP: lấy phần tử đầu của X-Forwarded-For', async () => {
    const redis = { incr: jest.fn(async () => 1), expire: jest.fn(), ttl: jest.fn() };
    await make('lookup', redis).canActivate(ctx({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }).context);
    expect(redis.incr).toHaveBeenCalledWith('visitor:rl:lookup:9.9.9.9');
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
