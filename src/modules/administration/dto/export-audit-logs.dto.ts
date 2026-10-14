import {
  IsDateString,
  IsOptional,
  IsUUID,
  IsString,
  MaxLength,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AuditLogSearchFields,
  AuditLogSeverityFilter,
} from './query-audit-logs.dto.js';

/**
 * ExportAuditLogsDto — bộ lọc cho GET /api/v1/audit-logs/export.
 *
 * Khác QueryAuditLogsDto (list phân trang): `from`/`to` BẮT BUỘC — audit_logs
 * tăng trưởng vô hạn theo thời gian (khác `users` bị chặn tự nhiên theo số
 * nhân viên), export không giới hạn khoảng thời gian sẽ tạo rủi ro quét toàn
 * bảng. Không có page/limit — export lấy toàn bộ bản ghi khớp filter trong
 * khoảng, giới hạn an toàn tuyệt đối ở MAX_EXPORT_ROWS (audit-log-export.service.ts).
 */
export class ExportAuditLogsDto extends AuditLogSearchFields {
  @ApiProperty({
    description: 'Lọc từ thời điểm (ISO 8601) — bắt buộc',
    example: '2026-01-01T00:00:00Z',
  })
  @IsDateString({}, { message: 'from phải là chuỗi ngày ISO 8601 hợp lệ' })
  from!: string;

  @ApiProperty({
    description: 'Lọc đến thời điểm (ISO 8601) — bắt buộc',
    example: '2026-12-31T23:59:59Z',
  })
  @IsDateString({}, { message: 'to phải là chuỗi ngày ISO 8601 hợp lệ' })
  to!: string;

  @ApiPropertyOptional({
    description: 'Lọc theo userId (UUID)',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo loại hành động (actionType)',
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  actionType?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo loại entity (entityType)',
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  entityType?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo mức độ nghiêm trọng',
    enum: AuditLogSeverityFilter,
  })
  @IsOptional()
  @IsEnum(AuditLogSeverityFilter)
  severity?: AuditLogSeverityFilter;
}
