import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quầy đăng ký khách chuyển hẳn cho bảo vệ (GUARD): SYSTEM_ADMIN / BUSINESS_ADMIN thôi `visitor.desk.use`
 * (vẫn xem / quản lý lượt khách qua visit.read + visit.manage). Menu An ninh trả về SYSTEM_ADMIN nên gỡ
 * quyền xem người lạ đã cấp cho BUSINESS_ADMIN ở 20261015000002.
 */
export class RevokeAdminVisitorDeskAndBaStranger20261015000003 implements MigrationInterface {
  name = 'RevokeAdminVisitorDeskAndBaStranger20261015000003';

  private readonly grants: Array<[string, string]> = [
    ['SYSTEM_ADMIN', 'visitor.desk.use'],
    ['BUSINESS_ADMIN', 'visitor.desk.use'],
    ['BUSINESS_ADMIN', 'face.stranger.read'],
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const [role, code] of this.grants) {
      await q.query(
        `DELETE FROM role_permissions
         WHERE role_id IN (SELECT id FROM roles WHERE role_code = $1)
           AND permission_id IN (SELECT id FROM permissions WHERE permission_code = $2);`,
        [role, code],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const [role, code] of this.grants) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, p.id, NOW() FROM roles r CROSS JOIN permissions p
         WHERE r.role_code = $1 AND r.is_active = true AND p.permission_code = $2
           AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);`,
        [role, code],
      );
    }
  }
}
