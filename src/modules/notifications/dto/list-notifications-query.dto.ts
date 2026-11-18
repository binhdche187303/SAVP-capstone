import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsString,
  Matches,
  MaxLength,
  IsArray,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ListNotificationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /** true = đã đọc, false = chưa đọc; bỏ trống = tất cả. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  )
  @IsBoolean({ message: 'isRead phải là true hoặc false' })
  isRead?: boolean;

  /** Loại thông báo, nhiều loại cách nhau dấu phẩy (vd. unknown_vehicle_alert,device_offline_alert). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @IsString({ each: true })
  type?: string[];

  /** Từ ngày (YYYY-MM-DD, giờ VN). */
  @IsOptional()
  @Matches(DAY_RE, { message: 'from phải có dạng YYYY-MM-DD' })
  from?: string;

  /** Đến ngày (YYYY-MM-DD, giờ VN), tính cả ngày. */
  @IsOptional()
  @Matches(DAY_RE, { message: 'to phải có dạng YYYY-MM-DD' })
  to?: string;

  /** Tìm trong tiêu đề / nội dung (biển số, tên camera…). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class MarkNotificationGroupReadDto {
  @IsString()
  @MaxLength(60)
  type!: string;

  @Matches(DAY_RE, { message: 'day phải có dạng YYYY-MM-DD' })
  day!: string;
}
