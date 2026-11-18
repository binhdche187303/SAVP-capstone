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
import { IvssZoneAccessLogService } from '../services/ivss-zone-access-log.service.js';
import { QueryZoneAccessLogDto } from '../dto/query-zone-access-log.dto.js';

/**
 * IvssZoneAccessController (Zone Access Log — đường B, FIX 2026-08-11) — nhật ký ra/vào
 * theo NGÀY cho MỘT zone khu vực. Controller RIÊNG (mirror `IvssRoomAccessController`),
 * KHÔNG đụng `ivss-room-access.controller.ts`.
 *
 * 1 route: `GET /ivss/zones/:zoneId/access-log` — 404 nếu zone không tồn tại/đã xóa mềm.
 *
 * SEC-02: admin-gated bằng permission TÁI DÙNG `ivss.access_log.read` (KHÔNG tạo permission
 * mới — đã seed SYSTEM_ADMIN từ `20260804000001-SeedIvssAccessLogReadPermission.ts`, mở
 * thêm BUSINESS_ADMIN/MANAGER từ `20260809000001-GrantAccessLogReadToBusinessAdminManager.ts`).
 * READ-ONLY.
 */
@ApiTags('IVSS - Zone Access Log')
@Controller('ivss')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('ivss.access_log.read')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class IvssZoneAccessController {
  constructor(
    private readonly zoneAccessLogService: IvssZoneAccessLogService,
  ) {}

  @Get('zones/:zoneId/access-log')
  @ApiOperation({
    summary:
      'Admin xem nhật ký ra/vào theo ngày cho MỘT zone khu vực (404 nếu zone không tồn tại), CẢ người quen lẫn người lạ, có phân trang + tìm kiếm',
  })
  async accessLog(
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Query() query: QueryZoneAccessLogDto,
  ) {
    const data = await this.zoneAccessLogService.getZoneAccessLog(zoneId, {
      date: query.date,
      from: query.from,
      to: query.to,
      page: query.page,
      limit: query.limit,
      search: query.search,
      status: query.status,
    });
    return { success: true, message: 'Zone access log retrieved', data };
  }
}
