import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Khách đến làm việc — chính sách khu vực cho khách (`zones.visitor_policy`).
 * open = tự cấp cho mọi lượt (cổng mặc định), grantable = người được gặp cấp, restricted = chỉ quản lý cấp.
 * Giữ hành vi cũ: mọi cổng hiện có → open (trước đây mọi cổng đều được cấp tự động), khu khác → grantable.
 */
export class ZoneVisitorPolicy20261023000001 implements MigrationInterface {
  name = 'ZoneVisitorPolicy20261023000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE zones ADD COLUMN IF NOT EXISTS visitor_policy varchar(20) NOT NULL DEFAULT 'grantable';
      UPDATE zones SET visitor_policy = 'open' WHERE zone_type = 'gate';
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE zones DROP COLUMN IF EXISTS visitor_policy;`);
  }
}
