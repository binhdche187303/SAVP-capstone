import {
  IsUUID,
  IsOptional,
  IsISO8601,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * UC-65 — Input gán thiết bị vào phòng họp (PATCH /equipments/:id/assignment).
 *
 * roomId bắt buộc. installedAt tùy chọn (mặc định now nếu không truyền, xử lý ở service).
 * KHÔNG nhận field khác — forbidNonWhitelisted reject.
 */
export class AssignEquipmentDto {
  @IsUUID('4', { message: 'roomId phải là định dạng UUID' })
  roomId: string;

  @IsOptional()
  @IsISO8601({}, { message: 'Ngày lắp đặt phải là ngày ISO 8601' })
  installedAt?: string;

  @IsOptional()
  @IsString({ message: 'Ghi chú phân bổ phải là chuỗi ký tự' })
  @MaxLength(2000, { message: 'Ghi chú phân bổ tối đa 2000 ký tự' })
  assignmentNote?: string;
}
