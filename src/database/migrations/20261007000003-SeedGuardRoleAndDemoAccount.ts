import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedGuardRoleAndDemoAccount20261007000003
  implements MigrationInterface
{
  name = 'SeedGuardRoleAndDemoAccount20261007000003';

  // bcrypt.hash('Abcd1234@', saltRounds=10), same demo password as core demo users.
  private readonly demoPasswordHash =
    '$2b$10$szGAzI6OAO0nxSI4OSsCuuwQVvan0AJW2XjzvMlHb2VeNGgBusgm6';

  private readonly guardUser = {
    username: 'guard.demo',
    email: 'guard@meetingsys.vn',
    employeeCode: 'BV001',
    fullName: 'Nguyen Van Bao Ve',
    positionTitle: 'Nhan vien bao ve',
    deptCode: 'OPS',
    roleCode: 'GUARD',
  };

  private readonly guardPermissions = [
    {
      code: 'gate.access.monitor',
      name: 'Truc giam sat cong ra vao',
      module: 'gate_access',
      action: 'monitor',
    },
    {
      code: 'gate.access.read',
      name: 'Xem nhat ky ra vao cong',
      module: 'gate_access',
      action: 'read',
    },
    {
      code: 'gate.access.alert.handle',
      name: 'Xu ly canh bao ra vao cong',
      module: 'gate_access',
      action: 'handle_alert',
    },
  ];

  private readonly sharedPermissionCodes = [
    'notification.read.self',
    'notification.update.self',
    'profile.biometric.read_status',
    'profile.biometric.submit',
    'profile.avatar.update',
    'department.read',
    'account.user.read.detail',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.ensureGuardRole(queryRunner);
    await this.insertGuardUser(queryRunner);
    await this.assignGuardRole(queryRunner);
    await this.seedGuardPermissions(queryRunner);
    await this.grantSharedPermissions(queryRunner);
  }

  private async ensureGuardRole(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO roles (role_code, role_name, description, is_system_role, is_active)
       SELECT 'GUARD'::varchar, 'Bao ve'::varchar,
              'Vai tro bao ve dung cho dashboard truc cong va xu ly canh bao ra vao.'::text,
              true, true
       WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_code = 'GUARD');`,
    );
  }

  private async insertGuardUser(queryRunner: QueryRunner): Promise<void> {
    const user = this.guardUser;
    await queryRunner.query(
      `INSERT INTO users (
         employee_code, username, email, password_hash, full_name, position_title,
         department_id, direct_manager_id, employment_status, account_status,
         must_change_password
       )
       SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::varchar,
              COALESCE(
                (SELECT id FROM departments WHERE department_code = $7),
                (SELECT id FROM departments WHERE department_code = 'IT'),
                (SELECT id FROM departments ORDER BY id ASC LIMIT 1)
              ), NULL,
              'active', 'active', false
       WHERE NOT EXISTS (
         SELECT 1 FROM users
         WHERE lower(username) = lower($2)
            OR lower(email) = lower($3)
            OR employee_code = $1
       );`,
      [
        user.employeeCode,
        user.username,
        user.email,
        this.demoPasswordHash,
        user.fullName,
        user.positionTitle,
        user.deptCode,
      ],
    );
  }

  private async assignGuardRole(queryRunner: QueryRunner): Promise<void> {
    const sysAdminRow = (await queryRunner.query(
      `SELECT id FROM users WHERE lower(username) = 'sysadmin';`,
    )) as Array<{ id: string }>;
    const assignedBy = sysAdminRow[0]?.id ?? null;

    await queryRunner.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by, is_active)
       SELECT u.id, r.id, $3, true
       FROM users u, roles r
       WHERE lower(u.username) = lower($1) AND r.role_code = $2
         AND NOT EXISTS (
           SELECT 1 FROM user_roles ur
           WHERE ur.user_id = u.id AND ur.role_id = r.id AND ur.is_active = true
         );`,
      [this.guardUser.username, this.guardUser.roleCode, assignedBy],
    );
  }

  private async seedGuardPermissions(queryRunner: QueryRunner): Promise<void> {
    for (const permission of this.guardPermissions) {
      await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $2::text, true
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = $1);`,
        [
          permission.code,
          permission.name,
          permission.module,
          permission.action,
        ],
      );
      await this.grantPermissionToRole(queryRunner, 'GUARD', permission.code);
    }
  }

  private async grantSharedPermissions(
    queryRunner: QueryRunner,
  ): Promise<void> {
    for (const code of this.sharedPermissionCodes) {
      await this.grantPermissionToRole(queryRunner, 'GUARD', code);
    }
  }

  private async grantPermissionToRole(
    queryRunner: QueryRunner,
    roleCode: string,
    permissionCode: string,
  ): Promise<void> {
    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW()
       FROM roles r, permissions p
       WHERE r.role_code = $1
         AND r.is_active = true
         AND p.permission_code = $2
         AND p.is_active = true
         AND NOT EXISTS (
           SELECT 1 FROM role_permissions rp
           WHERE rp.role_id = r.id AND rp.permission_id = p.id
         );`,
      [roleCode, permissionCode],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const customPermissionCodes = this.guardPermissions.map((p) => p.code);

    await queryRunner.query(
      `DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE lower(username) = lower($1));`,
      [this.guardUser.username],
    );
    await queryRunner.query(
      `DELETE FROM users WHERE lower(username) = lower($1);`,
      [this.guardUser.username],
    );
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE role_id IN (SELECT id FROM roles WHERE role_code = 'GUARD')
          OR permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1));`,
      [customPermissionCodes],
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code = ANY($1);`,
      [customPermissionCodes],
    );
    await queryRunner.query(`DELETE FROM roles WHERE role_code = 'GUARD';`);
  }
}
