import { Body, Controller, Get, Put, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ViolationRulesService } from '../services/violation-rules.service.js';
import { UpdateViolationRulesDto } from '../dto/update-violation-rules.dto.js';

@ApiTags('Attendance - Violation Rules')
@ApiBearerAuth()
@Controller('attendance/violation-rules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ViolationRulesController {
  constructor(private readonly service: ViolationRulesService) {}

  /** Mọi người đăng nhập đọc được (thư ký/chủ trì chọn hình thức khi điểm danh thủ công). */
  @Get()
  @ApiOperation({ summary: 'Danh sách hình thức vi phạm + mốc phút điểm danh' })
  async get(@Query('includeInactive') includeInactive?: string) {
    const data = await this.service.getConfig(includeInactive === 'true');
    return { success: true, message: 'OK', data };
  }

  @Put()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @RequirePermissions('attendance.violation_rule.manage')
  @ApiOperation({ summary: 'Cập nhật cấu hình vi phạm điểm danh (Business Admin)' })
  async update(
    @Body() dto: UpdateViolationRulesDto,
    @CurrentUser() actor: { userId: string },
  ) {
    const data = await this.service.updateConfig(dto, actor.userId);
    return {
      success: true,
      message: 'Đã lưu cấu hình. Áp dụng cho các lần điểm danh sau.',
      data,
    };
  }
}
