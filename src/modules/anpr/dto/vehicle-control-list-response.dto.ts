import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VehicleControlListEntity } from '../entities/vehicle-control-list.entity.js';

/**
 * VehicleControlListResponseDto (VCL-001 / UC8) — shape công khai (mirror toVehicleRegistrationResponse).
 * KHÔNG lộ `deleted_at`.
 */
export class VehicleControlListResponseDto {
  @ApiProperty({ description: 'ID mục trong danh sách kiểm soát' })
  id: string;

  @ApiProperty({ description: 'Biển số đã chuẩn hoá' })
  plate_number: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Biển số dạng thô (chưa chuẩn hoá)',
  })
  plate_raw: string | null;

  @ApiProperty({ description: 'Phân loại danh sách (blocklist/watchlist)' })
  list_type: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Loại phương tiện (null = không xác định)',
  })
  vehicle_type: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Lý do đưa vào danh sách kiểm soát',
  })
  reason: string | null;

  @ApiProperty({ description: 'Trạng thái kích hoạt' })
  active: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'ID user tạo mục này' })
  created_by: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Đồng bộ HGVision: null (chưa) | pending (cờ ghi tắt) | synced | failed',
  })
  hgvision_sync_status: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Lần đồng bộ HGVision thành công gần nhất',
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

export function toVehicleControlListResponse(
  entity: VehicleControlListEntity,
): VehicleControlListResponseDto {
  return {
    id: entity.id,
    plate_number: entity.plateNumber,
    plate_raw: entity.plateRaw,
    list_type: entity.listType,
    vehicle_type: entity.vehicleType ?? null,
    reason: entity.reason,
    active: entity.active,
    created_by: entity.createdBy,
    hgvision_sync_status: entity.hgvisionSyncStatus ?? null,
    hgvision_synced_at: entity.hgvisionSyncedAt ?? null,
    hgvision_sync_error: entity.hgvisionSyncError ?? null,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}
