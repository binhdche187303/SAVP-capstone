import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  IsIn,
  MaxLength,
  Max,
  Min,
} from 'class-validator';

/**
 * QueryZoneAccessLogDto (Zone Access Log — đường B, FIX 2026-08-11) — query cho
 * GET /ivss/zones/:zoneId/access-log. Mirror `QueryRoomAccessLogDto` — KHÔNG có
 * `meetingId` (zone khu vực không gắn cuộc họp, khác room).
 *
 * `date` dạng YYYY-MM-DD; thiếu → service tự lấy hôm nay. `page`/`limit` mirror y hệt
 * RAL-001 (limit tối đa 100). `search` lọc theo `users.full_name` (ILIKE) — event chưa
 * khớp danh tính (full_name NULL) bị loại khi có `search`.
 */
export class QueryZoneAccessLogDto {
  @ApiPropertyOptional({
    description:
      'Ngày cần xem nhật ký, định dạng YYYY-MM-DD — thiếu thì mặc định hôm nay',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date phải theo định dạng YYYY-MM-DD',
  })
  date?: string;

  @ApiPropertyOptional({
    description:
      'Từ ngày (YYYY-MM-DD, giờ VN) — dùng cùng `to` để xem khoảng ngày',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'from phải theo định dạng YYYY-MM-DD',
  })
  from?: string;

  @ApiPropertyOptional({
    description: 'Đến ngày (YYYY-MM-DD, giờ VN, gồm cả ngày này)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'to phải theo định dạng YYYY-MM-DD',
  })
  to?: string;

  @ApiPropertyOptional({ description: 'Số trang', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(1, { message: 'page phải >= 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Số bản ghi mỗi trang (tối đa 100)',
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: 'limit phải >= 1' })
  @Max(100, { message: 'limit tối đa 100' })
  limit?: number = 20;

  @ApiPropertyOptional({
    description:
      'Tìm theo tên người (users.full_name, ILIKE) — event chưa khớp danh tính bị loại khi có search',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'search tối đa 200 ký tự' })
  search?: string;

  @ApiPropertyOptional({
    enum: ['matched', 'stranger'],
    description:
      'Lọc: matched = người quen (khớp danh tính), stranger = người lạ',
  })
  @IsOptional()
  @IsIn(['matched', 'stranger'], {
    message: 'status phải là matched hoặc stranger',
  })
  status?: 'matched' | 'stranger';
}
