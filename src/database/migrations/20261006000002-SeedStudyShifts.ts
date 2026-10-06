import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ACD-001 R10 — seed 6 ca học cố định (giờ địa phương VN). Dữ liệu tham chiếu, cần ở mọi môi trường.
 * Idempotent: WHERE NOT EXISTS theo shift_code đang sống. Đổi giờ ca sau này = migration UPDATE mới;
 * buổi học đã tạo giữ snapshot start_time/end_time (D5) nên không bị ảnh hưởng.
 */
export class SeedStudyShifts20261006000002 implements MigrationInterface {
  name = 'SeedStudyShifts20261006000002';

  private readonly shifts: Array<
    [code: string, name: string, order: number, start: string, end: string]
  > = [
    ['SLOT1', 'Ca 1', 1, '07:30', '09:50'],
    ['SLOT2', 'Ca 2', 2, '10:00', '12:20'],
    ['SLOT3', 'Ca 3', 3, '12:50', '15:10'],
    ['SLOT4', 'Ca 4', 4, '15:20', '17:40'],
    ['SLOT5', 'Ca 5', 5, '18:00', '20:20'],
    ['SLOT6', 'Ca 6', 6, '20:30', '22:50'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [code, name, order, start, end] of this.shifts) {
      await queryRunner.query(
        `INSERT INTO study_shifts (shift_code, shift_name, shift_order, start_time, end_time)
         SELECT $1::varchar, $2::varchar, $3::smallint, $4::time, $5::time
         WHERE NOT EXISTS (
           SELECT 1 FROM study_shifts WHERE shift_code = $1 AND deleted_at IS NULL
         );`,
        [code, name, order, start, end],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Chỉ xoá ca CHƯA được buổi học nào tham chiếu (FK RESTRICT bảo vệ dữ liệu thật).
    await queryRunner.query(
      `DELETE FROM study_shifts s
        WHERE s.shift_code = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM class_sessions cs WHERE cs.shift_id = s.id);`,
      [this.shifts.map(([code]) => code)],
    );
  }
}
