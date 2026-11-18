import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Đồng bộ UEL — khóa buổi học.
 *
 * UEL dùng chung ma_lich_hoc cho các lớp HP học ghép (cùng phòng, cùng giờ) ⇒ khóa cũ
 * external_id = ma_lich_hoc làm buổi lớp này đè lên buổi lớp kia. Khóa mới: "ma_lich_hoc|mã lớp HP".
 * Đổi khóa các buổi đã đồng bộ (giữ nguyên dòng ⇒ điểm danh / tham chiếu không đổi).
 */
export class UelSessionExternalIdPerSection20261118000001 implements MigrationInterface {
  name = 'UelSessionExternalIdPerSection20261118000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE class_sessions se
         SET external_id = se.external_id || '|' || cs.class_code
        FROM class_sections cs
       WHERE cs.id = se.class_section_id
         AND se.source = 'uel_api'
         AND se.external_id ~ '^[0-9]+$'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE class_sessions
         SET external_id = split_part(external_id, '|', 1)
       WHERE source = 'uel_api'
         AND external_id ~ '^[0-9]+\\|[^|]+$'
    `);
  }
}
