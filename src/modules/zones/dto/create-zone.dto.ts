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
} from 'class-validator';
import { Expose } from 'class-transformer';
import { ZONE_TYPES, type ZoneType } from '../constants/zone-type.constant.js';

/**
 * CreateZoneDto (ZNC-001 / UC-90) — body tạo khu vực.
 *
 * Giới hạn độ dài khớp ĐÚNG schema `zones` (migration 20260721000001) để lỗi bị chặn ở
 * boundary thay vì để Postgres ném truncate.
 *
 * `zone_type` BẮT BUỘC (OQ-4): DB có DEFAULT 'room' nhưng KHÔNG được dựa vào nó — tạo zone
 * cổng mà quên `zone_type` sẽ âm thầm thành 'room' và logic điểm danh cổng (FT-20) không bao
 * giờ kích hoạt, không có lỗi nào báo.
 *
 * KHÔNG khai `status`/`id`/timestamps: `ValidationPipe({whitelist:true})` loại mọi field thừa
 * — client không tự đặt được trạng thái hay khóa chính.
 */
export class CreateZoneDto {
  @Expose({ name: 'zone_code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  zoneCode: string;

  @Expose({ name: 'zone_name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  zoneName: string;

  // OQ-4: required — CỐ Ý KHÔNG có @IsOptional.
  @Expose({ name: 'zone_type' })
  @IsIn([...ZONE_TYPES])
  zoneType: ZoneType;

  // OQ-6: nullable cho MỌI zone_type — không conditional validation.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  building?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  floor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @Expose({ name: 'metadata_json' })
  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;

  // Toạ độ GPS cho Bản đồ khuôn viên — phải gửi đủ cặp (kiểm ở ZonesService).
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number;
}
