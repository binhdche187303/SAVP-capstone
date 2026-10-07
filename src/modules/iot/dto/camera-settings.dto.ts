import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Expose, Type } from 'class-transformer';

// ── 2.2.4 Sơ đồ lắp đặt camera ─────────────────────────────────────────────
// Lưu `metadata_json.layout = { floor_key, x, y, angle }` (toạ độ SVG rộng 1000, angle độ).

export class CameraLayoutPositionDto {
  @Expose({ name: 'device_id' })
  @IsUUID()
  deviceId: string;

  @IsNumber()
  @Min(0)
  @Max(5000)
  x: number;

  @IsNumber()
  @Min(0)
  @Max(5000)
  y: number;

  @IsInt()
  @Min(0)
  @Max(359)
  angle: number;
}

/** PUT /iot-devices/layout — lưu vị trí các camera của 1 tầng; reset=true xoá vị trí cả tầng. */
export class SaveCameraLayoutDto {
  /** Khoá tầng dạng "Tòa A - Tầng 1" (khớp areaName của phòng). */
  @Expose({ name: 'floor_key' })
  @IsString()
  @Length(1, 120)
  floorKey: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => CameraLayoutPositionDto)
  positions?: CameraLayoutPositionDto[];

  @IsOptional()
  @IsBoolean()
  reset?: boolean;
}

// ── 2.2.7 Lịch ghi hình & lưu trữ ──────────────────────────────────────────
// Lưu `metadata_json.recording = { mode, retention_days, bitrate_mbps, schedule }`.

export const RECORDING_MODES = ['continuous', 'event', 'off'] as const;
export const RETENTION_DAYS = [7, 15, 30, 60, 90] as const;
export const BITRATES_MBPS = [1, 2, 4, 8] as const;

/** PATCH /iot-devices/:id/recording-policy */
export class ConfigureRecordingDto {
  @IsIn(RECORDING_MODES)
  mode: (typeof RECORDING_MODES)[number];

  @Expose({ name: 'retention_days' })
  @IsIn(RETENTION_DAYS)
  retentionDays: number;

  @Expose({ name: 'bitrate_mbps' })
  @IsIn(BITRATES_MBPS)
  bitrateMbps: number;

  /** 7 chuỗi (T2…CN), mỗi chuỗi 24 ký tự '0'/'1' theo giờ. */
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @Matches(/^[01]{24}$/, { each: true })
  schedule: string[];
}

// ── 2.2.1 Thống kê camera biển số ──────────────────────────────────────────

/** GET /iot-devices/anpr-stats?date=YYYY-MM-DD (mặc định hôm nay, giờ VN). */
export class AnprStatsQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}
