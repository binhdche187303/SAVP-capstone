import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedTeacherStudentRoles20261007000001
  implements MigrationInterface
{
  name = 'SeedTeacherStudentRoles20261007000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const roles = [
      {
        code: 'TEACHER',
        name: 'Giảng viên',
        description:
          'Vai trò giảng viên dùng cho dashboard lớp học và điểm danh tự động.',
      },
      {
        code: 'STUDENT',
        name: 'Sinh viên',
        description: 'Vai trò sinh viên dùng cho dashboard chuyên cần cá nhân.',
      },
    ];

    for (const role of roles) {
      await queryRunner.query(
        `INSERT INTO "roles" ("role_code", "role_name", "description", "is_system_role", "is_active")
         SELECT $1::varchar, $2::varchar, $3::text, true, true
         WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "role_code" = $1)`,
        [role.code, role.name, role.description],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "user_roles" WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "role_code" IN ('TEACHER', 'STUDENT'))`,
    );
    await queryRunner.query(
      `DELETE FROM "role_permissions" WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "role_code" IN ('TEACHER', 'STUDENT'))`,
    );
    await queryRunner.query(
      `DELETE FROM "roles" WHERE "role_code" IN ('TEACHER', 'STUDENT')`,
    );
  }
}
