import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Expose } from 'class-transformer';

/**
 * UpdateVehicleRegistrationDto (VPM-001 / UC2) — body PATCH sửa metadata biển.
 *
 * DATA-01: `note` + `vehicle_type` + `plate_raw` (đổi biển, 2026-11-20). KHÔNG `plate_number`/
 * `user_id`/`status` (ValidationPipe `whitelist:true` loại field thừa nếu client lén gửi).
 * `plate_raw` được chuẩn hoá + kiểm định dạng + kiểm trùng y như lúc đăng ký.
 *
 * undefined vs null (service xử theo `!== undefined`):
 * - field KHÔNG gửi → undefined → giữ nguyên.
 * - field gửi = null → set null (xóa note). (@IsOptional cho phép null.)
 */
export class UpdateVehicleRegistrationDto {
  @ApiPropertyOptional({
    description:
      'Biển số mới dạng thô (đổi biển). Không gửi → giữ biển cũ. Tối đa 20 ký tự',
    maxLength: 20,
  })
  @Expose({ name: 'plate_raw' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  plateRaw?: string;

  @ApiPropertyOptional({
    description: 'Loại phương tiện; gửi null để xóa',
    nullable: true,
    maxLength: 50,
  })
  @Expose({ name: 'vehicle_type' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleType?: string | null;

  @ApiPropertyOptional({
    description: 'Ghi chú; gửi null để xóa',
    nullable: true,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string | null;
}
