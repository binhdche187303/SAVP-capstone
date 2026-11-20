import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedDemoGateZones20261011000005 implements MigrationInterface {
  name = 'SeedDemoGateZones20261011000005';

  /** Dữ liệu demo đã gỡ khỏi luồng migration — chỉ giữ data thật. down() vẫn dọn được demo cũ. */
  public async up(): Promise<void> {}

  /** Seed demo cũ — không còn chạy tự động. */
  public async seedDemo(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO zones (
         zone_code, zone_name, zone_type, building, floor, description,
         metadata_json, status
       )
       SELECT item.zone_code, item.zone_name, 'gate', 'Campus', 'G',
              item.description, item.metadata_json::jsonb, 'active'
       FROM (
         VALUES
           (
             'GATE_MAIN'::varchar,
             'Cong chinh'::varchar,
             'Cong ra vao chinh dung cho dashboard bao ve'::varchar,
             '{"guardDashboardGateId":"main"}'::text
           ),
           (
             'GATE_SIDE'::varchar,
             'Cong phu'::varchar,
             'Cong phu dung cho dashboard bao ve'::varchar,
             '{"guardDashboardGateId":"side"}'::text
           )
       ) AS item(zone_code, zone_name, description, metadata_json)
       WHERE NOT EXISTS (
         SELECT 1
           FROM zones z
          WHERE z.zone_code = item.zone_code
            AND z.deleted_at IS NULL
       );`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM zones
        WHERE zone_code IN ('GATE_MAIN', 'GATE_SIDE')
          AND metadata_json ? 'guardDashboardGateId';`,
    );
  }
}
