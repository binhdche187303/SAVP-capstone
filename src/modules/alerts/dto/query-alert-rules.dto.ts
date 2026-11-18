import type { FilterSelection } from '../../../common/utils/filter-selection.js';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  IsUUID,
  IsBoolean,
} from 'class-validator';
import { Type, Transform, Expose } from 'class-transformer';
import { ALERT_TYPES, type AlertType } from './create-alert-rule.dto.js';

const SORT_FIELDS = ['createdAt', 'alertType'] as const;

/**
 * QueryAlertRulesDto (ARL-001 / UC-122) — query GET /api/v1/alert-rules.
 *
 * Mirror pagination UC8 (page/limit, limit max 100). `active`-style boolean query param
 * dùng `@Transform` tay (KHÔNG `@Type(()=>Boolean)`, coi mọi string non-empty là true).
 */
export class QueryAlertRulesDto {
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
    description: 'Lọc theo loại sự kiện kích hoạt cảnh báo',
    enum: ALERT_TYPES,
  })
  @Expose({ name: 'alert_type' })
  @IsOptional()
  @IsIn(ALERT_TYPES, { each: true })
  alertType?: FilterSelection<AlertType>;

  @ApiPropertyOptional({ description: 'Lọc theo khu vực áp dụng quy tắc' })
  @Expose({ name: 'zone_id' })
  @IsOptional()
  @IsUUID('all', { each: true })
  zoneId?: FilterSelection<string>;

  @ApiPropertyOptional({ description: 'Lọc theo trạng thái bật/tắt' })
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map(item => item === 'true' ? true : item === 'false' ? false : item) : value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsOptional()
  @IsBoolean({ each: true })
  enabled?: FilterSelection<boolean>;

  @ApiPropertyOptional({
    description: 'Trường sắp xếp',
    enum: SORT_FIELDS,
    default: 'createdAt',
  })
  @Expose({ name: 'sort_by' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy: (typeof SORT_FIELDS)[number] = 'createdAt';

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
