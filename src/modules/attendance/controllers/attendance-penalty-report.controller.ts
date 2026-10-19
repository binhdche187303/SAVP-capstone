import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { AttendancePenaltyReportService } from '../services/attendance-penalty-report.service.js';

/**
 * Tổng hợp điểm trừ chuyên cần. Quyền theo phạm vi kiểm tra trong service:
 * cá nhân = ai cũng xem của mình; đơn vị = trưởng phòng (MANAGER); toàn trường = P.HC / BGH / admin.
 */
@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('attendance/penalty-report')
@UseGuards(JwtAuthGuard)
export class AttendancePenaltyReportController {
  constructor(private readonly service: AttendancePenaltyReportService) {}

  @Get('scope')
  @ApiOperation({ summary: 'Phạm vi xem tổng hợp của người dùng (null | unit | school)' })
  async scope(@CurrentUser() actor: { userId: string }) {
    const data = await this.service.resolveScope(actor.userId);
    return { success: true, data };
  }

  @Get('me')
  @ApiOperation({ summary: 'Điểm chuyên cần của tôi' })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD' })
  async me(
    @CurrentUser() actor: { userId: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const data = await this.service.getUserDetail(actor.userId, actor.userId, from, to);
    return { success: true, data };
  }

  @Get('users/:userId')
  @ApiOperation({ summary: 'Chi tiết điểm chuyên cần của 1 người (trưởng đơn vị / toàn trường)' })
  async user(
    @CurrentUser() actor: { userId: string },
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const data = await this.service.getUserDetail(actor.userId, userId, from, to);
    return { success: true, data };
  }

  @Get('meetings')
  @ApiOperation({ summary: 'Báo cáo theo cuộc họp có điểm danh trong khoảng thời gian' })
  async meetings(
    @CurrentUser() actor: { userId: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.service.getMeetingSummary(actor.userId, { from, to, departmentId, search });
    return { success: true, data };
  }

  @Get('meetings/:meetingId')
  @ApiOperation({ summary: 'Chi tiết điểm danh 1 cuộc họp' })
  async meeting(
    @CurrentUser() actor: { userId: string },
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Query('departmentId') departmentId?: string,
  ) {
    const data = await this.service.getMeetingDetail(actor.userId, meetingId, departmentId);
    return { success: true, data };
  }

  @Get()
  @ApiOperation({ summary: 'Bảng tổng hợp theo người (đơn vị hoặc toàn trường)' })
  async summary(
    @CurrentUser() actor: { userId: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.service.getSummary(actor.userId, { from, to, departmentId, search });
    return { success: true, data };
  }
}
