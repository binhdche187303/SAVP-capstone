import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedTeacherStudentDemoAccounts20261007000002
  implements MigrationInterface
{
  name = 'SeedTeacherStudentDemoAccounts20261007000002';

  // bcrypt.hash('Abcd1234@', saltRounds=10), same demo password as core demo users.
  private readonly demoPasswordHash =
    '$2b$10$szGAzI6OAO0nxSI4OSsCuuwQVvan0AJW2XjzvMlHb2VeNGgBusgm6';

  private readonly users = [
    {
      username: 'teacher.demo',
      email: 'teacher@meetingsys.vn',
      employeeCode: 'GV001',
      fullName: 'Nguyen Thi Giang',
      positionTitle: 'Giang vien',
      deptCode: 'IT',
      roleCode: 'TEACHER',
    },
    {
      username: 'student.demo',
      email: 'student@meetingsys.vn',
      employeeCode: 'SV001',
      fullName: 'Le Minh Sinh',
      positionTitle: 'Sinh vien',
      deptCode: 'IT',
      roleCode: 'STUDENT',
    },
  ];

  private readonly classroomPermissions = [
    {
      code: 'class.attendance.manage',
      name: 'Quan ly diem danh lop hoc',
      module: 'classroom',
      action: 'manage_attendance',
      roles: ['TEACHER'],
    },
    {
      code: 'class.attendance.export',
      name: 'Xuat bang chuyen can lop hoc',
      module: 'classroom',
      action: 'export_attendance',
      roles: ['TEACHER'],
    },
    {
      code: 'class.attendance.read.self',
      name: 'Xem chuyen can ca nhan',
      module: 'classroom',
      action: 'read_self_attendance',
      roles: ['STUDENT'],
    },
    {
      code: 'class.attendance.stats.read',
      name: 'Xem thong ke chuyen can lop hoc',
      module: 'classroom',
      action: 'read_attendance_stats',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
  ];

  private readonly sharedPermissionCodes = [
    'notification.read.self',
    'profile.avatar.read_status',
    'profile.avatar.submit',
    'profile.biometric.read_status',
    'profile.biometric.submit',
    'profile.avatar.update',
    'schedule.read.self',
    'department.read',
    'accounts.user.list',
    'account.user.read.detail',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.ensureRoles(queryRunner);
    await this.insertUsers(queryRunner);
    await this.assignUserRoles(queryRunner);
    await this.seedClassroomPermissions(queryRunner);
    await this.grantSharedPermissions(queryRunner);
  }

  private async ensureRoles(queryRunner: QueryRunner): Promise<void> {
    const roles = [
      {
        code: 'TEACHER',
        name: 'Giang vien',
        description:
          'Vai tro giang vien dung cho dashboard lop hoc va diem danh tu dong.',
      },
      {
        code: 'STUDENT',
        name: 'Sinh vien',
        description: 'Vai tro sinh vien dung cho dashboard chuyen can ca nhan.',
      },
    ];

    for (const role of roles) {
      await queryRunner.query(
        `INSERT INTO roles (role_code, role_name, description, is_system_role, is_active)
         SELECT $1::varchar, $2::varchar, $3::text, true, true
         WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_code = $1);`,
        [role.code, role.name, role.description],
      );
    }
  }

  private async insertUsers(queryRunner: QueryRunner): Promise<void> {
    for (const user of this.users) {
      await queryRunner.query(
        `INSERT INTO users (
           employee_code, username, email, password_hash, full_name, position_title,
           department_id, direct_manager_id, employment_status, account_status,
           must_change_password
         )
         SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::varchar,
                (SELECT id FROM departments WHERE department_code = $7), NULL,
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
  }

  private async assignUserRoles(queryRunner: QueryRunner): Promise<void> {
    const sysAdminRow = (await queryRunner.query(
      `SELECT id FROM users WHERE lower(username) = 'sysadmin';`,
    )) as Array<{ id: string }>;
    const assignedBy = sysAdminRow[0]?.id ?? null;

    for (const user of this.users) {
      await queryRunner.query(
        `INSERT INTO user_roles (user_id, role_id, assigned_by, is_active)
         SELECT u.id, r.id, $3, true
         FROM users u, roles r
         WHERE lower(u.username) = lower($1) AND r.role_code = $2
           AND NOT EXISTS (
             SELECT 1 FROM user_roles ur
             WHERE ur.user_id = u.id AND ur.role_id = r.id AND ur.is_active = true
           );`,
        [user.username, user.roleCode, assignedBy],
      );
    }
  }

  private async seedClassroomPermissions(
    queryRunner: QueryRunner,
  ): Promise<void> {
    for (const permission of this.classroomPermissions) {
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

      for (const roleCode of permission.roles) {
        await this.grantPermissionToRole(
          queryRunner,
          roleCode,
          permission.code,
        );
      }
    }
  }

  private async grantSharedPermissions(
    queryRunner: QueryRunner,
  ): Promise<void> {
    for (const code of this.sharedPermissionCodes) {
      await this.grantPermissionToRole(queryRunner, 'TEACHER', code);
      await this.grantPermissionToRole(queryRunner, 'STUDENT', code);
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
    const usernames = this.users.map((user) => user.username.toLowerCase());
    const customPermissionCodes = this.classroomPermissions.map((p) => p.code);

    await queryRunner.query(
      `DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE lower(username) = ANY($1));`,
      [usernames],
    );
    await queryRunner.query(
      `DELETE FROM users WHERE lower(username) = ANY($1);`,
      [usernames],
    );
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE role_id IN (SELECT id FROM roles WHERE role_code IN ('TEACHER', 'STUDENT'))
          OR permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1));`,
      [customPermissionCodes],
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code = ANY($1);`,
      [customPermissionCodes],
    );
  }
}
