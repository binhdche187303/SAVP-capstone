import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bảo vệ trực cổng phải XỬ LÝ được, không chỉ xem: tiếp nhận/đóng cảnh báo an ninh (gồm cảnh báo
 * xe lạ / xe kiểm soát từ ANPR — quyết định "Cho qua/Chặn" ghi vào resolution_note), xem lịch sử xe
 * ra vào + ảnh sự kiện. Chỉ GÁN quyền đã có sẵn, không tạo quyền mới.
 */
export class GrantGuardSecurityOperations20261015000001 implements MigrationInterface {
  name = 'GrantGuardSecurityOperations20261015000001';

  private readonly codes = [
    'security_alert.read',
    'security_alert.acknowledge',
    'security_alert.resolve',
    'anpr.vehicle.history_view',
    'ivss.access_log.read',
    'zones.zone.read',
  ];

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW() FROM roles r CROSS JOIN permissions p
       WHERE r.role_code = 'GUARD' AND r.is_active = true AND p.permission_code = ANY($1)
         AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);`,
      [this.codes],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM role_permissions
       WHERE role_id IN (SELECT id FROM roles WHERE role_code = 'GUARD')
         AND permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1));`,
      [this.codes],
    );
  }
}
