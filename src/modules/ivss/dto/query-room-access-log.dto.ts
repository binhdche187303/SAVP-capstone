import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsInt,
  IsArray,
  ArrayMaxSize,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Max,
  Min,
} from 'class-validator';

/**
 * QueryRoomAccessLogDto (RAL-001 / Màn 2) — query cho
 * GET /ivss/access-log và GET /ivss/rooms/:roomId/access-log.
 *
 * `date` dạng YYYY-MM-DD; thiếu → service tự lấy hôm nay. Dùng @Matches thay
 * @IsDateString vì chỉ chấp nhận ngày thuần (không nhận ISO có giờ/offset) —
 * biên ngày được tính trong SQL bằng `$2::date` .. `+ interval '1 day'`.
 *
 * `page`/`limit` (ALS-002): trước đây endpoint trả TOÀN BỘ event trong ngày, không
 * phân trang — phòng đông người/ngày cao điểm trả hàng nghìn dòng. `limit` chặn trên
 * 100 để 1 request không kéo cả ngày.
 *
 * `search` (ALS-002): lọc theo `users.full_name` (ILIKE). Event chưa khớp danh tính
 * (full_name NULL) bị loại khi có `search` — đúng ý nghĩa "tìm theo tên người".
 *
 * `meetingId`: lọc theo ca họp cụ thể — AND với `date` (không thay thế biên ngày).
 * Không truyền → giữ hành vi cũ (mọi event trong ngày, không lọc theo cuộc họp).
 */
export class QueryRoomAccessLogDto {
  @ApiPropertyOptional({
    description:
      'Ngày cần xem nhật ký, định dạng YYYY-MM-DD — thiếu thì mặc định hôm nay',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date phải theo định dạng YYYY-MM-DD',
  })
  date?: string;

  @IsOptional()
  @Transform(({ value }) => value === undefined ? undefined : Array.isArray(value) ? value : [value])
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  roomIds?: string[];

  @ApiPropertyOptional({ description: 'Lọc theo ca họp cụ thể (AND với date)' })
  @IsOptional()
  @IsUUID('4', { message: 'meetingId phải là UUID hợp lệ' })
  meetingId?: string;

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
}
