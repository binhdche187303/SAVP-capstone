import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { DashboardOverviewRepository } from '../repositories/dashboard-overview.repository';
import { DashboardOverviewConfigService } from './dashboard-overview-config.service';
import { QueryDashboardOverviewDto } from '../dto/query-dashboard-overview.dto';
import {
  DashboardOverviewResponseDto,
  TrendPointDto,
} from '../dto/dashboard-overview-response.dto';

interface ScopeResult {
  isAdmin: boolean;
  scopeDepartmentIds: string[] | null;
  viewerRole?: string;
}

@Injectable()
export class DashboardOverviewService {
  private readonly logger = new Logger(DashboardOverviewService.name);

  private static readonly CACHE_TTL_SECONDS = 60;
  private static readonly CACHE_PREFIX = 'analytics:dashboard:overview:';

  constructor(
    private readonly authzRepo: AuthzReadRepository,
    private readonly repo: DashboardOverviewRepository,
    private readonly configService: DashboardOverviewConfigService,
    private readonly auditLogsService: AuditLogsService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Orchestrator: resolve scope -> validate -> aggregate -> build response.
   */
  async getOverview(
    currentUser: { userId: string },
    query: QueryDashboardOverviewDto,
  ): Promise<DashboardOverviewResponseDto> {
    const scope = await this.resolveScope(currentUser.userId);
    const { from, to } = await this.resolveDateRange(query);
    await this.validateMaxRange(from, to);
    this.validateDepartmentOwnership(scope, query.departmentId);

    // Redis cache — key theo scope + filter (from/to/dept/room)
    const cacheKey = this.buildCacheKey(scope, from, to, query);
    try {
      const cached =
        await this.redisService.getJson<DashboardOverviewResponseDto>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache HIT ${cacheKey}`);
        return cached;
      }
    } catch {
      // Redis lỗi thì fallback DB, không throw
    }

    const params = {
      from,
      to,
      scopeDepartmentIds: scope.scopeDepartmentIds,
      departmentId: query.departmentId,
      roomId: query.roomId,
    };

    const logAction = async (meetCount: number) => {
      try {
        await this.auditLogsService.logAction({
          userId: currentUser.userId,
          actionType: 'read_analytics_dashboard_overview',
          entityType: 'analytics_dashboard',
          metadataJson: {
            viewerUserId: currentUser.userId,
            viewerRole: scope.viewerRole,
            from,
            to,
            departmentId: query.departmentId,
            roomId: query.roomId,
            resolvedScopeDepartmentIds: scope.scopeDepartmentIds,
            meetingCount: meetCount,
          },
        });
      } catch (err) {
        this.logger.warn(
          'Failed to write audit log for dashboard overview',
          err instanceof Error ? err.message : undefined,
        );
      }
    };

    // Empty state short-circuit
    const meetingCount = await this.repo.countMeetings(params);
    if (meetingCount === 0) {
      const emptyRes = this.buildEmptyResponse(from, to);
      logAction(0);
      return emptyRes;
    }

    // Aggregate all KPIs
    const [
      activeRooms,
      utilization,
      noShow,
      attendance,
      activeUserCount,
      recordingCount,
      trend,
    ] = await Promise.all([
      this.repo.countActiveRooms(params),
      this.repo.getUtilizationAggregate(params),
      this.repo.getNoShowAggregate(params),
      this.repo.getAttendanceAggregate(params),
      this.repo.countActiveUsers(params),
      this.repo.countRecordingSessions(params),
      this.repo.getDailyTrend(params),
    ]);

    const res = this.buildResponse(
      from,
      to,
      meetingCount,
      activeRooms,
      utilization,
      noShow,
      attendance,
      activeUserCount,
      recordingCount,
      trend,
    );

    logAction(meetingCount);

    // Cache SET (fail-safe: Redis lỗi không làm hỏng response)
    try {
      await this.redisService.setJsonWithTtl(
        cacheKey,
        res,
        DashboardOverviewService.CACHE_TTL_SECONDS,
      );
    } catch {
      // ignore
    }

    return res;
  }

  /**
   * Resolve user scope based on role.
   * SYSTEM_ADMIN/BUSINESS_ADMIN -> null (no restriction).
   * MANAGER -> query departments managed by user.
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
      message: 'You do not have permission to view analytics dashboard',
      error: { code: 'PERMISSION_DENIED', details: {} },
    });
  }

  /**
   * Resolve date range from query or defaults.
   */
  async resolveDateRange(
    query: QueryDashboardOverviewDto,
  ): Promise<{ from: string; to: string }> {
    const now = new Date();
    const from =
      query.from ??
      new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
    const to = query.to ?? now.toISOString().split('T')[0];

    if (from > to) {
      throw new BadRequestException({
        success: false,
        message: 'from must be before or equal to to',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }

    return { from, to };
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
   * Validate departmentId is within scope for MANAGER role.
   */
  validateDepartmentOwnership(scope: ScopeResult, departmentId?: string): void {
    if (scope.isAdmin || !departmentId) return;

    if (!scope.scopeDepartmentIds?.includes(departmentId)) {
      throw new ForbiddenException({
        success: false,
        message: 'Department is outside your scope',
        error: { code: 'DEPARTMENT_OUT_OF_SCOPE', details: {} },
      });
    }
  }

  /**
   * Build empty response (EX1).
   */
  private buildCacheKey(
    scope: ScopeResult,
    from: string,
    to: string,
    query: QueryDashboardOverviewDto,
  ): string {
    const scopeKey = scope.isAdmin
      ? 'admin'
      : (scope.scopeDepartmentIds ?? []).sort().join(',') || 'empty';
    return (
      DashboardOverviewService.CACHE_PREFIX +
      `${scopeKey}:${from}:${to}:${query.departmentId ?? '-'}:${query.roomId ?? '-'}`
    );
  }

  private buildEmptyResponse(
    from: string,
    to: string,
  ): DashboardOverviewResponseDto {
    return {
      period: { from, to },
      meetingCount: 0,
      activeRooms: 0,
      utilizationRate: 0,
      noShowRate: 0,
      onTimeRate: 0,
      recordingCount: 0,
      activeUserCount: 0,
      trend: [],
    };
  }

  /**
   * Build full response from aggregates.
   */
  private buildResponse(
    from: string,
    to: string,
    meetingCount: number,
    activeRooms: number,
    utilization: { actualMinutesSum: number; reservedMinutesSum: number },
    noShow: { noShowCount: number; bookingCount: number },
    attendance: { onTimeCount: number; totalCount: number },
    activeUserCount: number,
    recordingCount: number,
    trend: Array<{
      date: string;
      meetingCount: number;
      actualMinutesSum: number;
      reservedMinutesSum: number;
    }>,
  ): DashboardOverviewResponseDto {
    const utilizationRate =
      utilization.reservedMinutesSum > 0
        ? Math.round(
            (utilization.actualMinutesSum / utilization.reservedMinutesSum) *
              1000,
          ) / 10
        : 0;
    const noShowRate =
      noShow.bookingCount > 0
        ? Math.round((noShow.noShowCount / noShow.bookingCount) * 1000) / 10
        : 0;
    const onTimeRate =
      attendance.totalCount > 0
        ? Math.round((attendance.onTimeCount / attendance.totalCount) * 1000) /
          10
        : 0;

    const trendPoints: TrendPointDto[] = trend.map((t) => ({
      date: t.date,
      meetingCount: t.meetingCount,
      utilizationRate:
        t.reservedMinutesSum > 0
          ? Math.round((t.actualMinutesSum / t.reservedMinutesSum) * 1000) / 10
          : 0,
    }));

    return {
      period: { from, to },
      meetingCount,
      activeRooms,
      utilizationRate,
      noShowRate,
      onTimeRate,
      recordingCount,
      activeUserCount,
      trend: trendPoints,
    };
  }
}
