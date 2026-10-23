import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVisitorRouteOrder20261023000002 implements MigrationInterface {
  name = 'AddVisitorRouteOrder20261023000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "visitor_visit_zones" ADD COLUMN IF NOT EXISTS "route_order" integer`,
    );
    await queryRunner.query(`
      WITH ranked AS (
        SELECT visit_id, zone_id,
               ROW_NUMBER() OVER (PARTITION BY visit_id ORDER BY zone_id) AS position
          FROM visitor_visit_zones
      )
      UPDATE visitor_visit_zones vvz
         SET route_order = ranked.position
        FROM ranked
       WHERE vvz.visit_id = ranked.visit_id AND vvz.zone_id = ranked.zone_id
    `);
    await queryRunner.query(
      `ALTER TABLE "visitor_visit_zones" ALTER COLUMN "route_order" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_visitor_visit_zones_route" ON "visitor_visit_zones" ("visit_id", "route_order")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_visitor_visit_zones_route"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visitor_visit_zones" DROP COLUMN IF EXISTS "route_order"`,
    );
  }
}
