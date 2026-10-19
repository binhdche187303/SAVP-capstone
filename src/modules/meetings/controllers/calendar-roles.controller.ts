import { Body, Controller, Get, Put, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { CalendarRolesService } from '../services/calendar-roles.service.js';
import { UpdateCalendarRolesDto } from '../dto/update-calendar-roles.dto.js';

@ApiTags('Meetings - Calendar Roles')
@ApiBearerAuth()
@Controller('meeting-calendar-roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CalendarRolesController {
  constructor(private readonly service: CalendarRolesService) {}

  @Get()
  @RequirePermissions('meeting.calendar_role.manage')
  @ApiOperation({ summary: 'Văn thư đơn vị, Ban Giám hiệu, đơn vị duyệt lịch cấp trường' })
  async get() {
    const data = await this.service.getConfig();
    return { success: true, message: 'OK', data };
  }

  @Get('booking-context')
  @ApiOperation({ summary: 'Nhóm lịch được phép, BGH và người duyệt cho form đặt lịch' })
  async bookingContext(@CurrentUser() actor: { userId: string }) {
    const data = await this.service.getBookingContext(actor.userId);
    return { success: true, message: 'OK', data };
  }

  @Put()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @RequirePermissions('meeting.calendar_role.manage')
  @ApiOperation({ summary: 'Cập nhật vai trò lịch họp (Business Admin)' })
  async update(
    @Body() dto: UpdateCalendarRolesDto,
    @CurrentUser() actor: { userId: string },
  ) {
    const data = await this.service.updateConfig(dto, actor.userId);
    return { success: true, message: 'Đã lưu cấu hình vai trò lịch họp', data };
  }
}
