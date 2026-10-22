import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
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

  /** Khu vực (zone) nhóm camera phụ trách. */
  @Expose({ name: 'zone_id' })
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  /** Mục đích sử dụng (vd: truy vết mất đồ, nhà xe, cổng). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  purpose?: string;
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

  /** `null` để gỡ khu vực khỏi nhóm. */
  @Expose({ name: 'zone_id' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  zoneId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  purpose?: string;
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
