import type { FilterSelection } from '../../../common/utils/filter-selection.js';
import {
  IsOptional,
  IsEnum,
  IsDateString,
  IsUUID,
  IsString,
  MaxLength,
  IsInt,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class QueryOnTimeRateDto {
  @IsOptional()
  @IsEnum(['day', 'week', 'month', 'quarter', 'custom'], {
    message: 'preset must be one of: day, week, month, quarter, custom',
  })
  @ApiPropertyOptional({
    description: 'Time range preset',
    enum: ['day', 'week', 'month', 'quarter', 'custom'],
    default: 'month',
  })
  preset?: string;

  @IsOptional()
  @IsDateString({}, { message: 'from must be a valid ISO date string' })
  @ApiPropertyOptional({
    description: 'Start date (ISO 8601) - only used if preset=custom',
    example: '2026-06-01',
  })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to must be a valid ISO date string' })
  @ApiPropertyOptional({
    description: 'End date (ISO 8601) - only used if preset=custom',
    example: '2026-06-30',
  })
  to?: string;

  @IsOptional()
  @IsUUID('4', { each: true, message: 'departmentId must be a valid UUID v4' })
  @ApiPropertyOptional({ description: 'Filter by department UUID' })
  departmentId?: FilterSelection<string>;

  @IsOptional()
  @IsUUID('4', { message: 'meetingId must be a valid UUID v4' })
  @ApiPropertyOptional({ description: 'Filter by meeting UUID' })
  meetingId?: string;

  @IsOptional()
  @IsString({ message: 'search must be a string' })
  @MaxLength(150, { message: 'search must not exceed 150 characters' })
  @ApiPropertyOptional({
    description: 'Search by full name, email or employee code',
  })
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'graceMinutes must be an integer' })
  @Min(0, { message: 'graceMinutes must be at least 0' })
  @ApiPropertyOptional({ description: 'Grace period in minutes', default: 0 })
  graceMinutes?: number;
}
