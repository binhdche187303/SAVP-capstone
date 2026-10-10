import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * VIS-BE-001 §7.3 — 5 quyền của phân hệ Khách. Khuôn: 20260825000001-SeedBiometricDeletePermission
 * (idempotent; chỉ gắn cho role đang tồn tại và is_active).
 */
export class SeedVisitorPermissions20261012000003 implements MigrationInterface {
  name = 'SeedVisitorPermissions20261012000003';

  private readonly entries: Array<{ code: string; name: string; action: string; roles: string[] }> = [
    { code: 'visitor.visit.read', name: 'Xem danh sách và chi tiết lượt khách', action: 'read', roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN', 'GUARD'] },
    { code: 'visitor.visit.manage', name: 'Duyệt, từ chối, thu hồi, gia hạn, đóng lượt khách', action: 'manage', roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'] },
    { code: 'visitor.desk.use', name: 'Dùng quầy lễ tân khách (đăng ký vãng lai, check-in/out, chụp ảnh)', action: 'use', roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN', 'GUARD'] },
    { code: 'visitor.stats.read', name: 'Xem thống kê khách', action: 'read', roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'] },
    { code: 'visitor.host.self', name: 'Quản lý khách của chính mình (người được gặp)', action: 'self', roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN', 'MANAGER', 'EMPLOYEE', 'TEACHER'] },
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const e of this.entries) {
      await q.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, 'visitors', $3::varchar, $2::text, true
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = $1);`,
        [e.code, e.name, e.action],
      );
      const rows = (await q.query(`SELECT id FROM permissions WHERE permission_code = $1;`, [e.code])) as Array<{ id: string }>;
      const permissionId = rows[0]?.id;
      if (!permissionId) continue;
      for (const roleCode of e.roles) {
        await q.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_at)
           SELECT r.id, $2::uuid, NOW() FROM roles r
           WHERE r.role_code = $1 AND r.is_active = true
             AND NOT EXISTS (SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = $2::uuid);`,
          [roleCode, permissionId],
        );
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const codes = this.entries.map((e) => e.code);
    await q.query(`DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1));`, [codes]);
    await q.query(`DELETE FROM permissions WHERE permission_code = ANY($1);`, [codes]);
  }
}
