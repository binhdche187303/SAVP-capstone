import { MigrationInterface, QueryRunner } from 'typeorm';

/** VIS-BE-001 — đơn vị VISITOR cho tài khoản khách ẩn (mẫu 20260811000001-SeedPartnerDepartment). */
export class SeedVisitorDepartment20261012000002 implements MigrationInterface {
  name = 'SeedVisitorDepartment20261012000002';
  private readonly visitorDepartmentId = '8d4f3a2b-5c7b-4a3f-8e9d-2b3c4d5e6f70';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO departments (id, department_code, department_name, is_active)
       SELECT $1::uuid, 'VISITOR', 'Khách đến làm việc', true
       WHERE NOT EXISTS (SELECT 1 FROM departments WHERE id = $1 OR department_code = 'VISITOR');`,
      [this.visitorDepartmentId],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM departments WHERE id = $1 AND department_code = 'VISITOR';`, [this.visitorDepartmentId]);
  }
}
