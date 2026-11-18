import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsObject,
  IsDateString,
  IsUUID,
  MaxLength,
  Length,
  Matches,
} from 'class-validator';
import { EquipmentType, HealthStatus } from '../entities/equipment.entity.js';

/**
 * UC-61 — Input đăng ký thiết bị họp mới (POST /api/v1/equipments).
 *
 * Chỉ nhận field trong danh sách chốt. Các field còn lại của entity
 * (iotDeviceId, assetStatus, assignedBy/assignedAt, lastIssue*, lastMaintenance*)
 * KHÔNG được nhận từ client — `forbidNonWhitelisted` sẽ reject nếu gửi.
 *
 * roomId/assignmentNote (tùy chọn): cho phép gán phòng ngay lúc đăng ký thay vì
 * phải tạo xong rồi gán riêng ở bước sau (PATCH .../assignment). Nếu gán, service
 * validate roomId TRƯỚC khi tạo (không tạo thiết bị "mồ côi" nếu gán thất bại).
 */
export class CreateEquipmentDto {
  @IsString({ message: 'Tên thiết bị phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Tên thiết bị không được để trống' })
  @MaxLength(150, { message: 'Tên thiết bị tối đa 150 ký tự' })
  equipmentName: string;

  @IsEnum(EquipmentType, {
    message:
      'Loại thiết bị không hợp lệ. Giá trị: camera, microphone, display, speaker, capture_agent, sensor, other',
  })
  equipmentType: EquipmentType;

  @IsString({ message: 'Mã thiết bị phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Mã thiết bị không được để trống' })
  @Length(3, 80, { message: 'Mã thiết bị phải từ 3 đến 80 ký tự' })
  @Matches(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, {
    message:
      'Mã thiết bị chỉ chấp nhận ký tự A-Z, 0-9 và dấu gạch ngang (-), viết hoa',
  })
  @MaxLength(80, { message: 'Mã thiết bị tối đa 80 ký tự' })
  equipmentCode: string;

  @IsOptional()
  @IsString({ message: 'Số serial phải là chuỗi ký tự' })
  @MaxLength(120, { message: 'Số serial tối đa 120 ký tự' })
  serialNumber?: string;

  @IsOptional()
  @IsString({ message: 'Hãng sản xuất phải là chuỗi ký tự' })
  @MaxLength(100, { message: 'Hãng sản xuất tối đa 100 ký tự' })
  brand?: string;

  @IsOptional()
  @IsString({ message: 'Model phải là chuỗi ký tự' })
  @MaxLength(100, { message: 'Model tối đa 100 ký tự' })
  model?: string;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'Ngày mua phải là ngày hợp lệ (YYYY-MM-DD)' },
  )
  purchaseDate?: string;

  @IsOptional()
  @IsObject({ message: 'Thông số kỹ thuật phải là object' })
  specification?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(HealthStatus, {
    message:
      'Tình trạng không hợp lệ. Giá trị: healthy, warning, faulty, offline, unknown',
  })
  healthStatus?: HealthStatus;

  @IsOptional()
  @IsUUID('4', { message: 'roomId phải là định dạng UUID' })
  roomId?: string;

  @IsOptional()
  @IsString({ message: 'Ghi chú phân bổ phải là chuỗi ký tự' })
  @MaxLength(2000, { message: 'Ghi chú phân bổ tối đa 2000 ký tự' })
  assignmentNote?: string;
}
