import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsISO8601,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ListVehicleHistoryQueryDto (VHI-001 / UC7) — query GET /anpr/vehicle-history + /anpr/admin/vehicle-history.
 *
 * 1 DTO chung 2 route. `listForUser` BỎ QUA `matchState` (chỉ `listAll` dùng).
 * `plateNumber` nhận RAW — service normalize qua normalizePlate (UC1) trước khi so DB (DATA-03).
 */
export class ListVehicleHistoryQueryDto {
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

  @ApiPropertyOptional({ description: 'Lọc từ thời điểm (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Lọc đến thời điểm (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo hướng di chuyển',
    enum: ['enter', 'leave', 'seen'],
  })
  @IsOptional()
  @IsIn(['enter', 'leave', 'seen'])
  direction?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo biển số (chuẩn hoá trước khi so)',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  plateNumber?: string;

  // Chỉ admin route (listAll) dùng — lọc chỉ-khớp / chỉ-lạ.
  @ApiPropertyOptional({
    description: 'Lọc theo trạng thái khớp đăng ký (chỉ admin route)',
    enum: ['matched', 'unmatched'],
  })
  @IsOptional()
  @IsIn(['matched', 'unmatched'])
  matchState?: string;

  // Chỉ admin route (listAll) dùng — tìm theo tên chủ xe (users.full_name, ILIKE).
  // listForUser KHÔNG expose owner/userId (privacy-by-design) nên field này vô nghĩa ở đó.
  @ApiPropertyOptional({
    description: 'Tìm theo tên chủ xe (chỉ admin route)',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  ownerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cameraName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  zoneId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  vehicleType?: string;
}
