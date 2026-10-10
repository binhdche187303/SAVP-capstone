import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RPT-CENTER-BE-001 §4.1 — báo cáo chuyên cần cán bộ gộp sự kiện khuôn mặt theo (người, ngày).
 * Trên production hãy tạo trước bằng `CREATE INDEX CONCURRENTLY IF NOT EXISTS …` (cùng tên) rồi mới chạy migration;
 * migration dùng IF NOT EXISTS nên sẽ bỏ qua.
 */
export class AddIvssFaceEventUserIndex20261013000003 implements MigrationInterface {
  name = 'AddIvssFaceEventUserIndex20261013000003';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_iot_device_events_face_user_time"
         ON "iot_device_events" ((payload_json->>'userId'), "event_time")
         WHERE "event_type" = 'ivss_face_event' AND payload_json->>'userId' IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_iot_device_events_face_user_time"`);
  }
}
