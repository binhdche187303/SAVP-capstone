import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const RTSP = /^rtsp:\/\/\S+$/i;

/** Thêm camera RTSP sang HGVision từ web SAVP. */
export class CreateHgCameraDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @Matches(RTSP, { message: 'Luồng chính phải là URL rtsp://...' })
  @MaxLength(500)
  mainUrl!: string;

  @IsOptional()
  @IsString()
  @Matches(/^$|^rtsp:\/\/\S+$/i, {
    message: 'Luồng phụ phải là URL rtsp://...',
  })
  @MaxLength(500)
  subUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  group?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional() @IsBoolean() usingAi?: boolean;
  @IsOptional() @IsBoolean() usingFace?: boolean;
  @IsOptional() @IsBoolean() usingPlate?: boolean;
  @IsOptional() @IsBoolean() usingRecord?: boolean;
  @IsOptional() @IsBoolean() isShowing?: boolean;
}
