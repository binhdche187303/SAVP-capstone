import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export const STRANGER_DISMISS_REASONS = [
  'legit_visitor',
  'ai_false_positive',
  'handled_offline',
  'other',
] as const;
export type StrangerDismissReason = (typeof STRANGER_DISMISS_REASONS)[number];

/**
 * DismissStrangerDto — body POST /api/v1/face-access/stranger-alerts/dismiss.
 * Đóng cảnh báo người lạ phía máy chủ: bắt buộc có lý do, lưu người đóng + audit, mở lại được.
 */
export class DismissStrangerDto {
  @ApiProperty({ description: 'Các sự kiện face_stranger cần đóng (≤100)', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  eventIds: string[];

  @ApiProperty({ enum: STRANGER_DISMISS_REASONS })
  @IsIn(STRANGER_DISMISS_REASONS as unknown as string[])
  reason: StrangerDismissReason;

  @ApiPropertyOptional({ maxLength: 500, description: 'Bắt buộc (≥5 ký tự) khi reason = other — service kiểm tra' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Mở lại các sự kiện đã đóng. */
export class ReopenStrangerDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  eventIds: string[];
}
