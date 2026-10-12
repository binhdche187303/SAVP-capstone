import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * KPI-001 (task #10, 2026-10-07) — bảng tổng hợp theo giờ cho zone traffic & vehicle stats.
 *
 * ADD-ONLY: tạo 4 bảng mới + 1 index partial trên iot_device_events (không sửa cột/dữ liệu).
 * Index vehicle_time: trước đây vehicle event không có index theo thời gian (zone_id luôn NULL)
 * ⇒ thống kê xe quét toàn bảng. Production bảng lớn: tạo tay
 *   CREATE INDEX CONCURRENTLY "IDX_iot_device_events_vehicle_time" ON ...
 * TRƯỚC khi chạy migration (IF NOT EXISTS sẽ bỏ qua) để không khoá ghi.
 */
export class CreateKpiRollupTables20261007000001 implements MigrationInterface {
  name = 'CreateKpiRollupTables20261007000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kpi_zone_hourly" (
        "zone_id" uuid NOT NULL,
        "bucket_hour" timestamptz NOT NULL,
        "event_count" integer NOT NULL,
        "sample_count" integer NOT NULL,
        "occupancy_sum" bigint NOT NULL,
        "occupancy_peak" integer NULL,
        "peak_at" timestamptz NOT NULL,
        "computed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kpi_zone_hourly" PRIMARY KEY ("zone_id", "bucket_hour"),
        CONSTRAINT "FK_kpi_zone_hourly_zone" FOREIGN KEY ("zone_id")
          REFERENCES "zones"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kpi_zone_hourly_bucket" ON "kpi_zone_hourly" ("bucket_hour")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kpi_vehicle_hourly" (
        "id" bigserial NOT NULL,
        "bucket_hour" timestamptz NOT NULL,
        "zone_id" uuid NULL,
        "vehicle_type" text NULL,
        "direction" text NULL,
        "match_state" text NULL,
        "event_count" integer NOT NULL,
        "computed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kpi_vehicle_hourly" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kpi_vehicle_hourly_bucket" ON "kpi_vehicle_hourly" ("bucket_hour")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kpi_vehicle_plate_hourly" (
        "id" bigserial NOT NULL,
        "bucket_hour" timestamptz NOT NULL,
        "zone_id" uuid NULL,
        "vehicle_type" text NULL,
        "plate_number" text NOT NULL,
        CONSTRAINT "PK_kpi_vehicle_plate_hourly" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kpi_vehicle_plate_hourly_bucket" ON "kpi_vehicle_plate_hourly" ("bucket_hour")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kpi_rollup_watermarks" (
        "rollup_name" varchar(50) NOT NULL,
        "covered_from" timestamptz NOT NULL,
        "covered_until" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kpi_rollup_watermarks" PRIMARY KEY ("rollup_name")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_iot_device_events_vehicle_time"
        ON "iot_device_events" ("event_time") WHERE "event_type" = 'ivss_vehicle_event'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_iot_device_events_vehicle_time"`,
    );
    await queryRunner.query(`DROP TABLE "kpi_rollup_watermarks"`);
    await queryRunner.query(`DROP TABLE "kpi_vehicle_plate_hourly"`);
    await queryRunner.query(`DROP TABLE "kpi_vehicle_hourly"`);
    await queryRunner.query(`DROP TABLE "kpi_zone_hourly"`);
  }
}
