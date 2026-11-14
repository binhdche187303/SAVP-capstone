import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { UEL_SYNC_STEPS } from './uel-sync.service.js';
import type { UelSyncStep } from './uel-sync.service.js';

export class UelSyncRunDto {
  @ApiPropertyOptional({
    enum: UEL_SYNC_STEPS,
    isArray: true,
    description:
      'Các bước cần chạy (mặc định: tất cả, theo đúng thứ tự phụ thuộc).',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(UEL_SYNC_STEPS, { each: true })
  steps?: UelSyncStep[];

  @ApiPropertyOptional({
    example: '2025-2026',
    description: 'nam_hoc (sections/enrollments)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  namHoc?: string;

  @ApiPropertyOptional({
    example: 'HK01',
    description: 'hoc_ky (sections/enrollments) — "HK01" hoặc "1" đều được',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  hocKy?: string;

  @ApiPropertyOptional({
    example: '2026-11-09',
    description: 'Từ ngày (sessions)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate?: string;

  @ApiPropertyOptional({
    example: '2026-11-15',
    description: 'Đến ngày (sessions)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['GV0001', '22.001'],
    description:
      'sessions theo người: mã giảng viên cần lấy lịch (chi_tiet_tkb_gv_1ngay). Có mã ⇒ không hủy buổi nào.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  lecturerCodes?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['K240000001'],
    description:
      'sessions theo người: mã sinh viên cần lấy lịch (chi_tiet_tkb_sv_1ngay).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  studentCodes?: string[];
}
