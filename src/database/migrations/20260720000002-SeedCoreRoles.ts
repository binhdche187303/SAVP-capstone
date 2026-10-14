import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed 4 role loi ma toan bo he thong dang gia dinh da ton tai:
 * SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER, EMPLOYEE.
 *
 * Day la 4 ma role duy nhat con duoc dung o tang application code hien tai
 * (guard @RequireRoles('SYSTEM_ADMIN'), va toan bo ~130 file seed permission
 * sau khi doi chieu deu quy ve 4 ma nay — cac ma cu/loi thoi nhu ADMIN,
 * INTERNAL_USER, ROOM_ADMIN xuat hien trong mot so migration/seed rat som
 * nhung khong con duoc tao/dung o dau, xem migration backfill
 * 20260720000005-BackfillRolePermissions.ts de biet chi tiet alias.
 *
 * QUAN TRONG VE THU TU: migration nay PHAI chay TRUOC toan bo cac migration
 * Seed*Permission*.ts hien co de cac migration do gan duoc role_permissions
 * dung ngay lan chay dau (chung SELECT r.id FROM roles WHERE role_code = $1,
 * neu roles rong thi khong insert duoc gi ca ma khong bao loi). Vi TypeORM
 * chi chay cac migration CHUA duoc ghi nhan trong bang typeorm_migrations
 * (khong quan tam thu tu thoi gian thuc), migration nay van se chay dung tren
 * moi DB (moi hoac da migrate mot phan) mien la no chua tung duoc apply.
 * Voi permission da seed truoc do ma bi "mat" role_permissions vi roles chua
 * ton tai, xem migration backfill 20260720000005.
 */
export class SeedCoreRoles20260720000002 implements MigrationInterface {
  name = 'SeedCoreRoles20260720000002';

  private readonly roles: Array<{
    code: string;
    name: string;
    description: string;
  }> = [
    {
      code: 'SYSTEM_ADMIN',
      name: 'Quản trị hệ thống',
      description:
        'Toàn quyền trên toàn bộ hệ thống, không giới hạn theo phòng ban',
    },
    {
      code: 'BUSINESS_ADMIN',
      name: 'Quản trị nghiệp vụ',
      description:
        'Quản trị trong phạm vi phòng ban được giao',
    },
    {
      code: 'MANAGER',
      name: 'Trưởng nhóm / Quản lý',
      description:
        'Quản lý nhân sự trực thuộc, duyệt yêu cầu, xem báo cáo',
    },
    {
      code: 'EMPLOYEE',
      name: 'Nhân viên',
      description:
        'Người dùng nội bộ thông thường, tạo và tham gia cuộc họp',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const role of this.roles) {
      await queryRunner.query(
        `INSERT INTO roles (role_code, role_name, description, is_system_role, is_active)
         SELECT $1::varchar, $2::varchar, $3::text, true, true
         WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_code = $1);`,
        [role.code, role.name, role.description],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const codes = this.roles.map((r) => r.code);
    await queryRunner.query(
      `DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE role_code = ANY($1));`,
      [codes],
    );
    await queryRunner.query(
      `DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE role_code = ANY($1));`,
      [codes],
    );
    await queryRunner.query(`DELETE FROM roles WHERE role_code = ANY($1);`, [
      codes,
    ]);
  }
}
