import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GuestOtpService } from '../services/guest-otp.service.js';
import { VerifyGuestOtpDto } from '../dto/verify-guest-otp.dto.js';
import { GuestInviteInfoResponseDto } from '../dto/guest-invite-info-response.dto.js';
import { VerifyGuestOtpResponseDto } from '../dto/verify-guest-otp-response.dto.js';

/**
 * GuestAccessController — 3 endpoint CÔNG KHAI (không JWT) cho khách ngoài
 * công ty. Xem `AuthModule`/`RateLimitGuard` — TUYỆT ĐỐI không cắm guard đó
 * vào đây (stub `return true`, NFR-GLA-006).
 *
 * Endpoint xem nội dung cuộc họp (`GET /guest/meetings/:meetingId`) nằm ở
 * `GuestContentController` riêng (dùng `GuestSessionGuard`) — xem Phase 3.
 */
@ApiTags('guest-access')
@Controller('guest/invites')
export class GuestAccessController {
  constructor(private readonly guestOtpService: GuestOtpService) {}

  @Get(':token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xem thong tin loi moi cua khach ngoai cong ty',
    description:
      'Cong khai, khong yeu cau JWT. KHONG co truong nao cho phep nhap email — chi tra ve email da che (FR-GLA-007).',
  })
  @ApiParam({
    name: 'token',
    type: String,
    description: 'Link mời dạng <epId>.<secret>',
  })
  @ApiResponse({ status: 200, description: 'Thông tin lời mời' })
  @ApiResponse({ status: 400, description: 'GUEST_INVITE_INVALID' })
  @ApiResponse({ status: 409, description: 'GUEST_MEETING_CANCELLED' })
  @ApiResponse({
    status: 410,
    description: 'GUEST_INVITE_EXPIRED / GUEST_INVITE_REVOKED',
  })
  async getInviteInfo(@Param('token') token: string): Promise<{
    success: boolean;
    message: string;
    data: GuestInviteInfoResponseDto;
  }> {
    const info = await this.guestOtpService.getInviteInfo(token);
    return {
      success: true,
      message: 'Thông tin lời mời',
      data: new GuestInviteInfoResponseDto({
        meetingTitle: info.meetingTitle,
        startTime: info.startTime.toISOString(),
        endTime: info.endTime.toISOString(),
        hostName: info.hostName,
        maskedEmail: info.maskedEmail,
        verificationMode: info.verificationMode,
      }),
    };
  }

  @Post(':token/otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gui ma OTP toi email da luu cua loi moi',
    description:
      'Ma OTP CHI gui toi email da luu trong DB tu luc host moi — KHONG bao gio nhan email tu client.',
  })
  @ApiParam({ name: 'token', type: String })
  @ApiResponse({ status: 200, description: 'Da gui ma xac nhan' })
  @ApiResponse({
    status: 409,
    description: 'GUEST_JOIN_WINDOW_CLOSED / GUEST_OTP_BLOCKED',
  })
  @ApiResponse({ status: 429, description: 'GUEST_OTP_TOO_MANY_REQUESTS' })
  async requestOtp(
    @Param('token') token: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.guestOtpService.requestOtp(token);
    return {
      success: true,
      message: 'Mã xác nhận đã được gửi tới email của bạn',
    };
  }

  @Post(':token/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xac minh OTP, cap phien truy cap cho khach',
    description:
      'Tra ve guestToken (JWT ky bang GUEST_TOKEN_SECRET, KHAC secret nhan vien).',
  })
  @ApiParam({ name: 'token', type: String })
  @ApiResponse({ status: 200, description: 'Xác thực thành công' })
  @ApiResponse({
    status: 409,
    description: 'GUEST_OTP_INVALID / GUEST_OTP_BLOCKED',
  })
  async verifyOtp(
    @Param('token') token: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: VerifyGuestOtpDto,
  ): Promise<{
    success: boolean;
    message: string;
    data: VerifyGuestOtpResponseDto;
  }> {
    const result = await this.guestOtpService.verifyOtp(token, dto.otp);
    return {
      success: true,
      message: 'Xác thực thành công',
      data: new VerifyGuestOtpResponseDto(result),
    };
  }
}
