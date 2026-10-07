import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trung tâm Cảnh báo sắp theo `last_seen_at` (lần xảy ra gần nhất) thay vì `triggered_at`.
 * Alert cũ chỉ có 1 lượt chưa từng bump nên `last_seen_at` = NULL → điền bằng
 * `triggered_at` (NULL sẽ nổi lên đầu khi ORDER BY DESC). Alert mới set luôn khi INSERT.
 */
export class SecurityAlertLastSeenBackfill20261010000001 implements MigrationInterface {
  name = 'SecurityAlertLastSeenBackfill20261010000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE security_alerts SET last_seen_at = triggered_at WHERE last_seen_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_security_alerts_last_seen_at ON security_alerts (last_seen_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_security_alerts_last_seen_at`,
    );
  }
}
