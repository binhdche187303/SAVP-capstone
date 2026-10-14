import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { JwtQueryOrHeaderAuthGuard } from '../../auth/guards/jwt-query-or-header-auth.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { DeviceEventSnapshotService } from '../services/device-event-snapshot.service.js';

/**
 * IvssDeviceEventSnapshotController (F-F fix) — TÁCH RIÊNG khỏi
 * IvssRoomAccessController để route ảnh snapshot dùng
 * JwtQueryOrHeaderAuthGuard (chấp nhận token qua `?token=` — `<img src>` không gắn
 * được header Authorization) mà KHÔNG đụng 2 route accessLogAll/accessLog (vẫn
 * JwtAuthGuard gốc, chỉ chấp header — 0 thay đổi, xem git diff
 * ivss-room-access.controller.ts).
 *
 * Cùng path (`ivss/device-events/:eventId/snapshot`) + cùng permission
 * `ivss.access_log.read` như bản gốc trong IvssRoomAccessController — FE KHÔNG cần
 * đổi URL, chỉ route bị dời sang controller khác.
 */
@ApiTags('IVSS - Device Event Snapshot')
@Controller('ivss/device-events')
@UseGuards(JwtQueryOrHeaderAuthGuard, PermissionsGuard)
@RequirePermissions('ivss.access_log.read')
export class IvssDeviceEventSnapshotController {
  constructor(
    private readonly deviceEventSnapshotService: DeviceEventSnapshotService,
  ) {}

  @Get(':eventId/snapshot')
  @ApiOperation({
    summary:
      'Lấy ảnh snapshot của 1 sự kiện thiết bị (khuôn mặt/xe) — yêu cầu quyền ivss.access_log.read, chấp nhận token qua query string (?token=) để dùng trực tiếp trong thẻ <img>',
  })
  async snapshot(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() currentUser: { userId: string },
    @Res() res: Response,
    @Query('type') type?: string,
  ) {
    const snapshot = await this.deviceEventSnapshotService.getSnapshot(
      eventId,
      currentUser.userId,
      type === 'plate' ? 'plate' : 'full',
    );
    // Ảnh HGVision: cho trình duyệt cache để mở lại không gọi HGVision lần nữa.
    if (snapshot.remote)
      res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Type', snapshot.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${snapshot.fileName}"`,
    );
    res.send(snapshot.buffer);
  }
}
