import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { ZonePresenceTimelineService } from '../services/zone-presence-timeline.service.js';
import { QueryZoneTimelineDto } from '../dto/query-zone-timeline.dto.js';

// Repo KHÔNG có global ValidationPipe (main.ts) ⇒ phải khai tường minh ở controller.
const TIMELINE_PIPE = new ValidationPipe({ whitelist: true, transform: true });

/**
 * ZonePresenceTimelineController (ZPT-001 / UC-119) —
 * `GET /api/v1/campus-dashboard/zones/:zoneId/timeline`.
 */
@Controller('campus-dashboard/zones')
export class ZonePresenceTimelineController {
  constructor(private readonly service: ZonePresenceTimelineService) {}

  @Get(':zoneId/timeline')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('campus_dashboard.timeline.read')
  @UsePipes(TIMELINE_PIPE)
  async getTimeline(
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Query() query: QueryZoneTimelineDto,
  ) {
    const data = await this.service.getTimeline(
      zoneId,
      new Date(query.from),
      new Date(query.to),
      query.userId,
      query.status,
    );

    return {
      success: true,
      message: 'Zone presence timeline retrieved successfully',
      data,
    };
  }
}
