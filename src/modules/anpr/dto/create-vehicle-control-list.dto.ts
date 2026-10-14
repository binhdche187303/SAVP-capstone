import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  Matches,
  MaxLength,
} from 'class-validator';
import { Expose, Transform } from 'class-transformer';
import {
  IsPlateStructure,
  PLATE_ALLOWED_CHARS,
  PLATE_CHARS_MESSAGE,
} from '../utils/plate-format.js';

/** UC8 (VCL-001): 2 loại danh sách kiểm soát phương tiện — bất biến sau khi tạo (spec §1.2). */
export const CONTROL_LIST_TYPES = ['blocklist', 'watchlist'] as const;
export type ControlListType = (typeof CONTROL_LIST_TYPES)[number];

/**
 * Loại phương tiện (tùy chọn) của mục danh sách kiểm soát — chỉ để mô tả/lọc,
 * KHÔNG dùng để kiểm tra định dạng biển hay quyết định khớp biển.
 */
export const CONTROL_LIST_VEHICLE_TYPES = [
  'car',
  'motorbike',
  'truck',
  'bus',
  'other',
] as const;
export type ControlListVehicleType =
  (typeof CONTROL_LIST_VEHICLE_TYPES)[number];

/** Chuẩn hóa loại xe về chữ thường; chuỗi rỗng ⇒ null (= "Không xác định"). */
export const toVehicleTypeValue = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const v = value.trim().toLowerCase();
  return v === '' ? null : v;
};

/**
 * CreateVehicleControlListDto (VCL-001 / UC8) — body POST /anpr/admin/control-list.
 *
 * KHÔNG có `active`/`created_by`: `active` mặc định `true` ở service, `created_by` lấy
 * từ JWT (@CurrentUser), KHÔNG từ body — mirror SEC-01/02 của UC1.
 */
export class CreateVehicleControlListDto {
  @ApiProperty({
    description: 'Biển số xe dạng thô (chưa chuẩn hoá)',
    maxLength: 20,
  })
  @Expose({ name: 'plate_raw' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Biển số xe không được để trống' })
  @MaxLength(20, { message: 'Biển số xe không được vượt quá 20 ký tự' })
  @Matches(PLATE_ALLOWED_CHARS, { message: PLATE_CHARS_MESSAGE })
  @IsPlateStructure()
  plateRaw: string;

  @ApiProperty({
    description: 'Phân loại danh sách kiểm soát — bất biến sau khi tạo',
    enum: CONTROL_LIST_TYPES,
  })
  @Expose({ name: 'list_type' })
  @IsIn(CONTROL_LIST_TYPES)
  listType: ControlListType;

  @ApiPropertyOptional({
    description: 'Lý do đưa vào danh sách kiểm soát',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional({
    description: 'Loại phương tiện (bỏ trống = không xác định)',
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
