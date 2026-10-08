import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsIn,
  IsNumber,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Expose } from 'class-transformer';
import { ZONE_TYPES, type ZoneType } from '../constants/zone-type.constant.js';
import {
  ZONE_STATUSES,
  type ZoneStatus,
} from '../constants/zone-status.constant.js';

/**
 * `@ValidateIf` cho field KHÔNG nhận `null` — CRUX của UC-91.
 *
 * ⚠ KHÔNG được thay bằng `@IsOptional()`: `@IsOptional()` bỏ qua validate khi giá trị là
 * `null` LẪN `undefined`. Với `zone_code`, request `{"zone_code": null}` sẽ lọt validate →
 * ở service `null !== undefined` là `true` nên `null` lọt vào `updates` →
 * `normalizeZoneCode(null)` = `String(null).trim().toUpperCase()` = `"NULL"` ⇒ `zone_code`
 * bị ghi thành chuỗi `"NULL"`: hỏng dữ liệu ÂM THẦM, không lỗi nào báo.
 *
 * `@ValidateIf((_, v) => v !== undefined)` bỏ qua khi không gửi (`undefined`) nhưng VẪN
 * validate khi gửi `null` ⇒ `null` bị các decorator bên dưới đánh trượt → 400.
 */
const SkipWhenAbsent = () => ValidateIf((_, value) => value !== undefined);

/**
 * UpdateZoneDto (ZNU-001 / UC-91) — body cập nhật khu vực.
 *
 * Ngữ nghĩa 3 nhánh (OQ-8): không gửi (`undefined`) = giữ nguyên · gửi `null` = xoá giá trị
 * (chỉ các field nullable) · gửi giá trị = gán. `metadata_json` được **thay thế toàn bộ**,
 * KHÔNG merge sâu.
 *
 * 2 nhóm decorator KHÔNG được dùng lẫn:
 * - KHÔNG nhận `null`: `zone_code`, `zone_name`, `zone_type`, `status` → `SkipWhenAbsent()`.
 * - Nhận `null` (= xoá): `building`, `floor`, `description`, `metadata_json`, `latitude`,
 *   `longitude` → `@IsOptional()`. Toạ độ phải đi cặp (kiểm ở service trên giá trị sau gộp).
 *
 * KHÔNG có `UpdateZoneStatusDto` riêng (OQ-3): `status` đi chung route `PATCH /zones/:id`.
 * Chuẩn hóa `zone_code` KHÔNG làm ở đây — tập trung tại service qua `normalizeZoneCode`.
 */
export class UpdateZoneDto {
  @Expose({ name: 'zone_code' })
  @SkipWhenAbsent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  zoneCode?: string;

  @Expose({ name: 'zone_name' })
  @SkipWhenAbsent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  zoneName?: string;

  @Expose({ name: 'zone_type' })
  @SkipWhenAbsent()
  @IsIn([...ZONE_TYPES])
  zoneType?: ZoneType;

  @SkipWhenAbsent()
  @IsIn([...ZONE_STATUSES])
  status?: ZoneStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  building?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  floor?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @Expose({ name: 'metadata_json' })
  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown> | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number | null;
}
