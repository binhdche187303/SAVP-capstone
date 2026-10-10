import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { BackgroundJobType } from '../../administration/entities/background-job.entity.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { REPORT_CENTER_EXPORT_JOB_NAME, REPORT_EXPORT_QUEUE_NAME } from '../constants/report-export-job.constants.js';
import { reportBadRequest } from './report-center.errors.js';
import { ReportCenterService } from './report-center.service.js';
import { REPORT_FORMATS, type ReportFormat } from './report-file.service.js';
import { REPORT_DEFINITIONS, isReportType } from './report-definition.registry.js';

export interface ReportCenterExportJobData {
  backgroundJobId: string;
  type: string;
  format: ReportFormat;
  filters: Record<string, string | undefined>;
  scope: { unrestricted: boolean; departmentIds: string[] | null };
  requestedByEmail: string;
}

@Injectable()
export class ReportCenterExportService {
  private readonly logger = new Logger(ReportCenterExportService.name);

  constructor(
    private readonly center: ReportCenterService,
    private readonly jobs: BackgroundJobsService,
    private readonly queue: QueueService,
    private readonly audit: AuditLogsService,
    private readonly dataSource: DataSource,
  ) {}

  /** POST /reports/center/:type/exports → 202. Mọi việc dựng file đi qua hàng đợi (ARCH-02). */
  async create(type: string, body: Record<string, unknown>, user: { userId: string; email: string }) {
    const format = String(body['format'] ?? '');
    if (!(REPORT_FORMATS as string[]).includes(format)) throw reportBadRequest('Định dạng xuất không hợp lệ', 'VALIDATION_ERROR');
    const { filters, scope } = await this.center.prepare(type, body, user.userId);
    const job = await this.jobs.createQueuedJob({
      jobType: BackgroundJobType.EXPORT_REPORT,
      requestedBy: user.userId,
      relatedEntityType: 'report_center',
      inputJson: { type, format, filters, scope },
    });
    const data: ReportCenterExportJobData = {
      backgroundJobId: job.id, type, format: format as ReportFormat, filters, scope, requestedByEmail: user.email,
    };
    await this.queue.addJob(REPORT_EXPORT_QUEUE_NAME, REPORT_CENTER_EXPORT_JOB_NAME, data);
    this.audit
      .logAction({
        userId: user.userId, actionType: 'report_center_export', entityType: 'background_jobs', entityId: job.id,
        metadataJson: { type, format, from: filters.from, to: filters.to, filters, scope },
      })
      .catch((e) => this.logger.warn(`Audit xuất báo cáo lỗi: ${e instanceof Error ? e.message : String(e)}`));
    return { jobId: job.id, status: 'queued' as const, delivery: 'download' as const, outputFileId: null };
  }

  /** 10 job xuất gần nhất của chính người gọi. */
  async recent(userId: string) {
    const rows: Array<{ id: string; status: string; created: Date; input_json: Record<string, unknown>; output_file_id: string | null; output_json: { fileName?: string } | null }> =
      await this.dataSource.query(
        `SELECT id, status, COALESCE(scheduled_at, started_at, completed_at, now()) AS created, input_json, output_file_id, output_json
           FROM background_jobs WHERE related_entity_type = 'report_center' AND requested_by = $1
          ORDER BY COALESCE(started_at, scheduled_at, completed_at) DESC NULLS LAST, id LIMIT 10`,
        [userId],
      );
    return rows.map((r) => {
      const type = String(r.input_json?.['type'] ?? '');
      const filters = (r.input_json?.['filters'] ?? {}) as Record<string, string>;
      return {
        id: r.id,
        reportType: type,
        reportTitle: isReportType(type) ? REPORT_DEFINITIONS[type].title : type,
        format: r.input_json?.['format'] ?? null,
        from: filters['from'] ?? null,
        to: filters['to'] ?? null,
        fileName: r.output_json?.fileName ?? null,
        status: r.status,
        outputFileId: r.output_file_id,
        createdAt: new Date(r.created).toISOString(),
      };
    });
  }
}
