import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Đợt 1 (2026-10-09) — Danh sách kiểm soát + Người lạ.
 *
 * 1. `security_alerts.dedupe_key` (mặc định '') + 2 unique index "đang mở" thêm cột này.
 *    Trước: 1 alert mở / (alert_type, zone) → người B trong danh sách kiểm soát bị gộp vào
 *    alert của người A. Nay person_watchlist_match truyền dedupe_key = userId → mỗi người 1
 *    alert mở riêng / khu vực. Loại khác để '' → hành vi y hệt cũ (không cần dọn dữ liệu).
 * 2. Partial index sự kiện người lạ — StrangerAlertService.list() lọc
 *    event_type='face_stranger' AND created_at >= now()-N phút trên bảng sự kiện lớn nhất.
 *
 * Production: tạo index (2) trước bằng CREATE INDEX CONCURRENTLY (cùng tên) để không khoá
 * ghi — IF NOT EXISTS sẽ bỏ qua (mirror ghi chú AddVehicleHistoryIndexes20261008000001).
 */
export class AlertDedupeKeyAndStrangerIndex20261009000001 implements MigrationInterface {
  name = 'AlertDedupeKeyAndStrangerIndex20261009000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "security_alerts"
        ADD COLUMN IF NOT EXISTS "dedupe_key" varchar(100) NOT NULL DEFAULT ''
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_security_alerts_open_type_zone"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_security_alerts_open_type_global"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_security_alerts_open_type_zone"
        ON "security_alerts" ("alert_type", "zone_id", "dedupe_key")
        WHERE "status" <> 'resolved' AND "zone_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_security_alerts_open_type_global"
        ON "security_alerts" ("alert_type", "dedupe_key")
        WHERE "status" <> 'resolved' AND "zone_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_iot_device_events_stranger_time"
        ON "iot_device_events" ("created_at" DESC)
        WHERE "event_type" = 'face_stranger'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_iot_device_events_stranger_time"`,
    );
    // Quay về 1 alert mở / (type, zone): đóng các alert mở trùng (giữ bản mới nhất) trước.
    await queryRunner.query(`
      UPDATE "security_alerts" s
         SET "status" = 'resolved', "resolved_at" = NOW(),
             "resolution_note" = 'Rollback migration dedupe_key'
       WHERE s."status" <> 'resolved'
         AND EXISTS (
           SELECT 1 FROM "security_alerts" o
            WHERE o."status" <> 'resolved'
              AND o."alert_type" = s."alert_type"
              AND o."zone_id" IS NOT DISTINCT FROM s."zone_id"
              AND (o."triggered_at", o."id") > (s."triggered_at", s."id"))
    `);
    await queryRunner.query(`DROP INDEX "UQ_security_alerts_open_type_global"`);
    await queryRunner.query(`DROP INDEX "UQ_security_alerts_open_type_zone"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_security_alerts_open_type_zone"
        ON "security_alerts" ("alert_type", "zone_id")
        WHERE "status" <> 'resolved' AND "zone_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_security_alerts_open_type_global"
        ON "security_alerts" ("alert_type")
        WHERE "status" <> 'resolved' AND "zone_id" IS NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "security_alerts" DROP COLUMN IF EXISTS "dedupe_key"`,
    );
  }
}
