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
import {
  PERSON_CONTROL_LIST_TYPES,
  type PersonControlListType,
} from './create-person-control-list.dto.js';

/**
 * QueryPersonControlListDto (PWL-001 / UC-125) — query GET /api/v1/person-control-list.
 * Mirror pagination UC8 (page/limit, limit max 100).
 */
export class QueryPersonControlListDto {
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
    description: 'Lọc theo phân loại danh sách',
    enum: PERSON_CONTROL_LIST_TYPES,
  })
  @Expose({ name: 'list_type' })
  @IsOptional()
  @IsIn(PERSON_CONTROL_LIST_TYPES, { each: true })
  listType?: FilterSelection<PersonControlListType>;

  @ApiPropertyOptional({
    description: 'Lọc theo trạng thái kích hoạt theo dõi',
  })
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map(item => item === 'true' ? true : item === 'false' ? false : item) : value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsOptional()
  @IsBoolean({ each: true })
  active?: FilterSelection<boolean>;

  @ApiPropertyOptional({
    description: 'Lọc theo user id ứng với người trong danh sách',
  })
  @Expose({ name: 'user_id' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Lọc theo face profile id' })
  @Expose({ name: 'face_profile_id' })
  @IsOptional()
  @IsUUID()
  faceProfileId?: string;
}
