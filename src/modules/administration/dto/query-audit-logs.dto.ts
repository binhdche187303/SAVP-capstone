import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsDateString,
  IsUUID,
  IsString,
  MaxLength,
  IsEnum,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum AuditLogSeverityFilter {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/** Nhận cả `a,b,c` lẫn `?x=a&x=b` → mảng chuỗi đã trim, bỏ phần tử rỗng. */
export const toStringList = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'string') {
    return value === ''
      ? undefined
      : value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
  }
  if (Array.isArray(value)) {
    // Phần tử không phải chuỗi giữ nguyên để @IsString({ each }) báo lỗi
    return value.map((v: unknown) => (typeof v === 'string' ? v.trim() : v));
  }
  return value;
};

/**
 * Chuẩn hóa bộ field tìm kiếm thành filter cho repository.
 *
 * GET /audit-logs không chạy ValidationPipe (không có pipe global) nên query đến
 * dạng thô: `searchActionTypes=a,b` vẫn là chuỗi — phải tự tách ở đây, nếu không
 * Postgres báo malformed array ở `= ANY($n)`.
 */
export const normalizeSearchFields = (
  fields: AuditLogSearchFields,
): {
  search?: string;
  searchActionTypes?: string[];
  searchEntityTypes?: string[];
} => {
  const search =
    typeof fields.search === 'string' ? fields.search.trim().slice(0, 100) : '';
  if (!search) return {};
  const asCodes = (value: unknown): string[] => {
    const list = toStringList({ value });
    return Array.isArray(list)
      ? list
          .filter((v): v is string => typeof v === 'string' && v !== '')
          .slice(0, 100)
      : [];
  };
  const result: ReturnType<typeof normalizeSearchFields> = { search };
  const actionTypes = asCodes(fields.searchActionTypes);
  const entityTypes = asCodes(fields.searchEntityTypes);
  if (actionTypes.length) result.searchActionTypes = actionTypes;
  if (entityTypes.length) result.searchEntityTypes = entityTypes;
  return result;
};

/**
 * Bộ field tìm kiếm từ khóa dùng chung cho list + export audit logs.
 *
 * - `search`: so khớp tên/email người thực hiện (không phân biệt dấu), mã hành động,
 *   phân hệ, địa chỉ IP.
 * - `searchActionTypes` / `searchEntityTypes`: các mã mà FE đã xác định có NHÃN TIẾNG VIỆT
 *   khớp từ khóa (nhãn hiển thị chỉ nằm ở FE) — OR thêm vào điều kiện của `search`,
 *   KHÔNG phải bộ lọc AND độc lập. Bị bỏ qua nếu không có `search`.
 */
export class AuditLogSearchFields {
  @ApiPropertyOptional({
    description:
      'Từ khóa: tên/email người thực hiện, mã hành động, phân hệ hoặc IP',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description:
      'Mã action_type có nhãn tiếng Việt khớp từ khóa (phân tách bằng dấu phẩy)',
    type: String,
  })
  @IsOptional()
  @Transform(toStringList)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  searchActionTypes?: string[];

  @ApiPropertyOptional({
    description:
      'Mã entity_type có nhãn tiếng Việt khớp từ khóa (phân tách bằng dấu phẩy)',
    type: String,
  })
  @IsOptional()
  @Transform(toStringList)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  searchEntityTypes?: string[];
}

/**
 * QueryAuditLogsDto — bộ lọc tùy chọn cho GET /api/v1/audit-logs.
 *
 * Tất cả field đều optional. Khi không truyền, không áp filter tương ứng.
 * Validate `from > to` được xử lý ở service (T013).
 */
export class QueryAuditLogsDto extends AuditLogSearchFields {
  @ApiPropertyOptional({
    description: 'Trang hiện tại (bắt đầu từ 1)',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Số bản ghi mỗi trang (tối đa 100)',
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Lọc từ thời điểm (ISO 8601)',
    example: '2026-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Lọc đến thời điểm (ISO 8601)',
    example: '2026-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

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
