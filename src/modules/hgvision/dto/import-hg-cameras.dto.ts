import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** 1 dòng file Excel camera (FE đọc .xlsx → JSON). Kiểm tra nghiệp vụ ở service để báo lỗi theo dòng. */
export class ImportHgCameraRowDto {
  @IsString() @MaxLength(80) code!: string;
  @IsOptional() @IsString() @MaxLength(80) model?: string;
  @IsOptional() @IsString() @MaxLength(100) cabinet?: string;
  @IsOptional() @IsString() @MaxLength(50) drawingNo?: string;
  @IsOptional() @IsString() @MaxLength(80) serial?: string;
  @IsOptional() @IsString() @MaxLength(100) ip?: string;
  @IsOptional() @IsString() @MaxLength(100) username?: string;
  @IsOptional() @IsString() @MaxLength(200) password?: string;
}

export class ImportHgCamerasDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ImportHgCameraRowDto)
  rows!: ImportHgCameraRowDto[];

  /** true = chỉ xem trước, không ghi gì. */
  @IsOptional() @IsBoolean() dryRun?: boolean;

  /** true = thêm camera sang HGVision (ONVIF) nếu bên đó chưa có. */
  @IsOptional() @IsBoolean() pushToHg?: boolean;
}
