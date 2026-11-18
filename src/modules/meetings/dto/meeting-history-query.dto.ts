import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class MeetingHistoryQueryDto {
  @IsOptional()
  // Express/qs chi tra ve array khi query co >=2 gia tri cung key (vd
  // status=a&status=b). Voi 1 gia tri (vd ?status=completed, cach FE luon
  // gui), req.query.status la string thuan -> IN (:...status) crash o
  // PostgresDriver.escapeQueryWithParameters (value.map is not a function).
  // Chuan hoa ve array truoc khi validate/dua xuong service.
  @Transform(({ value }) =>
    value === undefined ? undefined : Array.isArray(value) ? value : [value],
  )
  @IsEnum(
    [
      'draft',
      'pending_approval',
      'scheduled',
      'in_progress',
      'cancelled',
      'completed',
    ],
    {
      each: true,
      message: 'Trạng thái không hợp lệ',
    },
  )
  status?: string[] = ['completed'];

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
  @IsDateString(
    {},
    { message: 'Thời điểm bắt đầu phải là chuỗi ngày ISO (vd: 2026-06-08T00:00:00+07:00)' },
  )
  from?: string;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'Thời điểm kết thúc phải là chuỗi ngày ISO (vd: 2026-06-08T00:00:00+07:00)' },
  )
  to?: string;

  @IsOptional()
  @MaxLength(200, { message: 'Từ khóa tìm kiếm không được vượt quá 200 ký tự' })
  q?: string;

  // Lịch tuần UEL: lọc theo nhóm lịch. Chuẩn hoá về array giống `status`.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : Array.isArray(value) ? value : [value],
  )
  @IsEnum(['UNIT', 'SCHOOL_LEADERSHIP', 'SCHOOL_OTHER'], {
    each: true,
    message: 'Loại lịch không hợp lệ',
  })
  calendarType?: string[];
}
