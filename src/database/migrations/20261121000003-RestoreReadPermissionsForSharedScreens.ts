import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trả lại 3 quyền XEM mà PrunePermissionsWithoutScreens gỡ nhầm (các trang dùng chung gọi tới
 * qua URL có query nên lần rà trước không bắt được):
 * - iot.camera_group.read (BA, MANAGER): bộ lọc nhóm camera ở "Lưu lượng & Heatmap" và "Truy vết".
 * - security_alert.read, vehicle_control.read (BA): widget cảnh báo mới và blocklist trên dashboard BA.
 */
const GRANTS: [string, string][] = [
  ['BUSINESS_ADMIN', 'iot.camera_group.read'],
  ['MANAGER', 'iot.camera_group.read'],
  ['BUSINESS_ADMIN', 'security_alert.read'],
  ['BUSINESS_ADMIN', 'vehicle_control.read'],
];

export class RestoreReadPermissionsForSharedScreens20261121000003 implements MigrationInterface {
  name = 'RestoreReadPermissionsForSharedScreens20261121000003';

  public async up(q: QueryRunner): Promise<void> {
    for (const [role, code] of GRANTS) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, p.id, NOW() FROM roles r, permissions p
          WHERE r.role_code = $1 AND p.permission_code = $2
            AND NOT EXISTS (SELECT 1 FROM role_permissions x
                             WHERE x.role_id = r.id AND x.permission_id = p.id)`,
        [role, code],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const [role, code] of GRANTS) {
      await q.query(
        `DELETE FROM role_permissions
          WHERE role_id IN (SELECT id FROM roles WHERE role_code = $1)
            AND permission_id IN (SELECT id FROM permissions WHERE permission_code = $2)`,
        [role, code],
      );
    }
  }
}
