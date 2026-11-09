import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { UEL_LOOKUP_TYPES } from './uel-lookup.service.js';
import type { UelLookupType } from './uel-lookup.service.js';

export class UelLookupDto {
  @ApiProperty({
    enum: UEL_LOOKUP_TYPES,
    description:
      'staff = thông tin cán bộ; student = thông tin SV; studentEnrollments = học phần SV đã đăng ký; ' +
      'lecturerDay / studentDay = lịch dạy / lịch học 1 ngày; session = chi tiết 1 buổi học.',
  })
  @IsIn(UEL_LOOKUP_TYPES)
  type!: UelLookupType;

  @ApiProperty({
    example: 'NS003',
    description:
      'Mã cán bộ / mã SV / mã giảng viên / mã buổi học (ma_lich_hoc)',
  })
  @IsString()
  @MaxLength(50)
  code!: string;

  @ApiPropertyOptional({
    example: '2026-11-09',
    description: 'Ngày học — bắt buộc với lecturerDay, studentDay',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}
