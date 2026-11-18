import type { FilterSelection } from '../../../common/utils/filter-selection.js';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MeetingStatus } from '../entities/meeting.entity.js';

// BE-02 (2026-07-26): allowlist bat buoc cho sortBy — KHONG duoc noi chuoi truc tiep
// vao SQL/QueryBuilder (CLAUDE.md 14.3, 8.4).
export const MEETING_LIST_SORT_FIELDS = [
  'created_at',
  'start_time',
  'title',
  'status',
] as const;
export type MeetingListSortField = (typeof MEETING_LIST_SORT_FIELDS)[number];

export class MeetingListQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsIn(MEETING_LIST_SORT_FIELDS)
  sortBy: MeetingListSortField = 'created_at';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsIn(Object.values(MeetingStatus))
  status?: MeetingStatus;

  @IsOptional()
  @IsUUID('all', { each: true })
  roomId?: FilterSelection<string>;

  @IsOptional()
  @IsUUID()
  organizerId?: string;

  @IsOptional()
  @IsUUID('all', { each: true })
  departmentId?: FilterSelection<string>;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}
