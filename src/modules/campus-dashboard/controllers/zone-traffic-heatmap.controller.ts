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
import { ZoneTrafficHeatmapService } from '../services/zone-traffic-heatmap.service.js';
import { QueryZoneTrafficDto } from '../dto/query-zone-traffic.dto.js';

// Repo KHÔNG có global ValidationPipe (main.ts) ⇒ phải khai tường minh ở controller.
const TRAFFIC_PIPE = new ValidationPipe({ whitelist: true, transform: true });

/**
 * ZoneTrafficHeatmapController (ZTH-001 / UC-120) —
 * `GET /api/v1/campus-dashboard/zones/traffic`.
 */
@Controller('campus-dashboard/zones')
export class ZoneTrafficHeatmapController {
  constructor(private readonly service: ZoneTrafficHeatmapService) {}

  @Get('traffic')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('campus_dashboard.traffic.read')
  @UsePipes(TRAFFIC_PIPE)
  async getTraffic(@Query() query: QueryZoneTrafficDto) {
    const data = await this.service.getTraffic(
      new Date(query.from),
      new Date(query.to),
      query.building,
      query.floor,
      { groupId: query.groupId, bucket: query.bucket },
    );

    return {
      success: true,
      message: 'Zone traffic & heatmap retrieved successfully',
      data,
    };
  }
}
