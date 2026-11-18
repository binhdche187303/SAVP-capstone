import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * EQUIP-FAULT-LIFECYCLE-001 — Input xác nhận lỗi thiết bị (PATCH /equipments/:id/fault-confirmation).
 * confirmationNote là tùy chọn để sysadmin bổ sung ghi chú khi xác nhận lỗi.
 */
export class ConfirmEquipmentFaultDto {
  @IsOptional()
  @IsString({ message: 'Ghi chú xác nhận phải là chuỗi ký tự' })
  @MaxLength(2000, { message: 'Ghi chú xác nhận tối đa 2000 ký tự' })
  confirmationNote?: string;
}
