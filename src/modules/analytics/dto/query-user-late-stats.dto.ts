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
  Max,
  IsIn,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UserLateStatsQueryDto {
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

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(50, { message: 'limit must not exceed 50' })
  @ApiPropertyOptional({ description: 'Items per page (max 50)', default: 10 })
  limit?: number = 10;

  @IsOptional()
  @IsIn(['lateRate', 'lateCount', 'fullName'], {
    message: 'sortBy must be one of: lateRate, lateCount, fullName',
  })
  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['lateRate', 'lateCount', 'fullName'],
    default: 'lateRate',
  })
  sortBy?: 'lateRate' | 'lateCount' | 'fullName' = 'lateRate';
}
