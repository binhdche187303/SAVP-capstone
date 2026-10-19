import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { BackgroundJobType } from '../../administration/entities/background-job.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { DashboardOverviewConfigService } from '../../analytics/services/dashboard-overview-config.service.js';
import { CreateGateAccessExportDto } from '../dto/create-gate-access-export.dto.js';
import { CreateExportResponseDto } from '../dto/meeting-activity-export-response.dto.js';
import {
  REPORT_EXPORT_QUEUE_NAME,
  GATE_ACCESS_EXPORT_JOB_NAME,
} from '../constants/report-export-job.constants.js';

export interface ResolvedGateAccessScope {
  zoneId: string | null;
  departmentId: string | null;
  userId: string | null;
}

/**
 * GateAccessReportService — orchestrator cho UC-127.
 *
 * Luồng: validate from/to/format → resolve scope theo RBAC (mirror UC-AA-12 §2.2,
 * KHÔNG rollup phòng ban con) → createQueuedJob → addJob(BullMQ) → trả jobId.
 *
 * §0.1 spec: LUÔN enqueue job kể cả khi tổ hợp filter có thể rỗng — worker sẽ
 * render file "Không có dữ liệu" hợp lệ, KHÔNG chặn tạo job đồng bộ ở tầng này.
 */
@Injectable()
export class GateAccessReportService {
  private readonly logger = new Logger(GateAccessReportService.name);

  constructor(
    private readonly authzRepo: AuthzReadRepository,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly queueService: QueueService,
    private readonly dashboardConfigService: DashboardOverviewConfigService,
    private readonly auditLogsService: AuditLogsService,
    private readonly dataSource: DataSource,
  ) {}

  async createExportJob(
    currentUser: { userId: string; email: string; sub?: string },
    dto: CreateGateAccessExportDto,
  ): Promise<CreateExportResponseDto> {
    try {
      this.validateDateRange(dto.from, dto.to);
      await this.validateMaxRangeDays(dto.from, dto.to);

      const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
        currentUser.userId,
      );

      const resolvedScope = await this.resolveScope(
        currentUser.userId,
        dto.scope,
        roles,
      );

      const backgroundJob = await this.backgroundJobsService.createQueuedJob({
        jobType: BackgroundJobType.EXPORT_REPORT,
        requestedBy: currentUser.userId,
        relatedEntityType: 'gate_access_report',
        inputJson: {
          from: dto.from,
          to: dto.to,
          format: dto.format,
          scope: resolvedScope,
        },
      });

      await this.queueService.addJob(
        REPORT_EXPORT_QUEUE_NAME,
        GATE_ACCESS_EXPORT_JOB_NAME,
        {
          backgroundJobId: backgroundJob.id,
          from: dto.from,
          to: dto.to,
          format: dto.format,
          scope: resolvedScope,
          requestedByEmail: currentUser.email,
        },
      );

      this.writeAuditLog(
        currentUser.userId,
        backgroundJob.id,
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
   * Resolve scope theo RBAC (§2.2 spec, CL-1 §5.6):
   * - SYSTEM_ADMIN/BUSINESS_ADMIN → không giới hạn.
   * - MANAGER → chỉ được dùng departmentId/userId thuộc phạm vi quản lý; zoneId không
   *   giới hạn (cổng không gắn phòng ban).
   */
  private async resolveScope(
    userId: string,
    scope: CreateGateAccessExportDto['scope'] | undefined,
    roles: string[],
  ): Promise<ResolvedGateAccessScope> {
    const isAdmin =
      roles.includes('SYSTEM_ADMIN') || roles.includes('BUSINESS_ADMIN');

    if (isAdmin) {
      return {
        zoneId: scope?.zoneId ?? null,
        departmentId: scope?.departmentId ?? null,
        userId: scope?.userId ?? null,
      };
    }

    if (roles.includes('MANAGER')) {
      const rows: { id: string }[] = await this.dataSource.query(
        `SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL))`,
        [userId],
      );
      const managedIds = rows.map((r) => r.id);

      const requestedDeptId = scope?.departmentId;
      if (requestedDeptId && !managedIds.includes(requestedDeptId)) {
        throw new ForbiddenException({
          success: false,
          message: 'Phòng ban nằm ngoài phạm vi quản lý của bạn.',
          error: { code: 'DEPARTMENT_OUT_OF_SCOPE', details: {} },
        });
      }

      // CL-1: nếu Manager truyền userId, kiểm tra người đó thuộc phòng ban quản lý.
      if (scope?.userId) {
        const targetRows: { department_id: string | null }[] =
          await this.dataSource.query(
            `SELECT department_id FROM users WHERE id = $1`,
            [scope.userId],
          );
        const targetDeptId = targetRows[0]?.department_id ?? null;
        if (!targetDeptId || !managedIds.includes(targetDeptId)) {
          throw new ForbiddenException({
            success: false,
            message: 'Cá nhân nằm ngoài phạm vi quản lý của bạn.',
            error: { code: 'DEPARTMENT_OUT_OF_SCOPE', details: {} },
          });
        }
      }

      const fallbackDeptId =
        managedIds.length > 0
          ? managedIds[0]
          : '00000000-0000-0000-0000-000000000000';

      return {
        zoneId: scope?.zoneId ?? null,
        departmentId: requestedDeptId ?? fallbackDeptId,
        userId: scope?.userId ?? null,
      };
    }

    throw new ForbiddenException({
      success: false,
      message: 'Bạn không có quyền xuất báo cáo này.',
      error: { code: 'PERMISSION_DENIED', details: {} },
    });
  }

  private async writeAuditLog(
    userId: string,
    jobId: string,
    from: string,
    to: string,
    format: string,
    scope: ResolvedGateAccessScope,
  ): Promise<void> {
    await this.auditLogsService.logAction({
      userId,
      actionType: 'export_gate_access_report',
      entityType: 'background_jobs',
      entityId: jobId,
      metadataJson: { viewerUserId: userId, from, to, format, scope, jobId },
    });
  }
}
