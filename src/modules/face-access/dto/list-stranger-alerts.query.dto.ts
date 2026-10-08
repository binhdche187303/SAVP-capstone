import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, IsUUID, Matches, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ListStrangerAlertsQueryDto (SAL-001) — query GET /api/v1/face-access/stranger-alerts.
 * page/limit (limit max 100); windowMinutes tùy chọn override STRANGER_ALERT_WINDOW_MINUTES.
 */
export class ListStrangerAlertsQueryDto {
  @ApiPropertyOptional({ description: 'Số trang', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Số bản ghi mỗi trang (tối đa 100)',
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description:
      'Override cửa sổ thời gian tính stranger gần đây (phút), mặc định STRANGER_ALERT_WINDOW_MINUTES',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  windowMinutes?: number;

  @ApiPropertyOptional({
    description:
      'Từ ngày (YYYY-MM-DD, giờ VN). Có from/to ⇒ lọc theo khoảng ngày thay cho windowMinutes',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'from phải theo định dạng YYYY-MM-DD',
  })
  from?: string;

  @ApiPropertyOptional({
    description: 'Đến ngày (YYYY-MM-DD, giờ VN, tính cả ngày này)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'to phải theo định dạng YYYY-MM-DD',
  })
  to?: string;

  @ApiPropertyOptional({
    description: 'Chỉ lấy người lạ của 1 thiết bị (camera)',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}
