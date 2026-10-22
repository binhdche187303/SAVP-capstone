import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * CameraTraceQueryDto — query cho GET /campus/camera-trace.
 * Phải có ít nhất một trong `groupId` / `deviceId` / `zoneId` (service kiểm); nếu đưa nhiều
 * điều kiện thì lấy giao (camera thuộc nhóm VÀ nằm trong khu vực).
 */
export class CameraTraceQueryDto {
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsUUID()
  zoneId?: string;

  /** Mốc bắt đầu (ISO 8601, có giờ). */
  @IsDateString()
  from!: string;

  /** Mốc kết thúc (ISO 8601, có giờ). */
  @IsDateString()
  to!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
