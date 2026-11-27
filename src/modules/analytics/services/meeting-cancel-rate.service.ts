import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import {
  MeetingCancelRateRepository,
  CancelRateSummaryResult,
  TopOrganizerResult,
  TopDepartmentResult,
} from '../repositories/meeting-cancel-rate.repository';
import { DashboardOverviewConfigService } from './dashboard-overview-config.service';
import { QueryMeetingCancelRateDto } from '../dto/query-meeting-cancel-rate.dto';
import { MeetingCancelRateResponseDto } from '../dto/meeting-cancel-rate-response.dto';

interface ScopeResult {
  isAdmin: boolean;
  scopeDepartmentIds: string[] | null;
  viewerRole?: string;
}

@Injectable()
export class MeetingCancelRateService {
  private readonly logger = new Logger(MeetingCancelRateService.name);

  constructor(
    private readonly authzRepo: AuthzReadRepository,
    private readonly repo: MeetingCancelRateRepository,
    private readonly configService: DashboardOverviewConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Orchestrator: resolve preset -> validate max range -> resolve scope -> validate department ownership -> resolve organizer email -> aggregate -> build response.
   */
  async getCancelRate(
    currentUser: { userId: string },
    query: QueryMeetingCancelRateDto,
  ): Promise<{ data: MeetingCancelRateResponseDto; message: string }> {
    // 1. Resolve Date Range from Preset
    const { from, to } = this.resolvePresetRange(
      query.preset,
      query.from,
      query.to,
    );

    // 2. Validate Max Range Days
    await this.validateMaxRange(from, to);

    // 3. Resolve Scope
    const scope = await this.resolveScope(currentUser.userId);

    // 4. Validate Department Ownership for MANAGER
    this.validateDepartmentOwnership(scope, query.departmentIds);

    const granularity = query.granularity || 'week';
    const buckets = this.generateBuckets(from, to, granularity);

    // Audit log helper
    const logAction = async (totalCount: number) => {
      try {
        await this.auditLogsService.logAction({
          userId: currentUser.userId,
          actionType: 'read_analytics_meeting_cancel_rate',
          entityType: 'meetings',
          metadataJson: {
            viewerUserId: currentUser.userId,
            viewerRole: scope.viewerRole,
            from,
            to,
            granularity,
            departmentIds: query.departmentIds,
            roomId: query.roomId,
            organizerEmail: query.organizerEmail,
            resolvedScopeDepartmentIds: scope.scopeDepartmentIds,
            totalMeetingCount: totalCount,
          },
        });
      } catch (err) {
        this.logger.warn(
          'Failed to write audit log for meeting cancel rate',
          err instanceof Error ? err.message : undefined,
        );
      }
    };

    // 5. Short-circuit if manager has no departments
    if (
      scope.scopeDepartmentIds !== null &&
      scope.scopeDepartmentIds.length === 0
    ) {
      const data = this.buildEmptyResponse(from, to, buckets);
      await logAction(0);
      return { data, message: data.message! };
    }

    // 6. Resolve organizer ID from email if provided
    let organizerId: string | undefined;
    if (query.organizerEmail) {
      const resolvedId = await this.repo.findUserIdByEmail(
        query.organizerEmail,
      );
      if (!resolvedId) {
        // organizerEmail doesn't match any user -> return empty response (EX1/FR-015/FR-018)
        const data = this.buildEmptyResponse(from, to, buckets);
        await logAction(0);
        return { data, message: data.message! };
      }
      organizerId = resolvedId;
    }

    // 7. Perform main queries
    const params = {
      from,
      to,
      scopeDepartmentIds: scope.scopeDepartmentIds,
      departmentIds: query.departmentIds,
      roomId: query.roomId,
      organizerId,
      granularity,
    };

    const [summaryResult, seriesResult, topOrganizersResult] =
      await Promise.all([
        this.repo.getCancelRateSummary(params),
        this.repo.getCancelRateSeries(params),
        this.repo.getTopOrganizers(params),
      ]);

    // MANAGER role cannot view topDepartments (returns empty)
    let topDepartmentsResult: TopDepartmentResult[] = [];
    if (scope.viewerRole !== 'MANAGER') {
      topDepartmentsResult = await this.repo.getTopDepartments(params);
    }

    const data = this.buildResponse(
      from,
      to,
      buckets,
      summaryResult,
      seriesResult,
      topOrganizersResult,
      topDepartmentsResult,
    );

    await logAction(summaryResult.totalMeetingCount);

    const message =
      summaryResult.totalMeetingCount === 0
        ? 'Không có dữ liệu thiết lập cuộc họp nào cho bộ lọc hiện tại'
        : 'Thống kê tỷ lệ cuộc họp bị hủy được truy xuất thành công';

    return { data, message };
  }

  /**
   * Resolve user scope based on role.
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
      message:
        'You do not have permission to view meeting cancel rate analytics',
      error: { code: 'PERMISSION_DENIED', details: {} },
    });
  }

  /**
   * Resolve from/to date strings based on preset.
   */
  resolvePresetRange(
    preset?: string,
    from?: string,
    to?: string,
  ): { from: string; to: string } {
    const tzOffset = 7 * 60; // UTC+7
    const now = new Date();
    const localTime = new Date(now.getTime() + tzOffset * 60000);
    const currentYear = localTime.getUTCFullYear();
    const currentMonth = localTime.getUTCMonth(); // 0-indexed

    const activePreset = preset || 'month_current';

    if (activePreset === 'month_current') {
      const firstDay = new Date(Date.UTC(currentYear, currentMonth, 1));
      const lastDay = new Date(Date.UTC(currentYear, currentMonth + 1, 0));
      return {
        from: firstDay.toISOString().split('T')[0],
        to: lastDay.toISOString().split('T')[0],
      };
    }

    if (activePreset === 'month_previous') {
      const firstDay = new Date(Date.UTC(currentYear, currentMonth - 1, 1));
      const lastDay = new Date(Date.UTC(currentYear, currentMonth, 0));
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
          message: 'Both from and to are required when preset is custom',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
      if (from > to) {
        throw new BadRequestException({
          success: false,
          message: 'from must be before or equal to to',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
      return { from, to };
    }

    throw new BadRequestException({
      success: false,
      message: 'Invalid preset value',
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
   * Validate departmentIds is within scope for MANAGER role.
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
   * Generate buckets based on granularity (week/month only).
   */
  generateBuckets(from: string, to: string, granularity: string): string[] {
    const buckets: string[] = [];
    const curr = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);

    if (granularity === 'month') {
      curr.setUTCDate(1);
      while (curr <= end) {
        const year = curr.getUTCFullYear();
        const month = String(curr.getUTCMonth() + 1).padStart(2, '0');
        buckets.push(`${year}-${month}`);
        curr.setUTCMonth(curr.getUTCMonth() + 1);
      }
    } else {
      // Default to 'week'
      const day = (curr.getUTCDay() + 6) % 7;
      curr.setUTCDate(curr.getUTCDate() - day);
      while (curr <= end) {
        buckets.push(this.getISOWeekLabel(curr));
        curr.setUTCDate(curr.getUTCDate() + 7);
      }
    }

    return buckets;
  }

  private getISOWeekLabel(date: Date): string {
    const d = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    const dayNum = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dayNum + 3);
    const firstThursday = d.getTime();
    d.setUTCMonth(0, 1);
    if (d.getUTCDay() !== 4) {
      d.setUTCMonth(0, 1 + ((4 - d.getUTCDay() + 7) % 7));
    }
    const weekNum = 1 + Math.ceil((firstThursday - d.getTime()) / 604800000);
    const year = new Date(firstThursday).getUTCFullYear();
    return `${year}-W${String(weekNum).padStart(2, '0')}`;
  }

  /**
   * Build response for empty/no-match cases.
   */
  private buildEmptyResponse(
    from: string,
    to: string,
    buckets: string[],
  ): MeetingCancelRateResponseDto {
    const series = buckets.map((period) => ({
      period,
      totalCount: 0,
      cancelledCount: 0,
      cancelRate: 0,
    }));

    return {
      period: { from, to },
      totalMeetingCount: 0,
      cancelledCount: 0,
      cancelRate: 0,
      series,
      topOrganizers: [],
      topDepartments: [],
      message: 'Không có dữ liệu thiết lập cuộc họp nào cho bộ lọc hiện tại',
    };
  }

  /**
   * Build full response.
   */
  private buildResponse(
    from: string,
    to: string,
    buckets: string[],
    summaryResult: CancelRateSummaryResult,
    seriesResult: Map<string, { totalCount: number; cancelledCount: number }>,
    topOrganizersResult: TopOrganizerResult[],
    topDepartmentsResult: TopDepartmentResult[],
  ): MeetingCancelRateResponseDto {
    const totalMeetingCount = summaryResult.totalMeetingCount;
    const cancelledCount = summaryResult.cancelledCount;

    const cancelRate =
      totalMeetingCount > 0
        ? Math.round((cancelledCount / totalMeetingCount) * 1000) / 10
        : 0;

    const series = buckets.map((bucketKey) => {
      const result = seriesResult.get(bucketKey);
      if (!result || result.totalCount === 0) {
        return {
          period: bucketKey,
          totalCount: 0,
          cancelledCount: 0,
          cancelRate: 0,
        };
      }
      return {
        period: bucketKey,
        totalCount: result.totalCount,
        cancelledCount: result.cancelledCount,
        cancelRate:
          Math.round((result.cancelledCount / result.totalCount) * 1000) / 10,
      };
    });

    const topOrganizers = topOrganizersResult.map((o) => ({
      userId: o.userId,
      email: o.email,
      fullName: o.fullName,
      organizedCount: o.organizedCount,
      cancelledCount: o.cancelledCount,
      cancelRate:
        o.organizedCount > 0
          ? Math.round((o.cancelledCount / o.organizedCount) * 1000) / 10
          : 0,
    }));

    const topDepartments = topDepartmentsResult.map((d) => ({
      departmentId: d.departmentId,
      departmentName: d.departmentName,
      organizedCount: d.organizedCount,
      cancelledCount: d.cancelledCount,
      cancelRate:
        d.organizedCount > 0
          ? Math.round((d.cancelledCount / d.organizedCount) * 1000) / 10
          : 0,
    }));

    const response: MeetingCancelRateResponseDto = {
      period: { from, to },
      totalMeetingCount,
      cancelledCount,
      cancelRate,
      series,
      topOrganizers,
      topDepartments,
    };

    if (totalMeetingCount === 0) {
      response.message =
        'Không có dữ liệu thiết lập cuộc họp nào cho bộ lọc hiện tại';
    }

    return response;
  }
}
