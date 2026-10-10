import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../../../auth/decorators/require-permissions.decorator.js';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard.js';
import { ReportCenterEnabledGuard } from '../../center/report-center-enabled.guard.js';
import { ReportScheduleRunService } from '../report-schedule-run.service.js';

const ok = <T>(data: T, meta: Record<string, unknown> = {}) => ({ success: true, message: 'OK', data, meta });

/** Lịch sử lần chạy của lịch gửi báo cáo. */
@Controller('report-schedule-runs')
@UseGuards(ReportCenterEnabledGuard, JwtAuthGuard, PermissionsGuard)
@RequirePermissions('report.schedule.manage')
export class ReportScheduleRunController {
  constructor(private readonly runs: ReportScheduleRunService) {}

  @Get()
  async list(@Query() q: Record<string, string>) {
    const r = await this.runs.list(q);
    return ok({ items: r.items, total: r.total }, { page: r.page, limit: r.limit, total: r.total });
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.CREATED)
  async retry(@Param('id') id: string) { return ok(await this.runs.retry(id)); }

  @Get(':id/files/:format')
  async file(@Param('id') id: string, @Param('format') format: string) { return ok(await this.runs.fileLink(id, format)); }
}
