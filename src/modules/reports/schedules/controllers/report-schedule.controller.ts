import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../auth/decorators/require-permissions.decorator.js';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard.js';
import { ReportCenterEnabledGuard } from '../../center/report-center-enabled.guard.js';
import { ReportScheduleRunService } from '../report-schedule-run.service.js';
import { ReportScheduleService, type SchedulePayload } from '../report-schedule.service.js';

type CurrentUserPayload = { userId: string; email: string };
const ok = <T>(data: T, message = 'OK') => ({ success: true, message, data, meta: {} });

/** Lịch gửi báo cáo tự động (2.13).  */
@Controller('report-schedules')
@UseGuards(ReportCenterEnabledGuard, JwtAuthGuard, PermissionsGuard)
@RequirePermissions('report.schedule.manage')
export class ReportScheduleController {
  constructor(
    private readonly schedules: ReportScheduleService,
    private readonly runs: ReportScheduleRunService,
  ) {}

  @Get()
  async list() { return ok(await this.schedules.list()); }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: SchedulePayload, @CurrentUser() u: CurrentUserPayload) { return ok(await this.schedules.create(body, u.userId), 'Đã tạo lịch gửi'); }

  /** FE gửi cả thân đầy đủ (sửa) lẫn `{ enabled }` (bật/tắt). */
  @Patch(':id')
  async patch(@Param('id') id: string, @Body() body: SchedulePayload, @CurrentUser() u: CurrentUserPayload) {
    const onlyEnabled = body && Object.keys(body).length === 1 && 'enabled' in body;
    return ok(onlyEnabled ? await this.schedules.toggle(id, Boolean(body.enabled), u.userId) : await this.schedules.update(id, body, u.userId));
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  async duplicate(@Param('id') id: string, @CurrentUser() u: CurrentUserPayload) { return ok(await this.schedules.duplicate(id, u.userId)); }

  /** BR-S5: gửi thử ngay, không đổi lần chạy kế tiếp. */
  @Post(':id/run-now')
  @HttpCode(HttpStatus.ACCEPTED)
  async runNow(@Param('id') id: string) { return ok(await this.runs.runNow(id), 'Đã đưa vào hàng đợi gửi'); }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() u: CurrentUserPayload) { return ok(await this.schedules.remove(id, u.userId)); }
}
