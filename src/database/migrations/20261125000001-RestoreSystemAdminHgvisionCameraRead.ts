import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trả lại hgvision.camera.read cho SYSTEM_ADMIN (PrunePermissionsWithoutScreens gỡ vì lúc đó
 * không trang nào của quản trị hệ thống gọi /hgvision/cameras).
 * Trang "Ghi hình & lưu trữ" (/system-admin/camera-recording) làm lại 2026-11-25 theo hướng chỉ xem,
 * đồng bộ HGVision → gọi GET /hgvision/cameras → 403 "Bạn không có quyền thực hiện hành động này".
 */
export class RestoreSystemAdminHgvisionCameraRead20261125000001 implements MigrationInterface {
  name = 'RestoreSystemAdminHgvisionCameraRead20261125000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW() FROM roles r, permissions p
        WHERE r.role_code = 'SYSTEM_ADMIN' AND p.permission_code = 'hgvision.camera.read'
          AND NOT EXISTS (SELECT 1 FROM role_permissions x
                           WHERE x.role_id = r.id AND x.permission_id = p.id)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM role_permissions
        WHERE role_id IN (SELECT id FROM roles WHERE role_code = 'SYSTEM_ADMIN')
          AND permission_id IN (SELECT id FROM permissions WHERE permission_code = 'hgvision.camera.read')`,
    );
  }
}
