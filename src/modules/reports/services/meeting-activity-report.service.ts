import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { BackgroundJobType } from '../../administration/entities/background-job.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { DashboardOverviewConfigService } from '../../analytics/services/dashboard-overview-config.service.js';
import { CreateMeetingActivityExportDto } from '../dto/create-meeting-activity-export.dto.js';
import { CreateExportResponseDto } from '../dto/meeting-activity-export-response.dto.js';
import {
  REPORT_EXPORT_QUEUE_NAME,
  MEETING_ACTIVITY_EXPORT_JOB_NAME,
} from '../constants/report-export-job.constants.js';

interface ResolvedScope {
  departmentId: string | null;
  roomId: string | null;
  organizerId: string | null;
}

/**
 * MeetingActivityReportService — orchestrator cho UC-AA-12 / UC-158.
 *
 * Luồng: validate from/to/delivery → resolve department scope theo RBAC →
 * createQueuedJob → addJob(BullMQ) → trả jobId.
 *
 * FR-001, FR-002, FR-003: orchestration.
 * FR-006..FR-012: department scope enforcement.
 * FR-013..FR-020: validation.
 */
@Injectable()
export class MeetingActivityReportService {
  private readonly logger = new Logger(MeetingActivityReportService.name);

  constructor(
    private readonly authzRepo: AuthzReadRepository,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly queueService: QueueService,
    private readonly dashboardConfigService: DashboardOverviewConfigService,
    private readonly auditLogsService: AuditLogsService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Tạo export job bất đồng bộ.
   * FR-001, FR-005, FR-029.
   */
  async createExportJob(
    currentUser: { userId: string; email: string; sub?: string },
    dto: CreateMeetingActivityExportDto,
  ): Promise<CreateExportResponseDto> {
    try {
      // 1. Validate from/to
      this.validateDateRange(dto.from, dto.to);

      // 2. Validate max range days (T018)
      await this.validateMaxRangeDays(dto.from, dto.to);

      // 3. Validate delivery (T020)
      this.validateDelivery(dto.delivery);

      // 4. Resolve department scope (T019)
      const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
        currentUser.userId,
      );
      const viewerRole = roles.includes('SYSTEM_ADMIN')
        ? 'SYSTEM_ADMIN'
        : roles.includes('BUSINESS_ADMIN')
          ? 'BUSINESS_ADMIN'
          : roles.includes('MANAGER')
            ? 'MANAGER'
            : 'USER';

      const resolvedScope = await this.resolveDepartmentScope(
        currentUser.userId,
        dto.scope,
        roles,
      );

      // 5. Tạo background job record
      const backgroundJob = await this.backgroundJobsService.createQueuedJob({
        jobType: BackgroundJobType.EXPORT_REPORT,
        requestedBy: currentUser.userId,
        relatedEntityType: 'meeting_activity_report',
        inputJson: {
          from: dto.from,
          to: dto.to,
          format: dto.format,
          scope: resolvedScope,
          delivery: 'download',
        },
      });

      // 6. Enqueue BullMQ job
      await this.queueService.addJob(
        REPORT_EXPORT_QUEUE_NAME,
        MEETING_ACTIVITY_EXPORT_JOB_NAME,
        {
          backgroundJobId: backgroundJob.id,
          from: dto.from,
          to: dto.to,
          format: dto.format,
          scope: resolvedScope,
          requestedByEmail: currentUser.email,
        },
      );

      // 7. Audit log non-blocking (FR-029)
      this.writeAuditLog(
        currentUser.userId,
        backgroundJob.id,
        viewerRole,
        dto.from,
        dto.to,
        dto.format,
        resolvedScope,
      ).catch((err) =>
        this.logger.warn(
          `Audit log write failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

      return {
        jobId: backgroundJob.id,
        status: 'queued',
        delivery: 'download',
        outputFileId: null,
      };
    } catch (error: unknown) {
      // Re-throw known HTTP exceptions
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`createExportJob failed: ${errMsg}`);
      throw new InternalServerErrorException({
        success: false,
        message: 'Đã xảy ra lỗi khi tạo export job.',
        error: { code: 'INTERNAL_ERROR', details: {} },
      });
    }
  }

  // ───── Private validation helpers ─────────────────────────────────────────

  /**
   * T018: Validate from/to hợp lệ và from <= to.
   * FR-016, FR-017.
   */
  private validateDateRange(from: string, to: string): void {
    if (!from || !to) {
      throw new BadRequestException({
        success: false,
        message: 'from và to là bắt buộc.',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
    if (from > to) {
      throw new BadRequestException({
        success: false,
        message: 'from không được sau to.',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
  }

  /**
   * T018: Validate kỳ báo cáo không vượt analytics.dashboard_max_range_days.
   * FR-020.
   */
  private async validateMaxRangeDays(from: string, to: string): Promise<void> {
    const maxDays = await this.dashboardConfigService.getMaxRangeDays();
    const diffDays =
      (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
    if (diffDays > maxDays) {
      throw new BadRequestException({
        success: false,
        message: `Kỳ báo cáo vượt quá ${maxDays} ngày tối đa.`,
        error: { code: 'DATE_RANGE_TOO_LARGE', details: { maxDays } },
      });
    }
  }

  /**
   * T020: Validate delivery chỉ chấp nhận undefined hoặc 'download'.
   * OOS-001.
   */
  private validateDelivery(delivery: string | undefined): void {
    if (delivery !== undefined && delivery !== 'download') {
      throw new BadRequestException({
        success: false,
        message: "Chỉ hỗ trợ delivery='download'.",
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
  }

  /**
   * T019: Resolve scope department theo RBAC.
   * - SYSTEM_ADMIN / BUSINESS_ADMIN → không giới hạn (scope.departmentId dùng nguyên)
   * - MANAGER → chỉ được dùng departmentId thuộc phạm vi quản lý;
   *   nếu truyền departmentId ngoài phạm vi → ForbiddenException.
   *
   * FR-006, FR-007, FR-012, FR-015, FR-021.
   */
  private async resolveDepartmentScope(
    userId: string,
    scope?: CreateMeetingActivityExportDto['scope'],
    roles: string[] = [],
  ): Promise<ResolvedScope> {
    const isAdmin =
      roles.includes('SYSTEM_ADMIN') || roles.includes('BUSINESS_ADMIN');

    if (isAdmin) {
      return {
        departmentId: scope?.departmentId ?? null,
        roomId: scope?.roomId ?? null,
        organizerId: scope?.organizerId ?? null,
      };
    }

    // MANAGER: kiểm tra departmentId thuộc phạm vi quản lý
    if (roles.includes('MANAGER')) {
      // Query phòng ban do user quản lý
      const rows: { id: string }[] = await this.dataSource.query(
        `SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL))`,
        [userId],
      );
      const managedIds = rows.map((r) => r.id);

      // Nếu MANAGER truyền departmentId, kiểm tra hợp lệ
      const requestedDeptId = scope?.departmentId;
      if (requestedDeptId && !managedIds.includes(requestedDeptId)) {
        throw new ForbiddenException({
          success: false,
          message: 'Phòng ban nằm ngoài phạm vi quản lý của bạn.',
          error: { code: 'DEPARTMENT_OUT_OF_SCOPE', details: {} },
        });
      }

      // Nếu MANAGER không truyền departmentId, scope theo tất cả phòng ban quản lý
      // Nếu MANAGER không quản lý phòng ban nào, gán dummy UUID để query trả về rỗng (đúng FR-030)
      const fallbackDeptId =
        managedIds.length > 0
          ? managedIds[0]
          : '00000000-0000-0000-0000-000000000000';

      return {
        departmentId: requestedDeptId ?? fallbackDeptId,
        roomId: scope?.roomId ?? null,
        organizerId: scope?.organizerId ?? null,
      };
    }

    // Role khác không có quyền — PermissionsGuard đã chặn trước, nhưng fallback an toàn
    throw new ForbiddenException({
      success: false,
      message: 'Bạn không có quyền xuất báo cáo này.',
      error: { code: 'PERMISSION_DENIED', details: {} },
    });
  }

  // ───── Audit log ──────────────────────────────────────────────────────────

  private async writeAuditLog(
    userId: string,
    jobId: string,
    viewerRole: string,
    from: string,
    to: string,
    format: string,
    scope: ResolvedScope,
  ): Promise<void> {
    const auditEnabled = this.configService.get<string>(
      'AUDIT_LOG_ENABLED',
      'true',
    );
    if (auditEnabled !== 'true') return;
    await this.auditLogsService.logAction({
      userId,
      actionType: 'export_meeting_activity_report',
      entityType: 'background_jobs',
      entityId: jobId,
      metadataJson: {
        viewerUserId: userId,
        viewerRole,
        from,
        to,
        format,
        scope,
        jobId,
      },
    });
  }
}
