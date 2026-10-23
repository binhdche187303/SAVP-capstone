import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { StrangerAlertService } from '../services/stranger-alert.service.js';
import { ListStrangerAlertsQueryDto } from '../dto/list-stranger-alerts.query.dto.js';
import { ReviewStrangerDto } from '../dto/review-stranger.dto.js';
import { DismissStrangerDto, ReopenStrangerDto } from '../dto/dismiss-stranger.dto.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

/**
 * StrangerAlertController (SAL-001 / #20) — admin xem stranger gần đây.
 * SEC-02: admin-only (JwtAuthGuard + PermissionsGuard). KHÔNG lộ payload/base64.
 */
@ApiTags('Face Access - Stranger Alerts')
@Controller('face-access/stranger-alerts')
export class StrangerAlertController {
  constructor(private readonly strangerAlertService: StrangerAlertService) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('face.stranger.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary:
      'Admin xem danh sách cảnh báo người lạ (stranger) gần đây, có phân trang',
  })
  async list(@Query() query: ListStrangerAlertsQueryDto) {
    const result = await this.strangerAlertService.list(query);
    return {
      success: true,
      message: 'Stranger alerts retrieved',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get(':deviceId/sightings')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('face.stranger.read')
  @ApiOperation({
    summary:
      'Các lần xuất hiện của 1 người lạ trên 1 thiết bị (strangerId rỗng = người lạ thiết bị không gán mã)',
  })
  async sightings(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Query('strangerId') strangerId?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.strangerAlertService.listSightings(
      deviceId,
      strangerId || null,
      status === 'dismissed' ? 'dismissed' : 'pending',
    );
    return { success: true, message: 'Stranger sightings retrieved', data };
  }

  @Get('events/:eventId/candidate-meetings')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('face.stranger.review')
  @ApiOperation({ summary: 'Cuộc họp có thể gán cho sự kiện người lạ (cùng phòng, sát thời điểm event)' })
  async candidateMeetings(@Param('eventId', ParseUUIDPipe) eventId: string) {
    const data = await this.strangerAlertService.listCandidateMeetings(eventId);
    return { success: true, message: 'Candidate meetings retrieved', data };
  }

  @Post('review')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('face.stranger.review')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Hậu kiểm: xác nhận các sự kiện người lạ thực ra là một người cụ thể' })
  async review(@Body() dto: ReviewStrangerDto, @CurrentUser() user: { userId: string }) {
    const data = await this.strangerAlertService.review(dto, user.userId);
    return { success: true, message: 'Stranger events reviewed', data };
  }

  @Post('dismiss')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('face.stranger.review')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Đóng cảnh báo người lạ (bắt buộc lý do, có audit, mở lại được)' })
  async dismiss(@Body() dto: DismissStrangerDto, @CurrentUser() user: { userId: string }) {
    const data = await this.strangerAlertService.dismiss(dto, user.userId);
    return { success: true, message: 'Stranger events dismissed', data };
  }

  @Post('reopen')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('face.stranger.review')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Mở lại cảnh báo người lạ đã đóng' })
  async reopen(@Body() dto: ReopenStrangerDto, @CurrentUser() user: { userId: string }) {
    const data = await this.strangerAlertService.reopen(dto, user.userId);
    return { success: true, message: 'Stranger events reopened', data };
  }
}
