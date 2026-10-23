/**
 * Bảng ánh xạ tiếng Việt cho file xuất Excel nhật ký hệ thống
 * (Docs/Nam_Sent/be-audit-log-export-requirement.md, mục 2).
 *
 * CHỈ dùng cho renderer XLSX export — KHÔNG áp dụng cho response JSON của
 * GET /audit-logs (AuditLogItemDto vẫn trả raw actionType/entityType/severity).
 */

/**
 * §2.A — Chuẩn hóa Hành động (Action Type). Key viết thường, so khớp không phân biệt hoa/thường.
 * GIỮ ĐỒNG BỘ với FE `src/constants/auditActionLabels.js` (màn Nhật ký hệ thống) để nhãn trên màn
 * hình và file Excel giống nhau. Gồm cả mã cũ của tài liệu export (CREATE_USER, LOCK_USER...).
 */
export const ACTION_TYPE_VN_MAP: Record<string, string> = {
  login: 'Đăng nhập',
  login_success: 'Đăng nhập thành công',
  login_failed: 'Đăng nhập thất bại',
  logout: 'Đăng xuất',
  request_otp: 'Yêu cầu mã OTP',
  user_create: 'Thêm tài khoản',
  account_create: 'Thêm tài khoản',
  create_user: 'Thêm tài khoản',
  account_update: 'Cập nhật tài khoản',
  update_user: 'Cập nhật tài khoản',
  account_lock: 'Khóa tài khoản',
  lock_user: 'Khóa tài khoản',
  account_unlock: 'Mở khóa tài khoản',
  unlock_user: 'Mở khóa tài khoản',
  account_delete: 'Xóa tài khoản',
  delete_user: 'Xóa tài khoản',
  account_role_update: 'Cập nhật vai trò tài khoản',
  account_status_update: 'Cập nhật trạng thái tài khoản',
  account_import: 'Nhập danh sách tài khoản',
  partner_account_import: 'Nhập tài khoản đối tác',
  'account.partner.extend': 'Gia hạn tài khoản đối tác',
  'account.partner.lock_early': 'Khóa sớm tài khoản đối tác',
  export_users: 'Xuất tệp nhân viên',
  'avatar.updated': 'Cập nhật ảnh đại diện',
  avatar_update: 'Cập nhật ảnh đại diện',
  avatar_submit: 'Gửi ảnh đại diện chờ duyệt',
  role_assign: 'Gán vai trò',
  create_role: 'Tạo vai trò',
  update_role: 'Cập nhật vai trò',
  delete_role: 'Xóa vai trò',
  create_permission: 'Tạo quyền',
  assign_permission: 'Gán quyền',
  revoke_permission: 'Thu hồi quyền',
  toggle_permission: 'Bật/tắt quyền',
  update_permission: 'Cập nhật quyền',
  create: 'Tạo mới',
  update: 'Cập nhật',
  delete: 'Xóa',
  soft_delete: 'Xóa (lưu trữ)',
  view_detail: 'Xem chi tiết',
  approve: 'Phê duyệt',
  reject: 'Từ chối',
  enable: 'Bật',
  disable: 'Tắt',
  deactivate: 'Ngừng hoạt động',
  reactivate: 'Kích hoạt lại',
  export: 'Xuất dữ liệu',
  export_audit_logs: 'Xuất nhật ký hệ thống',
  auto_offline: 'Thiết bị mất kết nối',
  device_offline: 'Thiết bị mất kết nối',
  auto_online: 'Thiết bị kết nối lại',
  register_device: 'Đăng ký thiết bị',
  update_device: 'Cập nhật thiết bị',
  remove_device: 'Vô hiệu hóa thiết bị',
  assign_device: 'Gán thiết bị vào phòng',
  device_enable: 'Bật thiết bị',
  device_disable: 'Tắt thiết bị',
  configure_face_server: 'Cấu hình máy chủ nhận diện khuôn mặt',
  configure_ai: 'Cấu hình AI',
  resolve_fault: 'Xử lý sự cố thiết bị',
  confirm_fault: 'Xác nhận sự cố thiết bị',
  system_config_update: 'Cập nhật cấu hình hệ thống',
  update_config: 'Cập nhật cấu hình hệ thống',
  no_show_config_update: 'Cập nhật cấu hình vắng mặt',
  early_vacancy_config_update: 'Cập nhật cấu hình trả phòng sớm',
  channel_map_config_update: 'Cập nhật ánh xạ kênh camera',
  ivss_presence_config_update: 'Cập nhật cấu hình hiện diện IVSS',
  security_alert_config_update: 'Cập nhật cấu hình cảnh báo an ninh',
  create_meeting: 'Tạo cuộc họp',
  start_meeting: 'Bắt đầu cuộc họp',
  end_meeting: 'Kết thúc cuộc họp',
  cancel_meeting: 'Hủy cuộc họp',
  meeting_cancel: 'Hủy cuộc họp',
  extend_meeting: 'Gia hạn cuộc họp',
  extend_meeting_pending: 'Yêu cầu gia hạn cuộc họp chờ duyệt',
  extend_meeting_reject: 'Từ chối gia hạn cuộc họp',
  extend_meeting_auto_rejected: 'Gia hạn cuộc họp bị tự động từ chối',
  meeting_request_approve: 'Duyệt yêu cầu đặt phòng họp',
  update_requested: 'Gửi yêu cầu cập nhật cuộc họp',
  update_room_requested: 'Gửi yêu cầu đổi phòng họp',
  update_room: 'Đổi phòng họp',
  add_participant: 'Thêm người tham gia',
  remove_participant: 'Xóa người tham gia',
  add_external_participant: 'Thêm khách mời bên ngoài',
  remove_external_participant: 'Xóa khách mời bên ngoài',
  import_participants: 'Nhập danh sách người tham gia',
  meeting_invitation_sent: 'Gửi lời mời họp',
  meeting_reminder_sent: 'Gửi nhắc lịch họp',
  meeting_reminder_scheduled: 'Lên lịch nhắc họp',
  meeting_cancellation_notification_resent: 'Gửi lại thông báo hủy họp',
  agenda_saved: 'Lưu chương trình họp',
  agenda_item_updated: 'Cập nhật mục chương trình họp',
  agenda_item_deleted: 'Xóa mục chương trình họp',
  meeting_agenda_attachment_uploaded: 'Tải lên tệp chương trình họp',
  meeting_agenda_attachment_deleted: 'Xóa tệp chương trình họp',
  no_show_manual_release: 'Giải phóng phòng vắng mặt thủ công',
  meeting_minutes_draft_created: 'Tạo bản nháp biên bản họp',
  meeting_minutes_updated: 'Cập nhật biên bản họp',
  meeting_minutes_issued: 'Ban hành biên bản họp',
  meeting_minutes_distributed: 'Phân phối biên bản họp',
  meeting_minutes_deleted: 'Xóa biên bản họp',
  meeting_minutes_exported: 'Xuất biên bản họp',
  meeting_minutes_shared: 'Chia sẻ biên bản họp',
  meeting_minutes_unshared: 'Hủy chia sẻ biên bản họp',
  meeting_minutes_live_share_toggled: 'Bật/tắt chia sẻ trực tiếp biên bản họp',
  meeting_minutes_resources_linked: 'Liên kết tài liệu vào biên bản họp',
  meeting_minutes_attachment_uploaded: 'Tải lên tệp đính kèm biên bản họp',
  meeting_minutes_attachment_deleted: 'Xóa tệp đính kèm biên bản họp',
  checkin_alert_sent: 'Gửi nhắc điểm danh',
  checkin_alert_skipped: 'Bỏ qua nhắc điểm danh',
  create_manual_attendance: 'Điểm danh thủ công',
  update_attendance_status: 'Cập nhật trạng thái điểm danh',
  update_attendance_record: 'Cập nhật bản ghi điểm danh',
  invalidate_attendance: 'Hủy bản ghi điểm danh',
  export_attendance: 'Xuất dữ liệu điểm danh',
  'biometric.upload': 'Tải lên dữ liệu khuôn mặt',
  'biometric.download': 'Tải xuống dữ liệu khuôn mặt',
  'biometric.approve': 'Duyệt dữ liệu khuôn mặt',
  'biometric.reject': 'Từ chối dữ liệu khuôn mặt',
  'biometric.delete': 'Xóa dữ liệu khuôn mặt',
  'biometric.import_upload': 'Nhập hàng loạt dữ liệu khuôn mặt',
  'biometric.auto_revoked_on_role_downgrade': 'Tự động thu hồi dữ liệu khuôn mặt khi hạ vai trò',
  visitor_visit_create: 'Tạo lượt khách đến',
  'visitor visit create': 'Tạo lượt khách đến',
  'visitor visit approve': 'Duyệt lượt khách',
  'visitor visit check in': 'Khách vào khuôn viên',
  'visitor visit check out': 'Khách rời khuôn viên',
  'visitor visit reassign host': 'Đổi người tiếp khách',
  'visitor visit revoke': 'Thu hồi quyền ra vào của khách',
  'visitor.visit.create': 'Tạo lượt khách đến',
  'visitor.visit.approve': 'Duyệt lượt khách',
  'visitor.visit.check_in': 'Khách vào khuôn viên',
  'visitor.visit.check_out': 'Khách rời khuôn viên',
  'visitor.visit.reassign_host': 'Đổi người tiếp khách',
  'visitor.visit.revoke': 'Thu hồi quyền ra vào của khách',
  guest_invite_issued: 'Gửi lời mời khách',
  guest_invite_resent: 'Gửi lại lời mời khách',
  guest_admitted: 'Cho khách vào',
  guest_rejected: 'Từ chối khách',
  guest_access_revoked: 'Thu hồi quyền truy cập của khách',
  guest_otp_requested: 'Khách yêu cầu mã OTP',
  guest_otp_verified: 'Khách xác thực OTP thành công',
  guest_otp_verify_failed: 'Khách xác thực OTP thất bại',
  export_vehicle_report: 'Xuất báo cáo phương tiện',
  export_security_alert_report: 'Xuất báo cáo cảnh báo an ninh',
  export_room_utilization_report: 'Xuất báo cáo sử dụng phòng',
  export_meeting_activity_report: 'Xuất báo cáo hoạt động họp',
  export_gate_access_report: 'Xuất báo cáo ra vào cổng',
  report_center_export: 'Xuất báo cáo từ Trung tâm báo cáo',
  notification_failure: 'Gửi thông báo thất bại',
  notification_enqueue_failed: 'Xếp hàng thông báo thất bại',
  read_analytics_dashboard_overview: 'Xem thống kê tổng quan',
  read_analytics_room_dashboard: 'Xem thống kê bảng điều khiển phòng',
  read_analytics_room_detail: 'Xem thống kê chi tiết phòng',
  read_analytics_room_utilization_rate: 'Xem thống kê tỷ lệ sử dụng phòng',
  read_analytics_on_time_rate: 'Xem thống kê tỷ lệ đúng giờ',
  read_analytics_on_time_rate_users: 'Xem thống kê tỷ lệ đúng giờ theo người dùng',
  read_analytics_on_time_rate_me: 'Xem thống kê tỷ lệ đúng giờ của tôi',
  read_analytics_on_time_rate_late_history: 'Xem thống kê lịch sử đi muộn',
  read_analytics_no_show_rate: 'Xem thống kê tỷ lệ vắng mặt',
  read_analytics_meeting_count_by_period: 'Xem thống kê số cuộc họp theo kỳ',
  read_analytics_meeting_cancel_rate: 'Xem thống kê tỷ lệ hủy họp',
  read_analytics_meeting_status_breakdown: 'Xem thống kê trạng thái cuộc họp',
  read_analytics_meeting_average_duration: 'Xem thống kê thời lượng họp trung bình',
  read_analytics_security_alerts_daily_trend: 'Xem thống kê xu hướng cảnh báo an ninh theo ngày',
  read_analytics_audit_activity_hourly: 'Xem thống kê hoạt động hệ thống theo giờ',
};

/** §2.A fallback — từ khóa phổ biến dịch khi actionType không nằm trong bảng trên. */
const ACTION_TYPE_KEYWORD_FALLBACK: Array<[RegExp, string]> = [
  [/\bvisitor visit approve\b/g, 'Duyệt lượt khách'],
  [/\bvisitor visit check in\b/g, 'Khách vào khuôn viên'],
  [/\bvisitor visit check out\b/g, 'Khách rời khuôn viên'],
  [/\bvisitor visit reassign host\b/g, 'Đổi người tiếp khách'],
  [/\bvisitor visit revoke\b/g, 'Thu hồi quyền ra vào của khách'],
  [/\bview detail\b/g, 'Xem chi tiết'],
  [/\bread analytics\b/g, 'Xem thống kê'],
  [/\bexport\b/g, 'Xuất'],
  [/\bcreate\b/g, 'Tạo mới'],
  [/\bupdate\b/g, 'Cập nhật'],
  [/\bdelete\b/g, 'Xóa'],
];

/** §2.B — Chuẩn hóa Loại đối tượng (Entity Type). */
export const ENTITY_TYPE_VN_MAP: Record<string, string> = {
  auth: 'Hệ thống xác thực',
  users: 'Quản lý tài khoản',
  'iot-devices': 'Giám sát thiết bị IoT',
  rooms: 'Quản lý phòng họp',
  'system-configurations': 'Cấu hình hệ thống',
  visitor_visits: 'Quản lý lượt khách',
  visitor_visit: 'Quản lý lượt khách',
  visitors: 'Quản lý khách',
};

/** §2.C — Chuẩn hóa Mức độ nghiêm trọng (Severity). */
export const SEVERITY_VN_MAP: Record<string, string> = {
  info: 'Thành công',
  warning: 'Cảnh báo',
  error: 'Thất bại',
  critical: 'Nghiêm trọng',
};

/**
 * translateActionTypeToVn — tra bảng ACTION_TYPE_VN_MAP (không phân biệt hoa/thường);
 * nếu không khớp, áp dụng fallback §2.A: thường hóa, thay `_`/`-` bằng khoảng trắng,
 * dịch từ khóa phổ biến, viết hoa chữ cái đầu.
 */
export function translateActionTypeToVn(raw: string): string {
  const mapped = ACTION_TYPE_VN_MAP[raw.toLowerCase()];
  if (mapped) return mapped;

  let normalized = raw
    .toLowerCase()
    .replace(/[_.-]+/g, ' ')
    .trim();
  for (const [pattern, replacement] of ACTION_TYPE_KEYWORD_FALLBACK) {
    normalized = normalized.replace(pattern, replacement);
  }
  if (!normalized) return raw;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/** translateEntityTypeToVn — tra bảng ENTITY_TYPE_VN_MAP; giữ nguyên raw nếu không khớp. */
export function translateEntityTypeToVn(raw: string): string {
  return ENTITY_TYPE_VN_MAP[raw.toLowerCase()] ?? raw;
}

/** translateSeverityToVn — tra bảng SEVERITY_VN_MAP; giữ nguyên raw nếu không khớp. */
export function translateSeverityToVn(raw: string): string {
  return SEVERITY_VN_MAP[raw.toLowerCase()] ?? raw;
}
