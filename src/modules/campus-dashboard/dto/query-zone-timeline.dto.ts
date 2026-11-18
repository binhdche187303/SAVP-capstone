import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

/** QueryZoneTimelineDto (ZPT-001 / UC-119) — query cho `GET /campus-dashboard/zones/:zoneId/timeline`. */
export class QueryZoneTimelineDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  /** 'matched' = người quen, 'stranger' = người lạ (lượt xuất hiện không nhận diện). */
  @IsOptional()
  @IsIn(['matched', 'stranger'])
  status?: 'matched' | 'stranger';
}
