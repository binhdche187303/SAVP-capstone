import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed du lieu demo cho `departments` — 6 phong ban (1 goc + 5 con).
 *
 * Boi canh: sau khi doi chieu toan bo src/database/migrations + src/database/seeds,
 * KHONG co migration/seed nao tung tao departments/roles/users goc — ~130 file seed
 * permission deu gia dinh roles.role_code da ton tai san (WHERE role_code = $1), nhung
 * khong role nao duoc tao. Day la migration dau tien trong chuoi "Tier 0" khoi phuc
 * du lieu nen RBAC + demo (xem huong-dan-setup-be-cho-nhom.md muc 8).
 *
 * Idempotent bang WHERE NOT EXISTS (khong dung ON CONFLICT vi ux_departments_code la
 * partial unique index — CREATE INDEX IF NOT EXISTS trong migration 20260608025416 co
 * the la no-op neu index cung ten da ton tai tu baseline SQL, nen khong chac chan target
 * ON CONFLICT nao se khop).
 */
export class SeedDemoDepartments20260720000001 implements MigrationInterface {
  name = 'SeedDemoDepartments20260720000001';

  private readonly root = {
    code: 'BOD',
    name: 'Ban Giám đốc',
    description: 'Ban điều hành công ty (demo seed data)',
  };

  private readonly children: Array<{
    code: string;
    name: string;
    description: string;
  }> = [
    {
      code: 'IT',
      name: 'Phòng Công nghệ thông tin',
      description: 'Phát triển và vận hành hệ thống (demo seed data)',
    },
    {
      code: 'HR',
      name: 'Phòng Nhân sự',
      description: 'Tuyển dụng và quản lý nhân sự (demo seed data)',
    },
    {
      code: 'SALES',
      name: 'Phòng Kinh doanh',
      description: 'Kinh doanh và chăm sóc khách hàng (demo seed data)',
    },
    {
      code: 'ADM',
      name: 'Phòng Hành chính - Lễ tân',
      description: 'Hành chính văn phòng, lễ tân (demo seed data)',
    },
    {
      code: 'FAC',
      name: 'Phòng Vận hành - Cơ sở vật chất',
      description:
        'Quản lý phòng họp, thiết bị, cơ sở vật chất (demo seed data)',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO departments (department_code, department_name, description, is_active)
       SELECT $1::varchar, $2::varchar, $3::text, true
       WHERE NOT EXISTS (SELECT 1 FROM departments WHERE department_code = $1);`,
      [this.root.code, this.root.name, this.root.description],
    );

    const rootRow = (await queryRunner.query(
      `SELECT id FROM departments WHERE department_code = $1;`,
      [this.root.code],
    )) as Array<{ id: string }>;
    const rootId = rootRow[0]?.id;
    if (!rootId) return;

    for (const child of this.children) {
      await queryRunner.query(
        `INSERT INTO departments (department_code, department_name, parent_department_id, description, is_active)
         SELECT $1::varchar, $2::varchar, $3::uuid, $4::text, true
         WHERE NOT EXISTS (SELECT 1 FROM departments WHERE department_code = $1);`,
        [child.code, child.name, rootId, child.description],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const codes = [this.root.code, ...this.children.map((c) => c.code)];
    // Xoa con truoc (parent_department_id FK ON DELETE SET NULL nen thu tu khong bat buoc,
    // nhung xoa con truoc cho ro rang).
    await queryRunner.query(
      `DELETE FROM departments WHERE department_code = ANY($1) AND parent_department_id IS NOT NULL;`,
      [codes],
    );
    await queryRunner.query(
      `DELETE FROM departments WHERE department_code = ANY($1);`,
      [codes],
    );
  }
}
