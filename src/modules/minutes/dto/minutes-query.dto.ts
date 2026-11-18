import type { FilterSelection } from '../../../common/utils/filter-selection.js';
import {
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  Min,
  Max,
  Validate,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FromToConstraint } from '../../meetings/validators/from-to.constraint.js';

export class MinutesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(20)
  limit?: number = 20;

  @IsOptional()
  @IsString({ each: true })
  @IsIn(['draft', 'published', 'archived', 'all'], { each: true })
  status?: FilterSelection<string>;

  @IsOptional()
  @IsUUID('4')
  roomId?: string;

  @IsOptional()
  @IsUUID('4')
  meetingId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  @Validate(FromToConstraint, ['from'])
  to?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  @IsIn(['actual_start_time', 'created_at'])
  sortBy?: string = 'actual_start_time';

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder?: string = 'desc';
}
