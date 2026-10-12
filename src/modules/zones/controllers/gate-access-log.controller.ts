import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { GateAccessLogService } from '../services/gate-access-log.service.js';
import { ListGateAccessLogsQueryDto } from '../dto/list-gate-access-logs-query.dto.js';
import { AdminListGateAccessLogsQueryDto } from '../dto/admin-list-gate-access-logs-query.dto.js';
import {
  toGateAccessLogResponse,
  toAdminGateAccessLogResponse,
} from '../dto/gate-access-log-response.dto.js';

// Repo KHÔNG có global ValidationPipe (main.ts) ⇒ khai tường minh (mirror ZONE_PIPE).
const GATE_LOG_PIPE = new ValidationPipe({ whitelist: true, transform: true });

/**
 * GateAccessLogController (GAL-001 / UC-107) — xem & tra cứu lịch sử ra/vào cổng.
 *
 * ⚠ URL KHÔNG dưới `/zones` dù entity thuộc module `zones` (sở hữu module ≠ tiền tố URL):
 * log ra/vào cổng không phải resource "zone". `@Controller()` prefix rỗng; `api/v1` ở main.ts.
 *
 * 2 route:
 * - GET /api/v1/gate-access-logs        — log CỦA MÌNH (JwtAuthGuard, fold userId từ JWT).
 * - GET /api/v1/admin/gate-access-logs  — log MỌI NGƯỜI (admin-gated: zones.gate_log.read).
 *
 * `admin/gate-access-logs` và `gate-access-logs` khác literal segment đầu ⇒ KHÔNG xung đột;
 * không có route `:id` nên không bẫy nuốt route.
 */
@Controller()
export class GateAccessLogController {
  constructor(private readonly gateAccessLogService: GateAccessLogService) {}

  // USER: log của current user. userId từ @CurrentUser (SEC-01) — chỉ JwtAuthGuard.
  @Get('gate-access-logs')
  @UseGuards(JwtAuthGuard)
  @UsePipes(GATE_LOG_PIPE)
  async listForUser(
    @CurrentUser() user: { userId: string },
    @Query() query: ListGateAccessLogsQueryDto,
  ) {
    const { items, meta } = await this.gateAccessLogService.listForUser(
      user.userId,
      query,
    );

    return {
      success: true,
      message: 'Gate access logs retrieved successfully',
      data: items.map(toGateAccessLogResponse),
      meta,
    };
  }

  @Post('admin/gate-access-logs/scan')
  @UseGuards(JwtAuthGuard)
  async scanFromGuardDashboard(
    @CurrentUser() user: { userId: string },
    @Body()
    body: {
      gateId?: string;
      direction?: 'in' | 'out' | 'enter' | 'leave';
      scenario?: 'authorized' | 'unknown' | 'plate_mismatch';
      snapshotImageBase64?: string;
    },
  ) {
    const data = await this.gateAccessLogService.scanFromGuardDashboard(
      user.userId,
      body,
    );
    return {
      success: data.success,
      message: data.message,
      data,
    };
  }

  // ADMIN: log của mọi người — gate THẬT. Thiếu @RequirePermissions = endpoint hở im lặng.
  @Get('admin/gate-access-logs')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('zones.gate_log.read')
  @UsePipes(GATE_LOG_PIPE)
  async listAll(@Query() query: AdminListGateAccessLogsQueryDto) {
    const { items, meta } = await this.gateAccessLogService.listAll(query);

    return {
      success: true,
      message: 'Gate access logs retrieved successfully',
      data: items.map(toAdminGateAccessLogResponse),
      meta,
    };
  }
}
