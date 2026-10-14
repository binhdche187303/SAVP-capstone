import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequireAnyPermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { AlertsService } from '../services/alerts.service.js';
import { QuerySecurityAlertsDto } from '../dto/query-security-alerts.dto.js';
import { ResolveSecurityAlertDto } from '../dto/resolve-security-alert.dto.js';
import { BulkAcknowledgeSecurityAlertsDto } from '../dto/bulk-acknowledge-security-alerts.dto.js';
import {
  toSecurityAlertResponse,
  toZoneSummary,
} from '../dto/security-alert-response.dto.js';

const SECURITY_ALERT_PIPE = new ValidationPipe({
  whitelist: true,
  transform: true,
});

/**
 * AlertsController (ASC-001 / UC-123) — Trung tâm cảnh báo an ninh: list/detail/
 * acknowledge/resolve/bulk-acknowledge. Toàn bộ route admin/security-gated.
 */
@ApiTags('Alerts - Security Alerts')
@Controller('security-alerts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @RequireAnyPermissions('security_alert.read', 'gate.access.alert.handle')
  @UsePipes(SECURITY_ALERT_PIPE)
  @ApiOperation({
    summary:
      'Xem danh sách cảnh báo an ninh (Trung tâm cảnh báo), có phân trang + lọc',
  })
  async list(@Query() query: QuerySecurityAlertsDto) {
    const { items, meta } = await this.alertsService.list(query);
    return {
      success: true,
      message: 'Security alerts retrieved successfully',
      data: items.map(toSecurityAlertResponse),
      meta,
    };
  }

  @Get(':id')
  @RequireAnyPermissions('security_alert.read', 'gate.access.alert.handle')
  @ApiOperation({
    summary:
      'Xem chi tiết 1 cảnh báo an ninh, kèm thông tin zone + lịch sử cùng loại/cùng zone',
  })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const { alert, zone, history } = await this.alertsService.findDetail(id);
    return {
      success: true,
      message: 'Security alert retrieved successfully',
      data: {
        ...toSecurityAlertResponse(alert),
        zone: toZoneSummary(zone),
        history: history.map(toSecurityAlertResponse),
      },
    };
  }

  @Post(':id/acknowledge')
  @RequireAnyPermissions(
    'security_alert.acknowledge',
    'gate.access.alert.handle',
  )
  @ApiOperation({
    summary: 'Xác nhận đã tiếp nhận 1 cảnh báo an ninh (new → acknowledged)',
  })
  async acknowledge(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const entity = await this.alertsService.acknowledge(id, user.userId);
    return {
      success: true,
      message: 'Security alert acknowledged successfully',
      data: toSecurityAlertResponse(entity),
    };
  }

  @Post(':id/resolve')
  @RequireAnyPermissions('security_alert.resolve', 'gate.access.alert.handle')
  @UsePipes(SECURITY_ALERT_PIPE)
  @ApiOperation({
    summary:
      'Xử lý xong 1 cảnh báo an ninh (acknowledged → resolved), kèm ghi chú xử lý',
  })
  async resolve(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveSecurityAlertDto,
  ) {
    const entity = await this.alertsService.resolve(id, dto, user.userId);
    return {
      success: true,
      message: 'Security alert resolved successfully',
      data: toSecurityAlertResponse(entity),
    };
  }

  @Post('bulk-acknowledge')
  @RequireAnyPermissions(
    'security_alert.acknowledge',
    'gate.access.alert.handle',
  )
  @UsePipes(SECURITY_ALERT_PIPE)
  @ApiOperation({
    summary:
      'Xác nhận hàng loạt nhiều cảnh báo an ninh cùng lúc, xử lý độc lập từng id (1 lỗi không chặn id khác)',
  })
  async bulkAcknowledge(
    @CurrentUser() user: { userId: string },
    @Body() dto: BulkAcknowledgeSecurityAlertsDto,
  ) {
    const result = await this.alertsService.bulkAcknowledge(
      dto.ids,
      user.userId,
    );
    return {
      success: true,
      message: 'Bulk acknowledge processed',
      data: result,
    };
  }
}
