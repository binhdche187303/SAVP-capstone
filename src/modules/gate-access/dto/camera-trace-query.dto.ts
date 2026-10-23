import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

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

  /** Lọc loại sự kiện trên TOÀN BỘ kết quả (không chỉ trang hiện tại). */
  @IsOptional()
  @IsIn(['gate', 'meeting', 'zone'])
  kind?: 'gate' | 'meeting' | 'zone';

  /** Tìm theo tên / mã nhân sự / biển số trên toàn bộ kết quả. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Cột sắp xếp (mặc định time). */
  @IsOptional()
  @IsIn(['time', 'person', 'event', 'camera', 'zone'])
  sortBy?: 'time' | 'person' | 'event' | 'camera' | 'zone';

  /** Chiều sắp xếp (mặc định desc = mới nhất trước). */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

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
