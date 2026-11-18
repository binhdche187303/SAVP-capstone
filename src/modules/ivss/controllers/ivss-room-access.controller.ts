import {
  Controller,
  Get,
  Param,
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
import { IvssRoomAccessLogService } from '../services/ivss-room-access-log.service.js';
import { QueryRoomAccessLogDto } from '../dto/query-room-access-log.dto.js';

/**
 * IvssRoomAccessController (RAL-001 / Màn 2) — nhật ký ra/vào theo NGÀY.
 *
 * Controller RIÊNG (prefix `ivss`) để KHÔNG đụng `ivss-presence.controller.ts`
 * (prefix `ivss/meetings` — Màn 1, góc nhìn theo cuộc họp).
 *
 * 2 route (ALS-002):
 * - `GET /ivss/access-log`                 — toàn hệ thống (mọi phòng)
 * - `GET /ivss/rooms/:roomId/access-log`   — một phòng (404 nếu phòng không tồn tại)
 *
 * SEC-02: admin-gated bằng permission RIÊNG `ivss.access_log.read` (KHÔNG tái dùng
 * `ivss.presence.read` như bản đầu) — đây là dữ liệu di chuyển cá nhân toàn khuôn viên,
 * phạm vi rộng hơn hẳn presence theo cuộc họp; migration chỉ grant SYSTEM_ADMIN.
 * READ-ONLY.
 */
@ApiTags('IVSS - Room Access Log')
@Controller('ivss')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('ivss.access_log.read')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class IvssRoomAccessController {
  constructor(
    private readonly roomAccessLogService: IvssRoomAccessLogService,
  ) {}

  @Get('access-log')
  @ApiOperation({
    summary:
      'Admin xem nhật ký ra/vào theo ngày cho TOÀN hệ thống (mọi phòng), có phân trang + tìm kiếm',
  })
  async accessLogAll(@Query() query: QueryRoomAccessLogDto) {
    const data = await this.roomAccessLogService.getRoomAccessLog(null, {
      date: query.date,
      roomIds: query.roomIds,
      meetingId: query.meetingId,
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
    return { success: true, message: 'Access log retrieved', data };
  }

  @Get('rooms/:roomId/access-log')
  @ApiOperation({
    summary:
      'Admin xem nhật ký ra/vào theo ngày cho MỘT phòng cụ thể (404 nếu phòng không tồn tại)',
  })
  async accessLog(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: QueryRoomAccessLogDto,
  ) {
    const data = await this.roomAccessLogService.getRoomAccessLog(roomId, {
      date: query.date,
      roomIds: query.roomIds,
      meetingId: query.meetingId,
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
    return { success: true, message: 'Room access log retrieved', data };
  }
}
