import { MigrationInterface, QueryRunner } from 'typeorm';

export class StandardizeDemoAccountIdentity20261123000001 implements MigrationInterface {
  name = 'StandardizeDemoAccountIdentity20261123000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Scope to the original demo domain; synchronized UEL profiles are untouched.
    await queryRunner.query(`
      UPDATE users
      SET email = replace(email, '@meetingsys.vn', '@uel.edu.vn'),
          full_name = CASE username
            WHEN 'sysadmin' THEN 'System Admin'
            WHEN 'bizadmin.it' THEN 'Business Admin'
            WHEN 'bizadmin.hr' THEN 'Business Admin'
            WHEN 'teacher.demo' THEN 'Nguyễn Thị Giang'
            ELSE full_name END
      WHERE email LIKE '%@meetingsys.vn'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users
      SET email = replace(email, '@uel.edu.vn', '@meetingsys.vn'),
          full_name = CASE username
            WHEN 'sysadmin' THEN 'Tran Quoc Admin'
            WHEN 'bizadmin.it' THEN 'Le Thi Van Anh'
            WHEN 'bizadmin.hr' THEN 'Pham Minh Duc'
            WHEN 'teacher.demo' THEN 'Nguyen Thi Giang'
            ELSE full_name END
      WHERE email IN (
        'sysadmin@uel.edu.vn', 'bizadmin.it@uel.edu.vn', 'bizadmin.hr@uel.edu.vn',
        'manager.it@uel.edu.vn', 'manager.hr@uel.edu.vn', 'manager.sales@uel.edu.vn',
        'emp.it1@uel.edu.vn', 'emp.it2@uel.edu.vn', 'emp.hr1@uel.edu.vn',
        'emp.hr2@uel.edu.vn', 'emp.sales1@uel.edu.vn', 'emp.sales2@uel.edu.vn',
        'emp.admin1@uel.edu.vn', 'emp.facility1@uel.edu.vn', 'guard@uel.edu.vn',
        'teacher@uel.edu.vn', 'student@uel.edu.vn', 'hieutruong@uel.edu.vn',
        'phohieutruong.dt@uel.edu.vn'
      )
    `);
  }
}
