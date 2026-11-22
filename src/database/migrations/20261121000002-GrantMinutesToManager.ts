import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MANAGER có menu "Kho biên bản" và tab biên bản trong chi tiết cuộc họp nhưng không có quyền
 * biên bản nào (EMPLOYEE/TEACHER có đủ). Trưởng đơn vị hiện chỉ mang 1 vai trò MANAGER nên
 * không được bù từ vai trò khác → menu bị ẩn, tab biên bản lỗi 403. Cấp cùng bộ quyền như EMPLOYEE.
 */
const CODES = [
  'meeting.minutes.read', 'meeting.minutes.create', 'meeting.minutes.update', 'meeting.minutes.delete',
  'meeting.minutes.issue', 'meeting.minutes.export', 'meeting.minutes.ai_draft.create',
  'meeting.minutes.link_resources', 'meeting.minutes.attachment.read', 'meeting.minutes.attachment.create',
  'meeting.minutes.attachment.delete', 'meeting.minutes.share.read', 'meeting.minutes.share.create',
  'meeting.minutes.share.delete', 'minutes.distribute',
];

export class GrantMinutesToManager20261121000002 implements MigrationInterface {
  name = 'GrantMinutesToManager20261121000002';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW() FROM roles r, permissions p
        WHERE r.role_code = 'MANAGER' AND p.permission_code = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM role_permissions x
                           WHERE x.role_id = r.id AND x.permission_id = p.id)`,
      [CODES],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM role_permissions
        WHERE role_id IN (SELECT id FROM roles WHERE role_code = 'MANAGER')
          AND permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1))`,
      [CODES],
    );
  }
}
