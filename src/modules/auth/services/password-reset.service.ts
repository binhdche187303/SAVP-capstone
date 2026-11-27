import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AUTH_ERROR_CODES } from '../constants/auth-error-codes';
import { ConfirmResetDto } from '../dto/confirm-reset.dto';
import { RequestOtpDto } from '../dto/request-otp.dto';
import { ResetAuditRepository } from '../repositories/reset-audit.repository';
import { UsersResetRepository } from '../repositories/users-reset.repository';
import { PasswordResetCacheService } from './password-reset-cache.service';
import { AuthEmailService } from './auth-email.service';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly cacheService: PasswordResetCacheService,
    private readonly emailService: AuthEmailService,
    private readonly usersRepository: UsersResetRepository,
    private readonly auditRepository: ResetAuditRepository,
  ) {}

  /**
   * UC-AUTH-03 Step 1: Request a password reset OTP.
   */
  async requestOtp(
    dto: RequestOtpDto,
    ipAddress?: string,
    userAgent?: string,
    requestId?: string,
  ): Promise<{ success: boolean; message: string; data: null }> {
    const { email } = dto;

    try {
      // 1. Anti-spam Rate Limiting: Check if already blocked (60-minute window)
      const isBlocked = await this.cacheService.isBlocked(email);
      if (isBlocked) {
        throw new HttpException(
          {
            success: false,
            message: 'Yêu cầu quá nhiều lần. Vui lòng thử lại sau.',
            error: {
              code: AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS,
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 2. Increment 5-minute spam counter
      const currentAttempts = await this.cacheService.incrementLimitCounter(
        email,
        300000,
      ); // 5 mins
      if (currentAttempts > 3) {
        // Block the email for 60 minutes
        await this.cacheService.blockEmail(email, 3600000); // 60 mins
        throw new HttpException(
          {
            success: false,
            message: 'Yêu cầu quá nhiều lần. Vui lòng thử lại sau.',
            error: {
              code: AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS,
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 3. Look up user. Unified security error E1 if restricted (soft deleted/locked/inactive/resigned)
      const user = await this.usersRepository.findByEmailForReset(email);
      if (
        !user ||
        user.deletedAt !== null ||
        user.accountStatus !== 'active' ||
        user.employmentStatus !== 'active'
      ) {
        // Chống dò tài khoản: trả Y HỆT phản hồi thành công (không gửi mã). Trước đây trả
        // 400 "Email không tồn tại…" nên người ngoài phân biệt được email nào có tài khoản.
        this.logger.warn(`[PasswordReset] Yêu cầu OTP cho email không hợp lệ/bị hạn chế (không gửi mã).`);
        return {
          success: true,
          message:
            'Nếu email đã đăng ký và tài khoản đang hoạt động, mã xác thực đã được gửi tới email. Vui lòng kiểm tra hộp thư.',
          data: null,
        };
      }

      // 4. Generate a secure 6-digit OTP
      const otp = crypto.randomInt(100000, 999999).toString();
      const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

      // 5. Store OTP SHA-256 hash in Redis (TTL 10 minutes)
      const session = {
        otpHash,
        attempts: 0,
        createdAt: new Date().toISOString(),
      };
      await this.cacheService.setOtpSession(email, session, 600000); // 10 mins

      // 6. Non-blocking Async Dispatch: Send email OTP and Log audit request
      this.emailService.sendOtp(email, otp).catch((err) => {
        this.logger.error(
          `[Non-Blocking] Failed to send OTP email to ${email}: ${err.message}`,
          err.stack,
        );
      });

      this.auditRepository
        .logOtpRequest({
          userId: user.id,
          email,
          ipAddress,
          userAgent,
          requestId,
        })
        .catch((err) => {
          this.logger.error(
            `[Non-Blocking] Failed to log OTP request audit: ${err.message}`,
            err.stack,
          );
        });

      return {
        success: true,
        message:
          'Nếu email đã đăng ký và tài khoản đang hoạt động, mã xác thực đã được gửi tới email. Vui lòng kiểm tra hộp thư.',
        data: null,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Unhandled error during OTP request for ${email}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * UC-AUTH-03 Step 2: Confirm password reset with OTP.
   */
  async confirmReset(
    dto: ConfirmResetDto,
    ipAddress?: string,
    userAgent?: string,
    requestId?: string,
  ): Promise<{ success: boolean; message: string; data: null }> {
    const { email, otp, newPassword } = dto;

    try {
      // 1. Look up user. Unified security error E1 if restricted
      const user = await this.usersRepository.findByEmailForReset(email);
      if (
        !user ||
        user.deletedAt !== null ||
        user.accountStatus !== 'active' ||
        user.employmentStatus !== 'active'
      ) {
        // Cùng thông báo với "sai mã" — không để lộ email nào có tài khoản.
        throw new BadRequestException({
          success: false,
          message:
            'Mã xác thực không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.',
          error: {
            code: AUTH_ERROR_CODES.AUTH_OTP_INVALID_OR_EXPIRED,
          },
        });
      }

      // 2. Fetch active OTP session from Cache
      const session = await this.cacheService.getOtpSession(email);
      if (!session) {
        throw new BadRequestException({
          success: false,
          message:
            'Mã xác thực không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.',
          error: {
            code: AUTH_ERROR_CODES.AUTH_OTP_INVALID_OR_EXPIRED,
          },
        });
      }

      // 3. Validate OTP
      const hashedInput = crypto.createHash('sha256').update(otp).digest('hex');
      if (hashedInput !== session.otpHash) {
        // Brute Force Protection: Increment failed attempts
        session.attempts += 1;

        if (session.attempts >= 5) {
          // Self-destruct key after 5 failed attempts
          await this.cacheService.deleteOtpSession(email);
          throw new BadRequestException({
            success: false,
            message:
              'Mã xác thực không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.',
            error: {
              code: AUTH_ERROR_CODES.AUTH_OTP_INVALID_OR_EXPIRED,
            },
          });
        } else {
          // Update failed attempts and preserve remaining TTL
          const elapsed = Date.now() - new Date(session.createdAt).getTime();
          const remainingTtl = Math.max(0, 600000 - elapsed);
          if (remainingTtl > 0) {
            await this.cacheService.setOtpSession(email, session, remainingTtl);
          }

          throw new BadRequestException({
            success: false,
            message:
              'Mã xác thực không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.',
            error: {
              code: AUTH_ERROR_CODES.AUTH_OTP_INVALID_OR_EXPIRED,
            },
          });
        }
      }

      // 4. OTP is correct! Hash the new password and update in a DB transaction
      const salt = await bcrypt.genSalt(10);
      const newPasswordHash = await bcrypt.hash(newPassword, salt);

      await this.usersRepository.updatePasswordInTransaction(
        user.id,
        newPasswordHash,
      );

      // 5. Invalidate OTP, limits, and blocks immediately
      await this.cacheService.deleteOtpSession(email);
      await this.cacheService.deleteLimitCounter(email);
      await this.cacheService.deleteBlockKey(email);
      await this.cacheService.invalidateUserTokens(user.id, 604800000); // Invalidate old tokens (7 days TTL)

      // 6. Non-blocking Audit Log Dispatch
      this.auditRepository
        .logResetSuccess({
          userId: user.id,
          email,
          ipAddress,
          userAgent,
          requestId,
        })
        .catch((err) => {
          this.logger.error(
            `[Non-Blocking] Failed to log password reset success audit: ${err.message}`,
            err.stack,
          );
        });

      return {
        success: true,
        message:
          'Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.',
        data: null,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Unhandled error during password reset confirmation for ${email}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
