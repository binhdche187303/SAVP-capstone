import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { Expose } from 'class-transformer';

/**
 * CreateVehicleRegistrationDto (VPR-001 / UC1) — body route USER tự đăng ký biển.
 *
 * KHÔNG có `user_id`: route user lấy user_id từ JWT (@CurrentUser). ValidationPipe
 * `whitelist:true` loại mọi field thừa (kể cả user_id nếu client lén truyền) — SEC-01.
 */
export class CreateVehicleRegistrationDto {
  // name = tên trường THẬT trên API (Expose map plate_raw → plateRaw); Swagger trước đây ghi plateRaw.
  @ApiProperty({
    name: 'plate_raw',
    description: 'Biển số xe dạng thô (chưa chuẩn hoá), tối đa 20 ký tự',
    maxLength: 20,
  })
  @Expose({ name: 'plate_raw' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  plateRaw: string;

  @ApiPropertyOptional({ name: 'vehicle_type', description: 'Loại phương tiện', maxLength: 50 })
  @Expose({ name: 'vehicle_type' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleType?: string;

  @ApiPropertyOptional({ description: 'Ghi chú thêm', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
