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
  Max,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsFutureDateConstraint } from '../validators/is-future-date.validator.js';
import { IsAfterStartTimeConstraint } from '../validators/is-after-start-time.validator.js';
import { ExternalParticipantDto } from './external-participant.dto.js';

export class MeetingReminderDto {
  @IsIn(['in_app', 'email', 'message', 'sms'], { message: 'channel phải là in_app, email, message hoặc sms' })
  channel: 'in_app' | 'email' | 'message' | 'sms';

  /** Số phút trước giờ họp (1 phút – 7 ngày). */
  @IsInt({ message: 'minutes phải là số nguyên' })
  @Min(1, { message: 'Nhắc trước tối thiểu 1 phút' })
  @Max(10080, { message: 'Nhắc trước tối đa 7 ngày' })
  minutes: number;
}

export class MeetingReportRequirementDto {
  /** Người phải nộp báo cáo (phải là thành viên cuộc họp). */
  @IsArray()
  @ArrayMinSize(1, { message: 'Chọn ít nhất 1 người nộp báo cáo' })
  @IsUUID('4', { each: true })
  userIds: string[];

  /** Hạn nộp: số phút trước giờ họp (0 = đến giờ họp, tối đa 30 ngày). */
  @IsInt()
  @Min(0)
  @Max(43200)
  deadlineMinutes: number;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  note?: string;
}

export class MeetingSignoffDto {
  /** Người ký duyệt biên bản; bỏ trống ⇒ chủ trì. */
  @IsUUID('4')
  @IsOptional()
  signerId?: string;
}

export class MeetingRecurrenceDto {
  @IsIn(['daily', 'weekly', 'monthly'], { message: 'type phải là daily, weekly hoặc monthly' })
  type: 'daily' | 'weekly' | 'monthly';

  /** Hằng tuần: thứ trong tuần (1 = Thứ Hai … 7 = Chủ nhật). */
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  @IsOptional()
  daysOfWeek?: number[];

  /** Kết thúc vào ngày (YYYY-MM-DD) — hoặc dùng count. */
  @IsDateString()
  @IsOptional()
  endDate?: string;

  /** Kết thúc sau N buổi (tính cả buổi đầu). */
  @IsInt()
  @Min(2)
  @Max(60)
  @IsOptional()
  count?: number;
}

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

  /** Nhắc trước giờ họp theo kênh; bỏ trống ⇒ thông báo 10 phút, [] ⇒ không nhắc. */
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => MeetingReminderDto)
  @IsOptional()
  reminders?: MeetingReminderDto[];

  @ValidateNested()
  @Type(() => MeetingReportRequirementDto)
  @IsOptional()
  reportRequirement?: MeetingReportRequirementDto;

  @ValidateNested()
  @Type(() => MeetingSignoffDto)
  @IsOptional()
  signoff?: MeetingSignoffDto;

  @ValidateNested()
  @Type(() => MeetingRecurrenceDto)
  @IsOptional()
  recurrence?: MeetingRecurrenceDto;

  /** Lặp: các ngày (YYYY-MM-DD, giờ VN) bị trùng phòng mà người đặt chọn bỏ qua. */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  skipDates?: string[];

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
