import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * ReviewStrangerDto — body POST /api/v1/face-access/stranger-alerts/review.
 * Hậu kiểm AI nhận sai (họp 20/10): người có thẩm quyền xác nhận "các lần xuất hiện này là ai".
 */
export class ReviewStrangerDto {
  @ApiProperty({ description: 'Các sự kiện face_stranger được xác nhận cùng một người (≤100)', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  eventIds: string[];

  @ApiProperty({ description: 'Người được xác nhận' })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({ description: 'Cuộc họp đã được gán điểm danh (nếu có) — chỉ để lưu vết' })
  @IsOptional()
  @IsUUID()
  meetingId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
