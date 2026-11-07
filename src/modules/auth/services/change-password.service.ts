import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { UsersChangePasswordRepository } from '../repositories/users-change-password.repository';
import { ChangePasswordCacheService } from './change-password-cache.service';
import { ChangePasswordAuditRepository } from '../repositories/change-password-audit.repository';
import { PasswordResetCacheService } from './password-reset-cache.service';

/** Context forwarded from controller (no sensitive data). */
export interface ChangePasswordContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * ChangePasswordService — UC-AUTH-04
 *
 * Implements the 10-step business logic (BL-1 … BL-10) for changing a
 * logged-in user's own password.  All sensitive reads/writes happen inside a
 * single DB transaction with a row-level lock (SELECT … FOR UPDATE).
 */
@Injectable()
export class ChangePasswordService {
  private readonly logger = new Logger(ChangePasswordService.name);

  /** 7 days in ms — TTL for the passive-invalidation Redis key. */
  private readonly TOKEN_INVALIDATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly dataSource: DataSource,
    private readonly usersRepo: UsersChangePasswordRepository,
    private readonly cacheService: ChangePasswordCacheService,
    private readonly auditRepo: ChangePasswordAuditRepository,
    private readonly passwordResetCacheService: PasswordResetCacheService,
  ) {}

  /**
   * Entry point for PATCH /api/v1/auth/change-password.
   *
   * @param userId  Extracted from JWT payload — never from request body.
   * @param dto     Validated ChangePasswordDto.
   * @param ctx     IP / UA / requestId for audit.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    ctx: ChangePasswordContext,
  ): Promise<{ success: boolean; message: string }> {
    // ── BL-1: Early exit if user is blocked by rate-limit ──────────────────
    const blocked = await this.cacheService.isBlocked(userId);
    if (blocked) {
      throw new HttpException(
        {
          success: false,
          message:
            'Bạn đã nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút.',
          error: {
            code: 'CHANGE_PASSWORD_RATE_LIMITED',
            details: { retryAfterMinutes: 15 },
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ── BL-2: confirmPassword must match newPassword ────────────────────────
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException({
        success: false,
        message: 'Mật khẩu xác nhận không trùng khớp',
        error: { code: 'CONFIRM_PASSWORD_MISMATCH', details: {} },
      });
    }

    // ── BL-3 … BL-7: DB transaction with row-level lock ────────────────────
    await this.dataSource.transaction(async (em) => {
      // BL-3: Lock the user row
      const user = await this.usersRepo.findByIdForUpdate(userId, em);

      if (!user || user.deletedAt !== null) {
        throw new ForbiddenException({
          success: false,
          message: 'Tài khoản không tồn tại hoặc đã bị xóa.',
          error: { code: 'ACCOUNT_RESTRICTED', details: {} },
        });
      }

      if (user.accountStatus !== 'active') {
        throw new ForbiddenException({
          success: false,
          message:
            'Tài khoản của bạn đang bị khóa hoặc không hoạt động. Vui lòng liên hệ quản trị viên.',
          error: { code: 'ACCOUNT_RESTRICTED', details: {} },
        });
      }

      // BL-4: Verify currentPassword via bcrypt
      const currentPasswordValid =
        !!user.passwordHash &&
        (await bcrypt.compare(dto.currentPassword, user.passwordHash));

      if (!currentPasswordValid) {
        // Increment rate-limit counter (may throw InternalServerErrorException on Redis failure)
        const newCount = await this.cacheService.incrementFailedCounter(userId);
        this.logger.warn(
          `[ChangePassword] Wrong currentPassword for user ${userId}. Attempt #${newCount}.`,
        );

        if (newCount >= 5) {
          // Set block flag; fire-and-forget audit for rate-limited event
          await this.cacheService.setBlockFlag(userId);
          this.auditRepo
            .logRateLimited({ userId, ...ctx })
            .catch((err: unknown) => {
              this.logger.error(
                `[ChangePassword] Failed to write rate-limited audit log: ${(err as Error).message}`,
              );
            });
        }

        throw new BadRequestException({
          success: false,
          message: 'Mật khẩu hiện tại không chính xác. Vui lòng kiểm tra lại.',
          error: { code: 'CURRENT_PASSWORD_INCORRECT', details: {} },
        });
      }

      // BL-5: newPassword must not equal current password (E5 — server-side bcrypt check)
      const sameAsCurrent =
        !!user.passwordHash &&
        (await bcrypt.compare(dto.newPassword, user.passwordHash));
      if (sameAsCurrent) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'Mật khẩu mới không được trùng với mật khẩu hiện tại.',
          error: { code: 'SAME_AS_CURRENT_PASSWORD', details: {} },
        });
      }

      // BL-6: Hash the new password
      const salt = await bcrypt.genSalt(10);
      const newPasswordHash = await bcrypt.hash(dto.newPassword, salt);

      // BL-7: Persist — UPDATE within the transaction (row is still locked)
      await this.usersRepo.updatePassword(em, userId, newPasswordHash);
    });

    // ── BL-8: Passive JWT invalidation — set auth:user:{userId}:invalid_after ─
    await this.passwordResetCacheService.invalidateUserTokens(
      userId,
      this.TOKEN_INVALIDATION_TTL_MS,
    );

    // ── BL-9: Fire-and-forget audit log ───────────────────────────────────────
    this.auditRepo.logSuccess({ userId, ...ctx }).catch((err: unknown) => {
      this.logger.error(
        `[ChangePassword] Failed to write success audit log: ${(err as Error).message}`,
      );
    });

    // ── BL-10: Return success ─────────────────────────────────────────────────
    return {
      success: true,
      message:
        'Thay đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới.',
    };
  }
}
