import type { FilterSelection } from '../../../common/utils/filter-selection.js';
import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { BackgroundJobType } from '../../administration/entities/background-job.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { DashboardOverviewConfigService } from '../../analytics/services/dashboard-overview-config.service.js';
import { CreateSecurityAlertExportDto } from '../dto/create-security-alert-export.dto.js';
import { CreateExportResponseDto } from '../dto/meeting-activity-export-response.dto.js';
import {
  REPORT_EXPORT_QUEUE_NAME,
  SECURITY_ALERT_EXPORT_JOB_NAME,
} from '../constants/report-export-job.constants.js';

/**
 * SecurityAlertReportService — orchestrator cho UC-129.
 *
 * §2.2 spec: KHÔNG áp scope phòng ban Manager — `security_alerts` không gắn
 * `department_id`, chỉ gắn `zone_id` (filter tùy chọn cho mọi role).
 * §0.1 spec: LUÔN enqueue job kể cả khi rỗng.
 */
@Injectable()
export class SecurityAlertReportService {
  private readonly logger = new Logger(SecurityAlertReportService.name);

  constructor(
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly queueService: QueueService,
    private readonly dashboardConfigService: DashboardOverviewConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async createExportJob(
    currentUser: { userId: string; email: string; sub?: string },
    dto: CreateSecurityAlertExportDto,
  ): Promise<CreateExportResponseDto> {
    try {
      this.validateDateRange(dto.from, dto.to);
      await this.validateMaxRangeDays(dto.from, dto.to);

      const filters = {
        alertType: dto.filters?.alertType ?? null,
        zoneId: dto.filters?.zoneId ?? null,
        status: dto.filters?.status ?? null,
        severity: dto.filters?.severity ?? null,
      };

      const backgroundJob = await this.backgroundJobsService.createQueuedJob({
        jobType: BackgroundJobType.EXPORT_REPORT,
        requestedBy: currentUser.userId,
        relatedEntityType: 'security_alert_report',
        inputJson: {
          from: dto.from,
          to: dto.to,
          format: dto.format,
          filters,
        },
      });

      await this.queueService.addJob(
        REPORT_EXPORT_QUEUE_NAME,
        SECURITY_ALERT_EXPORT_JOB_NAME,
        {
          backgroundJobId: backgroundJob.id,
          from: dto.from,
          to: dto.to,
          format: dto.format,
          filters,
          requestedByEmail: currentUser.email,
        },
      );

      this.writeAuditLog(
        currentUser.userId,
        backgroundJob.id,
        dto.from,
        dto.to,
        dto.format,
        filters,
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
      if (error instanceof BadRequestException) {
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

  private async writeAuditLog(
    userId: string,
    jobId: string,
    from: string,
    to: string,
    format: string,
    filters: {
      alertType: FilterSelection<string> | null;
      zoneId: FilterSelection<string> | null;
      status: FilterSelection<string> | null;
    },
  ): Promise<void> {
    await this.auditLogsService.logAction({
      userId,
      actionType: 'export_security_alert_report',
      entityType: 'background_jobs',
      entityId: jobId,
      metadataJson: { viewerUserId: userId, from, to, format, filters, jobId },
    });
  }
}
