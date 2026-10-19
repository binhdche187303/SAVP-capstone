import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttendanceItemDto {
  /**
   * ID bản ghi `attendance_records` — FE cần field này để gọi các route động
   * `PATCH /meetings/:meetingId/attendance/:recordId/status`, `.../:recordId`,
   * `POST .../:recordId/invalidate`. null = người này CHƯA có bản ghi điểm danh
   * (phải tạo trước qua POST /meetings/:meetingId/attendance).
   */
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'ID bản ghi điểm danh; null nếu chưa điểm danh',
  })
  id: string | null;

  @ApiProperty({ format: 'uuid' })
  participantId: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty()
  fullName: string;

  @ApiPropertyOptional({ nullable: true })
  departmentName: string | null;

  @ApiPropertyOptional({ nullable: true })
  positionTitle: string | null;

  @ApiProperty({ enum: ['host', 'attendee', 'approver', 'note_taker'] })
  participantRole: string;

  @ApiProperty({
    enum: [
      'present',
      'late',
      'absent',
      'left_early',
      'not_checked_in',
      'pending_review',
    ],
  })
  attendanceStatus: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  checkInTime: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Only returned if user has permission',
  })
  attendanceSource: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Only returned if user has permission',
  })
  checkInMethod: string | null;

  @ApiProperty()
  isLate: boolean;

  @ApiProperty()
  lateMinutes: number;

  @ApiProperty({ nullable: true, description: 'Điểm trừ đã chốt (null = chưa chốt)' })
  penaltyPoints: number | null;

  @ApiProperty({ nullable: true, description: 'Hình thức vi phạm thư ký chọn thủ công' })
  violationRuleCode: string | null;

  @ApiProperty({ nullable: true })
  violationRuleName: string | null;

  @ApiProperty({ nullable: true, description: 'Lý do vắng/trễ/về sớm thành viên tự nhập' })
  excuseReason: string | null;

  @ApiProperty({ nullable: true, enum: ['pending', 'approved', 'rejected'] })
  excuseStatus: string | null;

  @ApiProperty({ nullable: true })
  excuseSubmittedAt: string | null;

  @ApiProperty({ nullable: true, description: 'Ghi chú khi chủ trì/thư ký từ chối' })
  excuseReviewNote: string | null;

  constructor(partial: Partial<AttendanceItemDto>) {
    Object.assign(this, partial);
  }
}
