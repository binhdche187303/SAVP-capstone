import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CampusMapService } from '../services/campus-map.service.js';
import { QueryCampusMapDto } from '../dto/query-campus-map.dto.js';

// Repo KHÔNG có global ValidationPipe (main.ts) ⇒ phải khai tường minh ở controller.
const CAMPUS_MAP_PIPE = new ValidationPipe({
  whitelist: true,
  transform: true,
});

/**
 * CampusMapController — `GET /api/v1/campus-dashboard/map` (Bản đồ GIS camera + sự kiện).
 * Dùng chung quyền với overview (cùng dữ liệu zone/camera/occupancy, thêm cảnh báo theo zone).
 */
@Controller('campus-dashboard')
export class CampusMapController {
  constructor(private readonly service: CampusMapService) {}

  @Get('map')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('campus_dashboard.overview.read')
  @UsePipes(CAMPUS_MAP_PIPE)
  async getMap(@Query() query: QueryCampusMapDto) {
    const data = await this.service.getMap(query);

    return {
      success: true,
      message: 'Campus map retrieved successfully',
      data,
    };
  }
}
