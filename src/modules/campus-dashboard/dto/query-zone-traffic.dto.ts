import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** QueryZoneTrafficDto (ZTH-001 / UC-120) — query cho `GET /campus-dashboard/zones/traffic`. */
export class QueryZoneTrafficDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  building?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  floor?: string;

  /** Chỉ tính sự kiện của các camera thuộc nhóm này (bắt buộc đọc raw, không dùng bảng rollup theo giờ). */
  @IsOptional()
  @IsUUID()
  groupId?: string;

  /** `minute`: gom theo phút để xem diễn biến ngắn hạn (khoảng tối đa 24 giờ). Mặc định gom theo giờ. */
  @IsOptional()
  @IsIn(['hour', 'minute'])
  bucket?: 'hour' | 'minute';
}
