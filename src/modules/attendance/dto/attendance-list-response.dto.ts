import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceItemDto } from './attendance-item.dto.js';

class MeetingSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({
    enum: [
      'draft',
      'pending_approval',
      'scheduled',
      'in_progress',
      'completed',
      'cancelled',
    ],
  })
  status: string;

  @ApiProperty({ format: 'date-time' })
  startTime: string;

  @ApiProperty({ format: 'date-time' })
  endTime: string;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  roomId: string | null;
}

class PermissionsDto {
  @ApiProperty()
  canViewAttendanceSource: boolean;
}

class AttendanceSummaryDto {
  @ApiProperty({ default: 'internal_participants_only' })
  scope: string = 'internal_participants_only';

  @ApiProperty()
  totalParticipants: number;

  @ApiProperty()
  checkedInCount: number;

  @ApiProperty()
  presentCount: number;

  @ApiProperty()
  lateCount: number;

  @ApiProperty()
  absentCount: number;

  @ApiProperty()
  notCheckedInCount: number;

  @ApiProperty()
  attendanceRate: number;
}

class MetaDto {
  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  total: number;

  @ApiProperty()
  totalPages: number;
}

class AttendanceListDataDto {
  @ApiProperty()
  meeting: MeetingSummaryDto;

  @ApiProperty()
  permissions: PermissionsDto;

  @ApiProperty()
  summary: AttendanceSummaryDto;

  @ApiProperty({ type: [AttendanceItemDto] })
  items: AttendanceItemDto[];
}

export class AttendanceListResponseDto {
  @ApiProperty()
  success: boolean = true;

  @ApiProperty()
  message: string = 'Danh sách điểm danh được truy xuất thành công';

  @ApiProperty()
  data: AttendanceListDataDto;

  @ApiProperty({ type: MetaDto })
  meta: MetaDto;
}
