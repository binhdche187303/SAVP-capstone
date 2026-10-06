import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { PresenceByDepartmentService } from '../services/presence-by-department.service.js';

/**
 * PresenceByDepartmentController (2.12) — `GET /api/v1/campus-dashboard/presence-by-department`.
 * Dùng chung quyền với overview (cùng chủ đề "ai đang có mặt").
 */
@Controller('campus-dashboard')
export class PresenceByDepartmentController {
  constructor(private readonly service: PresenceByDepartmentService) {}

  @Get('presence-by-department')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('campus_dashboard.overview.read')
  async getPresenceByDepartment() {
    const data = await this.service.getPresence();

    return {
      success: true,
      message: 'Presence by department retrieved successfully',
      data,
    };
  }
}
