import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * STT 8 (2026-10-05) — index cho gate_access_logs (lịch sử ra/vào cổng).
 *
 * Trước: bảng chỉ có PK → lọc theo cổng/người/khoảng ngày, job ghép cặp vào-ra
 * và báo cáo cổng đều Seq Scan toàn bảng (bảng chỉ tăng, ghi mỗi lượt qua cổng).
 *
 * ADD-ONLY: chỉ thêm index, không sửa/xóa cột hay dữ liệu.
 */
export class AddGateAccessLogIndexes20261005000003 implements MigrationInterface {
  name = 'AddGateAccessLogIndexes20261005000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Lịch sử cổng lọc theo cổng + khoảng ngày.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gate_access_logs_zone_time" ON "gate_access_logs" ("zone_id", "access_time")`,
    );
    // Lịch sử / hành trình 1 người, job ghép cặp tìm lượt enter gần nhất.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gate_access_logs_user_time" ON "gate_access_logs" ("user_id", "access_time")`,
    );
    // Lọc chỉ theo ngày, sắp xếp mới nhất, xuất báo cáo.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gate_access_logs_time" ON "gate_access_logs" ("access_time")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_gate_access_logs_time"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_gate_access_logs_user_time"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_gate_access_logs_zone_time"`,
    );
  }
}
