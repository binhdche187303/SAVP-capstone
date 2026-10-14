import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  AuditLogQueryRepository,
  AuditLogFilters,
  AuditLogRow,
} from '../repositories/audit-log-query.repository.js';
import { ExportAuditLogsDto } from '../dto/export-audit-logs.dto.js';
import { normalizeSearchFields } from '../dto/query-audit-logs.dto.js';
import { AuditLogItemDto } from '../dto/audit-log-response.dto.js';
import { AuditLogsService } from './audit-logs.service.js';
import { renderAuditLogExportXlsx } from '../renderers/audit-log-xlsx-renderer.js';

/** Cap cứng an toàn — audit_logs tăng trưởng vô hạn, khác `users`. */
const MAX_EXPORT_ROWS = 50000;

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function buildExportFileName(now: Date): string {
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `nhat-ky-he-thong-${stamp}.xlsx`;
}

/**
 * AuditLogExportService — GET /audit-logs/export → 200, trả thẳng file XLSX.
 *
 * Ngoài phạm vi UC-AA-11 gốc (spec §"Out of scope" ghi rõ export chưa được
 * đặc tả) — thêm theo yêu cầu trực tiếp 2026-08-11. Mirror pattern
 * UserExportService (reports/services/user-export.service.ts, BE-04): render
 * đồng bộ, KHÔNG dùng background_jobs/poll.
 *
 * TÁCH BIỆT khỏi AuditLogQueryService (service ĐỌC cho UC-AA-11) — không sửa
 * file đó. Cũng KHÔNG mở rộng AuditLogsService (service GHI dùng chung) —
 * chỉ gọi logAction() từ ngoài, đúng cách UserExportService đang làm cho
 * 'export_users'. Đây là hành động trích xuất dữ liệu chủ động (khác "xem"
 * danh sách, vốn cố tình không tự ghi log theo §0.10 UC-AA-11).
 *
 * Chỉ xuất đúng 5 trường như AuditLogItemDto (FR-025) — KHÔNG
 * oldValueJson/newValueJson/metadataJson/ipAddress/userAgent/requestId.
 */
@Injectable()
export class AuditLogExportService {
  private readonly logger = new Logger(AuditLogExportService.name);

  constructor(
    private readonly auditLogQueryRepository: AuditLogQueryRepository,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async exportAuditLogsXlsx(
    currentUser: { userId: string; email: string },
    dto: ExportAuditLogsDto,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    try {
      const fromDate = new Date(dto.from);
      const toDate = new Date(dto.to);
      if (fromDate > toDate) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'from must not be after to',
        });
      }

      const filters = this.buildFilters(dto);

      const [rows, total] = await Promise.all([
        this.auditLogQueryRepository.findAllForExport(filters, MAX_EXPORT_ROWS),
        this.auditLogQueryRepository.countMatching(filters),
      ]);

      const data = rows.map((row) => this.mapRow(row));

      const now = new Date();
      const buffer = await renderAuditLogExportXlsx(data, {
        generatedAt: now,
        extractedByEmail: currentUser.email,
        from: dto.from,
        to: dto.to,
        totalMatching: total,
        returnedCount: data.length,
        maxRows: MAX_EXPORT_ROWS,
      });
      const fileName = buildExportFileName(now);

      this.auditLogsService
        .logAction({
          userId: currentUser.userId,
          actionType: 'export_audit_logs',
          entityType: 'audit_logs',
          metadataJson: {
            filter: filters,
            rowCount: data.length,
            totalMatching: total,
          },
        })
        .catch((err) =>
          this.logger.warn(
            `Audit log write failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );

      return { buffer, fileName };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[AuditLogExport] Unexpected error: ${message}`);
      throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
    }
  }

  /** Mirror AuditLogQueryService.buildFilters — không import chéo, tránh phụ thuộc service khác. */
  private buildFilters(dto: ExportAuditLogsDto): AuditLogFilters {
    const filters: AuditLogFilters = { from: dto.from, to: dto.to };
    if (dto.userId) filters.userId = dto.userId;
    if (dto.actionType) filters.actionType = dto.actionType;
    if (dto.entityType) filters.entityType = dto.entityType;
    if (dto.severity) filters.severity = dto.severity;
    return { ...filters, ...normalizeSearchFields(dto) };
  }

  /** Mirror AuditLogQueryService.mapRow — cùng logic resolve actorName khi user_id NULL. */
  private mapRow(row: AuditLogRow): AuditLogItemDto {
    const actorUserId = row.user_id ?? null;
    const actorName =
      actorUserId === null ? 'Hệ thống' : (row.user_full_name ?? 'Hệ thống');

    return {
      id: row.id,
      createdAt: row.created_at,
      actorUserId,
      actorName,
      actionType: row.action_type,
      entityType: row.entity_type,
      entityId: row.entity_id ?? null,
      severity: row.severity,
    };
  }
}
