import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Họp 20/10 — truy vết theo nhóm camera/khu vực + hậu kiểm AI nhận sai.
 * - camera_groups: thêm zone_id (khu vực phụ trách) + purpose (mục đích sử dụng).
 * - Index (device_id, thời gian) cho 2 bảng sự kiện để truy vết theo camera không quét toàn bảng.
 * - Quyền face.stranger.review (xác nhận "đây là ai" cho sự kiện người lạ).
 */
export class CameraGroupZonePurposeAndStrangerReview20261022000001 implements MigrationInterface {
  name = 'CameraGroupZonePurposeAndStrangerReview20261022000001';

  private readonly perm = {
    code: 'face.stranger.review',
    name: 'Xác nhận lại người lạ (hậu kiểm AI)',
    roles: ['SYSTEM_ADMIN'],
  };

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE camera_groups
        ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES zones(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS purpose varchar(100);
      CREATE INDEX IF NOT EXISTS idx_camera_groups_zone ON camera_groups (zone_id);
      CREATE INDEX IF NOT EXISTS "IDX_zone_presence_events_device_time" ON zone_presence_events (device_id, event_time);
      CREATE INDEX IF NOT EXISTS "IDX_gate_access_logs_device_time" ON gate_access_logs (device_id, access_time);
    `);

    const e = this.perm;
    await q.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       SELECT $1::varchar, $2::varchar, 'face', 'review', $2::text, true
       WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = $1);`,
      [e.code, e.name],
    );
    const rows = (await q.query(`SELECT id FROM permissions WHERE permission_code = $1;`, [e.code])) as Array<{ id: string }>;
    const pid = rows[0]?.id;
    if (!pid) return;
    for (const roleCode of e.roles) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, $2::uuid, NOW() FROM roles r
         WHERE r.role_code = $1 AND r.is_active = true
           AND NOT EXISTS (SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = $2::uuid);`,
        [roleCode, pid],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = $1);`, [this.perm.code]);
    await q.query(`DELETE FROM permissions WHERE permission_code = $1;`, [this.perm.code]);
    await q.query(`
      DROP INDEX IF EXISTS "IDX_gate_access_logs_device_time";
      DROP INDEX IF EXISTS "IDX_zone_presence_events_device_time";
      DROP INDEX IF EXISTS idx_camera_groups_zone;
      ALTER TABLE camera_groups DROP COLUMN IF EXISTS purpose, DROP COLUMN IF EXISTS zone_id;
    `);
  }
}
