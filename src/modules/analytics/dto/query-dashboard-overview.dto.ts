import type { FilterSelection } from '../../../common/utils/filter-selection.js';
﻿import { IsOptional, IsDateString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryDashboardOverviewDto {
  @IsOptional()
  @IsDateString({}, { message: 'from must be a valid ISO date string' })
  @ApiPropertyOptional({
    description: 'Start date (ISO 8601)',
    example: '2026-06-01',
  })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to must be a valid ISO date string' })
  @ApiPropertyOptional({
    description: 'End date (ISO 8601)',
    example: '2026-06-30',
  })
  to?: string;

  @IsOptional()
  @IsUUID('4', { each: true, message: 'departmentId must be a valid UUID v4' })
  @ApiPropertyOptional({ description: 'Filter by department UUID' })
  departmentId?: FilterSelection<string>;

  @IsOptional()
  @IsUUID('4', { message: 'roomId must be a valid UUID v4' })
  @ApiPropertyOptional({ description: 'Filter by room UUID' })
  roomId?: string;
}
