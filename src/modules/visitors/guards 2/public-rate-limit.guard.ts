import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RedisService } from '../../redis/redis.service.js';
import { VisitorConfigService } from '../config/visitor-config.service.js';

export const PUBLIC_RATE_LIMIT_KEY = 'visitor:public-rate-limit';
export type PublicRateLimitBucket = 'register' | 'lookup' | 'hosts';
/** Gắn nhóm giới hạn tần suất cho endpoint công khai của phân hệ Khách (SEC: chống lạm dụng). */
export const PublicRateLimit = (bucket: PublicRateLimitBucket) => SetMetadata(PUBLIC_RATE_LIMIT_KEY, bucket);

/**
 * Giới hạn theo IP bằng Redis: INCR + EXPIRE ở lần đầu của cửa sổ. Vượt → 429 `RATE_LIMITED` + Retry-After.
 * Redis lỗi → cho qua (ghi cảnh báo): không để sự cố Redis khóa cả cổng đăng ký.
 */
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(PublicRateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly config: VisitorConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bucket = this.reflector.getAllAndOverride<PublicRateLimitBucket | undefined>(PUBLIC_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!bucket) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    const ip = forwarded || req.ip || 'unknown';
    const [limit, windowSeconds] = (await this.config.get()).publicRateLimit[bucket];
    const key = `visitor:rl:${bucket}:${ip}`;

    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, windowSeconds);
      if (count > limit) {
        const ttl = await this.redis.ttl(key);
        res.setHeader('Retry-After', String(ttl > 0 ? ttl : windowSeconds));
        throw new HttpException(
          { success: false, message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.', error: { code: 'RATE_LIMITED', details: {} } },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.warn(`Rate limit bỏ qua do Redis lỗi: ${e instanceof Error ? e.message : 'unknown'}`);
    }
    return true;
  }
}
