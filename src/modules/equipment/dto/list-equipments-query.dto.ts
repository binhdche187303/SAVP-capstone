import type { FilterSelection } from '../../../common/utils/filter-selection.js';
import {
  IsOptional,
  IsEnum,
  IsUUID,
  IsString,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  EquipmentType,
  AssetStatus,
  HealthStatus,
} from '../entities/equipment.entity.js';

/**
 * UC-64 — Query lọc / tìm kiếm kho thiết bị (GET /api/v1/equipments).
 *
 * Tất cả filter optional, kết hợp AND. sortBy dùng allowlist @IsIn (chống inject
 * field); service map sang cột thật qua SORT_MAP. Read-only.
 */
export class ListEquipmentsQueryDto {
  @IsOptional()
  @IsEnum(EquipmentType, { each: true,
    message:
      'Loại thiết bị không hợp lệ. Giá trị: camera, microphone, display, speaker, capture_agent, sensor, other',
  })
  equipmentType?: FilterSelection<EquipmentType>;

  @IsOptional()
  @IsEnum(AssetStatus, {
    message:
      'Trạng thái tài sản không hợp lệ. Giá trị: available, assigned, retired, lost, maintenance',
  })
  assetStatus?: AssetStatus;

  @IsOptional()
  @IsEnum(HealthStatus, { each: true,
    message:
      'Tình trạng không hợp lệ. Giá trị: healthy, warning, faulty, offline, unknown',
  })
  healthStatus?: FilterSelection<HealthStatus>;

  @IsOptional()
  @IsUUID('4', { message: 'currentRoomId phải là định dạng UUID' })
  currentRoomId?: string;

  @IsOptional()
  @IsString({ message: 'Từ khóa tìm kiếm phải là chuỗi ký tự' })
  search?: string;

  @IsOptional()
  @IsIn(
    [
      'equipmentCode',
      'equipmentName',
      'equipmentType',
      'assetStatus',
      'healthStatus',
      'createdAt',
    ],
    {
      message:
        'sortBy chỉ được là equipmentCode, equipmentName, equipmentType, assetStatus, healthStatus hoặc createdAt',
    },
  )
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sortOrder chỉ được là asc hoặc desc' })
  sortOrder?: 'asc' | 'desc' = 'desc';

  @Type(() => Number)
  @IsOptional()
  @Min(1, { message: 'page phải lớn hơn hoặc bằng 1' })
  page?: number = 1;

  @Type(() => Number)
  @IsOptional()
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng 1' })
  @Max(100, { message: 'limit không được vượt quá 100' })
  limit?: number = 20;
}
