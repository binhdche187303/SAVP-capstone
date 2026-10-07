import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Expose, Type } from 'class-transformer';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DetectionZoneDto {
  @IsInt()
  @Min(0)
  @Max(100)
  x: number;

  @IsInt()
  @Min(0)
  @Max(100)
  y: number;

  @IsInt()
  @Min(5)
  @Max(100)
  w: number;

  @IsInt()
  @Min(5)
  @Max(100)
  h: number;
}

/**
 * ConfigureAiConfigDto (IAC-001 / UC-96) — bật/tắt chức năng AI của camera.
 * PATCH /iot-devices/:id/ai-config → ghi `metadata_json.ai_config`.
 *
 * ⚠ MAP CỜ → LOẠI EVENT (cho consumer phát-hiện-lệch cấu hình ở UC-105 — KHÔNG dùng nhãn UI
 * IVSS; consumer so "cờ khai tắt" với "event loại đó vẫn về"):
 *   - face_recognition  → ivss_face_event
 *   - plate_recognition → vehicle plate event (sự kiện biển số)
 *   - people_counting   → occupancy event (sự kiện đếm người / hiện diện khu vực)
 *
 * ⚠ NGỮ NGHĨA MERGE: cờ GỬI → cập nhật; cờ KHÔNG gửi → giữ nguyên (service merge từng cờ,
 * không replace cả cụm). Cả 3 @IsOptional chính vì merge.
 *
 * ⚠ `absent` ≠ `false`: khoá VẮNG MẶT = admin CHƯA khai; `false` = admin KHAI phải tắt. Lần
 * PATCH đầu chỉ gửi 1 cờ ⇒ 2 cờ kia vẫn vắng mặt, KHÔNG mặc định thành `false`. Consumer
 * (UC-105) chỉ cảnh báo lệch khi cờ `false` TƯỜNG MINH.
 *
 * ⚠⚠ Config là TUYÊN BỐ Ý ĐỊNH của quản trị viên, KHÔNG phải trạng thái thật của thiết bị
 * (BE không đẩy được xuống camera/IVSS). CẤM dùng để lọc/chặn event.
 */
export class ConfigureAiConfigDto {
  @Expose({ name: 'face_recognition' })
  @IsOptional()
  @IsBoolean()
  faceRecognition?: boolean;

  @Expose({ name: 'plate_recognition' })
  @IsOptional()
  @IsBoolean()
  plateRecognition?: boolean;

  @Expose({ name: 'people_counting' })
  @IsOptional()
  @IsBoolean()
  peopleCounting?: boolean;

  // ── Cấu hình nâng cao (2.2.6) — cùng ngữ nghĩa merge: khoá gửi mới ghi đè. ──

  /** Ngưỡng tin cậy nhận diện (%). */
  @Expose({ name: 'confidence_threshold' })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(99)
  confidenceThreshold?: number;

  /** Vùng nhận diện trên khung hình, đơn vị % (x, y = góc trên-trái). */
  @Expose({ name: 'detection_zone' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DetectionZoneDto)
  detectionZone?: DetectionZoneDto;

  /** Khung giờ hoạt động HH:mm. */
  @Expose({ name: 'active_from' })
  @IsOptional()
  @Matches(HH_MM)
  activeFrom?: string;

  @Expose({ name: 'active_to' })
  @IsOptional()
  @Matches(HH_MM)
  activeTo?: string;

  /** Ngày hoạt động trong tuần: 0 = Thứ 2 … 6 = Chủ nhật. */
  @Expose({ name: 'active_days' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  activeDays?: number[];

  @Expose({ name: 'stranger_alert' })
  @IsOptional()
  @IsBoolean()
  strangerAlert?: boolean;

  /** Chống giả mạo (ảnh/màn hình). */
  @Expose({ name: 'liveness_check' })
  @IsOptional()
  @IsBoolean()
  livenessCheck?: boolean;

  @Expose({ name: 'mask_support' })
  @IsOptional()
  @IsBoolean()
  maskSupport?: boolean;

  @Expose({ name: 'low_light' })
  @IsOptional()
  @IsBoolean()
  lowLight?: boolean;
}

/** Map field DTO → khoá snake trong `metadata_json.ai_config` (dùng khi merge ở service). */
export const AI_CONFIG_KEYS: Record<string, string> = {
  faceRecognition: 'face_recognition',
  plateRecognition: 'plate_recognition',
  peopleCounting: 'people_counting',
  confidenceThreshold: 'confidence_threshold',
  detectionZone: 'detection_zone',
  activeFrom: 'active_from',
  activeTo: 'active_to',
  activeDays: 'active_days',
  strangerAlert: 'stranger_alert',
  livenessCheck: 'liveness_check',
  maskSupport: 'mask_support',
  lowLight: 'low_light',
};
