import type { FilterSelection } from '../../../common/utils/filter-selection.js';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

const SORT_BY_VALUES = ['reservedStartTime', 'sessionStatus'] as const;

export class QueryRoomUsageHistoryDto {
  @IsOptional()
  @IsEnum(['day', 'week', 'month', 'custom'], {
    message: 'preset must be one of: day, week, month, custom',
  })
  @ApiPropertyOptional({
    enum: ['day', 'week', 'month', 'custom'],
    default: 'month',
  })
  preset?: string;

  @IsOptional()
  @IsDateString({}, { message: 'from must be a valid ISO date string' })
  @ApiPropertyOptional({ example: '2026-06-01' })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to must be a valid ISO date string' })
  @ApiPropertyOptional({ example: '2026-06-30' })
  to?: string;

  @IsOptional()
  @IsUUID('4', { message: 'roomId must be a valid UUID v4' })
  roomId?: string;

  @IsOptional()
  @IsString({ each: true })
  @MaxLength(150, { each: true })
  siteName?: FilterSelection<string>;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  areaName?: string;

  @IsOptional()
  @IsEnum(SORT_BY_VALUES, {
    message: 'sortBy must be one of: reservedStartTime, sessionStatus',
  })
  @ApiPropertyOptional({ enum: SORT_BY_VALUES, default: 'reservedStartTime' })
  sortBy?: (typeof SORT_BY_VALUES)[number];

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiPropertyOptional({ default: 1 })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({ default: 20 })
  limit?: number;
}
