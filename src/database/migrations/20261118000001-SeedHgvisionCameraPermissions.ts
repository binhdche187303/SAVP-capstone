import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quyền cho API camera HGVision (/api/v1/hgvision/*):
 * - hgvision.camera.read: xem camera, tình trạng, nhật ký, live. Bảo vệ xem TẤT CẢ camera (đã chốt).
 * - hgvision.system.read: kiểm tra kết nối + tài nguyên máy chủ HGVision (chỉ quản trị hệ thống).
 */
export class SeedHgvisionCameraPermissions20261118000001 implements MigrationInterface {
  name = 'SeedHgvisionCameraPermissions20261118000001';

  private readonly entries = [
    [
      'hgvision.camera.read',
      'Xem camera HGVision (danh sách, tình trạng, live)',
      'read',
      ['SYSTEM_ADMIN', 'BUSINESS_ADMIN', 'GUARD'],
    ],
    [
      'hgvision.system.read',
      'Xem kết nối và tài nguyên máy chủ HGVision',
      'read',
      ['SYSTEM_ADMIN'],
    ],
  ] as const;

  async up(q: QueryRunner): Promise<void> {
    for (const [code, name, action, roles] of this.entries) {
      await q.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, 'hgvision', $3::varchar, $2::varchar, true
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = $1::varchar)`,
        [code, name, action],
      );
      await q.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, p.id, NOW() FROM roles r CROSS JOIN permissions p
         WHERE r.role_code = ANY($2::varchar[]) AND r.is_active = true AND p.permission_code = $1::varchar
           AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)`,
        [code, [...roles]],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    const codes = this.entries.map(([code]) => code);
    await q.query(
      `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1::varchar[]))`,
      [codes],
    );
    await q.query(
      `DELETE FROM permissions WHERE permission_code = ANY($1::varchar[])`,
      [codes],
    );
  }
}
