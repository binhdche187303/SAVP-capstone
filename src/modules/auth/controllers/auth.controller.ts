import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Patch,
  Post,
  Req,
  SetMetadata,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { LoginDto } from '../dto/login.dto';
import { LogoutResponseDto } from '../dto/logout-response.dto';
import { RequestOtpDto } from '../dto/request-otp.dto';
import { ConfirmResetDto } from '../dto/confirm-reset.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { RefreshTokenResponseDto } from '../dto/refresh-token-response.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { LoginResponsePresenter } from '../presenters/login-response.presenter';
import { LoginService } from '../services/login.service';
import { LogoutService } from '../services/logout.service';
import { PasswordResetService } from '../services/password-reset.service';
import { ChangePasswordService } from '../services/change-password.service';
import { GetMeService } from '../services/get-me.service';
import { RefreshTokenService } from '../services/refresh-token.service';
import { AllowPartnerAccount } from '../../../common/decorators/allow-partner-account.decorator';
import { hasOnlyAllowedLoginFields } from '../utils/login-normalization.util';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly loginService: LoginService,
    private readonly logoutService: LogoutService,
    private readonly loginResponsePresenter: LoginResponsePresenter,
    private readonly passwordResetService: PasswordResetService,
    private readonly changePasswordService: ChangePasswordService,
    private readonly getMeService: GetMeService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  @ApiOperation({
    summary:
      'Đăng nhập bằng username/email + mật khẩu, trả về access/refresh token',
  })
  async login(
    @Body() loginDto: LoginDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('x-request-id') requestId?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const rawBody = request.body as Record<string, unknown>;
    if (!hasOnlyAllowedLoginFields(rawBody)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request body contains unsupported fields.',
          details: [],
          requestId,
        },
      };
    }

    const result = await this.loginService.login(loginDto, {
      ipAddress,
      requestId,
      userAgent,
    });

    return this.loginResponsePresenter.success(result);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @AllowPartnerAccount()
  // KHONG gan @UseGuards(JwtAuthGuard): access token da het han la ly do goi
  // endpoint nay nen khong the doi hoi access token con hop le. Xac thuc o day
  // dua vao chinh chu ky cua refresh token (secret rieng) + doi chieu Redis
  // blacklist trong RefreshTokenService — mirror cach lam public cua repo
  // (xem 'login', khong co UseGuards). (SEC-02, BE-01, 2026-07-26)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Cap phat cap access+refresh token moi tu mot refresh token con hop le. ' +
      'Ap dung rotation: refresh token cu bi blacklist ngay sau khi dung (chong replay).',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({
    status: 200,
    description: 'Refresh thanh cong',
    type: RefreshTokenResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error (thieu refreshToken)',
  })
  @ApiUnauthorizedResponse({
    description:
      'Refresh token invalid/het han (REFRESH_TOKEN_INVALID) hoac da bi thu hoi (REFRESH_TOKEN_REVOKED)',
  })
  async refresh(@Body() dto: RefreshTokenDto): Promise<{
    success: boolean;
    message: string;
    data: RefreshTokenResponseDto;
  }> {
    const result = await this.refreshTokenService.refresh(dto.refreshToken);

    return {
      success: true,
      message: 'Làm mới token thành công',
      data: new RefreshTokenResponseDto(result),
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @AllowPartnerAccount()
  @UseGuards(JwtAuthGuard)
  @SetMetadata('ignoreBlacklist', true)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout',
    description: 'Invalidates the current session token',
  })
  @ApiResponse({
    status: 200,
    description: 'Logout successful',
    type: LogoutResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized / Token invalid' })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error (e.g., Redis issue)',
  })
  async logout(
    @Req() request: Request,
  ): Promise<{ success: boolean; message: string; data: LogoutResponseDto }> {
    const user = request['user'] as {
      userId: string;
      jti: string;
      exp: number;
    };

    // Blacklist the token
    await this.logoutService.logout(user.jti, user.exp);

    // Fire-and-forget audit logging
    this.logoutService
      .logLogoutAudit(user.userId, user.jti, request)
      .catch(() => {});

    return {
      success: true,
      message: 'Logout successful',
      data: {
        revoked: true,
        revokedAt: new Date(),
      },
    };
  }

  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: 'Request password reset OTP',
    description: 'Generates and sends a 6-digit OTP to the user email',
  })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  @ApiResponse({
    status: 400,
    description: 'E1 Unified Account Restricted error',
  })
  @ApiResponse({ status: 429, description: 'Spam rate limited block' })
  async requestOtp(
    @Body() dto: RequestOtpDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.passwordResetService.requestOtp(
      dto,
      ipAddress,
      userAgent,
      requestId,
    );
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: 'Confirm password reset with OTP',
    description: 'Verifies the OTP and resets user password',
  })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({
    status: 400,
    description: 'E1 Unified error or E2 OTP invalid/expired',
  })
  async confirmReset(
    @Body() dto: ConfirmResetDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.passwordResetService.confirmReset(
      dto,
      ipAddress,
      userAgent,
      requestId,
    );
  }

  @Patch('change-password')
  @HttpCode(HttpStatus.OK)
  @AllowPartnerAccount()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'Change password',
    description:
      'Allows an authenticated user to change their own password. Requires current password verification. ' +
      'Passive JWT invalidation is applied after success — old tokens are rejected on subsequent requests.',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({
    status: 400,
    description:
      'Validation error | Wrong current password | Confirm password mismatch | Password policy violation',
  })
  @ApiUnauthorizedResponse({
    description:
      'Unauthorized — JWT missing, expired, or invalidated after password change',
  })
  @ApiResponse({
    status: 403,
    description: 'Account restricted (locked / inactive)',
  })
  @ApiResponse({
    status: 422,
    description: 'New password is the same as the current password',
  })
  @ApiResponse({
    status: 429,
    description: 'Too many failed attempts — rate limited for 15 minutes',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error (DB / Redis failure)',
  })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = (request as unknown as { user: { userId: string } }).user;
    const userId = user.userId;

    return this.changePasswordService.changePassword(userId, dto, {
      ipAddress,
      userAgent,
      requestId,
    });
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @AllowPartnerAccount()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Returns the profile of the currently authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getMe(
    @Req() request: Request,
  ): Promise<{ success: boolean; message: string; data: object }> {
    const user = (request as unknown as { user: { userId: string } }).user;
    const data = await this.getMeService.getMe(user.userId);
    return {
      success: true,
      message: 'Lấy thông tin tài khoản thành công',
      data,
    };
  }
}
