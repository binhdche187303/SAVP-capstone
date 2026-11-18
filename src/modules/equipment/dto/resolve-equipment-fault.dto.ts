import {
  IsOptional,
  IsIn,
  IsString,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { HealthStatus } from '../entities/equipment.entity.js';
import { ReportedAssetAction } from './report-equipment-fault.dto.js';

export type ResolvedAssetAction = ReportedAssetAction;

/**
 * EQUIP-FAULT-LIFECYCLE-001 — Input cập nhật thiết bị sau khi sửa xong (PATCH /equipments/:id/fault-resolution).
 * healthStatus bắt buộc: chỉ nhận healthy hoac warning.
 * assetStatus tùy chọn: active, maintenance, retired (service resolve qua resolveAssetAction).
 * resolutionNote bắt buộc: mô tả chi tiết đã xử lý/bảo trì những gì.
 */
export class ResolveEquipmentFaultDto {
  @IsIn(['healthy', 'warning'], {
    message: 'Tình trạng bắt buộc phải là healthy hoặc warning',
  })
  healthStatus: HealthStatus;

  @IsOptional()
  @IsIn(['active', 'maintenance', 'retired'], {
    message: 'Trạng thái tài sản chỉ nhận active, maintenance hoặc retired',
  })
  assetStatus?: ResolvedAssetAction;

  @IsString({ message: 'Ghi chú khắc phục phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Ghi chú khắc phục không được để trống' })
  @MaxLength(2000, { message: 'Ghi chú khắc phục tối đa 2000 ký tự' })
  resolutionNote: string;
}
