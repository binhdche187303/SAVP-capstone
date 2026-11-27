import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthConfigService {
  constructor(private readonly configService: ConfigService) {}

  getAccessTokenTtlSeconds(): number {
    return this.configService.get<number>(
      'AUTH_ACCESS_TOKEN_TTL_SECONDS',
      60 * 180,
    );
  }

  getAccessTokenSecret(): string {
    return this.configService.get<string>('AUTH_ACCESS_TOKEN_SECRET', 'secret');
  }

  getRefreshTokenTtlSeconds(): number {
    return this.configService.get<number>(
      'AUTH_REFRESH_TOKEN_TTL_SECONDS',
      60 * 60 * 24 * 30,
    );
  }

  getRefreshTokenSecret(): string {
    return this.configService.get<string>(
      'AUTH_REFRESH_TOKEN_SECRET',
      'dev-refresh-secret',
    );
  }

  getRateLimitMaxAttempts(): number {
    return this.configService.get<number>(
      'AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS',
      5,
    );
  }

  getRateLimitWindowSeconds(): number {
    return this.configService.get<number>(
      'AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS',
      300,
    );
  }

  /** Sai liên tiếp bao nhiêu lần thì khoá tạm tài khoản (0 = tắt). */
  getLockoutThreshold(): number {
    return Number(this.configService.get<number>('AUTH_LOCKOUT_THRESHOLD', 10));
  }

  getLockoutWindowSeconds(): number {
    return Number(this.configService.get<number>('AUTH_LOCKOUT_WINDOW_MINUTES', 30)) * 60;
  }

  getLockoutDurationSeconds(): number {
    return Number(this.configService.get<number>('AUTH_LOCKOUT_MINUTES', 15)) * 60;
  }
}
