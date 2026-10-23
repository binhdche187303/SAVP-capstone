import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  ValidateIf,
  IsOptional,
  IsUUID,
  Min,
  IsArray,
  ArrayNotEmpty,
  IsBoolean,
  IsObject,
  ValidateNested,
  Matches,
  IsString,
} from 'class-validator';
import { Type, Expose } from 'class-transformer';

/**
 * UC-122 (ARL-001): 7 loại sự kiện cảnh báo đã duyệt (BAO_CAO_DE_XUAT_3_BANG_ALERT_CENTER.md)
 * + `vehicle_unauthorized` (xe có đăng ký nhưng chờ duyệt/bị từ chối — vehicle-control-alert.service
 * đã sinh và đọc rule qua findEffectiveRule, trước đây chỉ có rule seed nên không tạo/sửa/lọc được).
 * + nhóm cảnh báo khách được tạo từ visitor-gate/visitor-sweep và dùng chung Security Alert Center.
 */
export const ALERT_TYPES = [
  'stranger',
  'unknown_vehicle',
  'vehicle_unauthorized',
  'vehicle_control_match',
  'crowd',
  'intrusion',
  'device_error',
  'person_watchlist_match',
  'visitor_overstay',
  'visitor_must_leave',
  'visitor_zone_violation',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** UC-122 §2.3: 2 kênh hỗ trợ thật (mirror NotificationChannel IN_APP/EMAIL). */
export const ALERT_CHANNELS = ['in_app', 'email'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/** UC-122 §2.6: khung giờ cho phép của khu vực hạn chế (UC-124). */
export class RestrictedHoursDto {
  @ApiPropertyOptional({
    description: 'Giờ bắt đầu cho phép áp dụng cảnh báo, định dạng HH:mm',
  })
  @Expose({ name: 'allow_from' })
  @IsOptional()
  @IsString()
  @Matches(HHMM_REGEX, { message: 'allow_from phải theo định dạng HH:mm' })
  allowFrom?: string;

  @ApiPropertyOptional({
    description: 'Giờ kết thúc cho phép áp dụng cảnh báo, định dạng HH:mm',
  })
  @Expose({ name: 'allow_to' })
  @IsOptional()
  @IsString()
  @Matches(HHMM_REGEX, { message: 'allow_to phải theo định dạng HH:mm' })
  allowTo?: string;
}

/**
 * CreateAlertRuleDto (ARL-001 / UC-122) — body POST /api/v1/alert-rules.
 *
 * KHÔNG có `createdBy`/`updatedBy`: lấy từ JWT (@CurrentUser), KHÔNG từ body — mirror
 * SEC-01/02 của UC1/UC8.
 */
export class CreateAlertRuleDto {
  @ApiProperty({
    description: 'Loại sự kiện kích hoạt cảnh báo',
    enum: ALERT_TYPES,
  })
  @Expose({ name: 'alert_type' })
  @IsIn(ALERT_TYPES)
  alertType: AlertType;

  @ApiPropertyOptional({
    description: 'Khu vực áp dụng quy tắc; bỏ trống = toàn hệ thống',
  })
  @Expose({ name: 'zone_id' })
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional({
    description: 'Ngưỡng kích hoạt — bắt buộc khi alertType=crowd',
  })
  @ValidateIf((o: CreateAlertRuleDto) => o.alertType === 'crowd')
  @IsInt()
  @Min(1)
  threshold?: number;

  @ApiProperty({
    description: 'Danh sách kênh gửi thông báo',
    enum: ALERT_CHANNELS,
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ALERT_CHANNELS, { each: true })
  channels: AlertChannel[];

  @ApiPropertyOptional({
    description: 'Bật/tắt quy tắc ngay khi tạo (mặc định bật)',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Khung giờ hạn chế áp dụng quy tắc; bỏ trống = áp dụng 24/7',
    type: RestrictedHoursDto,
  })
  @Expose({ name: 'restricted_hours_json' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RestrictedHoursDto)
  restrictedHoursJson?: RestrictedHoursDto;

  @ApiPropertyOptional({
    description: 'Danh sách person id được phép bỏ qua cảnh báo',
    type: [String],
  })
  @Expose({ name: 'allowed_person_ids_json' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  allowedPersonIdsJson?: string[];
}
