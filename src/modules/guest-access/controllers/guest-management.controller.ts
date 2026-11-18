import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { GuestManagementService } from '../services/guest-management.service.js';

/**
 * GuestManagementController — API PHÍA HOST quản lý lời mời/phòng chờ khách.
 *
 * Khác hoàn toàn `GuestAccessController`/`GuestContentController` (dành cho
 * khách) — controller này dùng `JwtAuthGuard`+`PermissionsGuard` như mọi
 * endpoint nội bộ khác, cộng thêm ownership-or-admin check ở tầng service
 * (`GuestManagementService.assertOwnershipOrAdmin`).
 */
@ApiTags('guest-access-management')
@Controller('live-meetings/:meetingId/guests')
export class GuestManagementController {
  constructor(
    private readonly guestManagementService: GuestManagementService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.guest.session.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xem danh sach khach ngoai cong ty cua cuoc hop' })
  @ApiParam({ name: 'meetingId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Danh sách khách' })
  @ApiResponse({ status: 403, description: 'NOT_MEETING_HOST / FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'MEETING_NOT_FOUND' })
  async listGuests(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; message: string; data: unknown }> {
    const data = await this.guestManagementService.listGuests(
      meetingId,
      user.userId,
    );
    return { success: true, message: 'Danh sách khách', data };
  }

  @Get('lobby')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.guest.admit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xem hang cho duyet vao cua cuoc hop' })
  @ApiParam({ name: 'meetingId', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Danh sach externalParticipantId dang cho',
  })
  async listLobby(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; message: string; data: string[] }> {
    const data = await this.guestManagementService.listLobby(
      meetingId,
      user.userId,
    );
    return { success: true, message: 'Hàng chờ duyệt vào', data };
  }

  @Post(':externalParticipantId/admit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.guest.admit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Duyet khach vao cuoc hop' })
  @ApiParam({ name: 'meetingId', type: String, format: 'uuid' })
  @ApiParam({ name: 'externalParticipantId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Da duyet' })
  async admit(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('externalParticipantId', ParseUUIDPipe)
    externalParticipantId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; message: string }> {
    await this.guestManagementService.admit(
      meetingId,
      externalParticipantId,
      user.userId,
    );
    return { success: true, message: 'Đã duyệt khách vào cuộc họp' };
  }

  @Post(':externalParticipantId/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.guest.admit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tu choi khach o phong cho' })
  @ApiParam({ name: 'meetingId', type: String, format: 'uuid' })
  @ApiParam({ name: 'externalParticipantId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Da tu choi' })
  async reject(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('externalParticipantId', ParseUUIDPipe)
    externalParticipantId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; message: string }> {
    await this.guestManagementService.reject(
      meetingId,
      externalParticipantId,
      user.userId,
    );
    return { success: true, message: 'Đã từ chối khách' };
  }

  @Post(':externalParticipantId/resend-invite')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.guest.invite.manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Gui lai link moi cho khach',
    description:
      'Sinh loi moi MOI, lam link cu mat hieu luc ngay lap tuc (FR-GLA-005/013).',
  })
  @ApiParam({ name: 'meetingId', type: String, format: 'uuid' })
  @ApiParam({ name: 'externalParticipantId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Da gui lai link moi' })
  @ApiResponse({
    status: 404,
    description: 'EXTERNAL_PARTICIPANT_NOT_FOUND / GUEST_EMAIL_MISSING',
  })
  async resendInvite(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('externalParticipantId', ParseUUIDPipe)
    externalParticipantId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; message: string }> {
    await this.guestManagementService.resendInvite(
      meetingId,
      externalParticipantId,
      user.userId,
    );
    return { success: true, message: 'Đã gửi lại link mời cho khách' };
  }

  @Delete(':externalParticipantId/access')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.guest.invite.manage')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thu hoi quyen truy cap cua khach ngay lap tuc' })
  @ApiParam({ name: 'meetingId', type: String, format: 'uuid' })
  @ApiParam({ name: 'externalParticipantId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Da thu hoi' })
  async revokeAccess(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('externalParticipantId', ParseUUIDPipe)
    externalParticipantId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; message: string }> {
    await this.guestManagementService.revokeAccess(
      meetingId,
      externalParticipantId,
      user.userId,
    );
    return { success: true, message: 'Đã thu hồi quyền truy cập của khách' };
  }
}
