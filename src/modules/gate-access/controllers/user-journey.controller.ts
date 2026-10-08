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
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { UserJourneyService } from '../services/user-journey.service.js';
import { UserJourneyQueryDto } from '../dto/user-journey-query.dto.js';
import { UserJourneyOwnQueryDto } from '../dto/user-journey-own-query.dto.js';

const JOURNEY_PIPE = new ValidationPipe({ whitelist: true, transform: true });

/**
 * UserJourneyController (UJN-001) — GET /campus/user-journey?userId=&date=
 *
 * Hành trình khuôn viên của 1 người trong 1 ngày, ghép 3 kiểu nguồn (cổng/họp/khu vực).
 * READ-ONLY. 1 route "own" (chỉ `JwtAuthGuard`, mirror `GateAccessHistoryController.listOwn`)
 * + 1 route "admin" (`PermissionsGuard` + `@RequirePermissions`) — KHÔNG gộp chung route
 * cũ với check `userId === currentUser` vì `PermissionsGuard` không đọc được query param.
 *
 * ⚠ PERMISSION (route admin): dùng `zones.gate_log.read` — đã kiểm `role_permissions`
 * trên DB thật: quyền này TỒN TẠI và được cấp cho BUSINESS_ADMIN + MANAGER + SYSTEM_ADMIN.
 * KHÔNG dùng `gate_access.history.read_all`/`gate_access.stats.read`: tuy có migration
 * seed (20260723000002/3) nhưng CHƯA có trong DB đang kiểm ⇒ rủi ro 403 nếu môi trường
 * đích cũng chưa chạy 2 migration đó. Không bịa quyền mới ⇒ không cần migration kèm.
 */
@Controller('campus')
export class UserJourneyController {
  constructor(private readonly userJourneyService: UserJourneyService) {}

  /**
   * [2026-08-21] Route "own" — bất kỳ user đã login nào cũng xem được HÀNH TRÌNH ĐẦY ĐỦ
   * của CHÍNH MÌNH (gate + meeting + zone), không riêng gì lịch sử ra/vào cổng. Trước đó
   * FE (UserJourney.jsx, isSelfOnly) phải fallback về `GET /gate-access/history` vì thiếu
   * quyền `zones.gate_log.read` ⇒ nhân viên chỉ thấy cổng ANPR. Route này không cần
   * permission gì thêm vì user chỉ đọc được đúng dữ liệu của chính họ (userId lấy từ JWT,
   * KHÔNG nhận từ query) — an toàn tương đương `gate-access/history` own route.
   */
  @Get('user-journey/me')
  @UseGuards(JwtAuthGuard)
  @UsePipes(JOURNEY_PIPE)
  async myJourney(
    @CurrentUser() user: { userId: string },
    @Query() query: UserJourneyOwnQueryDto,
  ) {
    const data = query.to
      ? await this.userJourneyService.getUserJourneyRange(
          user.userId,
          query.date ?? query.to,
          query.to,
        )
      : await this.userJourneyService.getUserJourney(user.userId, query.date);
    return { success: true, message: 'User journey retrieved', data };
  }

  @Get('user-journey')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('zones.gate_log.read')
  @UsePipes(JOURNEY_PIPE)
  async userJourney(@Query() query: UserJourneyQueryDto) {
    const data = query.to
      ? await this.userJourneyService.getUserJourneyRange(
          query.userId,
          query.date ?? query.to,
          query.to,
        )
      : await this.userJourneyService.getUserJourney(query.userId, query.date);
    return { success: true, message: 'User journey retrieved', data };
  }
}
