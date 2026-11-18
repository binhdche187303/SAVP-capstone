import type { FilterSelection } from '../../../common/utils/filter-selection.js';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';

import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { BackgroundJobEntity } from '../../administration/entities/background-job.entity.js';
import {
  MediaFileEntity,
  MediaFileType,
  MediaVisibilityLevel,
  StorageProvider,
} from '../../recording/entities/media-file.entity.js';
import { SecurityAlertReportDataService } from '../services/security-alert-report-data.service.js';
import { renderSecurityAlertPdf } from '../renderers/security-alert-pdf-renderer.js';
import { renderSecurityAlertXlsx } from '../renderers/security-alert-xlsx-renderer.js';
import { StorageService } from '../../storage/storage.service.js';

interface SecurityAlertExportJobData {
  backgroundJobId: string;
  from: string;
  to: string;
  format: 'pdf' | 'xlsx';
  filters: {
    alertType: FilterSelection<string> | null;
    zoneId: FilterSelection<string> | null;
    status: FilterSelection<string> | null;
    severity?: FilterSelection<string> | null;
  };
  requestedByEmail: string;
}

/**
 * SecurityAlertReportWorkerProcessor — UC-129.
 *
 * QUAN TRỌNG: plain @Injectable(), KHÔNG @Processor/WorkerHost — mirror
 * GateAccessReportWorkerProcessor/VehicleReportWorkerProcessor. Chỉ
 * MeetingActivityReportWorkerProcessor giữ @Processor duy nhất, dispatch sang
 * class này khi job.name === 'export:security-alert'.
 */
@Injectable()
export class SecurityAlertReportWorkerProcessor {
  private readonly logger = new Logger(SecurityAlertReportWorkerProcessor.name);

  constructor(
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly dataService: SecurityAlertReportDataService,
    @InjectRepository(MediaFileEntity)
    private readonly mediaFileRepo: Repository<MediaFileEntity>,
    private readonly storageService: StorageService,
  ) {}

  async processExport(job: Job<SecurityAlertExportJobData>): Promise<void> {
    const { backgroundJobId } = job.data;
    this.logger.log(
      `Processing job ${job.id} — bgJob=${backgroundJobId} format=${job.data.format}`,
    );

    try {
      await this.backgroundJobsService.markRunning(backgroundJobId);

      const alerts = await this.dataService.listAllForExport({
        from: job.data.from,
        to: job.data.to,
        filters: job.data.filters,
      });
      const rows = alerts.map((a) => this.dataService.mapToExportRow(a));
      const statusCounts = this.dataService.getStatusCounts(alerts);

      const meta = {
        from: job.data.from,
        to: job.data.to,
        generatedAt: new Date(),
        extractedByEmail: job.data.requestedByEmail,
      };

      let fileBuffer: Buffer;
      let mimeType: string;
      let fileExt: string;

      if (job.data.format === 'xlsx') {
        fileBuffer = await renderSecurityAlertXlsx(rows, statusCounts, meta);
        mimeType =
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        fileExt = 'xlsx';
      } else {
        fileBuffer = await renderSecurityAlertPdf(rows, statusCounts, meta);
        mimeType = 'application/pdf';
        fileExt = 'pdf';
      }

      const saveResult = await this.storageService.saveFile({
        buffer: fileBuffer,
        originalName: `security-alert-report.${fileExt}`,
        folder: 'exports',
      });

      const storageProv =
        this.storageService.getDriver() === 's3'
          ? StorageProvider.S3
          : StorageProvider.LOCAL;

      const fileName = path.basename(saveResult.storageKey);

      const mediaFile = this.mediaFileRepo.create({
        fileName,
        fileType: MediaFileType.EXPORT,
        mimeType,
        storageProvider: storageProv,
        storageKey: saveResult.storageKey,
        fileSizeBytes: saveResult.sizeBytes.toString(),
        relatedEntityType: 'background_job',
        relatedEntityId: backgroundJobId,
        visibilityLevel: MediaVisibilityLevel.INTERNAL,
        isActive: true,
      });
      const savedMedia = await this.mediaFileRepo.save(mediaFile);

      await this.backgroundJobsService.markCompleted(backgroundJobId, {
        fileName,
        format: fileExt,
        outputFileId: savedMedia.id,
      });

      await this.mediaFileRepo.manager.update(
        BackgroundJobEntity,
        backgroundJobId,
        { outputFileId: savedMedia.id },
      );

      this.logger.log(
        `Job ${job.id} completed — file: ${fileName} mediaFileId: ${savedMedia.id}`,
      );
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Job ${job.id} failed — ${errMsg}`);
      await this.backgroundJobsService.markFailed(backgroundJobId, errMsg);
    }
  }
}
