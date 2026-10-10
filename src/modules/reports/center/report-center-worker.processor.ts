import { Inject, Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { BackgroundJobEntity } from '../../administration/entities/background-job.entity.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import type { ReportCenterExportJobData } from './report-center-export.service.js';
import { isReportType } from './report-definition.registry.js';
import { ReportFileService } from './report-file.service.js';
import { REPORT_PROVIDERS, type ReportProvider } from './report-model.js';

export const DEFAULT_EXPORT_MAX_ROWS = 50_000;

/**
 * Dựng file cho job `export:report-center`. Plain @Injectable — `MeetingActivityReportWorkerProcessor` giữ @Processor
 * duy nhất của queue `report-export` và gọi sang đây theo `job.name`. Lỗi → markFailed, KHÔNG ném (ARCH-02).
 */
@Injectable()
export class ReportCenterWorkerProcessor {
  private readonly logger = new Logger(ReportCenterWorkerProcessor.name);

  constructor(
    private readonly jobs: BackgroundJobsService,
    private readonly files: ReportFileService,
    private readonly dataSource: DataSource,
    @Inject(REPORT_PROVIDERS) private readonly providers: ReportProvider[],
  ) {}

  async maxRows(): Promise<number> {
    try {
      const rows: Array<{ config_value: string | null }> = await this.dataSource.query(`SELECT config_value FROM system_configs WHERE config_key = 'report.export_max_rows' LIMIT 1`);
      const n = parseInt(rows[0]?.config_value ?? '', 10);
      if (Number.isInteger(n) && n > 0) return n;
    } catch { /* dùng mặc định */ }
    return DEFAULT_EXPORT_MAX_ROWS;
  }

  async processExport(job: Job<ReportCenterExportJobData>): Promise<void> {
    const { backgroundJobId, type, format, filters, scope, requestedByEmail } = job.data;
    try {
      await this.jobs.markRunning(backgroundJobId);
      const provider = isReportType(type) ? this.providers.find((p) => p.type === type) : undefined;
      if (!provider) throw new Error(`Không có bộ dựng cho loại báo cáo "${type}"`);
      const now = new Date();
      const model = await provider.build({ from: filters['from'] as string, to: filters['to'] as string, ...filters }, scope, null, now);
      const cap = await this.maxRows();
      if (model.total > cap) {
        throw new Error(`Báo cáo có ${model.total.toLocaleString('vi-VN')} dòng, vượt giới hạn ${cap.toLocaleString('vi-VN')} dòng. Vui lòng thu hẹp kỳ hoặc bộ lọc.`);
      }
      const stored = await this.files.renderAndStore(model, format, { generatedAt: now, generatedByEmail: requestedByEmail }, { entityType: 'background_job', entityId: backgroundJobId });
      await this.jobs.markCompleted(backgroundJobId, { fileName: stored.fileName, format, outputFileId: stored.mediaFileId });
      await this.dataSource.manager.update(BackgroundJobEntity, backgroundJobId, { outputFileId: stored.mediaFileId });
      this.logger.log(`Job ${job.id} xong — ${stored.fileName}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Lỗi không xác định';
      this.logger.error(`Job ${job.id} lỗi — ${msg}`);
      await this.jobs.markFailed(backgroundJobId, msg).catch(() => undefined);
    }
  }
}
