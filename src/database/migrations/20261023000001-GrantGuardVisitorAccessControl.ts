import { MigrationInterface, QueryRunner } from 'typeorm';

/** Bảo vệ được gia hạn hoặc thu hồi quyền ra vào, không được mặc nhiên có toàn bộ quyền quản lý lượt. */
export class GrantGuardVisitorAccessControl20261023000001 implements MigrationInterface {
  name = 'GrantGuardVisitorAccessControl20261023000001';

  private readonly entries = [
    ['visitor.visit.extend', 'Gia hạn quyền ra vào lượt khách', 'extend'],
    ['visitor.visit.revoke', 'Thu hồi quyền ra vào lượt khách', 'revoke'],
  ] as const;

  async up(q: QueryRunner): Promise<void> {
    for (const [code, name, action] of this.entries) {
      await q.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, 'visitors', $3::varchar, $2::varchar, true
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = $1::varchar)`,
        [code, name, action],
      );
      await q.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, p.id, NOW() FROM roles r CROSS JOIN permissions p
         WHERE r.role_code = 'GUARD' AND r.is_active = true AND p.permission_code = $1::varchar
           AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)`,
        [code],
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
