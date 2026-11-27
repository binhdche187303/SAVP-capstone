import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import type { Request } from 'express';
import { UsersChangePasswordRepository } from '../repositories/users-change-password.repository';
import { RequestIdentityResolver } from '../services/request-identity.resolver';

/**
 * Routes that are ALWAYS allowed, even when must_change_password = true.
 * These are exact prefix matches against request.path.
 */
const ALLOWED_ROUTE_PREFIXES = [
  '/api/v1/auth/me',
  '/api/v1/auth/change-password',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
] as const;

/**
 * MustChangePasswordGuard — UC-AUTH-04 (FR-CHPWD-026)
 *
 * Must run AFTER JwtAuthGuard so that request.user is already populated.
 * Reads must_change_password from DB each request (no cache) to ensure
 * freshness — avoids stale JWT-claim issues when Admin changes the flag.
 *
 * Design decision: DB query per request is acceptable for v1.
 * Future optimisation: cache with short TTL (e.g. 30 s) in Redis.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  private readonly logger = new Logger(MustChangePasswordGuard.name);

  constructor(
    private readonly usersRepo: UsersChangePasswordRepository,
    @Optional() private readonly identity?: RequestIdentityResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Guard toàn cục chạy TRƯỚC JwtAuthGuard ở controller → tự xác định người gọi.
    // Không có token hợp lệ (route công khai / token sai) → bỏ qua, JwtAuthGuard tự xử lý.
    const userId =
      (request['user'] as { userId?: string } | undefined)?.userId ??
      (await this.identity?.resolveUserId(request)) ??
      null;
    if (!userId) {
      return true;
    }

    const path = request.path;

    // Whitelisted routes — always allowed regardless of flag.
    if (ALLOWED_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return true;
    }

    // Query DB for current flag value.
    const result = await this.usersRepo
      .findMustChangePassword(userId)
      .catch((err: unknown) => {
        this.logger.error(
          `[MustChangePasswordGuard] DB lookup failed for user ${userId}: ${(err as Error).message}`,
          (err as Error).stack,
        );
        // Fail-open: if we can't check, allow the request to avoid locking out users.
        return null;
      });

    if (result?.mustChangePassword) {
      throw new ForbiddenException({
        success: false,
        message:
          'Tài khoản của bạn yêu cầu đổi mật khẩu trước khi tiếp tục. Vui lòng đổi mật khẩu tại /api/v1/auth/change-password.',
        error: {
          code: 'MUST_CHANGE_PASSWORD',
          details: {},
        },
      });
    }

    return true;
  }
}
