import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { GuestSessionGuard } from '../guards/guest-session.guard.js';
import { GuestMeetingScopeGuard } from '../guards/guest-meeting-scope.guard.js';
import { GuestContentService } from '../services/guest-content.service.js';
import { GuestRequestContext } from '../types/guest-jwt-payload.type.js';

/**
 * GuestContentController — nội dung cuộc họp bản rút gọn cho khách ĐÃ có
 * phiên hợp lệ (`GuestSessionGuard`) và ĐÚNG cuộc họp (`GuestMeetingScopeGuard`).
 *
 * KHÁC HOÀN TOÀN `LiveMeetingController`/`MeetingsController` nội bộ — không
 * dùng `JwtAuthGuard`/`PermissionsGuard`, không permission nào (spec FR-GLA-023).
 */
@ApiTags('guest-access')
@Controller('guest/meetings')
export class GuestContentController {
  constructor(private readonly guestContentService: GuestContentService) {}

  @Get(':meetingId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(GuestSessionGuard, GuestMeetingScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem noi dung cuoc hop ban rut gon (khach ngoai cong ty)',
    description:
      'Chi tra du lieu Muc B: thong tin hop, agenda, danh sach nguoi du (chi ten+to chuc), trang thai phien, ghi chu host chu dong chia se. KHONG transcript/recording/bien ban.',
  })
  @ApiParam({ name: 'meetingId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Nội dung cuộc họp' })
  @ApiResponse({ status: 401, description: 'GUEST_SESSION_INVALID' })
  @ApiResponse({
    status: 403,
    description: 'GUEST_MEETING_SCOPE_MISMATCH / GUEST_LOBBY_PENDING',
  })
  @ApiResponse({ status: 409, description: 'GUEST_MEETING_CANCELLED' })
  async getMeetingView(@Req() request: Request): Promise<{
    success: boolean;
    message: string;
    data: unknown;
  }> {
    const guest = (request as unknown as { guest: GuestRequestContext }).guest;
    const data = await this.guestContentService.getGuestMeetingView(guest);
    return { success: true, message: 'Nội dung cuộc họp', data };
  }
}
