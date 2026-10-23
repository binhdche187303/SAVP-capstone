import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  NotFoundException,
  ForbiddenException,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { IvssPresenceQueryService } from '../services/ivss-presence-query.service.js';
import { IvssPresenceReportService } from '../services/ivss-presence-report.service.js';

/**
 * IvssPresenceController (IPD-001 #41+#42) — READ-ONLY admin xem duration + timeline per-person.
 * SEC-02: admin-only (JwtAuthGuard + PermissionsGuard). KHÔNG mutate. KHÔNG lộ ảnh.
 */
@ApiTags('IVSS - Presence')
@Controller('ivss/meetings')
export class IvssPresenceController {
  constructor(
    private readonly presenceQueryService: IvssPresenceQueryService,
    private readonly presenceReportService: IvssPresenceReportService,
  ) {}

  // #43 (IPR-001): tải PDF báo cáo hiện diện cả họp. C2: @Res() file, KHÔNG envelope.
  // ⚠ LUẬT THỨ TỰ: route STATIC `report` phải khai TRƯỚC route động `:userId` bên dưới
  // (cùng method GET, cùng 5 segment). Khai sau sẽ bị `:userId` nuốt → ParseUUIDPipe 400.
  @Get(':meetingId/presence/report')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('ivss.presence.read')
  @ApiOperation({
    summary:
      'Admin tải báo cáo PDF hiện diện của toàn bộ cuộc họp (trả file nhị phân, không qua envelope JSON)',
  })
  async report(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() currentUser: { userId: string },
    @Res() res: Response,
  ) {
    let report: { buffer: Buffer; filename: string } | null;
    try {
      report = await this.presenceReportService.buildMeetingReport(
        meetingId,
        currentUser.userId,
      );
    } catch (e) {
      // [FIX 2026-08-13] EMPLOYEE bị buildMeetingReport() ném ForbiddenException chủ đích —
      // phải để Nest exception filter xử lý đúng 403, KHÔNG nuốt chung vào nhánh 500 dưới đây.
      if (e instanceof ForbiddenException) {
        throw e;
      }
      // Lỗi render → 500, KHÔNG lộ path/chi tiết nội bộ.
      res.status(500).end();
      return;
    }
    if (!report) {
      res.status(404).json({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.filename}"`,
    );
    res.send(report.buffer);
  }

  // #41 + #42 chi tiết 1 người trong 1 họp.
  @Get(':meetingId/presence/:userId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('ivss.presence.read')
  @ApiOperation({
    summary:
      'Admin xem thời lượng + timeline hiện diện của 1 người trong 1 cuộc họp cụ thể',
  })
  async userPresence(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() currentUser: { userId: string },
  ) {
    const data = await this.presenceQueryService.getUserPresence(
      meetingId,
      userId,
      currentUser.userId,
    );
    if (!data) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }
    return { success: true, message: 'IVSS user presence retrieved', data };
  }

  // Summary mọi participant trong 1 họp.
  @Get(':meetingId/presence')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('ivss.presence.read')
  @ApiOperation({
    summary:
      'Admin xem tổng hợp hiện diện của tất cả người tham dự trong 1 cuộc họp',
  })
  async meetingPresence(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() currentUser: { userId: string },
  ) {
    const data = await this.presenceQueryService.getMeetingPresence(
      meetingId,
      currentUser.userId,
    );
    if (!data) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }
    return { success: true, message: 'IVSS meeting presence retrieved', data };
  }

  @Get(':meetingId/access-events')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('ivss.presence.read')
  @ApiOperation({ summary: 'Xem nhật ký vào/ra chi tiết của phòng họp' })
  async meetingAccessEvents(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() currentUser: { userId: string },
  ) {
    const data = await this.presenceQueryService.getMeetingAccessEvents(
      meetingId,
      currentUser.userId,
    );
    if (!data) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }
    return { success: true, message: 'Meeting access events retrieved', data };
  }

}
