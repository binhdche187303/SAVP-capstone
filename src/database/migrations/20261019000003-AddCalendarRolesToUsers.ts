import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lịch tuần UEL — gán vai trò lịch trên tài khoản (không tạo role mới):
 * - users.is_unit_clerk: văn thư của đơn vị (users.department_id).
 * - users.leadership_title: thành viên Ban Giám hiệu (HIEU_TRUONG | PHO_HIEU_TRUONG | BI_THU ...).
 * - system_configs meeting.school_approver_department_id: đơn vị duyệt lịch cấp trường (P.HC).
 * - Quyền meeting.calendar_role.manage → BUSINESS_ADMIN.
 */
export class AddCalendarRolesToUsers20261019000003 implements MigrationInterface {
  name = 'AddCalendarRolesToUsers20261019000003';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_unit_clerk boolean NOT NULL DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS leadership_title varchar(30) NULL;
    `);
    await q.query(
      `INSERT INTO system_configs (config_key, config_value, value_type, config_group, description, is_sensitive, is_active, version_no)
       SELECT $1::varchar, (SELECT id::text FROM departments WHERE department_code = 'QL01' AND deleted_at IS NULL LIMIT 1),
              'string', 'meeting', $2::text, false, true, 1
       WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE config_key = $1);`,
      ['meeting.school_approver_department_id', 'Đơn vị duyệt lịch lãnh đạo trường và lịch hoạt động khác'],
    );
    await q.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       SELECT 'meeting.calendar_role.manage', $1::varchar, 'meeting', 'manage', $2::text, true
       WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'meeting.calendar_role.manage');`,
      ['Cấu hình vai trò lịch họp', 'Gán văn thư đơn vị, Ban Giám hiệu, đơn vị duyệt lịch cấp trường'],
    );
    await q.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW() FROM roles r, permissions p
       WHERE r.role_code = 'BUSINESS_ADMIN' AND p.permission_code = 'meeting.calendar_role.manage'
         AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id);`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = 'meeting.calendar_role.manage');
      DELETE FROM permissions WHERE permission_code = 'meeting.calendar_role.manage';
      DELETE FROM system_configs WHERE config_key = 'meeting.school_approver_department_id';
      ALTER TABLE users DROP COLUMN IF EXISTS leadership_title;
      ALTER TABLE users DROP COLUMN IF EXISTS is_unit_clerk;
    `);
  }
}
