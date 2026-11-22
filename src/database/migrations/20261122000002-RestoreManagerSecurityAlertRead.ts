import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trả lại security_alert.read cho MANAGER (PrunePermissionsWithoutScreens gỡ nhầm).
 * Chuông thông báo (NotificationBell) của khu vực /manager hiển thị các cảnh báo an ninh mới —
 * lần rà trước tưởng chuông kiểm theo quyền, thực tế nó kiểm theo đường dẫn nên không bắt được.
 * Phát hiện khi quét giao diện thật: mọi trang /manager gọi GET /security-alerts → 403 (không toast).
 */
export class RestoreManagerSecurityAlertRead20261122000002 implements MigrationInterface {
  name = 'RestoreManagerSecurityAlertRead20261122000002';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW() FROM roles r, permissions p
        WHERE r.role_code = 'MANAGER' AND p.permission_code = 'security_alert.read'
          AND NOT EXISTS (SELECT 1 FROM role_permissions x
                           WHERE x.role_id = r.id AND x.permission_id = p.id)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM role_permissions
        WHERE role_id IN (SELECT id FROM roles WHERE role_code = 'MANAGER')
          AND permission_id IN (SELECT id FROM permissions WHERE permission_code = 'security_alert.read')`,
    );
  }
}
