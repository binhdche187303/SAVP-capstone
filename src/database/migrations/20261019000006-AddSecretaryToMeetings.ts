import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lịch tuần UEL — Thư ký cuộc họp: người được giao điểm danh thủ công
 * (cùng quyền với Chủ trì, sửa được tới 24 giờ sau khi họp kết thúc).
 */
export class AddSecretaryToMeetings20261019000006 implements MigrationInterface {
  name = 'AddSecretaryToMeetings20261019000006';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS secretary_id uuid NULL REFERENCES users(id) ON DELETE SET NULL;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE meetings DROP COLUMN IF EXISTS secretary_id;`);
  }
}
