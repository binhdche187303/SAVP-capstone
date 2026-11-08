import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_SESSION_DAYS_AHEAD } from './uel-sync-settings.service.js';

export class UelSyncSettingsDto {
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

  @ApiPropertyOptional({
    example: 14,
    description: 'Số ngày lịch học kéo trước',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SESSION_DAYS_AHEAD)
  sessionDaysAhead?: number;
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
