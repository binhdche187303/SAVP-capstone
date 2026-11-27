import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { MeetingAverageDurationRepository } from '../repositories/meeting-average-duration.repository';
import { DashboardOverviewConfigService } from './dashboard-overview-config.service';
import { QueryMeetingAverageDurationDto } from '../dto/query-meeting-average-duration.dto';
import { MeetingAverageDurationResponseDto } from '../dto/meeting-average-duration-response.dto';

interface ScopeResult {
  isAdmin: boolean;
  scopeDepartmentIds: string[] | null;
  viewerRole?: string;
}

@Injectable()
export class MeetingAverageDurationService {
  private readonly logger = new Logger(MeetingAverageDurationService.name);

  constructor(
    private readonly authzRepo: AuthzReadRepository,
    private readonly repo: MeetingAverageDurationRepository,
    private readonly configService: DashboardOverviewConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Orchestrator: resolve scope -> validate -> generate buckets -> aggregate -> build response.
   */
  async getAverageDuration(
    currentUser: { userId: string },
    query: QueryMeetingAverageDurationDto,
  ): Promise<{ data: MeetingAverageDurationResponseDto; message: string }> {
    const { from, to } = await this.resolveDateRange(query);
    await this.validateMaxRange(from, to);
    const scope = await this.resolveScope(currentUser.userId);
    this.validateDepartmentOwnership(scope, query.departmentIds);

    const granularity = query.granularity || 'week';
    const buckets = this.generateBuckets(from, to, granularity);

    const params = {
      from,
      to,
      scopeDepartmentIds: scope.scopeDepartmentIds,
      departmentIds: query.departmentIds,
      roomId: query.roomId,
      granularity,
    };

    // Aggregate average duration by bucket and total summary
    const [bucketResults, summaryResult] = await Promise.all([
      this.repo.getAverageDurationByBucket(params),
      this.repo.getAverageDurationSummary(params),
    ]);

    const data = this.buildResponse(
      from,
      to,
      buckets,
      bucketResults,
      summaryResult,
    );

    // Audit logging
    try {
      await this.auditLogsService.logAction({
        userId: currentUser.userId,
        actionType: 'read_analytics_meeting_average_duration',
        entityType: 'meetings',
        metadataJson: {
          viewerUserId: currentUser.userId,
          viewerRole: scope.viewerRole,
          from,
          to,
          granularity,
          departmentIds: query.departmentIds,
          roomId: query.roomId,
          resolvedScopeDepartmentIds: scope.scopeDepartmentIds,
          completedMeetingCount: summaryResult.count,
        },
      });
    } catch (err) {
      this.logger.warn(
        'Failed to write audit log for meeting average duration',
        err instanceof Error ? err.message : undefined,
      );
    }

    const message =
      summaryResult.count === 0
        ? 'Không có dữ liệu thời lượng cuộc họp nào cho bộ lọc hiện tại'
        : 'Thống kê thời lượng trung bình cuộc họp được truy xuất thành công';

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
        'You do not have permission to view meeting average duration analytics',
      error: { code: 'PERMISSION_DENIED', details: {} },
    });
  }

  /**
   * Resolve date range: defaults to current month boundaries (Ho Chi Minh timezone)
   */
  async resolveDateRange(
    query: QueryMeetingAverageDurationDto,
  ): Promise<{ from: string; to: string }> {
    let from = query.from;
    let to = query.to;

    if (!from || !to) {
      const now = new Date();
      // Adjust now to Asia/Ho_Chi_Minh timezone (UTC+7)
      const tzOffset = 7 * 60; // in minutes
      const localTime = new Date(now.getTime() + tzOffset * 60000);
      const year = localTime.getUTCFullYear();
      const month = localTime.getUTCMonth(); // 0-indexed

      // First day of current month
      const firstDay = new Date(Date.UTC(year, month, 1));
      // Last day of current month (day 0 of next month is the last day of this month)
      const lastDay = new Date(Date.UTC(year, month + 1, 0));

      if (!from) {
        from = firstDay.toISOString().split('T')[0];
      }
      if (!to) {
        to = lastDay.toISOString().split('T')[0];
      }
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

  /**
   * Validate range does not exceed maxRangeDays.
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
   * Validate departmentIds is within manager scope.
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
   * Generate buckets based on granularity.
   */
  generateBuckets(from: string, to: string, granularity: string): string[] {
    const buckets: string[] = [];
    const curr = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);

    if (granularity === 'day') {
      while (curr <= end) {
        buckets.push(curr.toISOString().split('T')[0]);
        curr.setUTCDate(curr.getUTCDate() + 1);
      }
    } else if (granularity === 'month') {
      curr.setUTCDate(1);
      while (curr <= end) {
        const year = curr.getUTCFullYear();
        const month = String(curr.getUTCMonth() + 1).padStart(2, '0');
        buckets.push(`${year}-${month}`);
        curr.setUTCMonth(curr.getUTCMonth() + 1);
      }
    } else if (granularity === 'quarter') {
      const startMonth = Math.floor(curr.getUTCMonth() / 3) * 3;
      curr.setUTCMonth(startMonth, 1);
      while (curr <= end) {
        const year = curr.getUTCFullYear();
        const quarter = Math.floor(curr.getUTCMonth() / 3) + 1;
        buckets.push(`${year}-Q${quarter}`);
        curr.setUTCMonth(curr.getUTCMonth() + 3);
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
    const dayNum = (d.getUTCDay() + 6) % 7; // Monday is 0, Sunday is 6
    d.setUTCDate(d.getUTCDate() - dayNum + 3); // Set to Thursday of the same week
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
   * Build response data.
   */
  private buildResponse(
    from: string,
    to: string,
    buckets: string[],
    bucketResults: Map<
      string,
      { plannedAvg: number | null; actualAvg: number | null; count: number }
    >,
    summaryResult: {
      plannedAvg: number | null;
      actualAvg: number | null;
      count: number;
    },
  ): MeetingAverageDurationResponseDto {
    const series = buckets.map((bucketKey) => {
      const result = bucketResults.get(bucketKey);
      if (!result || result.count === 0) {
        return {
          period: bucketKey,
          plannedAverageMinutes: null,
          actualAverageMinutes: null,
          completedMeetingCount: 0,
        };
      }
      return {
        period: bucketKey,
        plannedAverageMinutes:
          result.plannedAvg !== null
            ? Math.round(result.plannedAvg * 10) / 10
            : null,
        actualAverageMinutes:
          result.actualAvg !== null
            ? Math.round(result.actualAvg * 10) / 10
            : null,
        completedMeetingCount: result.count,
      };
    });

    const summary = {
      plannedAverageMinutes:
        summaryResult.plannedAvg !== null
          ? Math.round(summaryResult.plannedAvg * 10) / 10
          : null,
      actualAverageMinutes:
        summaryResult.actualAvg !== null
          ? Math.round(summaryResult.actualAvg * 10) / 10
          : null,
      completedMeetingCount: summaryResult.count,
    };

    return {
      period: { from, to },
      summary,
      series,
    };
  }
}
