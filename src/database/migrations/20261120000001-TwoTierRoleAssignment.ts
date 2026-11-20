import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phân quyền 2 tầng (chốt phương án C):
 * - BUSINESS_ADMIN được gán role nghiệp vụ (accounts.user.update_roles) trong phạm vi đơn vị;
 *   service chặn cấp/gỡ SYSTEM_ADMIN, BUSINESS_ADMIN (chỉ SYSTEM_ADMIN được làm).
 * - Bổ sung MANAGER (assigned_by NULL = hệ thống gán) cho trưởng đơn vị hiện có
 *   (departments.manager_user_id) và Ban Giám hiệu (users.leadership_title).
 */
export class TwoTierRoleAssignment20261120000001 implements MigrationInterface {
  name = 'TwoTierRoleAssignment20261120000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO role_permissions (role_id, permission_id, granted_at)
      SELECT r.id, p.id, NOW() FROM roles r, permissions p
       WHERE r.role_code = 'BUSINESS_ADMIN' AND p.permission_code = 'accounts.user.update_roles'
         AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id);
    `);
    await q.query(`
      WITH leaders AS (
        SELECT u.id FROM users u
         WHERE u.deleted_at IS NULL
           AND (u.leadership_title IS NOT NULL
                OR EXISTS (SELECT 1 FROM departments d
                            WHERE d.manager_user_id = u.id AND d.deleted_at IS NULL))
      )
      INSERT INTO user_roles (user_id, role_id)
      SELECT l.id, r.id FROM leaders l, roles r
       WHERE r.role_code = 'MANAGER'
         AND NOT EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = l.id AND x.role_id = r.id);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM role_permissions
       WHERE role_id IN (SELECT id FROM roles WHERE role_code = 'BUSINESS_ADMIN')
         AND permission_id IN (SELECT id FROM permissions WHERE permission_code = 'accounts.user.update_roles');
    `);
  }
}
