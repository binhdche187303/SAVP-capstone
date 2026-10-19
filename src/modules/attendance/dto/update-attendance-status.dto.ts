import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Trạng thái cho phép đặt thủ công qua PATCH .../{recordId}/status (spec §5 #2, FR-005).
 * KHÔNG gồm `invalidated` — vô hiệu hóa phải qua endpoint #4.
 */
export const ManualAttendanceStatusList = [
  'present',
  'absent',
  'late',
  'left_early',
  'pending_review',
] as const;

export type ManualAttendanceStatus =
  (typeof ManualAttendanceStatusList)[number];

export class UpdateAttendanceStatusDto {
  @ApiProperty({
    enum: ManualAttendanceStatusList,
    description: 'Attendance status (excludes invalidated)',
  })
  @IsIn(ManualAttendanceStatusList, {
    message:
      'attendanceStatus must be one of: present, absent, late, left_early, pending_review',
  })
  attendanceStatus: ManualAttendanceStatus;

  @ApiPropertyOptional({
    description: 'Reason for the status change, max 1000 chars',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'reason cannot exceed 1000 characters' })
  reason?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Hình thức vi phạm chọn tay (rule_code); null = suy theo trạng thái',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  violationRuleCode?: string | null;
}
