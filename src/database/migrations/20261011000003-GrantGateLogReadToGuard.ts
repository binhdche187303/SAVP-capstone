import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrantGateLogReadToGuard20261011000003
  implements MigrationInterface
{
  name = 'GrantGateLogReadToGuard20261011000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW()
         FROM roles r, permissions p
        WHERE r.role_code = 'GUARD'
          AND r.is_active = true
          AND p.permission_code = 'zones.gate_log.read'
          AND p.is_active = true
          AND NOT EXISTS (
            SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = r.id
               AND rp.permission_id = p.id
          );`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions
        WHERE role_id IN (SELECT id FROM roles WHERE role_code = 'GUARD')
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_code = 'zones.gate_log.read'
          );`,
    );
  }
}
