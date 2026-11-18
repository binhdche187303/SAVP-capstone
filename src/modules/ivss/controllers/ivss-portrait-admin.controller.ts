import {
  Controller,
  Post,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { IvssPortraitSyncService } from '../services/ivss-portrait-sync.service.js';

/**
 * IvssPortraitAdminController (phương án c, phần 2) — force re-sync mapping
 * portrait 1 user khi có báo cáo cụ thể "bị nhận nhầm Người lạ" dù đã có mặt
 * trong kho chân dung thường trực. CHỈ đánh dấu `sync_status='pending'` —
 * KHÔNG tự enroll ngay (tránh block response chờ SDK call). reconcilePortraits()
 * (cron, mỗi 5 phút) tự nhặt và xử lý ở lượt tick kế tiếp, đi qua đúng
 * enrollPortrait() đã có (tự xóa device_person_id cũ trước khi enroll mới).
 */
@ApiTags('IVSS - Portrait Admin')
@Controller('admin/ivss/portrait')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class IvssPortraitAdminController {
  constructor(private readonly portraitSyncService: IvssPortraitSyncService) {}

  @Post(':userId/resync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ivss.portrait.manage')
  @ApiOperation({
    summary:
      'Admin đánh dấu chờ đồng bộ lại mapping chân dung (portrait) của 1 user (sync_status=pending) khi bị báo nhận nhầm Người lạ — KHÔNG enroll ngay, xử lý ở lượt reconcile cron kế tiếp (mỗi 5 phút)',
  })
  async resync(@Param('userId', ParseUUIDPipe) userId: string) {
    const found = await this.portraitSyncService.resyncMapping(userId);
    if (!found) {
      throw new NotFoundException({
        success: false,
        message:
          'Không tìm thấy mapping portrait nào cho user này (chưa từng enroll).',
        error: { code: 'PORTRAIT_MAPPING_NOT_FOUND', details: { userId } },
      });
    }
    return {
      success: true,
      message:
        'Đã đánh dấu mapping portrait chờ đồng bộ lại (sync_status=pending). Sẽ được xử lý ở lượt reconcile kế tiếp.',
      data: { userId, syncStatus: 'pending' },
    };
  }
}
