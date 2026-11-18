/**
 * Ràng buộc 1 chiều: quyền THAO TÁC (create/update/delete/assign/approve/...) trên 1
 * resource phụ thuộc (dependsOn) quyền XEM (read) cùng resource — nếu role có quyền
 * thao tác mà không có quyền xem, user không có cách nào chạm tới thao tác đó qua UI
 * (màn hình sửa/xóa luôn load dữ liệu qua 1 API read bị PermissionsGuard chặn trước).
 * Quyền `read` không bao giờ phụ thuộc gì — chiều ngược lại (role chỉ-xem) là hợp lệ.
 *
 * Chỉ chứa các cặp đã xác minh trực tiếp trong permission catalog thật — xem
 * Docs/Nam_Sent/BE_PLAN_Permission_Dependency_Constraints.md. KHÔNG suy đoán theo quy
 * ước tên cho các module chưa xác nhận (accounts.user.*, rooms, iot, anpr.vehicle.*,
 * attendance.*, minutes, live-meeting) — catalog đặt tên không đồng nhất giữa các
 * module nên suy luận theo tên không an toàn.
 */
export const PERMISSION_DEPENDENCIES: Readonly<
  Record<string, readonly string[]>
> = {
  'zones.zone.create': ['zones.zone.read'],
  'zones.zone.update': ['zones.zone.read'],
  'zones.zone.delete': ['zones.zone.read'],
  'zones.zone.assign_device': ['zones.zone.read'],
  'equipment.create': ['equipment.read'],
  'equipment.delete': ['equipment.read'],
  'equipment.assign': ['equipment.read'],
  'equipment.report_fault': ['equipment.read'],
  'account.role.create': ['account.role.read'],
  'account.role.update': ['account.role.read'],
  'account.role.delete': ['account.role.read'],
  'department.update': ['department.read'],
  'alert_rules.create': ['alert_rules.read'],
  'alert_rules.update': ['alert_rules.read'],
  'alert_rules.delete': ['alert_rules.read'],
  'person_control_list.create': ['person_control_list.read'],
  'person_control_list.update': ['person_control_list.read'],
  'person_control_list.delete': ['person_control_list.read'],
  'security_alert.acknowledge': ['security_alert.read'],
  'security_alert.resolve': ['security_alert.read'],
  'vehicle_control.create': ['vehicle_control.read'],
  'vehicle_control.update': ['vehicle_control.read'],
  'vehicle_control.delete': ['vehicle_control.read'],
  'meeting_request.approve': ['meeting_request.read'],
  'meeting_request.reject': ['meeting_request.read'],
  'face.unmapped.map': ['face.unmapped.read'],
  'recording.config.update': ['recording.config.read'],
  'recording.files.manage': ['recording.files.read'],
  'recording.files.play': ['recording.files.read'],
  'room.noshow.configure': ['room.noshow.read'],
  'room.noshow.release': ['room.noshow.read'],
  'room.noshow.update': ['room.noshow.read'],
} as const;

/** Trả về danh sách permissionCode mà `permissionCode` phụ thuộc — [] nếu không có. */
export function getPermissionDependencies(permissionCode: string): string[] {
  return [...(PERMISSION_DEPENDENCIES[permissionCode] ?? [])];
}
