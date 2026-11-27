import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import {
  NoShowRateRepository,
  KpiAggregateResult,
  RankingDbItem,
} from '../repositories/no-show-rate.repository';
import { DashboardOverviewConfigService } from './dashboard-overview-config.service';
import { QueryNoShowRateDto } from '../dto/query-no-show-rate.dto';
import {
  NoShowRateResponseDto,
  NoShowTrendItemDto,
  RankingDto,
  RankingItemDto,
} from '../dto/no-show-rate-response.dto';

interface ScopeResult {
  isAdmin: boolean;
  scopeDepartmentIds: string[] | null;
  viewerRole?: string;
}

@Injectable()
export class NoShowRateService {
  private readonly logger = new Logger(NoShowRateService.name);

  constructor(
    private readonly authzRepo: AuthzReadRepository,
    private readonly repo: NoShowRateRepository,
    private readonly configService: DashboardOverviewConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Orchestrator: resolve preset -> validate max range -> resolve department scope -> validate department ownership -> resolve room scope -> validate room ownership -> resolve organizer email -> aggregate -> build response.
   */
  async getNoShowRate(
    currentUser: { userId: string },
    query: QueryNoShowRateDto,
  ): Promise<{ data: NoShowRateResponseDto; message: string }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const rankBy = query.rankBy || 'room';

    // 1. Resolve date range
    const { from, to } = this.resolveDateRange(
      query.preset,
      query.from,
      query.to,
    );

    // 2. Validate max range days
    await this.validateMaxRange(from, to);

    // 3. Resolve department scope
    const scope = await this.resolveScope(currentUser.userId);

    // 4. Validate department ownership for MANAGER (multi-select)
    this.validateDepartmentOwnership(scope, query.departmentIds);

    // 5. Resolve room scope (only if MANAGER and rankBy=room or roomId is filtered)
    let scopeRoomIds: string[] | null = null;
    if (!scope.isAdmin && (rankBy === 'room' || query.roomId)) {
      scopeRoomIds = await this.repo.getManagerRoomIds(
        currentUser.userId,
        from,
        to,
      );
    }

    // 6. Validate room ownership
    this.validateRoomOwnership(scopeRoomIds, query.roomId);

    // Audit log helper
    const logAction = async (noShowCount: number) => {
      try {
        await this.auditLogsService.logAction({
          userId: currentUser.userId,
          actionType: 'read_analytics_no_show_rate',
          entityType: 'no_show_cases',
          metadataJson: {
            viewerUserId: currentUser.userId,
            viewerRole: scope.viewerRole,
            from,
            to,
            rankBy,
            page,
            limit,
            departmentIds: query.departmentIds,
            roomId: query.roomId,
            organizerEmail: query.organizerEmail,
            resolvedScopeDepartmentIds: scope.scopeDepartmentIds,
            noShowCount,
          },
        });
      } catch (err) {
        this.logger.warn(
          'Failed to write audit log for no-show rate analytics',
          err instanceof Error ? err.message : undefined,
        );
      }
    };

    // 7. Short-circuit if manager has no departments
    if (
      scope.scopeDepartmentIds !== null &&
      scope.scopeDepartmentIds.length === 0
    ) {
      const data = this.buildEmptyResponse(from, to, rankBy, page, limit);
      await logAction(0);
      return { data, message: data.message! };
    }

    // 8. Resolve organizer ID from email if provided
    let organizerId: string | undefined;
    if (query.organizerEmail) {
      const resolvedId = await this.repo.findUserIdByEmail(
        query.organizerEmail,
      );
      if (!resolvedId) {
        const data = this.buildEmptyResponse(from, to, rankBy, page, limit);
        await logAction(0);
        return { data, message: data.message! };
      }
      organizerId = resolvedId;
    }

    // 9. Query KPI Aggregate
    const params = {
      from,
      to,
      scopeDepartmentIds: scope.scopeDepartmentIds,
      scopeRoomIds,
      departmentIds: query.departmentIds,
      roomId: query.roomId,
      organizerId,
    };

    const kpi = await this.repo.getKpiAggregate(params);

    // 10. Query Ranking if noShowCount > 0
    let dbItems: RankingDbItem[] = [];
    if (kpi.noShowCount > 0) {
      if (rankBy === 'room') {
        dbItems = await this.repo.getRoomRanking(params, page, limit);
      } else if (rankBy === 'department') {
        dbItems = await this.repo.getDepartmentRanking(params, page, limit);
      } else if (rankBy === 'organizer') {
        dbItems = await this.repo.getOrganizerRanking(params, page, limit);
      }
    }

    // 11. Query daily trend (biểu đồ xu hướng no-show theo ngày)
    const trendRows = await this.repo.getDailyTrend(params);
    const trend: NoShowTrendItemDto[] = trendRows.map((t) => ({
      date: t.date,
      noShowCount: t.noShowCount,
      totalBookings: t.totalBookings,
      noShowRate:
        t.totalBookings > 0
          ? Math.round((t.noShowCount / t.totalBookings) * 1000) / 10
          : 0,
    }));

    const data = this.buildResponse(
      kpi,
      dbItems,
      from,
      to,
      rankBy,
      page,
      limit,
      trend,
    );

    await logAction(kpi.noShowCount);

    const message =
      kpi.noShowCount === 0
        ? 'Tuyệt vời! Không ghi nhận trường hợp lãng phí phòng họp nào trong khoảng thời gian này.'
        : 'Thống kê tỷ lệ no-show được truy xuất thành công';

    return { data, message };
  }

  /**
   * Resolve user scope based on roles.
   */
  async resolveScope(userId: string): Promise<ScopeResult> {
    const { roles } =
      await this.authzRepo.getEffectiveRolesAndPermissions(userId);

    if (roles.includes('SYSTEM_ADMIN')) {
      return {
        isAdmin: true,
        scopeDepartmentIds: null,
        viewerRole: 'SYSTEM_ADMIN',
      };
    }
    if (roles.includes('BUSINESS_ADMIN')) {
      return {
        isAdmin: true,
        scopeDepartmentIds: null,
        viewerRole: 'BUSINESS_ADMIN',
      };
    }
    if (roles.includes('MANAGER')) {
      const scopeDepartmentIds =
        await this.repo.getManagerDepartmentIds(userId);
      return { isAdmin: false, scopeDepartmentIds, viewerRole: 'MANAGER' };
    }

    throw new ForbiddenException({
      success: false,
      message: 'You do not have permission to view no-show rate analytics',
      error: { code: 'PERMISSION_DENIED', details: {} },
    });
  }

  /**
   * Resolve date range boundaries based on preset.
   */
  resolveDateRange(
    preset?: string,
    from?: string,
    to?: string,
  ): { from: string; to: string } {
    const tzOffset = 7 * 60; // UTC+7
    const now = new Date();
    const localTime = new Date(now.getTime() + tzOffset * 60000);
    const currentYear = localTime.getUTCFullYear();
    const currentMonth = localTime.getUTCMonth(); // 0-indexed
    const currentDay = localTime.getUTCDate();

    // Khi client chỉ gửi from & to (không kèm preset) thì coi như khoảng tùy chọn,
    // thay vì âm thầm bỏ qua bộ lọc và trả về tháng hiện tại.
    // Mirror on-time-rate.service.ts để mọi endpoint analytics hành xử giống nhau.
    const activePreset = preset || (from && to ? 'custom' : 'month');

    if (activePreset === 'day') {
      const todayStr = localTime.toISOString().split('T')[0];
      return { from: todayStr, to: todayStr };
    }

    if (activePreset === 'week') {
      const dayOfWeek = (localTime.getUTCDay() + 6) % 7; // Monday = 0
      const startOfWeek = new Date(
        Date.UTC(currentYear, currentMonth, currentDay - dayOfWeek),
      );
      const endOfWeek = new Date(
        Date.UTC(currentYear, currentMonth, currentDay - dayOfWeek + 6),
      );
      return {
        from: startOfWeek.toISOString().split('T')[0],
        to: endOfWeek.toISOString().split('T')[0],
      };
    }

    if (activePreset === 'month') {
      const firstDay = new Date(Date.UTC(currentYear, currentMonth, 1));
      const lastDay = new Date(Date.UTC(currentYear, currentMonth + 1, 0));
      return {
        from: firstDay.toISOString().split('T')[0],
        to: lastDay.toISOString().split('T')[0],
      };
    }

    if (activePreset === 'quarter') {
      const quarterStartMonth = Math.floor(currentMonth / 3) * 3;
      const firstDay = new Date(Date.UTC(currentYear, quarterStartMonth, 1));
      const lastDay = new Date(Date.UTC(currentYear, quarterStartMonth + 3, 0));
      return {
        from: firstDay.toISOString().split('T')[0],
        to: lastDay.toISOString().split('T')[0],
      };
    }

    if (activePreset === 'custom') {
      if (!from || !to) {
        throw new BadRequestException({
          success: false,
          message: 'Both from and to dates are required for custom preset',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
      if (from > to) {
        throw new BadRequestException({
          success: false,
          message: 'from date must be before or equal to to date',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
      return { from, to };
    }

    throw new BadRequestException({
      success: false,
      message: 'Invalid preset',
      error: { code: 'VALIDATION_ERROR', details: {} },
    });
  }

  /**
   * Validate date range does not exceed maxRangeDays.
   */
  async validateMaxRange(from: string, to: string): Promise<void> {
    const maxDays = await this.configService.getMaxRangeDays();
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    const diffDays = (toMs - fromMs) / 86400000;

    if (diffDays > maxDays) {
      throw new BadRequestException({
        success: false,
        message: `Date range exceeds maximum of ${maxDays} days`,
        error: { code: 'DATE_RANGE_TOO_LARGE', details: { maxDays } },
      });
    }
  }

  /**
   * Validate departmentIds is within scope for MANAGER.
   */
  validateDepartmentOwnership(
    scope: ScopeResult,
    departmentIds?: string[],
  ): void {
    if (scope.isAdmin || !departmentIds || departmentIds.length === 0) return;

    for (const deptId of departmentIds) {
      if (!scope.scopeDepartmentIds?.includes(deptId)) {
        throw new ForbiddenException({
          success: false,
          message: 'Đơn vị này nằm ngoài phạm vi của bạn. Trưởng nhóm chỉ xem được đơn vị mình được gán làm trưởng — liên hệ Quản trị nghiệp vụ để gán trưởng đơn vị.',
          error: { code: 'DEPARTMENT_OUT_OF_SCOPE', details: {} },
        });
      }
    }
  }

  /**
   * Validate roomId is within scope for MANAGER.
   */
  validateRoomOwnership(scopeRoomIds: string[] | null, roomId?: string): void {
    if (scopeRoomIds === null || !roomId) return;

    if (!scopeRoomIds.includes(roomId)) {
      throw new ForbiddenException({
        success: false,
        message: 'Room is outside your scope for the selected period',
        error: { code: 'ROOM_OUT_OF_SCOPE', details: {} },
      });
    }
  }

  /**
   * Build empty response.
   */
  private buildEmptyResponse(
    from: string,
    to: string,
    rankBy: string,
    page: number,
    limit: number,
    trend: NoShowTrendItemDto[] = [],
  ): NoShowRateResponseDto {
    return {
      period: { from, to },
      noShowCount: 0,
      totalBookings: 0,
      noShowRate: 0,
      trend,
      ranking: {
        rankBy,
        items: [],
        page,
        limit,
        total: 0,
        totalPages: 0,
      },
      message:
        'Tuyệt vời! Không ghi nhận trường hợp lãng phí phòng họp nào trong khoảng thời gian này.',
    };
  }

  /**
   * Build full response.
   */
  private buildResponse(
    kpi: KpiAggregateResult,
    dbItems: RankingDbItem[],
    from: string,
    to: string,
    rankBy: string,
    page: number,
    limit: number,
    trend: NoShowTrendItemDto[] = [],
  ): NoShowRateResponseDto {
    const noShowRate =
      kpi.totalBookings > 0
        ? Math.round((kpi.noShowCount / kpi.totalBookings) * 1000) / 10
        : 0;

    if (kpi.noShowCount === 0) {
      const res = this.buildEmptyResponse(from, to, rankBy, page, limit, trend);
      res.totalBookings = kpi.totalBookings;
      res.noShowRate = noShowRate;
      return res;
    }

    const items: RankingItemDto[] = dbItems.map((dbItem) => {
      const rate =
        dbItem.totalBookings > 0
          ? Math.round((dbItem.noShowCount / dbItem.totalBookings) * 1000) / 10
          : 0;

      return {
        id: dbItem.id,
        name: dbItem.name,
        email: dbItem.email,
        noShowCount: dbItem.noShowCount,
        totalBookings: dbItem.totalBookings,
        noShowRate: rate,
        lowSampleSize: dbItem.totalBookings < 3,
      };
    });

    const total = dbItems[0]?.fullCount ?? 0;
    const totalPages = Math.ceil(total / limit);

    return {
      period: { from, to },
      noShowCount: kpi.noShowCount,
      totalBookings: kpi.totalBookings,
      noShowRate,
      trend,
      ranking: {
        rankBy,
        items,
        page,
        limit,
        total,
        totalPages,
      },
    };
  }
}
