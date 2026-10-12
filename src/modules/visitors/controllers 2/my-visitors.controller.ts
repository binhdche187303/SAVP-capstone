import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { VISITOR_PERMISSIONS as P } from '../constants/visitor-permission.constant.js';
import { VisitorsEnabledGuard } from '../guards/visitors-enabled.guard.js';
import { VisitQueryService } from '../services/visit-query.service.js';
import { VisitorActorService } from '../services/visitor-actor.service.js';

const ok = (message: string, data: unknown) => ({ success: true, message, data, meta: {} });
type U = { userId?: string } | undefined;

/** "Khách của tôi": mọi dữ liệu lấy theo người đang đăng nhập (không còn `host-me` của mockup). */
@ApiTags('Visitors')
@ApiBearerAuth()
@Controller('visitors')
@UseGuards(VisitorsEnabledGuard, JwtAuthGuard)
export class MyVisitorsController {
  constructor(private readonly query: VisitQueryService, private readonly actors: VisitorActorService) {}

  @Get('my-visits')
  @ApiOperation({ summary: 'Khách xin gặp tôi: cần duyệt, sắp đến, đã tiếp' })
  async myVisits(@CurrentUser() user: U) {
    const actor = await this.actors.resolve(user);
    this.actors.requireAny(actor, P.HOST_SELF);
    return ok('OK', await this.query.myVisits(actor.userId as string));
  }

  @Get('my-notifications')
  @ApiOperation({ summary: 'Thông báo về khách của tôi' })
  async myNotifications(@CurrentUser() user: U) {
    const actor = await this.actors.resolve(user);
    this.actors.requireAny(actor, P.HOST_SELF);
    return ok('OK', await this.query.myNotifications(actor.userId as string));
  }

  @Post('my-notifications/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đánh dấu đã đọc (theo hộp thư chung)' })
  async markRead(@CurrentUser() user: U) {
    const actor = await this.actors.resolve(user);
    this.actors.requireAny(actor, P.HOST_SELF);
    return ok('OK', await this.query.markMyNotificationsRead(actor.userId as string));
  }
}
