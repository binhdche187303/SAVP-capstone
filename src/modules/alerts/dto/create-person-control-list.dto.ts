import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsUUID,
  IsBoolean,
  MaxLength,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';
import { Expose } from 'class-transformer';

/** UC-125 (PWL-001): mirror `vehicle_control_list.list_type` (Hải review §1.3). */
export const PERSON_CONTROL_LIST_TYPES = ['watchlist', 'blocklist'] as const;
export type PersonControlListType = (typeof PERSON_CONTROL_LIST_TYPES)[number];

/** Cùng vocabulary với `security_alerts.severity` — priority dùng thẳng làm severity (spec §2.1). */
export const PERSON_CONTROL_PRIORITIES = [
  'low',
  'medium',
  'high',
  'critical',
] as const;
export type PersonControlPriority = (typeof PERSON_CONTROL_PRIORITIES)[number];

/**
 * CreatePersonControlListDto (PWL-001 / UC-125) — body POST /api/v1/person-control-list.
 *
 * KHÔNG có `createdBy`: lấy từ JWT (@CurrentUser), KHÔNG từ body — mirror SEC-01/02 UC1/UC8.
 * `userId`/`faceProfileId` đều optional, ĐỘC LẬP (người ngoài chỉ có `displayName`).
 */
export class CreatePersonControlListDto {
  @ApiPropertyOptional({
    description: 'ID user hệ thống ứng với người này (nếu đã có tài khoản)',
  })
  @Expose({ name: 'user_id' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description:
      'ID face profile dùng để so khớp trực tiếp trên khuôn mặt (độc lập với userId)',
  })
  @Expose({ name: 'face_profile_id' })
  @IsOptional()
  @IsUUID()
  faceProfileId?: string;

  @ApiProperty({
    description: 'Tên hiển thị của người trong danh sách kiểm soát',
    maxLength: 255,
  })
  @Expose({ name: 'display_name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  displayName: string;

  @ApiPropertyOptional({
    description: 'ID ảnh chân dung đính kèm (media_files)',
  })
  @Expose({ name: 'photo_media_file_id' })
  @IsOptional()
  @IsUUID()
  photoMediaFileId?: string;

  @ApiPropertyOptional({
    description: 'Phân loại danh sách',
    enum: PERSON_CONTROL_LIST_TYPES,
  })
  @Expose({ name: 'list_type' })
  @IsOptional()
  @IsIn(PERSON_CONTROL_LIST_TYPES)
  listType?: PersonControlListType;

  @ApiPropertyOptional({
    description: 'Lý do đưa vào danh sách kiểm soát',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional({
    description: 'Mức độ ưu tiên (dùng thẳng làm severity khi tạo cảnh báo)',
    enum: PERSON_CONTROL_PRIORITIES,
  })
  @IsOptional()
  @IsIn(PERSON_CONTROL_PRIORITIES)
  priority?: PersonControlPriority;

  @ApiPropertyOptional({
    description: 'Trạng thái kích hoạt theo dõi ngay (mặc định bật)',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      'Các lượt người lạ (iot_device_events.id) bảo vệ xác nhận là người này — cảnh báo "Người lạ" chứa các lượt đó được đánh dấu chuyển theo dõi',
    type: [String],
  })
  @Expose({ name: 'source_event_ids' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  sourceEventIds?: string[];
}
