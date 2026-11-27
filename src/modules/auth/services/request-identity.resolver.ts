import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { RedisService } from '../../redis/redis.service';
import { AuthConfigService } from './auth-config.service';

/**
 * Xác định người gọi cho các GUARD TOÀN CỤC (APP_GUARD).
 *
 * Vì sao cần: NestJS chạy guard toàn cục TRƯỚC guard gắn ở controller. JwtAuthGuard
 * của dự án gắn theo từng controller, nên lúc MustChangePasswordGuard /
 * BiometricEnforcementGuard / PartnerAccountRestrictionGuard chạy thì `request.user`
 * CHƯA có → trước đây 3 guard này luôn `return true` (không bao giờ chặn).
 *
 * Resolver này xác thực access token y hệt JwtAuthGuard (chữ ký + blacklist jti +
 * mốc invalid_after khi đổi mật khẩu) nhưng KHÔNG ném lỗi: token sai/thiếu → null để
 * JwtAuthGuard ở controller tự trả 401 như cũ. Token khách (guest) ký bằng secret khác
 * nên không qua được bước verify → null → không bị các guard nội bộ áp dụng.
 */
@Injectable()
export class RequestIdentityResolver {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authConfigService: AuthConfigService,
    private readonly redisService: RedisService,
  ) {}

  async resolveUserId(request: Request): Promise<string | null> {
    const existing = (request['user'] as { userId?: string } | undefined)?.userId;
    if (existing) return existing;

    const token = this.extractToken(request);
    if (!token) return null;

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub?: string;
        jti?: string;
        iat?: number;
      }>(token, { secret: this.authConfigService.getAccessTokenSecret() });
      if (!payload?.sub) return null;

      if (payload.jti && (await this.redisService.exists(`blacklist:${payload.jti}`))) {
        return null;
      }
      const invalidAfter = await this.redisService.get(
        `auth:user:${payload.sub}:invalid_after`,
      );
      if (
        invalidAfter !== null &&
        (payload.iat ?? 0) * 1000 < parseInt(invalidAfter, 10)
      ) {
        return null;
      }
      return payload.sub;
    } catch {
      return null;
    }
  }

  /** Header `Authorization: Bearer` trước; `?token=` (route ảnh dùng JwtQueryOrHeaderAuthGuard) sau. */
  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token) return token;
    const fromQuery = request.query?.['token'];
    return typeof fromQuery === 'string' && fromQuery ? fromQuery : undefined;
  }
}
