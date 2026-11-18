import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SecurityAlertEntity } from '../entities/security-alert.entity.js';
import { ZoneEntity } from '../../zones/entities/zone.entity.js';

/**
 * SecurityAlertResponseDto (ASC-001 / UC-123) — shape công khai cho list/detail.
 */
export class SecurityAlertResponseDto {
  @ApiProperty({ description: 'ID cảnh báo an ninh' })
  id: string;

  @ApiProperty({ description: 'Loại sự kiện gây ra cảnh báo' })
  alert_type: string;

  @ApiProperty({ description: 'Mức độ nghiêm trọng' })
  severity: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Khu vực xảy ra cảnh báo',
  })
  zone_id: string | null;

  @ApiProperty({ description: 'Trạng thái xử lý (new/acknowledged/resolved)' })
  status: string;

  @ApiProperty({ description: 'Thời điểm cảnh báo được kích hoạt lần đầu' })
  triggered_at: Date;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Thời điểm cảnh báo được ghi nhận gần nhất (bump)',
  })
  last_seen_at: Date | null;

  @ApiProperty({ description: 'Số lần cảnh báo này lặp lại (đang tiếp diễn)' })
  occurrence_count: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ID event thiết bị gốc làm bằng chứng',
  })
  source_event_id: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'ID quy tắc cảnh báo kích hoạt (null nếu đối chiếu control-list trực tiếp)',
  })
  rule_id: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Dữ liệu bằng chứng đi kèm cảnh báo (biển số, ảnh, số người đếm được...)',
  })
  payload_json: Record<string, unknown> | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ID user đã xác nhận tiếp nhận',
  })
  acknowledged_by: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Họ tên người tiếp nhận',
  })
  acknowledged_by_name: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Thời điểm xác nhận tiếp nhận',
  })
  acknowledged_at: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'ID user đã xử lý xong' })
  resolved_by: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Họ tên người xử lý xong',
  })
  resolved_by_name: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Thời điểm xử lý xong' })
  resolved_at: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Ghi chú xử lý khi đóng cảnh báo',
  })
  resolution_note: string | null;

  @ApiProperty({ description: 'Thời điểm tạo' })
  created_at: Date;

  @ApiProperty({ description: 'Thời điểm cập nhật gần nhất' })
  updated_at: Date;
}

export function toSecurityAlertResponse(
  entity: SecurityAlertEntity,
): SecurityAlertResponseDto {
  return {
    id: entity.id,
    alert_type: entity.alertType,
    severity: entity.severity,
    zone_id: entity.zoneId,
    status: entity.status,
    triggered_at: entity.triggeredAt,
    last_seen_at: entity.lastSeenAt,
    occurrence_count: entity.occurrenceCount,
    source_event_id: entity.sourceEventId,
    rule_id: entity.ruleId,
    payload_json: entity.payloadJson,
    acknowledged_by: entity.acknowledgedBy,
    acknowledged_by_name: entity.acknowledgedByUser?.fullName ?? null,
    acknowledged_at: entity.acknowledgedAt,
    resolved_by: entity.resolvedBy,
    resolved_by_name: entity.resolvedByUser?.fullName ?? null,
    resolved_at: entity.resolvedAt,
    resolution_note: entity.resolutionNote,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}

export interface SecurityAlertZoneSummary {
  id: string;
  zone_code: string;
  zone_name: string;
}

export function toZoneSummary(
  zone: ZoneEntity | null,
): SecurityAlertZoneSummary | null {
  if (!zone) return null;
  return { id: zone.id, zone_code: zone.zoneCode, zone_name: zone.zoneName };
}
