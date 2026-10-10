import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class AccessWindowDto {
  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validTo?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) zoneIds?: string[];
}
export class ApproveVisitDto {
  @IsOptional() @ValidateNested() @Type(() => AccessWindowDto) access?: AccessWindowDto;
}
export class ReasonDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
export class ExtendVisitDto {
  @IsOptional() @IsString() validTo?: string;
}
export class AttachPhotoDto {
  @IsOptional() @IsString() @MaxLength(3_200_000) photo?: string;
}
export class ManualCheckInDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class CheckOutDto {
  @IsOptional() @IsString() zoneId?: string;
}
export class CloseManualDto {
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() exitAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
