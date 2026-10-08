import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * STT 19 (2026-10-08) — index cho lịch sử ANPR (VehicleHistoryService), FE poll 1s.
 *
 * Trước: lọc theo biển số (listAll ?plateNumber=) và "xe của tôi" (listForUser) so trên
 * payload_json->>'plateNumber' / payload_json->>'userId' — không có index → quét toàn bộ
 * sự kiện xe qua IDX_iot_device_events_vehicle_time rồi lọc (COUNT + rows mỗi lần gọi).
 *
 * Partial (chỉ ivss_vehicle_event) — bảng trộn cả sự kiện mặt, không phình index vô ích.
 * (key, event_time DESC) phục vụ cả WHERE key = $n lẫn ORDER BY event_time DESC LIMIT.
 *
 * ADD-ONLY. Production: tạo trước bằng CREATE INDEX CONCURRENTLY (cùng tên) để không
 * khoá ghi — IF NOT EXISTS sẽ bỏ qua (mirror ghi chú CreateKpiRollupTables20261007000001).
 */
export class AddVehicleHistoryIndexes20261008000001 implements MigrationInterface {
  name = 'AddVehicleHistoryIndexes20261008000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Lịch sử theo biển số (listAll ?plateNumber=, theo dõi 1 phương tiện).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_iot_device_events_vehicle_plate"
        ON "iot_device_events" ((payload_json->>'plateNumber'), "event_time" DESC)
        WHERE "event_type" = 'ivss_vehicle_event'
    `);
    // "Xe của tôi" (listForUser: payload_json->>'userId' = current user).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_iot_device_events_vehicle_user"
        ON "iot_device_events" ((payload_json->>'userId'), "event_time" DESC)
        WHERE "event_type" = 'ivss_vehicle_event'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_iot_device_events_vehicle_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_iot_device_events_vehicle_plate"`,
    );
  }
}
