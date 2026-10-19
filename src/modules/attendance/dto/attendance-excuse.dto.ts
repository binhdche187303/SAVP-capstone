import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Thành viên tự nhập lý do vắng mặt / đi trễ / về sớm. */
export class SubmitAttendanceExcuseDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MaxLength(1000, { message: 'Lý do tối đa 1000 ký tự' })
  reason: string;
}

/** Chủ trì / thư ký duyệt hoặc từ chối lý do (từ chối bắt buộc ghi chú). */
export class ReviewAttendanceExcuseDto {
  @ApiProperty()
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Ghi chú tối đa 1000 ký tự' })
  note?: string;
}
