import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cho phep giao vien va sinh vien la thanh vien cuoc hop goi API nhat ky
 * ra/vao cua chinh cuoc hop do. Backend van kiem tra membership theo meeting_id.
 */
export class GrantMeetingAccessLogToParticipants20261022000002
  implements MigrationInterface
{
  name = 'GrantMeetingAccessLogToParticipants20261022000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id, granted_at)
      SELECT r.id, p.id, NOW()
        FROM roles r
        CROSS JOIN permissions p
       WHERE r.role_code IN ('TEACHER', 'STUDENT')
         AND r.is_active = true
         AND p.permission_code = 'ivss.presence.read'
         AND NOT EXISTS (
           SELECT 1
             FROM role_permissions rp
            WHERE rp.role_id = r.id AND rp.permission_id = p.id
         );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM role_permissions
       WHERE permission_id = (
         SELECT id FROM permissions WHERE permission_code = 'ivss.presence.read'
       )
         AND role_id IN (
           SELECT id FROM roles WHERE role_code IN ('TEACHER', 'STUDENT')
         );
    `);
  }
}
