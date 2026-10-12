import { Controller, Get, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { VISITOR_PERMISSIONS as P } from '../constants/visitor-permission.constant.js';
import { VisitorStatsQueryDto } from '../dto/list-visits.query.dto.js';
import { VisitorsEnabledGuard } from '../guards/visitors-enabled.guard.js';
import { VisitQueryService } from '../services/visit-query.service.js';
import { VisitorActorService } from '../services/visitor-actor.service.js';

const ok = (message: string, data: unknown) => ({ success: true, message, data, meta: {} });

@ApiTags('Visitors')
@ApiBearerAuth()
@Controller('visitors')
@UseGuards(VisitorsEnabledGuard, JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class VisitorDeskController {
  constructor(private readonly query: VisitQueryService, private readonly actors: VisitorActorService) {}

  @Get('desk/today')
  @ApiOperation({ summary: 'Quầy lễ tân hôm nay: KPI, khách, cảnh báo cổng, hàng cần xử lý' })
  async desk(@CurrentUser() user: { userId?: string } | undefined) {
    this.actors.requireAny(await this.actors.resolve(user), P.DESK_USE);
    return ok('OK', await this.query.deskToday());
  }

  @Get('stats')
  @ApiOperation({ summary: 'Thống kê khách theo đơn vị và thời gian' })
  async stats(@Query() q: VisitorStatsQueryDto, @CurrentUser() user: { userId?: string } | undefined) {
    this.actors.requireAny(await this.actors.resolve(user), P.STATS_READ);
    return ok('OK', await this.query.stats(q));
  }
}
