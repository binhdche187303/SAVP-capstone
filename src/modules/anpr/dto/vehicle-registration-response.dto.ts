import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VehicleRegistrationEntity } from '../entities/vehicle-registration.entity.js';

/**
 * VehicleRegistrationResponseDto (VPR-001 / UC1) — shape công khai (mirror toIotDeviceResponse).
 * Chỉ field cần cho client; KHÔNG lộ field nội bộ ngoài schema.
 */
export class VehicleRegistrationResponseDto {
  @ApiProperty({ description: 'ID bản ghi đăng ký xe' })
  id: string;

  @ApiProperty({ description: 'ID user sở hữu biển số này' })
  user_id: string;

  @ApiProperty({ description: 'Biển số dạng thô (chưa chuẩn hoá)' })
  plate_raw: string;

  @ApiProperty({ description: 'Biển số đã chuẩn hoá' })
  plate_number: string;

  @ApiPropertyOptional({ nullable: true, description: 'Loại phương tiện' })
  vehicle_type: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Ghi chú' })
  note: string | null;

  @ApiProperty({ description: 'Trạng thái biển số (active/disabled)' })
  status: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Đồng bộ HGVision: null (chưa) | pending (cờ ghi tắt) | synced | failed',
  })
  hgvision_sync_status: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Lần đẩy HGVision thành công gần nhất',
  })
  hgvision_synced_at: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Lỗi đồng bộ HGVision gần nhất',
  })
  hgvision_sync_error: string | null;

  @ApiProperty({ description: 'Thời điểm tạo' })
  created_at: Date;

  @ApiProperty({ description: 'Thời điểm cập nhật gần nhất' })
  updated_at: Date;
}

export function toVehicleRegistrationResponse(
  entity: VehicleRegistrationEntity,
): VehicleRegistrationResponseDto {
  return {
    id: entity.id,
    user_id: entity.userId,
    plate_raw: entity.plateRaw,
    plate_number: entity.plateNumber,
    vehicle_type: entity.vehicleType,
    note: entity.note,
    status: entity.status,
    hgvision_sync_status: entity.hgvisionSyncStatus ?? null,
    hgvision_synced_at: entity.hgvisionSyncedAt ?? null,
    hgvision_sync_error: entity.hgvisionSyncError ?? null,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}
