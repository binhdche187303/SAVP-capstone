import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ban Giám hiệu (users.leadership_title) dùng role MANAGER thay cho EMPLOYEE:
 * vào giao diện quản lý, vẫn dự họp/chủ trì được; phạm vi toàn trường do cờ leadership_title quyết định.
 * Hiển thị "Ban Giám hiệu" thay nhãn role ở FE (getCalendarRoleLabel).
 */
export class BghUseManagerRole20261019000012 implements MigrationInterface {
  name = 'BghUseManagerRole20261019000012';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO user_roles (user_id, role_id, assigned_at, is_active)
      SELECT u.id, r.id, NOW(), true
        FROM users u JOIN roles r ON r.role_code = 'MANAGER'
       WHERE u.leadership_title IS NOT NULL AND u.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = u.id AND x.role_id = r.id);
      UPDATE user_roles ur SET is_active = true
        FROM users u, roles r
       WHERE ur.user_id = u.id AND ur.role_id = r.id AND r.role_code = 'MANAGER'
         AND u.leadership_title IS NOT NULL AND NOT ur.is_active;
      UPDATE user_roles ur SET is_active = false
        FROM users u, roles r
       WHERE ur.user_id = u.id AND ur.role_id = r.id AND r.role_code = 'EMPLOYEE'
         AND u.leadership_title IS NOT NULL AND ur.is_active;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE user_roles ur SET is_active = true
        FROM users u, roles r
       WHERE ur.user_id = u.id AND ur.role_id = r.id AND r.role_code = 'EMPLOYEE' AND u.leadership_title IS NOT NULL;
      UPDATE user_roles ur SET is_active = false
        FROM users u, roles r
       WHERE ur.user_id = u.id AND ur.role_id = r.id AND r.role_code = 'MANAGER' AND u.leadership_title IS NOT NULL;
    `);
  }
}
