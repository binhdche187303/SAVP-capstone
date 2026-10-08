import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ACCT-AVATAR-SUBMIT-001 (AR-01): Seed idempotent 2 permission self-service avatar
 * và gán cho EMPLOYEE, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN.
 *
 * Đặt trong migrations/ (không phải seeds/) để đảm bảo chạy chắc chắn qua
 * `npm run migration:run` — pattern seeds/*SeedXxxPermission*.ts hiện không có runner.
 *
 * Idempotent: ON CONFLICT DO NOTHING + fallback SELECT để lấy permission id
 * khi permission đã tồn tại từ lần chạy trước.
 *
 * Ghi chú: spec.md mục 4/10 dùng tên role "INTERNAL_USER", nhưng bảng `roles`
 * thực tế trong DB dùng role_code = 'EMPLOYEE' cho vai trò nhân viên thường
 * (cùng lệch code-vs-spec đã ghi ở spec.md mục 20.2 cho permission khác).
 * Migration dùng 'EMPLOYEE' để khớp đúng dữ liệu thật.
 */
export class SeedProfileAvatarPermissions20260624000002 implements MigrationInterface {
  name = 'SeedProfileAvatarPermissions20260624000002';

  private readonly permissions = [
    {
      code: 'profile.avatar.read_status',
      name: 'Xem trạng thái avatar của chính mình',
      action: 'avatar_read_status',
      description:
        'Cho phép user xem trạng thái avatar/face profile của chính mình',
    },
    {
      code: 'profile.avatar.submit',
      name: 'Tự nộp/nộp lại avatar của chính mình',
      action: 'avatar_submit',
      description: 'Cho phép user tự upload/re-upload avatar của chính mình',
    },
  ];

  private readonly roles = [
    'EMPLOYEE',
    'MANAGER',
    'BUSINESS_ADMIN',
    'SYSTEM_ADMIN',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_permissions_permission_code"
        ON permissions (permission_code);
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_role_permissions_role_permission"
        ON role_permissions (role_id, permission_id);
    `);

    for (const permission of this.permissions) {
      const inserted: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         VALUES ($1, $2, 'accounts', $3, $4, true)
         ON CONFLICT (permission_code) DO NOTHING
         RETURNING id;`,
        [
          permission.code,
          permission.name,
          permission.action,
          permission.description,
        ],
      );

      // ON CONFLICT DO NOTHING không trả row khi permission đã tồn tại → SELECT lại.
      let permissionId: string | undefined = inserted[0]?.id;
      if (!permissionId) {
        const existing: Array<{ id: string }> = await queryRunner.query(
          `SELECT id FROM permissions WHERE permission_code = $1 LIMIT 1;`,
          [permission.code],
        );
        permissionId = existing[0]?.id;
      }
      if (!permissionId) {
        continue;
      }

      for (const roleCode of this.roles) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_at)
           SELECT r.id, $2, NOW()
           FROM roles r
           WHERE r.role_code = $1 AND r.is_active = true
           ON CONFLICT (role_id, permission_id) DO NOTHING;`,
          [roleCode, permissionId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (
         SELECT id FROM permissions
         WHERE permission_code IN ('profile.avatar.read_status', 'profile.avatar.submit')
       );`,
    );
    await queryRunner.query(
      `DELETE FROM permissions
       WHERE permission_code IN ('profile.avatar.read_status', 'profile.avatar.submit');`,
    );
  }
}
