import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../auth/decorators/require-permissions.decorator.js';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard.js';
import { ReportCenterEnabledGuard } from '../report-center-enabled.guard.js';
import { ReportCenterExportService } from '../report-center-export.service.js';
import { ReportCenterService } from '../report-center.service.js';

type CurrentUserPayload = { userId: string; email: string; sub?: string };

/** Trung tâm báo cáo (2.13) — danh mục, tra cứu, xem trước. Xuất file ở Task 11. */
@Controller('reports')
@UseGuards(ReportCenterEnabledGuard, JwtAuthGuard, PermissionsGuard)
export class ReportCenterController {
  constructor(
    private readonly center: ReportCenterService,
    private readonly exporter: ReportCenterExportService,
  ) {}

  @Get('catalog')
  @RequirePermissions('report.center.read')
  async catalog() {
    return { success: true, message: 'OK', data: await this.center.catalog(), meta: {} };
  }

  @Get('lookups')
  @RequirePermissions('report.center.read')
  async lookups(@CurrentUser() user: CurrentUserPayload) {
    return { success: true, message: 'OK', data: await this.center.lookups(user.userId), meta: {} };
  }

  @Get(':type/preview')
  @RequirePermissions('report.center.read')
  async preview(@Param('type') type: string, @Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, message: 'OK', data: await this.center.preview(type, query, user.userId), meta: {} };
  }

  /**
   * Đường dẫn có tiền tố `center/` vì 4 controller xuất cũ đã giữ `POST /reports/{gate-access,vehicle,room-utilization,security-alert}/exports`.
   */
  @Post('center/:type/exports')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('report.center.export')
  async createExport(@Param('type') type: string, @Body() body: Record<string, unknown>, @CurrentUser() user: CurrentUserPayload) {
    const data = await this.exporter.create(type, body ?? {}, user);
    return { success: true, message: 'Export job đã được tạo và đang xử lý.', data, meta: {} };
  }

  @Get('exports/recent')
  @RequirePermissions('report.center.export')
  async recent(@CurrentUser() user: CurrentUserPayload) {
    return { success: true, message: 'OK', data: await this.exporter.recent(user.userId), meta: {} };
  }
}
