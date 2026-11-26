import { MigrationInterface, QueryRunner } from 'typeorm';

/** hgvision.camera.write: thêm camera sang HGVision từ web SAVP (quản trị). */
export class SeedHgvisionCameraWritePermission20261126000001 implements MigrationInterface {
  name = 'SeedHgvisionCameraWritePermission20261126000001';

  private readonly code = 'hgvision.camera.write';
  private readonly roles = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'];

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       SELECT $1::varchar, $2::varchar, 'hgvision', 'write', $2::varchar, true
       WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = $1::varchar)`,
      [this.code, 'Thêm camera sang HGVision'],
    );
    await q.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW() FROM roles r CROSS JOIN permissions p
       WHERE r.role_code = ANY($2::varchar[]) AND r.is_active = true AND p.permission_code = $1::varchar
         AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)`,
      [this.code, this.roles],
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = $1::varchar)`,
      [this.code],
    );
    await q.query(
      `DELETE FROM permissions WHERE permission_code = $1::varchar`,
      [this.code],
    );
  }
}
