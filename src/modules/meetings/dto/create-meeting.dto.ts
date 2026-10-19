import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsDateString,
  IsArray,
  IsBoolean,
  IsInt,
  Min,
  MaxLength,
  Validate,
  ValidateNested,
  Matches,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsFutureDateConstraint } from '../validators/is-future-date.validator.js';
import { IsAfterStartTimeConstraint } from '../validators/is-after-start-time.validator.js';
import { ExternalParticipantDto } from './external-participant.dto.js';

export class CreateMeetingDto {
  @IsString({ message: 'Tiêu đề cuộc họp phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Tiêu đề cuộc họp không được để trống' })
  @MaxLength(255, { message: 'Tiêu đề cuộc họp tối đa 255 ký tự' })
  title: string;

  @IsString({ message: 'Mô tả phải là chuỗi ký tự' })
  @MaxLength(2000, { message: 'Mô tả tối đa 2000 ký tự' })
  @IsOptional()
  description?: string;

  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'host_id phải là định dạng UUID',
  })
  @IsOptional()
  hostId?: string;

  /** Thư ký: phải là người tham gia hoặc người đặt lịch. */
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'secretaryId phải là định dạng UUID',
  })
  @IsOptional()
  secretaryId?: string;

  @IsDateString(
    { strict: true },
    { message: 'start_time phải là định dạng ISO 8601' },
  )
  @Validate(IsFutureDateConstraint, {
    message: 'Thời gian bắt đầu không được nằm trong quá khứ',
  })
  startTime: string;

  @IsDateString(
    { strict: true },
    { message: 'end_time phải là định dạng ISO 8601' },
  )
  @Validate(IsAfterStartTimeConstraint, ['startTime'], {
    message: 'Thời gian kết thúc phải sau thời gian bắt đầu',
  })
  endTime: string;

  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'room_id phải là định dạng UUID',
  })
  @IsNotEmpty({ message: 'room_id không được để trống' })
  roomId: string;

  @IsString({ message: 'meeting_type phải là chuỗi ký tự' })
  @IsOptional()
  meetingType?: string;

  @IsString({ message: 'meeting_mode phải là chuỗi ký tự' })
  @IsOptional()
  meetingMode?: string;

  @IsInt({ message: 'expected_attendee_count phải là số nguyên' })
  @Min(1, { message: 'expected_attendee_count phải lớn hơn hoặc bằng 1' })
  @IsOptional()
  expectedAttendeeCount?: number;

  /** Có điểm danh hay không (mặc định có). */
  @IsBoolean({ message: 'attendance_enabled phải là boolean' })
  @IsOptional()
  attendanceEnabled?: boolean;

  /** Nhắc trước giờ họp (phút), 0 = không nhắc; mặc định 10. */
  @IsIn([0, 5, 10, 15, 30, 60], { message: 'reminderMinutes phải là 0, 5, 10, 15, 30 hoặc 60' })
  @IsOptional()
  reminderMinutes?: number;

  /** Nhóm lịch (Lịch tuần UEL), mặc định lịch đơn vị. */
  @IsIn(['UNIT', 'SCHOOL_LEADERSHIP', 'SCHOOL_OTHER'], { message: 'Nhóm lịch không hợp lệ' })
  @IsOptional()
  calendarType?: 'UNIT' | 'SCHOOL_LEADERSHIP' | 'SCHOOL_OTHER';

  /** Thành phần tham gia (chữ tự do: cá nhân, đơn vị, khách ngoài). */
  @IsString()
  @MaxLength(1000, { message: 'Thành phần tham gia tối đa 1000 ký tự' })
  @IsOptional()
  attendeeComposition?: string;

  @IsBoolean({ message: 'capacity_override_confirmed phải là boolean' })
  @IsOptional()
  capacityOverrideConfirmed?: boolean;

  @IsBoolean({ message: 'equipment_warning_confirmed phải là boolean' })
  @IsOptional()
  equipmentWarningConfirmed?: boolean;

  @IsArray({ message: 'participant_user_ids phải là mảng' })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    each: true,
    message: 'Mỗi participant_user_id phải là định dạng UUID',
  })
  @IsOptional()
  participantUserIds?: string[];

  @ValidateNested({ each: true })
  @Type(() => ExternalParticipantDto)
  @IsOptional()
  externalParticipants?: ExternalParticipantDto[];
}
