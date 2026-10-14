import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Expose } from 'class-transformer';

export class CreateCameraGroupDto {
  @Expose({ name: 'group_code' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{2,50}$/, { message: 'Mã nhóm chỉ gồm chữ không dấu, số, "_" hoặc "-" (2–50 ký tự)' })
  groupCode: string;

  @Expose({ name: 'group_name' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  groupName: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateCameraGroupDto {
  @Expose({ name: 'group_name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  groupName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

/** Danh sách camera gán vào nhóm; ≤50/lần (ARCH-02: giao dịch ngắn). */
export class CameraGroupDevicesDto {
  @Expose({ name: 'device_ids' })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  deviceIds: string[];
}
