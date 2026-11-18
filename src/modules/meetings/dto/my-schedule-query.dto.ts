import {
  IsEnum,
  IsDateString,
  IsOptional,
  IsUUID,
  MaxLength,
  Validate,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { IsIanaTimezoneConstraint } from '../validators/is-iana-timezone.validator.js';

export enum ScheduleView {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class MyScheduleQueryDto {
  @IsEnum(ScheduleView, { message: 'Chế độ xem phải là day, week hoặc month' })
  view: ScheduleView;

  @IsDateString(
    {},
    {
      message:
        'Thời điểm bắt đầu phải là chuỗi ngày ISO có múi giờ (vd: 2026-06-08T00:00:00+07:00)',
    },
  )
  from: string;

  @IsDateString(
    {},
    {
      message:
        'Thời điểm kết thúc phải là chuỗi ngày ISO có múi giờ (vd: 2026-06-08T00:00:00+07:00)',
    },
  )
  to: string;

  @IsOptional()
  @Validate(IsIanaTimezoneConstraint)
  timezone?: string = 'Asia/Ho_Chi_Minh';

  @IsOptional()
  // ?status=a (1 giá trị) là chuỗi thuần → IN (:...status) crash; chuẩn hoá về mảng.
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
  status?: string[];

  @IsOptional()
  @IsEnum(['organizer', 'host', 'attendee'], {
    message: 'Vai trò phải là organizer, host hoặc attendee',
  })
  role?: 'organizer' | 'host' | 'attendee';

  @IsOptional()
  @IsUUID('4', { message: 'roomId phải là UUID hợp lệ' })
  roomId?: string;

  @IsOptional()
  @MaxLength(200, { message: 'Từ khóa tìm kiếm không được vượt quá 200 ký tự' })
  q?: string;
}
