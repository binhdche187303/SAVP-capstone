import { Controller, Get, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { CameraTraceService } from '../services/camera-trace.service.js';
import { CameraTraceQueryDto } from '../dto/camera-trace-query.dto.js';

const TRACE_PIPE = new ValidationPipe({ whitelist: true, transform: true });

/**
 * CameraTraceController — GET /campus/camera-trace?groupId=|deviceId=|zoneId=&from=&to=
 * Truy vết theo nhóm camera / camera / khu vực. Dùng cùng quyền `zones.gate_log.read` với
 * User Journey (BUSINESS_ADMIN + MANAGER + SYSTEM_ADMIN); MANAGER bị giới hạn theo phòng ban ở service.
 */
@Controller('campus')
export class CameraTraceController {
  constructor(private readonly cameraTraceService: CameraTraceService) {}

  @Get('camera-trace')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('zones.gate_log.read')
  @UsePipes(TRACE_PIPE)
  async trace(@Query() query: CameraTraceQueryDto, @CurrentUser() user: { userId: string }) {
    const data = await this.cameraTraceService.trace(user.userId, query);
    return { success: true, message: 'Camera trace retrieved', data };
  }
}
