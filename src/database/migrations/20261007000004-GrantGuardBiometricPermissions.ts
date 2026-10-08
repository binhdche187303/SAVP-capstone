import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrantGuardBiometricPermissions20261007000004
  implements MigrationInterface
{
  name = 'GrantGuardBiometricPermissions20261007000004';

  private readonly permissionCodes = [
    'notification.read.self',
    'notification.update.self',
    'profile.biometric.read_status',
    'profile.biometric.submit',
    'profile.avatar.update',
    'department.read',
    'account.user.read.detail',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const code of this.permissionCodes) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, p.id, NOW()
         FROM roles r, permissions p
         WHERE r.role_code = 'GUARD'
           AND r.is_active = true
           AND p.permission_code = $1
           AND p.is_active = true
           AND NOT EXISTS (
             SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = r.id AND rp.permission_id = p.id
           );`,
        [code],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions rp
       USING roles r, permissions p
       WHERE rp.role_id = r.id
         AND rp.permission_id = p.id
         AND r.role_code = 'GUARD'
         AND p.permission_code = ANY($1::varchar[]);`,
      [this.permissionCodes],
    );
  }
}
