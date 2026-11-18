import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsISO8601, IsIn, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ListUnknownVehiclesQueryDto (VUN-001 / UC6) — query GET /anpr/admin/unknown-vehicles.
 *
 * Mirror pagination UC3 (page/limit, limit max 100). `@Type(()=>Number)` ép query string→number
 * (cần ValidationPipe transform). Filter time-range `from`/`to` (theo event_time, ISO-8601) — OQ-2.
 */
export class ListUnknownVehiclesQueryDto {
  @ApiPropertyOptional({ description: 'Số trang', default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Số bản ghi mỗi trang (tối đa 100)',
    default: 20,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Lọc từ thời điểm (theo event_time, ISO 8601)',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'Lọc đến thời điểm (theo event_time, ISO 8601)',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'Tìm theo biển số (bỏ qua dấu gạch, chấm, khoảng trắng)' })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Từ khóa biển số tối đa 20 ký tự' })
  q?: string;

  @ApiPropertyOptional({ description: 'Hướng di chuyển: in (vào) | out (ra)' })
  @IsOptional()
  @IsIn(['in', 'out'], { message: 'Hướng phải là in hoặc out' })
  direction?: 'in' | 'out';

  @ApiPropertyOptional({
    description: 'Danh sách kiểm soát: controlled (có trong danh sách) | normal (không có)',
  })
  @IsOptional()
  @IsIn(['controlled', 'normal'], { message: 'Bộ lọc danh sách kiểm soát không hợp lệ' })
  flag?: 'controlled' | 'normal';

  @ApiPropertyOptional({
    description: 'Gom theo biển: distinct (mỗi biển 1 dòng) | repeat (chỉ biển xuất hiện từ 2 lần)',
  })
  @IsOptional()
  @IsIn(['distinct', 'repeat'], { message: 'Chế độ xem không hợp lệ' })
  view?: 'distinct' | 'repeat';
}
