import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dọn quyền thừa: gỡ quyền mà vai trò đang có nhưng không trang nào trong menu của vai trò
 * đó gọi tới. Đã đối chiếu theo từng API mà các trang của vai trò thực sự gọi (không chỉ theo
 * tên màn hình); quyền còn được dùng ở dashboard, popup, modal dùng chung... được giữ lại.
 *
 * Bật thêm:
 * - STUDENT notification.update.self: màn Thông báo của sinh viên có nút "đánh dấu đã đọc".
 * - BUSINESS_ADMIN meeting.time.update.any: BE nay đã kiểm quyền override này (trước chỉ có
 *   tên trong DB), đi cùng meeting.session.end.any mà BA đang có.
 *
 * down() trả lại đúng các dòng đã gỡ và bỏ các dòng đã bật.
 */
const REMOVE: Record<string, string[]> = {
  BUSINESS_ADMIN: [
    'alert_rules.create', 'alert_rules.delete', 'alert_rules.read',
    'alert_rules.update', 'anpr.vehicle.admin_delete', 'anpr.vehicle.admin_read',
    'anpr.vehicle.history_view', 'anpr.vehicle.unknown_view', 'campus_dashboard.employee_summary.read',
    'hgvision.camera.read', 'iot.camera_group.manage', 'iot.camera_group.read',
    'meeting.create', 'meeting.minutes.search_by_person', 'meeting_request.read',
    'notification.invite.send', 'person_control_list.create', 'person_control_list.delete',
    'person_control_list.read', 'person_control_list.update', 'recording.files.play',
    'scheduling.suggest.rooms', 'scheduling.suggest.times', 'security_alert.acknowledge',
    'security_alert.read', 'security_alert.resolve', 'vehicle_alert.read',
    'vehicle_control.create', 'vehicle_control.delete', 'vehicle_control.read',
    'vehicle_control.update', 'zones.zone.assign_device', 'zones.zone.create',
    'zones.zone.delete', 'zones.zone.update',
  ],
  EMPLOYEE: ['zones.zone.read'],
  GUARD: ['anpr.vehicle.admin_register'],
  MANAGER: [
    'account.partner.import', 'account.partner.manage', 'alert_rules.read',
    'campus_dashboard.employee_summary.read', 'campus_dashboard.overview.read', 'campus_dashboard.timeline.read',
    'department.create', 'department.deactivate', 'department.update',
    'gate_access.history.read_all', 'gate_access.stats.read', 'iot.camera_group.read',
    'iot.device.check_availability', 'iot.device.disable', 'iot.device.enable',
    'iot.device.probe', 'iot.device.update', 'person_control_list.read',
    'room.booking.read', 'room.noshow.read', 'room.utilization.read',
    'security_alert.acknowledge', 'security_alert.read', 'security_alert.resolve',
    'vehicle_alert.read', 'vehicle_control.read',
  ],
  STUDENT: ['ivss.presence.read', 'schedule.read.self', 'visitor.host.self'],
  SYSTEM_ADMIN: [
    'account.biometric.download', 'account.biometric.review', 'analytics.meeting.read',
    'analytics.overview.read', 'attendance.invalidate', 'attendance.manual.update',
    'campus_dashboard.employee_summary.read', 'campus_dashboard.manager_summary.read', 'class.attendance.stats.read',
    'department.create', 'department.deactivate', 'department.update',
    'equipment.assign', 'equipment.confirm_fault', 'equipment.create',
    'equipment.delete', 'equipment.read', 'equipment.report_fault',
    'equipment.resolve_fault', 'hgvision.camera.read', 'ivss.presence.read',
    'meeting.cancel.any', 'meeting.cancel.own', 'meeting.create',
    'meeting.extension.request.own', 'meeting.guest.admit', 'meeting.guest.invite.manage',
    'meeting.guest.session.read', 'meeting.minutes.ai_draft.create', 'meeting.minutes.attachment.create',
    'meeting.minutes.attachment.delete', 'meeting.minutes.attachment.read', 'meeting.minutes.create',
    'meeting.minutes.delete', 'meeting.minutes.export', 'meeting.minutes.issue',
    'meeting.minutes.link_resources', 'meeting.minutes.read', 'meeting.minutes.search_by_person',
    'meeting.minutes.share.create', 'meeting.minutes.share.delete', 'meeting.minutes.share.read',
    'meeting.minutes.update', 'meeting.note.create', 'meeting.note.read',
    'meeting.participant.add.external', 'meeting.participant.add.internal', 'meeting.participant.import',
    'meeting.participant.override_capacity', 'meeting.participant.remove', 'meeting.participant.remove.external',
    'meeting.presence.read', 'meeting.read.all', 'meeting.room.update',
    'meeting.session.end', 'meeting.session.end.any', 'meeting.session.extension.decide',
    'meeting.session.extension.override', 'meeting.session.start', 'meeting.time.update',
    'meeting.time.update.any', 'meeting.timeline.read', 'meeting.update.own',
    'meeting_request.approve', 'meeting_request.read', 'meeting_request.reject',
    'minutes.distribute', 'notification.cancellation.send', 'notification.invite.send',
    'notification.reminder.send', 'recording.config.create', 'recording.config.read',
    'recording.config.update', 'recording.files.manage', 'recording.files.play',
    'recording.files.read', 'recording.upload_track', 'recording.video.start',
    'recording.video.status', 'recording.video.stop', 'room.create',
    'room.delete', 'room.noshow.release', 'room.noshow.update',
    'room.update', 'room.utilization.read', 'schedule.read.self',
    'scheduling.conflict.participant.check', 'scheduling.suggest.rooms', 'scheduling.suggest.times',
    'transcript.create', 'transcript.read', 'transcript.speaker_tag',
    'transcript.update',
  ],
};

const ADD: Record<string, string[]> = {
  STUDENT: ['notification.update.self'],
  BUSINESS_ADMIN: ['meeting.time.update.any'],
};

const pairs = (m: Record<string, string[]>): [string, string][] =>
  Object.entries(m).flatMap(([role, codes]) =>
    codes.map((code): [string, string] => [role, code]),
  );

async function grant(q: QueryRunner, m: Record<string, string[]>): Promise<void> {
  for (const [role, code] of pairs(m)) {
    await q.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW() FROM roles r, permissions p
        WHERE r.role_code = $1 AND p.permission_code = $2
          AND NOT EXISTS (SELECT 1 FROM role_permissions x
                           WHERE x.role_id = r.id AND x.permission_id = p.id)`,
      [role, code],
    );
  }
}

async function revoke(q: QueryRunner, m: Record<string, string[]>): Promise<void> {
  for (const [role, code] of pairs(m)) {
    await q.query(
      `DELETE FROM role_permissions
        WHERE role_id IN (SELECT id FROM roles WHERE role_code = $1)
          AND permission_id IN (SELECT id FROM permissions WHERE permission_code = $2)`,
      [role, code],
    );
  }
}

export class PrunePermissionsWithoutScreens20261121000001 implements MigrationInterface {
  name = 'PrunePermissionsWithoutScreens20261121000001';

  public async up(q: QueryRunner): Promise<void> {
    await revoke(q, REMOVE);
    await grant(q, ADD);
  }

  public async down(q: QueryRunner): Promise<void> {
    await revoke(q, ADD);
    await grant(q, REMOVE);
  }
}
