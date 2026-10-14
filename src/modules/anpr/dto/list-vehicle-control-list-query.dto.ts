import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  IsString,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { Type, Transform, Expose } from 'class-transformer';
import {
  CONTROL_LIST_TYPES,
  CONTROL_LIST_VEHICLE_TYPES,
  type ControlListType,
  type ControlListVehicleType,
} from './create-vehicle-control-list.dto.js';

/**
 * ListVehicleControlListQueryDto (VCL-001 / UC8) — query GET /anpr/admin/control-list.
 *
 * Mirror pagination UC3 (page/limit, limit max 100). `plate` được service normalize
 * (`normalizePlate()`) trước khi so khớp — so khớp CHÍNH XÁC trên `plate_number` đã chuẩn
 * hóa, KHÔNG phải tìm gần đúng (spec §3). `active` là query string 'true'/'false' —
 * `@Type(()=>Boolean)` của class-transformer coi MỌI string non-empty là true nên phải
 * `@Transform` tay để 'false' → false thật.
 */
export class ListVehicleControlListQueryDto {
  @ApiPropertyOptional({ description: 'Số trang', default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Số bản ghi mỗi trang (tối đa 100)',
    default: 20,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Lọc theo biển số đã chuẩn hoá (khớp chính xác)',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  plate?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo phân loại danh sách',
    enum: CONTROL_LIST_TYPES,
  })
  @Expose({ name: 'list_type' })
  @IsOptional()
  @IsIn(CONTROL_LIST_TYPES)
  listType?: ControlListType;

  @ApiPropertyOptional({ description: 'Lọc theo trạng thái kích hoạt' })
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true',
  )
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: 'Lọc theo loại phương tiện',
    enum: CONTROL_LIST_VEHICLE_TYPES,
  })
  @Expose({ name: 'vehicle_type' })
  @IsOptional()
  @IsIn(CONTROL_LIST_VEHICLE_TYPES)
  vehicleType?: ControlListVehicleType;
}
