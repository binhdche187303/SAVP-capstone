import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataSource } from 'typeorm';

import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { BackgroundJobEntity } from '../../administration/entities/background-job.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import {
  MediaFileEntity,
  MediaFileType,
  MediaVisibilityLevel,
  StorageProvider,
} from '../../recording/entities/media-file.entity.js';
import { MeetingMinutesEntity } from '../entities/meeting-minutes.entity.js';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import { TranscriptEntity } from '../../transcription/entities/transcript.entity.js';
import { StorageService } from '../../storage/storage.service.js';
import { slugifyFileNamePart } from '../../../common/utils/filename.util.js';
import { renderMeetingMinutesPdf } from '../renderers/meeting-minutes-pdf-renderer.js';
import { renderMeetingMinutesDocx } from '../renderers/meeting-minutes-docx-renderer.js';
import {
  MinutesExportData,
  normalizeMinutesJsonList,
} from '../renderers/meeting-minutes-export-data.js';
import {
  MINUTES_EXPORT_QUEUE_NAME,
  MINUTES_EXPORT_JOB_NAME,
  MINUTES_EXPORT_AUDIT_ACTION,
} from '../constants/minutes-export-job.constants.js';
import type { MinutesExportFormat } from '../dto/create-minutes-export.dto.js';

interface MinutesExportJobData {
  backgroundJobId: string;
  minutesId: string;
  format: MinutesExportFormat;
  includeTranscript: boolean;
  includeActionItems: boolean;
  requestedByUserId: string;
}

/**
 * MinutesExportWorkerProcessor (UC-147, FR-005/FR-006/FR-007/FR-008).
 * Xử lý job 'export:meeting-minutes' từ queue 'minutes-export' (đã đăng ký sẵn
 * trong QueueModule). Mirror pattern MeetingActivityReportWorkerProcessor:
 *  markRunning → load minutes(+transcript) → render → saveFile → tạo MediaFileEntity
 *  → markCompleted + output_file_id → (export mặc định) set meeting_minutes.file_id
 *  → audit log. Catch toàn bộ → markFailed, KHÔNG throw tiếp (ARCH-02).
 */
@Processor(MINUTES_EXPORT_QUEUE_NAME)
export class MinutesExportWorkerProcessor extends WorkerHost {
  private readonly logger = new Logger(MinutesExportWorkerProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly auditLogsService: AuditLogsService,
    @InjectRepository(MediaFileEntity)
    private readonly mediaFileRepo: Repository<MediaFileEntity>,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<MinutesExportJobData>): Promise<void> {
    if (job.name !== MINUTES_EXPORT_JOB_NAME) return;

    const {
      backgroundJobId,
      minutesId,
      format,
      includeTranscript,
      includeActionItems,
      requestedByUserId,
    } = job.data;

    this.logger.log(
      `Processing minutes export — bgJob=${backgroundJobId} minutesId=${minutesId} format=${format}`,
    );

    try {
      await this.backgroundJobsService.markRunning(backgroundJobId);

      // 1. Load minutes
      const minutes = await this.dataSource
        .getRepository(MeetingMinutesEntity)
        .findOne({ where: { id: minutesId } });
      if (!minutes || minutes.deletedAt) {
        throw new Error(`Biên bản ${minutesId} không tồn tại hoặc đã bị xóa`);
      }

      const meeting = await this.dataSource
        .getRepository(MeetingEntity)
        .findOne({ where: { id: minutes.meetingId } });

      // 2. Transcript (optional — FR-011)
      let transcriptText: string | null = null;
      if (includeTranscript && minutes.linkedTranscriptId) {
        const transcript = await this.dataSource
          .getRepository(TranscriptEntity)
          .findOne({ where: { id: minutes.linkedTranscriptId } });
        transcriptText = transcript?.cleanedText || transcript?.rawText || null;
      }

      // 3. Chuẩn hóa dữ liệu render
      const exportData: MinutesExportData = {
        title: minutes.title,
        meetingTitle: meeting?.title ?? null,
        status: minutes.status,
        issuedAt: minutes.issuedAt,
        generatedAt: new Date(),
        minutesContent: minutes.minutesContent,
        decisions: normalizeMinutesJsonList(minutes.decisionsJson),
        actionItems: includeActionItems
          ? normalizeMinutesJsonList(minutes.actionItemsJson)
          : [],
        includeActionItems,
        transcriptText,
      };

      // 4. Render
      let fileBuffer: Buffer;
      let mimeType: string;
      let fileExt: string;
      if (format === 'docx') {
        fileBuffer = await renderMeetingMinutesDocx(exportData);
        mimeType =
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        fileExt = 'docx';
      } else {
        fileBuffer = await renderMeetingMinutesPdf(exportData);
        mimeType = 'application/pdf';
        fileExt = 'pdf';
      }

      // 5. Lưu file
      const saveResult = await this.storageService.saveFile({
        buffer: fileBuffer,
        originalName: `minutes-${minutesId}.${fileExt}`,
        folder: 'exports',
      });

      const storageProv =
        this.storageService.getDriver() === 's3'
          ? StorageProvider.S3
          : this.storageService.getDriver() === 'minio'
            ? StorageProvider.MINIO
            : StorageProvider.LOCAL;

      // 6. Tạo MediaFileEntity — tên file hiển thị/tải xuống theo tên cuộc họp
      // (khác với storageKey nội bộ vẫn random để tránh trùng/đoán được).
      const meetingSlug = slugifyFileNamePart(
        meeting?.title || minutes.title || 'cuoc_hop',
      );
      const friendlyFileName = `Tom_tat_cuoc_hop_${meetingSlug}.${fileExt}`;
      const mediaFile = this.mediaFileRepo.create({
        fileName: friendlyFileName,
        fileType: MediaFileType.EXPORT,
        mimeType,
        storageProvider: storageProv,
        storageKey: saveResult.storageKey,
        fileSizeBytes: saveResult.sizeBytes.toString(),
        relatedEntityType: 'meeting_minutes',
        relatedEntityId: minutesId,
        meetingId: minutes.meetingId,
        uploadedBy: requestedByUserId,
        visibilityLevel: MediaVisibilityLevel.INTERNAL,
        isActive: true,
      });
      const savedMedia = await this.mediaFileRepo.save(mediaFile);

      // 7. markCompleted + output_file_id
      await this.backgroundJobsService.markCompleted(backgroundJobId, {
        fileName: mediaFile.fileName,
        format: fileExt,
        outputFileId: savedMedia.id,
      });
      await this.mediaFileRepo.manager.update(
        BackgroundJobEntity,
        backgroundJobId,
        { outputFileId: savedMedia.id },
      );

      // 8. Export mặc định → cập nhật meeting_minutes.file_id (FR-006)
      const isDefaultExport =
        format === 'pdf' &&
        includeTranscript === true &&
        includeActionItems === true;
      if (isDefaultExport) {
        await this.mediaFileRepo.manager.update(
          MeetingMinutesEntity,
          minutesId,
          { fileId: savedMedia.id },
        );
      }

      // 9. Audit log
      await this.auditLogsService.logAction({
        userId: requestedByUserId,
        actionType: MINUTES_EXPORT_AUDIT_ACTION,
        entityType: 'meeting_minutes',
        entityId: minutesId,
        metadataJson: {
          format,
          mediaFileId: savedMedia.id,
          includeTranscript,
          includeActionItems,
          isDefaultExport,
        },
      });

      this.logger.log(
        `Minutes export completed — bgJob=${backgroundJobId} mediaFileId=${savedMedia.id} file=${mediaFile.fileName}`,
      );
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Minutes export failed — bgJob=${backgroundJobId}: ${errMsg}`,
      );
      // ARCH-02: KHÔNG throw tiếp để không crash worker
      await this.backgroundJobsService.markFailed(backgroundJobId, errMsg);
    }
  }
}
