import {
  IsBoolean,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const RTSP = /^rtsp:\/\/\S+$/i;

/**
 * Thêm camera sang HGVision từ web SAVP.
 *  - ONVIF (mặc định): chỉ cần IP + cổng ONVIF + tài khoản; HGVision tự lấy URL RTSP.
 *  - RTSP: nhập tay URL luồng chính/phụ (dự phòng cho camera không bật ONVIF).
 */
export class CreateHgCameraDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsIn(['ONVIF', 'RTSP'])
  protocol?: 'ONVIF' | 'RTSP';

  // ---- ONVIF ----
  @ValidateIf((o: CreateHgCameraDto) => o.protocol !== 'RTSP')
  @IsString()
  @Matches(/^[A-Za-z0-9.-]+$/, { message: 'IP / tên miền không hợp lệ' })
  @MaxLength(255)
  ip?: string;

  @IsOptional()
  @Matches(/^\d{1,5}$/, { message: 'Cổng không hợp lệ' })
  port?: string;

  @ValidateIf((o: CreateHgCameraDto) => o.protocol !== 'RTSP')
  @IsString()
  @IsNotEmpty({ message: 'Nhập tài khoản camera' })
  @MaxLength(100)
  username?: string;

  @ValidateIf((o: CreateHgCameraDto) => o.protocol !== 'RTSP')
  @IsString()
  @IsNotEmpty({ message: 'Nhập mật khẩu camera' })
  @MaxLength(200)
  password?: string;

  /** Đổi luồng chính + phụ sang H.264 (trình duyệt không phát được H.265). */
  @IsOptional() @IsBoolean() forceH264?: boolean;

  // ---- RTSP ----
  @ValidateIf((o: CreateHgCameraDto) => o.protocol === 'RTSP')
  @IsString()
  @Matches(RTSP, { message: 'Luồng chính phải là URL rtsp://...' })
  @MaxLength(500)
  mainUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^$|^rtsp:\/\/\S+$/i, {
    message: 'Luồng phụ phải là URL rtsp://...',
  })
  @MaxLength(500)
  subUrl?: string;

  // ---- chung ----
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
