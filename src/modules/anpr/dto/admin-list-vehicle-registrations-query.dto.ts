import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsString, MaxLength } from 'class-validator';
import { Expose, Transform } from 'class-transformer';
import { ListVehicleRegistrationsQueryDto } from './list-vehicle-registrations-query.dto.js';

/**
 * AdminListVehicleRegistrationsQueryDto (UC-101 / VPL-002)
 * — query GET /anpr/admin/vehicle-registrations (route ADMIN).
 *
 * `extends` DTO route user ⇒ kế thừa `page`/`limit`/`status`/`plate`/`vehicle_type`,
 * cộng thêm 2 filter chủ xe: `user_id` (exact) và `owner` (search tên/email qua join).
 *
 * ⚠ ĐÍNH CHÍNH comment SEC-01 của lớp cha: lớp cha ghi "KHÔNG nhận user_id" — điều đó
 * CHỈ đúng cho route USER. Lớp con NÀY CÓ `user_id`/`owner`, nhưng chỉ phục vụ route admin
 * đã qua @RequirePermissions('anpr.vehicle.admin_read'). Route user vẫn dùng lớp cha và
 * vẫn fold cứng userId từ JWT — hai field này không bao giờ tới được route user.
 */
export class AdminListVehicleRegistrationsQueryDto extends ListVehicleRegistrationsQueryDto {
  // Lọc xe của đúng một user (exact). Dùng IDX_vehicle_registrations_user_id.
  @ApiPropertyOptional({
    description: 'Lọc xe của đúng 1 user (khớp chính xác userId)',
  })
  @Expose({ name: 'user_id' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  // Tìm theo chủ xe: ILike trên full_name OR email (service join vr.user). KHÔNG normalize.
  @ApiPropertyOptional({
    description: 'Tìm theo tên/email chủ xe (khớp một phần)',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  owner?: string;

  // Ô tìm kiếm chung của FE: OR trên tên (không phân biệt dấu) / email chủ xe / biển số.
  @ApiPropertyOptional({
    description:
      'Tìm chung theo tên, email chủ xe hoặc biển số (khớp một phần)',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;
}
