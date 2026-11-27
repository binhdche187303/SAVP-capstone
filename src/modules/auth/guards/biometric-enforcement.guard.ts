import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthzReadRepository } from '../repositories/authz-read.repository';
import { BiometricStatusRawRepository } from '../repositories/biometric-status-raw.repository';
import { resolveBiometricReviewStatus } from '../../../common/utils/biometric-status-resolver.util';
import { isBiometricExemptRole } from '../../../common/utils/biometric-exempt-roles.util';
import { RequestIdentityResolver } from '../services/request-identity.resolver';

/**
 * Routes that are ALWAYS allowed, even when biometricReviewStatus is
 * not_uploaded/rejected. Exact prefix matches against request.path.
 */
const ALLOWED_ROUTE_PREFIXES = [
  '/api/v1/me/biometric-status',
  '/api/v1/me/biometric-submission',
  // [2026-11-23] Quét FaceID webcam 5 góc (tự duyệt).
  '/api/v1/me/biometric-scan',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
  '/api/v1/auth/me',
] as const;

/**
 * BiometricEnforcementGuard — server-side enforcement cho luồng bắt buộc nộp
 * sinh trắc học (Docs/Nam_Sent/be-biometric-enforcement.md §2, yêu cầu FE 2026-08-08).
 *
 * FE hiện chặn UI khi biometricReviewStatus = not_uploaded/rejected, nhưng
 * enforcement đó chỉ ở phía client — bypass bằng Postman/DevTools vẫn gọi được
 * API bình thường. Guard này chặn lại ở BE cho mọi role KHÔNG nằm trong
 * BIOMETRIC_EXEMPT_ROLE_CODES (hiện tại chỉ có MANAGER/EMPLOYEE là non-exempt).
 *
 * Phải chạy SAU JwtAuthGuard (request.user đã được populate) — cùng cơ chế
 * APP_GUARD + đọc DB mỗi request (không cache) + fail-open khi lỗi DB như
 * MustChangePasswordGuard (xem file cạnh, cùng lý do: v1 chấp nhận query mỗi
 * request, tránh khoá nhầm user khi DB lỗi).
 */
@Injectable()
export class BiometricEnforcementGuard implements CanActivate {
  private readonly logger = new Logger(BiometricEnforcementGuard.name);

  constructor(
    private readonly authzReadRepository: AuthzReadRepository,
    private readonly biometricStatusRawRepository: BiometricStatusRawRepository,
    @Optional() private readonly identity?: RequestIdentityResolver,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /**
   * Công tắc BIOMETRIC_ENFORCEMENT_ENABLED (mặc định false). Bật = chặn MỌI API (trừ
   * whitelist) với tài khoản chưa nộp / bị từ chối sinh trắc. Tắt = chỉ nhắc ở giao diện.
   * Thiếu ConfigService (unit test khởi tạo tay) → coi như bật để giữ hành vi cũ của test.
   */
  private isEnforcementEnabled(): boolean {
    if (!this.config) return true;
    return this.config.get<boolean>('BIOMETRIC_ENFORCEMENT_ENABLED', false) === true;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // If JwtAuthGuard hasn't populated user (unauthenticated route), skip.
    if (!this.isEnforcementEnabled()) {
      return true;
    }
    // Guard toàn cục chạy TRƯỚC JwtAuthGuard ở controller → tự xác định người gọi.
    const resolvedUserId =
      (request['user'] as { userId?: string } | undefined)?.userId ??
      (await this.identity?.resolveUserId(request)) ??
      null;
    if (!resolvedUserId) {
      return true;
    }
    const user = { userId: resolvedUserId };

    const path = request.path;

    // Whitelisted routes — always allowed regardless of biometric status.
    if (ALLOWED_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return true;
    }

    const { userId } = user;

    try {
      const { roles } =
        await this.authzReadRepository.getEffectiveRolesAndPermissions(userId);

      // BA 2026-08-03: Business Admin/System Admin không tham dự họp qua
      // FaceGate nên không bị chặn (đồng bộ với login/status — xem
      // isBiometricExemptRole).
      if (isBiometricExemptRole(roles)) {
        return true;
      }

      const rows =
        await this.biometricStatusRawRepository.getFaceProfileRows(userId);
      const { biometricReviewStatus } = resolveBiometricReviewStatus(rows);

      if (
        biometricReviewStatus === 'not_uploaded' ||
        biometricReviewStatus === 'rejected'
      ) {
        throw new ForbiddenException({
          success: false,
          error: {
            code: 'BIOMETRIC_REQUIRED',
            message:
              'Tài khoản cần hoàn tất nộp ảnh sinh trắc học trước khi sử dụng hệ thống.',
          },
        });
      }
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.error(
        `[BiometricEnforcementGuard] DB lookup failed for user ${userId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      // Fail-open: nếu không kiểm tra được, cho phép request để tránh khoá nhầm user.
      return true;
    }

    return true;
  }
}
