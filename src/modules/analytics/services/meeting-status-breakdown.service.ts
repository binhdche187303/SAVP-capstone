import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { MeetingStatusBreakdownRepository } from '../repositories/meeting-status-breakdown.repository';
import { DashboardOverviewConfigService } from './dashboard-overview-config.service';
import { QueryMeetingStatusBreakdownDto } from '../dto/query-meeting-status-breakdown.dto';
import {
  MeetingStatusBreakdownResponseDto,
  StatusBreakdownItemDto,
} from '../dto/meeting-status-breakdown-response.dto';

interface ScopeResult {
  isAdmin: boolean;
  scopeDepartmentIds: string[] | null;
  viewerRole?: string;
}

@Injectable()
export class MeetingStatusBreakdownService {
  private readonly logger = new Logger(MeetingStatusBreakdownService.name);

  constructor(
    private readonly authzRepo: AuthzReadRepository,
    private readonly repo: MeetingStatusBreakdownRepository,
    private readonly configService: DashboardOverviewConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Orchestrator: resolve date range -> validate max range -> resolve scope -> validate department ownership -> query -> build response.
   */
  async getStatusBreakdown(
    currentUser: { userId: string },
    query: QueryMeetingStatusBreakdownDto,
  ): Promise<{ data: MeetingStatusBreakdownResponseDto; message: string }> {
    // 1. Resolve Date Range from Preset
    const { from, to } = this.resolveDateRange(
      query.preset,
      query.from,
      query.to,
    );

    // 2. Validate Max Range Days
    await this.validateMaxRange(from, to);

    // 3. Resolve Scope
    const scope = await this.resolveScope(currentUser.userId);

    // 4. Validate Department Ownership for MANAGER (multi-select)
    this.validateDepartmentOwnership(scope, query.departmentIds);

    // Audit log helper
    const logAction = async (totalCount: number) => {
      try {
        await this.auditLogsService.logAction({
          userId: currentUser.userId,
          actionType: 'read_analytics_meeting_status_breakdown',
          entityType: 'meetings',
          metadataJson: {
            viewerUserId: currentUser.userId,
            viewerRole: scope.viewerRole,
            from,
            to,
            departmentIds: query.departmentIds,
            resolvedScopeDepartmentIds: scope.scopeDepartmentIds,
            totalMeetingCount: totalCount,
          },
        });
      } catch (err) {
        this.logger.warn(
          'Failed to write audit log for meeting status breakdown',
          err instanceof Error ? err.message : undefined,
        );
      }
    };

    // 5. Short-circuit if manager has no departments
    if (
      scope.scopeDepartmentIds !== null &&
      scope.scopeDepartmentIds.length === 0
    ) {
      const data = this.buildEmptyResponse(from, to);
      await logAction(0);
      return { data, message: data.message! };
    }

    // 6. Query counts
    const params = {
      from,
      to,
      scopeDepartmentIds: scope.scopeDepartmentIds,
      departmentIds: query.departmentIds,
    };

    const countMap = await this.repo.getStatusCounts(params);

    const data = this.buildResponse(countMap, from, to);

    await logAction(data.total);

    const message =
      data.total === 0
        ? 'Không có dữ liệu cuộc họp nào thỏa mãn bộ lọc hiện tại'
        : 'Thống kê cuộc họp theo trạng thái được truy xuất thành công';

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
        'You do not have permission to view meeting status breakdown analytics',
      error: { code: 'PERMISSION_DENIED', details: {} },
    });
  }

  /**
   * Resolve from/to dates based on preset range.
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
   * Validate departmentIds are within scope for MANAGER.
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
   * Build empty response.
   */
  private buildEmptyResponse(
    from: string,
    to: string,
  ): MeetingStatusBreakdownResponseDto {
    const statuses: Array<'scheduled' | 'completed' | 'cancelled' | 'no_show'> =
      ['scheduled', 'completed', 'cancelled', 'no_show'];

    const items = statuses.map((status) => ({
      status,
      count: 0,
      percentage: 0,
    }));

    return {
      period: { from, to },
      total: 0,
      items,
      message: 'Không có dữ liệu cuộc họp nào thỏa mãn bộ lọc hiện tại',
    };
  }

  /**
   * Build full response.
   */
  private buildResponse(
    countMap: Map<'scheduled' | 'completed' | 'cancelled' | 'no_show', number>,
    from: string,
    to: string,
  ): MeetingStatusBreakdownResponseDto {
    const statuses: Array<'scheduled' | 'completed' | 'cancelled' | 'no_show'> =
      ['scheduled', 'completed', 'cancelled', 'no_show'];

    let total = 0;
    for (const status of statuses) {
      total += countMap.get(status) ?? 0;
    }

    const items: StatusBreakdownItemDto[] = statuses.map((status) => {
      const count = countMap.get(status) ?? 0;
      const percentage =
        total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
      return { status, count, percentage };
    });

    const response: MeetingStatusBreakdownResponseDto = {
      period: { from, to },
      total,
      items,
    };

    if (total === 0) {
      response.message =
        'Không có dữ liệu cuộc họp nào thỏa mãn bộ lọc hiện tại';
    }

    return response;
  }
}
