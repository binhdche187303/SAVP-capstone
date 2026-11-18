import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Expose } from 'class-transformer';

/**
 * Body (không bắt buộc) của POST /security-alerts/:id/acknowledge — ghi chú lúc tiếp nhận
 * (vd "Đang ra cổng kiểm tra"). Không có cột riêng: lưu ở payload_json.acknowledgeNote.
 */
export class AcknowledgeSecurityAlertDto {
  @ApiPropertyOptional({
    description: 'Ghi chú khi tiếp nhận cảnh báo (không bắt buộc)',
    maxLength: 500,
  })
  @Expose({ name: 'acknowledge_note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  acknowledgeNote?: string;
}
