import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  MaxLength,
} from 'class-validator';
import { Expose, Transform } from 'class-transformer';
import {
  CONTROL_LIST_VEHICLE_TYPES,
  type ControlListVehicleType,
  toVehicleTypeValue,
} from './create-vehicle-control-list.dto.js';

/**
 * UpdateVehicleControlListDto (VCL-001 / UC8) — body PATCH /anpr/admin/control-list/:id.
 *
 * KHÔNG `list_type`/`plate_number`/`plate_raw` — bất biến sau khi tạo (spec §1.2, DATA-02).
 * Đổi loại danh sách/biển = xóa-mềm bản ghi cũ + tạo bản ghi mới. `whitelist:true` loại
 * field thừa nếu client lén gửi. Cả 2 field absent → no-op ở service (trả nguyên trạng).
 */
export class UpdateVehicleControlListDto {
  @ApiPropertyOptional({
    description: 'Lý do đưa vào danh sách kiểm soát',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional({ description: 'Trạng thái kích hoạt' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // null/'' ⇒ xóa loại xe (về "Không xác định"); undefined ⇒ giữ nguyên.
  @ApiPropertyOptional({
    description: 'Loại phương tiện (null = không xác định)',
    enum: CONTROL_LIST_VEHICLE_TYPES,
    nullable: true,
  })
  @Expose({ name: 'vehicle_type' })
  @Transform(toVehicleTypeValue)
  @IsOptional()
  @IsIn(CONTROL_LIST_VEHICLE_TYPES, {
    message: 'Loại phương tiện không hợp lệ',
  })
  vehicleType?: ControlListVehicleType | null;
}
