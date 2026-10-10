import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MediaFileEntity, MediaFileType, MediaVisibilityLevel, StorageProvider } from '../../recording/entities/media-file.entity.js';
import { StorageService } from '../../storage/storage.service.js';
import type { ReportModel } from './report-model.js';
import { renderReportDocx } from './renderers/report-docx.renderer.js';
import { renderReportPdf } from './renderers/report-pdf.renderer.js';
import { reportFileName, type ReportRenderMeta } from './renderers/report-render.common.js';
import { renderReportXlsx } from './renderers/report-xlsx.renderer.js';

export type ReportFormat = 'pdf' | 'xlsx' | 'docx';
export const REPORT_FORMATS: ReportFormat[] = ['pdf', 'xlsx', 'docx'];

const MIME: Record<ReportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export interface StoredReportFile { mediaFileId: string; fileName: string; format: ReportFormat; mimeType: string; sizeBytes: number; storageKey: string }

/** Dựng một ReportModel thành file (3 định dạng dùng chung) và lưu thành `media_files`. Dùng cho xuất tay và lịch gửi. */
@Injectable()
export class ReportFileService {
  constructor(
    @InjectRepository(MediaFileEntity) private readonly mediaFiles: Repository<MediaFileEntity>,
    private readonly storage: StorageService,
  ) {}

  render(model: ReportModel, format: ReportFormat, meta: ReportRenderMeta): Promise<Buffer> {
    if (format === 'xlsx') return renderReportXlsx(model, meta);
    if (format === 'docx') return renderReportDocx(model, meta);
    return renderReportPdf(model, meta);
  }

  async renderAndStore(
    model: ReportModel,
    format: ReportFormat,
    meta: ReportRenderMeta,
    related: { entityType: string; entityId: string },
  ): Promise<StoredReportFile> {
    const buffer = await this.render(model, format, meta);
    const fileName = reportFileName(model.type, model.period.from, model.period.to, format);
    const saved = await this.storage.saveFile({ buffer, originalName: fileName, folder: 'exports' });
    const media = await this.mediaFiles.save(this.mediaFiles.create({
      fileName,
      fileType: MediaFileType.EXPORT,
      mimeType: MIME[format],
      storageProvider: this.storage.getDriver() === 's3' ? StorageProvider.S3 : StorageProvider.LOCAL,
      storageKey: saved.storageKey,
      fileSizeBytes: saved.sizeBytes.toString(),
      relatedEntityType: related.entityType,
      relatedEntityId: related.entityId,
      visibilityLevel: MediaVisibilityLevel.INTERNAL,
      isActive: true,
    }));
    return { mediaFileId: media.id, fileName, format, mimeType: MIME[format], sizeBytes: saved.sizeBytes, storageKey: saved.storageKey };
  }

  /** Tên lưu trên kho (có thể khác `fileName` hiển thị). */
  baseName(storageKey: string): string {
    return path.basename(storageKey);
  }
}
