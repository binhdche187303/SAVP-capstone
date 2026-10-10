import { MigrationInterface, QueryRunner } from 'typeorm';

/** RPT-CENTER-BE-001 §7 — 3 quyền của Trung tâm báo cáo. Khuôn: 20261012000003-SeedVisitorPermissions. */
export class SeedReportCenterPermissions20261013000002 implements MigrationInterface {
  name = 'SeedReportCenterPermissions20261013000002';

  private readonly entries: Array<{ code: string; name: string; action: string; roles: string[] }> = [
    { code: 'report.center.read', name: 'Xem Trung tâm báo cáo', action: 'read', roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN', 'MANAGER'] },
    { code: 'report.center.export', name: 'Xuất báo cáo PDF/Excel/Word', action: 'export', roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN', 'MANAGER'] },
    { code: 'report.schedule.manage', name: 'Quản lý lịch gửi báo cáo tự động', action: 'manage', roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'] },
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const e of this.entries) {
      await q.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, 'reports', $3::varchar, $2::text, true
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
