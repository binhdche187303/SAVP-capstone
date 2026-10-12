import type { GateAccessLogEntity } from '../entities/gate-access-log.entity.js';

/**
 * GateAccessLogResponse (GAL-001 / UC-107) — shape route USER, field snake_case.
 *
 * Có `zone_name` (qua join) + biển của chính mình + paired_log_id/duration_seconds (do UC-106
 * ghi, hiện luôn NULL). KHÔNG khối `user` — đều là của chính mình (SEC-01).
 */
export interface GateAccessLogResponse {
  id: string;
  zone_id: string;
  zone_name: string | null;
  direction: string;
  access_time: Date;
  plate_number: string | null;
  vehicle_registration_id: string | null;
  paired_log_id: string | null;
  duration_seconds: number | null;
  metadata_json: Record<string, unknown> | null;
}

export function toGateAccessLogResponse(
  entity: GateAccessLogEntity,
): GateAccessLogResponse {
  return {
    id: entity.id,
    zone_id: entity.zoneId,
    // Log lịch sử: zone có thể đã xoá mềm — vẫn trả tên bình thường (KHÔNG lọc deletedAt).
    zone_name: entity.zone?.zoneName ?? null,
    direction: entity.direction,
    access_time: entity.accessTime,
    plate_number: entity.plateNumber,
    vehicle_registration_id: entity.vehicleRegistrationId,
    paired_log_id: entity.pairedLogId,
    duration_seconds: entity.durationSeconds,
    metadata_json: entity.metadataJson,
  };
}

/**
 * AdminGateAccessLogResponse (GAL-001 / UC-107) — shape route ADMIN.
 *
 * = field route user CỘNG `zone_code` + khối `owner` chủ nhân log. Owner CHỈ
 * user_id + full_name + email — CẤM phone/department/username/employee_code/trạng thái
 * tài khoản (SEC-01). Chỉ dùng cho endpoint admin đã qua @RequirePermissions.
 */
export interface AdminGateAccessLogOwner {
  user_id: string;
  full_name: string;
  email: string;
  employee_code?: string | null;
  position_title?: string | null;
}

export interface AdminGateAccessLogResponse extends GateAccessLogResponse {
  zone_code: string | null;
  user: AdminGateAccessLogOwner | null;
}

export function toAdminGateAccessLogResponse(
  entity: GateAccessLogEntity,
): AdminGateAccessLogResponse {
  return {
    ...toGateAccessLogResponse(entity),
    zone_code: entity.zone?.zoneCode ?? null,
    // Log lịch sử: user có thể đã bị vô hiệu hoá/xoá mềm — vẫn trả tên bình thường.
    user: entity.user
      ? {
          user_id: entity.user.id,
          full_name: entity.user.fullName,
          email: entity.user.email,
          employee_code: entity.user.employeeCode,
          position_title: entity.user.positionTitle,
        }
      : null,
  };
}
