import {
  IsOptional,
  IsIn,
  IsString,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { HealthStatus } from '../entities/equipment.entity.js';

/**
 * Hanh dong nguoi dung chon o dropdown "Hanh dong" (FE EquipmentManagement.jsx).
 * Khong trung voi AssetStatus cua entity ('active' khong ton tai trong DB) —
 * service.reportFault se map 'active' -> AVAILABLE/ASSIGNED tuy currentRoomId.
 */
export type ReportedAssetAction = 'active' | 'maintenance' | 'retired';

/**
 * UC-62 — Input báo lỗi / chuyển bảo trì thiết bị (PATCH /equipments/:id/fault).
 *
 * healthStatus chỉ nhận warning/faulty/offline (chặn recovery ve healthy ngay o DTO).
 * assetStatus nhan active/maintenance/retired — service se resolve 'active' sang
 * trang thai that (available/assigned) va 'retired' sang AssetStatus.RETIRED.
 * Ràng buộc "ít nhất một status" được kiểm ở service (Phase A) → 422 FAULT_NO_CHANGE.
 */
export class ReportEquipmentFaultDto {
  @IsOptional()
  @IsIn(['warning', 'faulty', 'offline'], {
    message:
      'Tình trạng chỉ nhận warning, faulty hoặc offline (không cho phép khôi phục)',
  })
  healthStatus?: HealthStatus;

  @IsOptional()
  @IsIn(['active', 'maintenance', 'retired'], {
    message: 'Trạng thái tài sản chỉ nhận active, maintenance hoặc retired',
  })
  assetStatus?: ReportedAssetAction;

  @IsString({ message: 'Mô tả sự cố phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Mô tả sự cố không được để trống' })
  @MaxLength(2000, { message: 'Mô tả sự cố tối đa 2000 ký tự' })
  issueNote: string;
}
