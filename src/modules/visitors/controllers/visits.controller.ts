import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { VISITOR_PERMISSIONS as P } from '../constants/visitor-permission.constant.js';
import { CreateVisitDto } from '../dto/public-registration.dto.js';
import { ListVisitsQueryDto } from '../dto/list-visits.query.dto.js';
import { ApproveVisitDto, AttachPhotoDto, CheckOutDto, CloseManualDto, ExtendVisitDto, ManualCheckInDto, ReasonDto } from '../dto/visit-actions.dto.js';
import { VisitorsEnabledGuard } from '../guards/visitors-enabled.guard.js';
import { VisitActionsService } from '../services/visit-actions.service.js';
import { VisitQueryService } from '../services/visit-query.service.js';
import { VisitService } from '../services/visit.service.js';
import { VisitorActorService } from '../services/visitor-actor.service.js';

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const ok = (message: string, data: unknown) => ({ success: true, message, data, meta: {} });
type CurrentUserInfo = { userId?: string } | undefined;

/**
 * Endpoint nội bộ của phân hệ Khách (VIS-BE-001 §7.2). JWT bắt buộc; quyền kiểm bằng `VisitorActorService`
 * vì nhiều thao tác cho phép "quyền quản lý HOẶC chính người được gặp" — `PermissionsGuard` chỉ biểu diễn được "tất cả".
 */
@ApiTags('Visitors')
@ApiBearerAuth()
@Controller('visitors')
@UseGuards(VisitorsEnabledGuard, JwtAuthGuard)
@UsePipes(pipe)
export class VisitsController {
  constructor(
    private readonly visits: VisitService,
    private readonly actions: VisitActionsService,
    private readonly query: VisitQueryService,
    private readonly actors: VisitorActorService,
  ) {}

  @Get('lookups')
  @ApiOperation({ summary: 'Danh mục: đơn vị, khu vực, mục đích' })
  async lookups() {
    return ok('OK', await this.query.lookups());
  }

  @Get('visits')
  @ApiOperation({ summary: 'Danh sách lượt khách (lọc, tìm kiếm, phân trang, đếm theo tab)' })
  async list(@Query() q: ListVisitsQueryDto, @CurrentUser() user: CurrentUserInfo) {
    this.actors.requireAny(await this.actors.resolve(user), P.VISIT_READ);
    return ok('OK', await this.query.list(q));
  }

  @Get('visits/:id')
  @ApiOperation({ summary: 'Chi tiết một lượt (kèm ảnh đăng ký)' })
  async detail(@Param('id') id: string, @CurrentUser() user: CurrentUserInfo) {
    const actor = await this.actors.resolve(user);
    const view = await this.query.detail(id);
    if (!actor.permissions.includes(P.VISIT_READ) && view.hostId !== actor.userId) {
      throw new ForbiddenException({ success: false, message: 'Bạn không có quyền thực hiện hành động này.', error: { code: 'FORBIDDEN', details: {} } });
    }
    return ok('OK', view);
  }

  @Get('visits/:id/related')
  @ApiOperation({ summary: 'Các lượt của cùng một khách' })
  async related(@Param('id') id: string, @CurrentUser() user: CurrentUserInfo) {
    this.actors.requireAny(await this.actors.resolve(user), P.VISIT_READ);
    return ok('OK', await this.query.related(id));
  }

  @Post('visits')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tạo lượt khách: lễ tân (walk_in) hoặc người được gặp mời (host_invite)' })
  async create(@Body() dto: CreateVisitDto, @CurrentUser() user: CurrentUserInfo) {
    const actor = await this.actors.resolve(user);
    this.actors.requireAny(actor, dto.channel === 'walk_in' ? P.DESK_USE : P.HOST_SELF);
    return ok('Đã tạo lượt khách', await this.visits.create(dto.channel, dto, actor));
  }

  @Post('visits/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Duyệt lượt (kèm sửa quyền ra vào)' })
  async approve(@Param('id') id: string, @Body() dto: ApproveVisitDto, @CurrentUser() user: CurrentUserInfo) {
    const actor = await this.actors.resolve(user);
    this.actors.requireAny(actor, P.VISIT_MANAGE, P.HOST_SELF);
    return ok('Đã duyệt lượt khách', await this.actions.approve(id, dto, actor));
  }

  @Post('visits/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Từ chối lượt (bắt buộc lý do)' })
  async reject(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() user: CurrentUserInfo) {
    const actor = await this.actors.resolve(user);
    this.actors.requireAny(actor, P.VISIT_MANAGE, P.HOST_SELF);
    return ok('Đã từ chối lượt khách', await this.actions.reject(id, dto, actor));
  }

  @Post('visits/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hủy lượt' })
  async cancel(@Param('id') id: string, @CurrentUser() user: CurrentUserInfo) {
    const actor = await this.actors.resolve(user);
    this.actors.requireAny(actor, P.VISIT_MANAGE, P.HOST_SELF);
    return ok('Đã hủy lượt khách', await this.actions.cancel(id, actor));
  }

  @Post('visits/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Thu hồi quyền ra vào (đang ở trong → phải rời khuôn viên)' })
  async revoke(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() user: CurrentUserInfo) {
    const actor = await this.actors.resolve(user);
    this.actors.requireAny(actor, P.VISIT_MANAGE);
    return ok('Đã thu hồi quyền ra vào', await this.actions.revoke(id, dto, actor));
  }

  @Post('visits/:id/extend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gia hạn hiệu lực' })
  async extend(@Param('id') id: string, @Body() dto: ExtendVisitDto, @CurrentUser() user: CurrentUserInfo) {
    const actor = await this.actors.resolve(user);
    this.actors.requireAny(actor, P.VISIT_MANAGE);
    return ok('Đã gia hạn', await this.actions.extend(id, dto, actor));
  }

  @Post('visits/:id/close-manual')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đóng lượt thủ công (khách đã rời nhưng camera không ghi nhận / không tìm thấy khách)' })
  async closeManual(@Param('id') id: string, @Body() dto: CloseManualDto, @CurrentUser() user: CurrentUserInfo) {
    const actor = await this.actors.resolve(user);
    this.actors.requireAny(actor, P.VISIT_MANAGE);
    return ok('Đã xử lý lượt khách', await this.actions.closeManually(id, dto, actor));
  }

  @Post('visits/:id/photo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chụp bổ sung ảnh khuôn mặt' })
  async photo(@Param('id') id: string, @Body() dto: AttachPhotoDto, @CurrentUser() user: CurrentUserInfo) {
    const actor = await this.actors.resolve(user);
    this.actors.requireAny(actor, P.DESK_USE);
    return ok('Đã bổ sung ảnh', await this.actions.attachPhoto(id, dto, actor));
  }

  @Post('visits/:id/check-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check-in tay (bắt buộc ghi chú xác minh)' })
  async checkIn(@Param('id') id: string, @Body() dto: ManualCheckInDto, @CurrentUser() user: CurrentUserInfo) {
    const actor = await this.actors.resolve(user);
    this.actors.requireAny(actor, P.DESK_USE);
    return ok('Đã check-in', await this.actions.checkInManual(id, dto, actor));
  }

  @Post('visits/:id/check-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ghi nhận khách rời khuôn viên' })
  async checkOut(@Param('id') id: string, @Body() dto: CheckOutDto, @CurrentUser() user: CurrentUserInfo) {
    const actor = await this.actors.resolve(user);
    this.actors.requireAny(actor, P.DESK_USE);
    return ok('Đã ghi nhận khách rời khuôn viên', await this.actions.checkOut(id, dto, actor));
  }
}
