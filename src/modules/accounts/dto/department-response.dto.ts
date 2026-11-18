import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DepartmentResponseDto {
  @ApiProperty({ description: 'ID phòng ban', format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Mã phòng ban (uppercase, đã normalize)' })
  departmentCode: string;

  @ApiProperty({ description: 'Tên phòng ban (đã trim)' })
  departmentName: string;

  @ApiProperty({
    description: 'ID phòng ban cha',
    format: 'uuid',
    nullable: true,
  })
  parentDepartmentId: string | null;

  @ApiProperty({
    description: 'ID người quản lý',
    format: 'uuid',
    nullable: true,
  })
  managerUserId: string | null;

  @ApiProperty({ description: 'Mô tả phòng ban', nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Trạng thái hoạt động' })
  isActive: boolean;

  @ApiProperty({
    description:
      'Số lượng nhân viên đang hoạt động trực thuộc TRỰC TIẾP phòng ban (employment_status active/probation, account_status active) — không đệ quy phòng ban con',
  })
  memberCount: number;

  @ApiPropertyOptional({
    description:
      'Số cán bộ (memberCount trừ SV) — chỉ có ở danh sách phòng ban',
  })
  staffCount?: number;

  @ApiPropertyOptional({
    description:
      'Số SV gắn vào phòng ban (khoa) — chỉ có ở danh sách phòng ban',
  })
  studentCount?: number;

  @ApiProperty({ description: 'Thời điểm tạo', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ description: 'Thời điểm cập nhật', format: 'date-time' })
  updatedAt: Date;
}
