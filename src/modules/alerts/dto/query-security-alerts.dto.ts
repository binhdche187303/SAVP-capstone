import type { FilterSelection } from '../../../common/utils/filter-selection.js';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  IsUUID,
  IsDateString,
} from 'class-validator';
import { Type, Expose } from 'class-transformer';
import { ALERT_TYPES } from './create-alert-rule.dto.js';

// Cảnh báo có thể LỌC = loại có quy tắc + `device_maintenance` (camera cần bảo trì — sinh theo
// system_configs, không có quy tắc nên không nằm trong ALERT_TYPES).
const FILTERABLE_ALERT_TYPES = [...ALERT_TYPES, 'device_maintenance'] as const;
type FilterableAlertType = (typeof FILTERABLE_ALERT_TYPES)[number];

const SECURITY_ALERT_STATUSES = ['new', 'acknowledged', 'resolved'] as const;
const SORT_FIELDS = [
  'lastSeenAt',
  'triggeredAt',
  'severity',
  'status',
] as const;

/**
 * QuerySecurityAlertsDto (ASC-001 / UC-123) — query GET /api/v1/security-alerts.
 *
 * KHÔNG lọc `status` mặc định (BR1: cảnh báo không tự ẩn) — client tự chọn nếu muốn.
 * Sort mặc định `triggeredAt DESC` (đúng SRS "sort giảm dần theo thời gian").
 */
export class QuerySecurityAlertsDto {
  @ApiPropertyOptional({ description: 'Số trang', default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Số bản ghi mỗi trang (tối đa 100)',
    default: 20,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Lọc theo loại sự kiện cảnh báo',
    enum: FILTERABLE_ALERT_TYPES,
  })
  @Expose({ name: 'alert_type' })
  @IsOptional()
  @IsIn(FILTERABLE_ALERT_TYPES, { each: true })
  alertType?: FilterSelection<FilterableAlertType>;

  @ApiPropertyOptional({
    description: 'Lọc mức độ cảnh báo',
    enum: ['low', 'medium', 'high', 'critical', 'urgent'],
  })
  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'critical', 'urgent'], { each: true })
  severity?: FilterSelection<string>;

  @ApiPropertyOptional({ description: 'Lọc theo khu vực' })
  @Expose({ name: 'zone_id' })
  @IsOptional()
  @IsUUID('all', { each: true })
  zoneId?: FilterSelection<string>;

  @ApiPropertyOptional({
    description:
      'Lọc theo trạng thái xử lý (bỏ trống = trả tất cả, cảnh báo không tự ẩn; open = new + acknowledged)',
    enum: [...SECURITY_ALERT_STATUSES, 'open'],
  })
  @IsOptional()
  @IsIn([...SECURITY_ALERT_STATUSES, 'open'], { each: true })
  status?: FilterSelection<(typeof SECURITY_ALERT_STATUSES)[number] | 'open'>;

  @ApiPropertyOptional({ description: 'Lọc từ thời điểm (ISO date)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Lọc đến thời điểm (ISO date)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Trường sắp xếp',
    enum: SORT_FIELDS,
    default: 'lastSeenAt',
  })
  @Expose({ name: 'sort_by' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy: (typeof SORT_FIELDS)[number] = 'lastSeenAt';

  @ApiPropertyOptional({
    description: 'Chiều sắp xếp',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @Expose({ name: 'sort_order' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
