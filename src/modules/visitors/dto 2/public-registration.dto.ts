import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/** Dữ liệu khách: mọi trường tùy chọn ở tầng cấu trúc; nghiệp vụ kiểm ở `validateVisitPayload` (thông điệp trùng FE). */
export class VisitorInfoDto {
  @IsOptional() @IsString() @MaxLength(150) fullName?: string;
  @IsOptional() @IsString() @MaxLength(30) idNumber?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(255) email?: string;
  @IsOptional() @IsString() @MaxLength(200) organization?: string;
  @IsOptional() @IsString() @MaxLength(16) plateNumber?: string;
  /** Data URL ảnh khuôn mặt; ≤ 2 MB sau giải mã, chỉ JPEG/PNG. */
  @IsOptional() @IsString() @MaxLength(3_200_000) photo?: string | null;
}

export class PublicRegistrationDto {
  @IsOptional() @ValidateNested() @Type(() => VisitorInfoDto) visitor?: VisitorInfoDto;
  @IsOptional() @IsString() hostId?: string;
  @IsOptional() @IsString() @MaxLength(120) purpose?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(50) companions?: number;
  @IsOptional() @IsString() scheduledFrom?: string;
  @IsOptional() @IsString() scheduledTo?: string;
  @IsOptional() @IsBoolean() consent?: boolean;
}

/** Tạo lượt nội bộ: lễ tân (walk_in, chọn người được gặp) hoặc người được gặp mời khách (host_invite). */
export class CreateVisitDto extends PublicRegistrationDto {
  @IsIn(['walk_in', 'host_invite']) channel!: 'walk_in' | 'host_invite';
}
