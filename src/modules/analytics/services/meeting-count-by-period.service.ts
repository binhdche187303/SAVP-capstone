import { filterValues, type FilterSelection } from '../../../common/utils/filter-selection.js';
import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { MeetingCountByPeriodRepository } from '../repositories/meeting-count-by-period.repository';
import { DashboardOverviewConfigService } from './dashboard-overview-config.service';
import { QueryMeetingCountByPeriodDto } from '../dto/query-meeting-count-by-period.dto';
import { MeetingCountByPeriodResponseDto } from '../dto/meeting-count-by-period-response.dto';

interface ScopeResult {
  isAdmin: boolean;
  scopeDepartmentIds: string[] | null;
  viewerRole?: string;
}

@Injectable()
export class MeetingCountByPeriodService {
  private readonly logger = new Logger(MeetingCountByPeriodService.name);

  constructor(
    private readonly authzRepo: AuthzReadRepository,
    private readonly repo: MeetingCountByPeriodRepository,
    private readonly configService: DashboardOverviewConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Orchestrator: resolve date range -> validate max range -> resolve scope -> validate department ownership -> generate buckets -> query -> build response.
   */
  async getCountByPeriod(
    currentUser: { userId: string },
    query: QueryMeetingCountByPeriodDto,
  ): Promise<{ data: MeetingCountByPeriodResponseDto; message: string }> {
    // 1. Resolve Date Range
    const { from, to } = this.resolveDateRange(query.from, query.to);

    // 2. Validate Max Range Days
    await this.validateMaxRange(from, to);

    // 3. Resolve Scope
    const scope = await this.resolveScope(currentUser.userId);

    // 4. Validate Department Ownership for MANAGER
    this.validateDepartmentOwnership(scope, query.departmentId);

    const granularity = query.granularity || 'week';
    const buckets = this.generateBuckets(from, to, granularity);

    // Audit log helper
    const logAction = async (totalCount: number) => {
      try {
        await this.auditLogsService.logAction({
          userId: currentUser.userId,
          actionType: 'read_analytics_meeting_count_by_period',
          entityType: 'meetings',
          metadataJson: {
            viewerUserId: currentUser.userId,
            viewerRole: scope.viewerRole,
            from,
            to,
            granularity,
            departmentId: query.departmentId,
            roomId: query.roomId,
            meetingType: query.meetingType,
            resolvedScopeDepartmentIds: scope.scopeDepartmentIds,
            totalMeetingCount: totalCount,
          },
        });
      } catch (err) {
        this.logger.warn(
          'Failed to write audit log for meeting count by period',
          err instanceof Error ? err.message : undefined,
        );
      }
    };

    // 5. Short-circuit if manager has no departments
    if (
      scope.scopeDepartmentIds !== null &&
      scope.scopeDepartmentIds.length === 0
    ) {
      const data = this.buildEmptyResponse(buckets);
      await logAction(0);
      return { data, message: data.message! };
    }

    // 6. Query aggregation
    const params = {
      from,
      to,
      scopeDepartmentIds: scope.scopeDepartmentIds,
      departmentId: query.departmentId,
      roomId: query.roomId,
      meetingType: query.meetingType,
      granularity,
    };

    const countMap = await this.repo.countMeetingsByBucket(params);

    const data = this.buildResponse(buckets, countMap);

    await logAction(data.total);

    const message =
      data.total === 0
        ? 'Không tìm thấy dữ liệu cuộc họp nào thỏa mãn các tiêu chí lọc hiện tại'
        : 'Thống kê số lượng cuộc họp được truy xuất thành công';

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
        'You do not have permission to view meeting count by period analytics',
      error: { code: 'PERMISSION_DENIED', details: {} },
    });
  }

  /**
   * Resolve from/to dates. Default to current month boundaries.
   */
  resolveDateRange(from?: string, to?: string): { from: string; to: string } {
    if (!from && !to) {
      const tzOffset = 7 * 60; // UTC+7
      const now = new Date();
      const localTime = new Date(now.getTime() + tzOffset * 60000);
      const currentYear = localTime.getUTCFullYear();
      const currentMonth = localTime.getUTCMonth(); // 0-indexed

      const firstDay = new Date(Date.UTC(currentYear, currentMonth, 1));
      const lastDay = new Date(Date.UTC(currentYear, currentMonth + 1, 0));

      return {
        from: firstDay.toISOString().split('T')[0],
        to: lastDay.toISOString().split('T')[0],
      };
    }

    if (!from || !to) {
      throw new BadRequestException({
        success: false,
        message: 'Both from and to dates must be provided',
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
  validateDepartmentOwnership(scope: ScopeResult, departmentId?: FilterSelection<string>): void {
    if (scope.isAdmin || !departmentId) return;

    if (filterValues(departmentId).some(id => !scope.scopeDepartmentIds?.includes(id))) {
      throw new ForbiddenException({
        success: false,
        message: 'Department is outside your scope',
        error: { code: 'DEPARTMENT_OUT_OF_SCOPE', details: {} },
      });
    }
  }

  /**
   * Generate periods buckets.
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
   * Build empty response.
   */
  private buildEmptyResponse(
    buckets: string[],
  ): MeetingCountByPeriodResponseDto {
    return {
      total: 0,
      series: buckets.map((period) => ({ period, count: 0 })),
      message:
        'Không tìm thấy dữ liệu cuộc họp nào thỏa mãn các tiêu chí lọc hiện tại',
    };
  }

  /**
   * Build full response.
   */
  private buildResponse(
    buckets: string[],
    countMap: Map<string, number>,
  ): MeetingCountByPeriodResponseDto {
    let total = 0;
    const series = buckets.map((period) => {
      const count = countMap.get(period) ?? 0;
      total += count;
      return { period, count };
    });

    const response: MeetingCountByPeriodResponseDto = {
      total,
      series,
    };

    if (total === 0) {
      response.message =
        'Không tìm thấy dữ liệu cuộc họp nào thỏa mãn các tiêu chí lọc hiện tại';
    }

    return response;
  }
}
