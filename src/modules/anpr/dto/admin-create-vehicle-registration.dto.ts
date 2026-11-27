import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { Expose } from 'class-transformer';
import { CreateVehicleRegistrationDto } from './create-vehicle-registration.dto.js';

/**
 * AdminCreateVehicleRegistrationDto (VPR-001 / UC1) — body route ADMIN đăng ký hộ user bất kỳ.
 *
 * Kế thừa field user DTO + thêm `user_id` (required). Route admin gate THẬT
 * (PermissionsGuard + @RequirePermissions('anpr.vehicle.admin_register')) — SEC-01.
 */
export class AdminCreateVehicleRegistrationDto extends CreateVehicleRegistrationDto {
  @ApiProperty({ name: 'user_id', description: 'ID user được đăng ký hộ biển số này' })
  @Expose({ name: 'user_id' })
  @IsUUID()
  userId: string;
}
