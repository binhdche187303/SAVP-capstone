import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UelSyncSettingsDto {
  @ApiPropertyOptional({ example: true, description: 'Bật đồng bộ tự động' })
  @IsOptional()
  @IsBoolean()
  autoEnabled?: boolean;

  @ApiPropertyOptional({
    enum: ['daily', 'weekly', 'interval'],
    example: 'daily',
    description: 'interval = mỗi intervalDays ngày',
  })
  @IsOptional()
  @IsIn(['daily', 'weekly', 'interval'])
  frequency?: 'daily' | 'weekly' | 'interval';

  @ApiPropertyOptional({
    example: 3,
    description: 'Số ngày giữa 2 lần khi frequency = interval (2..90)',
  })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(90)
  intervalDays?: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'Ngày trong tuần khi weekly: 0 = CN … 6 = T7',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;

  @ApiPropertyOptional({ example: '02:00', description: 'Giờ chạy (giờ VN)' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time phải có dạng HH:mm' })
  time?: string;

  @ApiPropertyOptional({
    enum: ['auto', 'fixed'],
    example: 'auto',
    description: 'auto = tự nhận học kỳ từ TKB; fixed = dùng namHoc + hocKy',
  })
  @IsOptional()
  @IsIn(['auto', 'fixed'])
  termMode?: 'auto' | 'fixed';

  @ApiPropertyOptional({
    example: '2026-2027',
    description: 'nam_hoc hiện tại; chuỗi rỗng = chưa cài',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  namHoc?: string;

  @ApiPropertyOptional({
    example: '1',
    description: 'hoc_ky hiện tại; chuỗi rỗng = chưa cài',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  hocKy?: string;

  /** Bỏ qua — tương thích FE cũ (lịch học giờ luôn lấy đến hết năm học). */
  @ApiHideProperty()
  @IsOptional()
  sessionDaysAhead?: unknown;
}

export class StudyPeriodDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(30)
  periodNo!: number;

  @ApiProperty({ example: '07:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime phải có dạng HH:mm',
  })
  startTime!: string;

  @ApiProperty({ example: '07:50' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'endTime phải có dạng HH:mm',
  })
  endTime!: string;
}

export class StudyPeriodsDto {
  @ApiProperty({ type: [StudyPeriodDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => StudyPeriodDto)
  periods!: StudyPeriodDto[];
}
