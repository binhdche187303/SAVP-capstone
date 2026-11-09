import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { AUTH_ERROR_CODES } from '../constants/auth-error-codes';
import { LoginDto } from '../dto/login.dto';
import { AuthAuditRepository } from '../repositories/auth-audit.repository';
import { AuthzReadRepository } from '../repositories/authz-read.repository';
import { UsersAuthRepository } from '../repositories/users-auth.repository';
import { BiometricStatusRawRepository } from '../repositories/biometric-status-raw.repository';
import { resolveBiometricReviewStatus } from '../../../common/utils/biometric-status-resolver.util';
import { isBiometricExemptRole } from '../../../common/utils/biometric-exempt-roles.util';
import {
  AuthUserSummary,
  LoginSuccessData,
  RequestContextInfo,
} from '../types/login.types';
import { normalizeLoginEmail } from '../utils/login-normalization.util';
import { AuthConfigService } from './auth-config.service';
import { RateLimitService } from './rate-limit.service';
import { TokenService } from './token.service';

@Injectable()
export class LoginService {
  private readonly logger = new Logger(LoginService.name);

  constructor(
    private readonly usersAuthRepository: UsersAuthRepository,
    private readonly authzReadRepository: AuthzReadRepository,
    private readonly authAuditRepository: AuthAuditRepository,
    private readonly rateLimitService: RateLimitService,
    private readonly tokenService: TokenService,
    private readonly authConfigService: AuthConfigService,
    private readonly biometricStatusRawRepository: BiometricStatusRawRepository,
  ) {}

  async login(
    loginDto: LoginDto,
    requestContext: RequestContextInfo,
  ): Promise<LoginSuccessData> {
    const normalizedEmail = normalizeLoginEmail(loginDto.email);

    try {
      await this.rateLimitService.checkOrThrow(
        requestContext.ipAddress,
        normalizedEmail,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS
      ) {
        throw new HttpException(
          {
            code: AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS,
            message: 'Too many login attempts.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw error;
    }

    const user =
      await this.usersAuthRepository.findByNormalizedEmail(normalizedEmail);
    if (!user) {
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        message: 'Invalid credentials.',
      });
    }

    const passwordMatched =
      !!user.passwordHash &&
      (await bcrypt.compare(loginDto.password, user.passwordHash));
    if (!passwordMatched) {
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        message: 'Invalid credentials.',
      });
    }

    if (
      user.accountExpiresAt &&
      user.accountExpiresAt.getTime() <= Date.now()
    ) {
      throw new ForbiddenException({
        code: AUTH_ERROR_CODES.AUTH_ACCOUNT_EXPIRED,
        message: 'Account has expired.',
      });
    }
    switch (user.accountStatus) {
      case 'active':
        break;
      case 'inactive':
        throw new ForbiddenException({
          code: AUTH_ERROR_CODES.AUTH_ACCOUNT_INACTIVE,
          message: 'Account is inactive.',
        });
      case 'locked':
        throw new HttpException(
          {
            code: AUTH_ERROR_CODES.AUTH_ACCOUNT_LOCKED,
            message: 'Account is locked.',
          },
          HttpStatus.LOCKED,
        );
      default:
        throw new ForbiddenException({
          code: AUTH_ERROR_CODES.AUTH_ACCOUNT_STATUS_NOT_ALLOWED,
          message: 'Account status is not allowed for login.',
        });
    }

    const jti = randomUUID();
    let accessToken: string;
    let refreshToken: string;

    try {
      accessToken = await this.tokenService.generateAccessToken({
        sub: user.id,
        jti,
        email: user.email,
      });
      refreshToken = await this.tokenService.generateRefreshToken({
        sub: user.id,
        jti,
      });
    } catch (error) {
      this.logger.error(
        'Token generation failed.',
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException({
        code: AUTH_ERROR_CODES.AUTH_TOKEN_GENERATION_FAILED,
        message: 'Failed to generate authentication tokens.',
      });
    }

    const authz =
      await this.authzReadRepository.getEffectiveRolesAndPermissions(user.id);

    try {
      await this.usersAuthRepository.updateLastLoginAt(user.id, new Date());
    } catch (error) {
      this.logger.error(
        'Failed to update last_login_at.',
        error instanceof Error ? error.stack : undefined,
      );
    }

    try {
      await this.authAuditRepository.logLoginSuccess({
        userId: user.id,
        requestId: requestContext.requestId,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        jti,
      });
    } catch (error) {
      this.logger.error(
        'Failed to write login audit log.',
        error instanceof Error ? error.stack : undefined,
      );
    }

    // ACCT-BIOMETRIC-SUBMIT-001 (BR-016): tính trạng thái sinh trắc học cho login response.
    // Resilient: lỗi đọc biometric status KHÔNG làm fail login (không chặn đăng nhập).
    let biometricReview = {
      biometricReviewStatus: 'not_uploaded' as const,
      biometricRequired: true,
      shouldShowBiometricPopup: true,
    } as ReturnType<typeof resolveBiometricReviewStatus>;
    try {
      const rows = await this.biometricStatusRawRepository.getFaceProfileRows(
        user.id,
      );
      biometricReview = resolveBiometricReviewStatus(rows);
    } catch (error) {
      this.logger.warn(
        `Failed to resolve biometric review status for user ${user.id}; defaulting to not_uploaded.`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    // BA 2026-08-03: Business Admin/System Admin không cần sinh trắc học vì
    // không trực tiếp tham dự họp qua FaceGate — miễn trừ 2 cờ, giữ nguyên
    // biometricReviewStatus gốc (không thêm giá trị enum mới).
    if (isBiometricExemptRole(authz.roles)) {
      biometricReview = {
        ...biometricReview,
        biometricRequired: false,
        shouldShowBiometricPopup: false,
      };
    }

    const summary: AuthUserSummary = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      biometricReviewStatus: biometricReview.biometricReviewStatus,
      biometricRequired: biometricReview.biometricRequired,
      shouldShowBiometricPopup: biometricReview.shouldShowBiometricPopup,
      departmentId: user.departmentId,
      roles: authz.roles,
      permissions: authz.permissions,
    };

    return {
      accessToken,
      refreshToken,
      expiresIn: this.authConfigService.getAccessTokenTtlSeconds(),
      user: summary,
    };
  }
}
