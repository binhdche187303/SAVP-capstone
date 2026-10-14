import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nghiệp vụ an ninh (ANPR, cảnh báo, người lạ, danh sách kiểm soát…) chuyển từ menu SYSTEM_ADMIN
 * sang BUSINESS_ADMIN (vận hành). BA đã có gần đủ quyền — chỉ thiếu xem người lạ. Chỉ GÁN quyền có sẵn;
 * SYSTEM_ADMIN giữ nguyên quyền (không còn trong menu nhưng vẫn truy cập được khi cần hỗ trợ kỹ thuật).
 */
export class GrantBusinessAdminSecurityOperations20261015000002 implements MigrationInterface {
  name = 'GrantBusinessAdminSecurityOperations20261015000002';

  private readonly codes = ['face.stranger.read'];

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW() FROM roles r CROSS JOIN permissions p
       WHERE r.role_code = 'BUSINESS_ADMIN' AND r.is_active = true AND p.permission_code = ANY($1)
         AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);`,
      [this.codes],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM role_permissions
       WHERE role_id IN (SELECT id FROM roles WHERE role_code = 'BUSINESS_ADMIN')
         AND permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1));`,
      [this.codes],
    );
  }
}
