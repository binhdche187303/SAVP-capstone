import { Injectable } from '@nestjs/common';
import { AUTH_ERROR_CODES } from '../constants/auth-error-codes';
import { AuthConfigService } from './auth-config.service';
import { RedisService } from '../../redis/redis.service';

/**
 * Chống dò mật khẩu cho đăng nhập — 2 lớp:
 *  1. Theo IP + email (`rate_limit:login:<ip>:<email>`): tối đa N lần SAI trong cửa sổ.
 *  2. Khoá tạm THEO TÀI KHOẢN (không phụ thuộc IP, chống đổi IP liên tục):
 *     sai liên tiếp ≥ AUTH_LOCKOUT_THRESHOLD lần trong AUTH_LOCKOUT_WINDOW_MINUTES
 *     → khoá AUTH_LOCKOUT_MINUTES phút. THRESHOLD = 0 → tắt lớp này.
 *
 * Chỉ lần đăng nhập SAI mới bị đếm; đăng nhập đúng xoá bộ đếm (trước đây đếm cả lần đúng
 * nên đăng nhập 6 lần / 5 phút — nhiều tab, cả nhóm dùng chung tài khoản — bị 429).
 */
@Injectable()
export class RateLimitService {
  private readonly PREFIX = 'rate_limit:login:';
  private readonly ACCOUNT_FAIL_PREFIX = 'auth:lockout:fail:';
  private readonly ACCOUNT_LOCK_PREFIX = 'auth:lockout:until:';

  constructor(
    private readonly authConfigService: AuthConfigService,
    private readonly redisService: RedisService,
  ) {}

  private ipKey(ipAddress: string | undefined, email: string): string {
    return `${this.PREFIX}${ipAddress ?? 'unknown'}:${email}`;
  }

  /** Chặn trước khi kiểm tra mật khẩu: tài khoản đang khoá tạm hoặc IP+email đã sai quá nhiều. */
  async assertAllowed(ipAddress: string | undefined, email: string): Promise<void> {
    const lockTtl = await this.redisService.ttl(`${this.ACCOUNT_LOCK_PREFIX}${email}`);
    if (lockTtl > 0 || lockTtl === -1) {
      const error = new Error(AUTH_ERROR_CODES.AUTH_ACCOUNT_TEMP_LOCKED) as Error & {
        retryAfterSeconds?: number;
      };
      error.name = AUTH_ERROR_CODES.AUTH_ACCOUNT_TEMP_LOCKED;
      error.retryAfterSeconds = lockTtl > 0 ? lockTtl : undefined;
      throw error;
    }
    const current = Number((await this.redisService.get(this.ipKey(ipAddress, email))) ?? 0);
    if (current >= this.authConfigService.getRateLimitMaxAttempts()) {
      const error = new Error(AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS);
      error.name = AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS;
      throw error;
    }
  }

  /** Ghi nhận 1 lần sai (email không tồn tại hoặc sai mật khẩu — đếm như nhau, không lộ email). */
  async recordFailure(ipAddress: string | undefined, email: string): Promise<void> {
    const key = this.ipKey(ipAddress, email);
    const n = await this.redisService.incr(key);
    if (n === 1) {
      await this.redisService.expire(key, this.authConfigService.getRateLimitWindowSeconds());
    }

    const threshold = this.authConfigService.getLockoutThreshold();
    if (threshold <= 0) return;
    const failKey = `${this.ACCOUNT_FAIL_PREFIX}${email}`;
    const fails = await this.redisService.incr(failKey);
    if (fails === 1) {
      await this.redisService.expire(failKey, this.authConfigService.getLockoutWindowSeconds());
    }
    if (fails >= threshold) {
      await this.redisService.setWithTtl(
        `${this.ACCOUNT_LOCK_PREFIX}${email}`,
        '1',
        this.authConfigService.getLockoutDurationSeconds(),
      );
      await this.redisService.del(failKey);
    }
  }

  /** Đăng nhập đúng → xoá bộ đếm sai của IP+email và của tài khoản. */
  async recordSuccess(ipAddress: string | undefined, email: string): Promise<void> {
    await this.redisService.del(this.ipKey(ipAddress, email));
    await this.redisService.del(`${this.ACCOUNT_FAIL_PREFIX}${email}`);
  }

  /**
   * @deprecated Đếm CẢ lần đăng nhập đúng — giữ cho tương thích; luồng đăng nhập dùng
   * assertAllowed() + recordFailure() + recordSuccess().
   */
  async checkOrThrow(
    ipAddress: string | undefined,
    email: string,
  ): Promise<void> {
    const maxAttempts = this.authConfigService.getRateLimitMaxAttempts();
    const windowSeconds = this.authConfigService.getRateLimitWindowSeconds();
    const key = this.ipKey(ipAddress, email);

    const current = await this.redisService.incr(key);
    if (current === 1) {
      await this.redisService.expire(key, windowSeconds);
    }

    if (current > maxAttempts) {
      const error = new Error(AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS);
      error.name = AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS;
      throw error;
    }
  }
}
