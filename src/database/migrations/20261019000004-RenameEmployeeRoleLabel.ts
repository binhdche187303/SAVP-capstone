import { MigrationInterface, QueryRunner } from 'typeorm';

/** Lịch tuần UEL: tên hiển thị role EMPLOYEE phù hợp trường đại học (không đổi quyền). */
export class RenameEmployeeRoleLabel20261019000004 implements MigrationInterface {
  name = 'RenameEmployeeRoleLabel20261019000004';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE roles SET role_name = $1 WHERE role_code = 'EMPLOYEE'`, ['Cán bộ, viên chức']);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE roles SET role_name = $1 WHERE role_code = 'EMPLOYEE'`, ['Nhân viên']);
  }
}
