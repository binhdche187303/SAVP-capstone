import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Người học cũng có thể là người được gặp trong đăng ký khách.
 * Đồng bộ quyền với luồng tìm host, vốn đã cho phép chọn tài khoản STUDENT.
 */
export class GrantVisitorHostSelfToStudent20261022000001 implements MigrationInterface {
  name = 'GrantVisitorHostSelfToStudent20261022000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW()
       FROM roles r CROSS JOIN permissions p
       WHERE r.role_code = 'STUDENT'
         AND r.is_active = true
         AND p.permission_code = 'visitor.host.self'
         AND p.is_active = true
         AND NOT EXISTS (
           SELECT 1 FROM role_permissions rp
           WHERE rp.role_id = r.id AND rp.permission_id = p.id
         )`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE role_id IN (SELECT id FROM roles WHERE role_code = 'STUDENT')
         AND permission_id IN (SELECT id FROM permissions WHERE permission_code = 'visitor.host.self')`,
    );
  }
}
