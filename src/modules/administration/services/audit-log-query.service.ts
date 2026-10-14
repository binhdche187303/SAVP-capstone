import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  AuditLogQueryRepository,
  AuditLogFilters,
} from '../repositories/audit-log-query.repository.js';
import {
  QueryAuditLogsDto,
  normalizeSearchFields,
} from '../dto/query-audit-logs.dto.js';
import {
  AuditActionTypeDto,
  AuditLogItemDto,
  AuditLogListResponseDto,
} from '../dto/audit-log-response.dto.js';

/**
 * AuditLogQueryService — orchestrator ĐỌC cho feature view audit logs.
 *
 * TÁCH BIỆT hoàn toàn khỏi AuditLogsService (service GHI dùng chung).
 * KHÔNG gọi logAction()/logSecurityEvent()/logEntityChange() ở bất kỳ đâu
 * trong service này (§0.10 spec.md — quyết định đã chốt, dễ bị thêm nhầm).
 *
 * Thứ tự xử lý:
 *   1. Apply defaults page/limit (T012)
 *   2. Validate from > to (T013)
 *   3. buildFilters (T014)
 *   4. findPaginated (T015) + countMatching (T016)
 *   5. resolve actorName (T017)
 *   6. map DTO (T018)
 *   7. buildResponse (T019)
 */
@Injectable()
export class AuditLogQueryService {
  private readonly logger = new Logger(AuditLogQueryService.name);

  constructor(
    private readonly auditLogQueryRepository: AuditLogQueryRepository,
  ) {}

  /**
   * T020: Luồng chính — list audit logs phân trang có filter.
   */
  async listAuditLogs(
    query: QueryAuditLogsDto,
  ): Promise<AuditLogListResponseDto> {
    try {
      // T012: Apply defaults
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;

      // T013: Validate from > to
      if (query.from && query.to) {
        const fromDate = new Date(query.from);
        const toDate = new Date(query.to);
        if (fromDate > toDate) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'from must not be after to',
          });
        }
      }

      // T014: Build filter object
      const filters = this.buildFilters(query);

      // T015 + T016: Query + Count (parallel)
      const [rows, total] = await Promise.all([
        this.auditLogQueryRepository.findPaginated(filters, page, limit),
        this.auditLogQueryRepository.countMatching(filters),
      ]);

      // T017 + T018: Resolve actorName + map DTO
      const data = rows.map((row) => this.mapRow(row));

      // T019: Build response
      return this.buildResponse(data, total, page, limit);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[AuditLogQuery] Unexpected error: ${message}`);
      throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
    }
  }

  /**
   * T014: Gộp các field filter thành object điều kiện AND.
   * Bỏ qua field không truyền (undefined/null).
   */
  buildFilters(query: QueryAuditLogsDto): AuditLogFilters {
    const filters: AuditLogFilters = {};
    if (query.from) filters.from = query.from;
    if (query.to) filters.to = query.to;
    if (query.userId) filters.userId = query.userId;
    if (query.actionType) filters.actionType = query.actionType;
    if (query.entityType) filters.entityType = query.entityType;
    if (query.severity) filters.severity = query.severity;
    return { ...filters, ...normalizeSearchFields(query) };
  }

  /**
   * T017 + T018: Resolve actorName và map row thành AuditLogItemDto.
   *
   * - userId === null → actorUserId=null, actorName="Hệ thống"
   * - userId có giá trị → actorUserId=userId, actorName=user.full_name
   *
   * KHÔNG map: oldValueJson, newValueJson, metadataJson,
   * ipAddress, userAgent, requestId (FR-025).
   */
  private mapRow(row: {
    id: string;
    created_at: Date;
    user_id: string | null;
    action_type: string;
    entity_type: string;
    entity_id: string | null;
    severity: string;
    user_full_name: string | null;
    user_avatar_url?: string | null;
  }): AuditLogItemDto {
    const actorUserId = row.user_id ?? null;
    const actorName =
      actorUserId === null ? 'Hệ thống' : (row.user_full_name ?? 'Hệ thống');
    // Hệ thống (user_id null) không có avatar; user có thể chưa upload → null.
    const actorAvatarUrl =
      actorUserId === null ? null : (row.user_avatar_url ?? null);

    return {
      id: row.id,
      createdAt: row.created_at,
      actorUserId,
      actorName,
      actorAvatarUrl,
      actionType: row.action_type,
      entityType: row.entity_type,
      entityId: row.entity_id ?? null,
      severity: row.severity,
    };
  }

  /**
   * listActionTypes — trả danh sách action_type có thật trong dữ liệu (kèm count),
   * phục vụ FE dựng dropdown lọc "Loại hành động" từ giá trị thật thay vì hard-code.
   */
  async listActionTypes(): Promise<AuditActionTypeDto[]> {
    try {
      const rows = await this.auditLogQueryRepository.findDistinctActionTypes();
      return rows.map((r) => ({
        actionType: r.action_type,
        count: r.count,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[AuditLogQuery] listActionTypes error: ${message}`);
      throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
    }
  }

  /**
   * T019: Xây dựng response wrapper với meta phân trang.
   *
   * KHÔNG thêm `message` đặc biệt khi data=[] (khác pattern EX1 analytics.*).
   */
  private buildResponse(
    data: AuditLogItemDto[],
    total: number,
    page: number,
    limit: number,
  ): AuditLogListResponseDto {
    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
      },
    };
  }
}
