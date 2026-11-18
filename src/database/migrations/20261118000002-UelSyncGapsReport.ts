import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Đồng bộ UEL — báo cáo dữ liệu cần bổ sung.
 *
 * - class_sections.uel_lecturer_name: tên GV theo UEL (tkb_ds_lophp.giang_vien, kèm học vị) ⇒
 *   biết lý do lớp HP chưa có GV (UEL chưa phân công / trùng tên / GV ngoài danh sách nhân sự).
 * - uel_sync_runs.gaps: tóm tắt SV/cán bộ chưa có email, lớp HP chưa có GV lúc lượt kết thúc.
 */
export class UelSyncGapsReport20261118000002 implements MigrationInterface {
  name = 'UelSyncGapsReport20261118000002';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE class_sections ADD COLUMN IF NOT EXISTS uel_lecturer_name varchar(500) NULL`,
    );
    await q.query(
      `ALTER TABLE uel_sync_runs ADD COLUMN IF NOT EXISTS gaps jsonb NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE uel_sync_runs DROP COLUMN IF EXISTS gaps`);
    await q.query(
      `ALTER TABLE class_sections DROP COLUMN IF EXISTS uel_lecturer_name`,
    );
  }
}
