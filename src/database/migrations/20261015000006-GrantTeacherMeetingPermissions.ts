import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Giảng viên cũng là cán bộ: được mời họp, đặt phòng họp, xem/soạn biên bản, tài liệu họp,
 * báo hỏng thiết bị như Nhân viên. Gán cho TEACHER các quyền cuộc họp mà EMPLOYEE đang có.
 * Không gán: dashboard nhân viên, Hành trình (zones), nhật ký ra/vào phòng — Giảng viên không có các trang đó.
 * Chỉ GÁN quyền đã có sẵn, không tạo quyền mới. "Khách của tôi" dùng visitor.host.self — TEACHER đã có.
 */
export class GrantTeacherMeetingPermissions20261015000006 implements MigrationInterface {
  name = 'GrantTeacherMeetingPermissions20261015000006';

  private readonly codes = [
    // Điểm danh trong cuộc họp
    'attendance.manual.create',
    'attendance.manual.update',
    'attendance.read',
    // Thiết bị phòng họp
    'equipment.read',
    'equipment.report_fault',
    'iot.device.read',
    'ivss.presence.read',
    // Cuộc họp
    'meeting.cancel.own',
    'meeting.create',
    'meeting.extension.request.own',
    'meeting.guest.admit',
    'meeting.guest.invite.manage',
    'meeting.guest.session.read',
    'meeting.note.create',
    'meeting.note.read',
    'meeting.participant.add.internal',
    'meeting.participant.import',
    'meeting.participant.remove',
    'meeting.presence.read',
    'meeting.session.end',
    'meeting.session.start',
    'meeting.time.update',
    'meeting.timeline.read',
    'meeting.update.own',
    // Biên bản
    'meeting.minutes.ai_draft.create',
    'meeting.minutes.attachment.create',
    'meeting.minutes.attachment.delete',
    'meeting.minutes.attachment.read',
    'meeting.minutes.create',
    'meeting.minutes.delete',
    'meeting.minutes.export',
    'meeting.minutes.issue',
    'meeting.minutes.link_resources',
    'meeting.minutes.read',
    'meeting.minutes.share.create',
    'meeting.minutes.share.delete',
    'meeting.minutes.share.read',
    'meeting.minutes.update',
    'minutes.distribute',
    // Thông báo cuộc họp
    'notification.cancellation.send',
    'notification.invite.send',
    'notification.reminder.send',
    'notification.update.self',
    // Ghi hình / tài liệu họp
    'recording.config.create',
    'recording.config.read',
    'recording.config.update',
    'recording.files.manage',
    'recording.files.play',
    'recording.files.read',
    'recording.upload_track',
    'recording.video.start',
    'recording.video.status',
    'recording.video.stop',
    // Lập lịch
    'scheduling.conflict.participant.check',
    'scheduling.suggest.rooms',
    'scheduling.suggest.times',
    // Transcript
    'transcript.create',
    'transcript.read',
    'transcript.speaker_tag',
    'transcript.update',
  ];

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW() FROM roles r CROSS JOIN permissions p
       WHERE r.role_code = 'TEACHER' AND r.is_active = true AND p.permission_code = ANY($1)
         AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);`,
      [this.codes],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM role_permissions
       WHERE role_id IN (SELECT id FROM roles WHERE role_code = 'TEACHER')
         AND permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1));`,
      [this.codes],
    );
  }
}
