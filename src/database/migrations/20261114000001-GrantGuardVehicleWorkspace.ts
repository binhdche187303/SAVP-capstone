import { MigrationInterface, QueryRunner } from 'typeorm';

/** Let guards use all three gate-control tabs and load their camera/user lookups. */
export class GrantGuardVehicleWorkspace20261114000001 implements MigrationInterface {
  name = 'GrantGuardVehicleWorkspace20261114000001';

  private readonly grants = [
    ['7e261114-0001-4000-8000-000000000001', 'anpr.vehicle.unknown_view'],
    ['7e261114-0001-4000-8000-000000000002', 'vehicle_alert.read'],
    ['7e261114-0001-4000-8000-000000000003', 'anpr.vehicle.admin_register'],
    ['7e261114-0001-4000-8000-000000000004', 'accounts.user.list'],
    ['7e261114-0001-4000-8000-000000000005', 'iot.device.read'],
  ];

  async up(q: QueryRunner): Promise<void> {
    const codes = this.grants.map(([, code]) => code);
    const permissions = await q.query(
      `SELECT permission_code FROM permissions WHERE permission_code = ANY($1::text[]) AND is_active = true`,
      [codes],
    );
    if (permissions.length !== codes.length) {
      throw new Error('Missing required permissions for the guard vehicle workspace');
    }
    for (const [id, code] of this.grants) {
      await q.query(
        `INSERT INTO role_permissions (id, role_id, permission_id, granted_at)
         SELECT $1::uuid, r.id, p.id, NOW()
           FROM roles r CROSS JOIN permissions p
          WHERE r.role_code = 'GUARD' AND r.is_active = true
            AND p.permission_code = $2 AND p.is_active = true
            AND NOT EXISTS (
              SELECT 1 FROM role_permissions rp
               WHERE rp.role_id = r.id AND rp.permission_id = p.id
            )`,
        [id, code],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    // Only undo rows this migration inserted; preserve previously granted permissions.
    await q.query(
      `DELETE FROM role_permissions
        WHERE id = ANY($1::uuid[])
          AND role_id IN (SELECT id FROM roles WHERE role_code = 'GUARD')`,
      [this.grants.map(([id]) => id)],
    );
  }
}
