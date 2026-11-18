import type { FilterSelection } from '../../../common/utils/filter-selection.js';
import {
  IsOptional,
  IsEnum,
  IsDateString,
  IsUUID,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryRoomUsageDashboardDto {
  @IsOptional()
  @IsEnum(['day', 'week', 'month', 'custom'], {
    message: 'preset must be one of: day, week, month, custom',
  })
  @ApiPropertyOptional({
    description: 'Time range preset',
    enum: ['day', 'week', 'month', 'custom'],
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
  @IsUUID('4', { message: 'roomId must be a valid UUID v4' })
  @ApiPropertyOptional({ description: 'Filter by room UUID' })
  roomId?: string;

  @IsOptional()
  @IsString({ each: true, message: 'siteName must be a string' })
  @MaxLength(150, { each: true, message: 'siteName must not exceed 150 characters' })
  @ApiPropertyOptional({ description: 'Filter by site name' })
  siteName?: FilterSelection<string>;
}
