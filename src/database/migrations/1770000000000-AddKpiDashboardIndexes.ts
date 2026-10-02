import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKpiDashboardIndexes1770000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // CONCURRENTLY không dùng được trong transaction của TypeORM (migrationsTransactionMode: each) -> dùng CREATE INDEX thường
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_meetings_start_time_deleted" ON "meetings" ("start_time", "deleted_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_room_bookings_reserved_start" ON "room_bookings" ("reserved_start_time")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_room_bookings_room_id" ON "room_bookings" ("room_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_room_bookings_meeting_id" ON "room_bookings" ("meeting_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_attendance_meeting_id" ON "attendance_records" ("meeting_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_no_show_booking_id" ON "no_show_cases" ("booking_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_usage_reserved_start" ON "room_booking_usages" ("reserved_start_time")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_usage_reserved_start"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_no_show_booking_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_attendance_meeting_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_room_bookings_meeting_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_room_bookings_room_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_room_bookings_reserved_start"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_meetings_start_time_deleted"`);
  }
}
