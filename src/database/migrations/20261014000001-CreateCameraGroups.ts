import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMG-001 (Kế hoạch #12) — nhóm camera + cảnh báo bảo trì.
 * - camera_groups / camera_group_members (n-n; xoá nhóm hoặc thiết bị → gỡ thành viên theo CASCADE).
 * - 2 quyền iot.camera_group.read / manage.
 * - system_configs 'device_maintenance.offline_hours' (mặc định 24h).
 */
export class CreateCameraGroups20261014000001 implements MigrationInterface {
  name = 'CreateCameraGroups20261014000001';

  private readonly perms = [
    { code: 'iot.camera_group.read', name: 'Xem nhóm camera', action: 'read', roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN', 'MANAGER'] },
    { code: 'iot.camera_group.manage', name: 'Quản lý nhóm camera', action: 'manage', roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'] },
  ];

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE camera_groups (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        group_code  varchar(50)  NOT NULL,
        group_name  varchar(150) NOT NULL,
        description text,
        created_by  uuid,
        created_at  timestamptz NOT NULL DEFAULT NOW(),
        updated_at  timestamptz NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX uq_camera_groups_code ON camera_groups (LOWER(group_code));
      CREATE TABLE camera_group_members (
        group_id   uuid NOT NULL REFERENCES camera_groups(id) ON DELETE CASCADE,
        device_id  uuid NOT NULL REFERENCES iot_devices(id) ON DELETE CASCADE,
        added_at   timestamptz NOT NULL DEFAULT NOW(),
        PRIMARY KEY (group_id, device_id)
      );
      CREATE INDEX idx_camera_group_members_device ON camera_group_members (device_id);
    `);

    await q.query(
      `INSERT INTO system_configs (config_key, config_value, value_type, config_group, description, is_sensitive, is_active, version_no)
       SELECT 'device_maintenance.offline_hours', '24', 'number', 'iot',
              'Camera offline liên tục quá số giờ này thì sinh cảnh báo cần bảo trì', false, true, 1
       WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE config_key = 'device_maintenance.offline_hours');`,
    );

    for (const e of this.perms) {
      await q.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, 'iot', $3::varchar, $2::text, true
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = $1);`,
        [e.code, e.name, e.action],
      );
      const rows = (await q.query(`SELECT id FROM permissions WHERE permission_code = $1;`, [e.code])) as Array<{ id: string }>;
      const pid = rows[0]?.id;
      if (!pid) continue;
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
  }

  public async down(q: QueryRunner): Promise<void> {
    const codes = this.perms.map((e) => e.code);
    await q.query(`DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1));`, [codes]);
    await q.query(`DELETE FROM permissions WHERE permission_code = ANY($1);`, [codes]);
    await q.query(`DELETE FROM system_configs WHERE config_key = 'device_maintenance.offline_hours';`);
    await q.query(`DROP TABLE IF EXISTS camera_group_members; DROP TABLE IF EXISTS camera_groups;`);
  }
}
