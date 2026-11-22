import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Điểm danh lớp học chuyển từ kiểm tra VAI TRÒ sang kiểm tra QUYỀN (ClassAttendanceService).
 *
 * - Quyền mới class.attendance.read.all: phạm vi "mọi lớp". Không có quyền này thì chỉ thấy lớp
 *   mình dạy (GV) hoặc lớp mình học (SV) — trước đây phạm vi này suy ra từ vai trò SA/BA.
 *   + SYSTEM_ADMIN: trang Cấu hình hệ thống chọn lớp để cấu hình điểm danh theo lớp.
 *   + BUSINESS_ADMIN: trang Chuyên cần lớp học xem mọi lớp.
 * - BUSINESS_ADMIN thêm class.attendance.export: trang Chuyên cần lớp học có nút xuất CSV
 *   (trước đây qua được nhờ vai trò BA).
 *
 * Quyền còn lại giữ nguyên: GV manage + export, BA stats.read, SV read.self;
 * sửa cấu hình điểm danh dùng admin.manage_config (SA, quyền của trang Cấu hình hệ thống).
 */
const NEW_PERMISSION = {
  code: 'class.attendance.read.all',
  name: 'Xem chuyên cần mọi lớp học',
  action: 'read_all_attendance',
  description:
    'Xem chuyen can cua moi lop hoc (khong gioi han lop minh day / minh hoc)',
};

const GRANTS: [string, string][] = [
  ['SYSTEM_ADMIN', 'class.attendance.read.all'],
  ['BUSINESS_ADMIN', 'class.attendance.read.all'],
  ['BUSINESS_ADMIN', 'class.attendance.export'],
];

export class ClassAttendancePermissionBased20261122000001 implements MigrationInterface {
  name = 'ClassAttendancePermissionBased20261122000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       SELECT $1::varchar, $2::varchar, 'classroom', $3::varchar, $4::text, true
        WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = $1::varchar)`,
      [
        NEW_PERMISSION.code,
        NEW_PERMISSION.name,
        NEW_PERMISSION.action,
        NEW_PERMISSION.description,
      ],
    );
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
    await q.query(
      `DELETE FROM role_permissions
        WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = $1)`,
      [NEW_PERMISSION.code],
    );
    await q.query(`DELETE FROM permissions WHERE permission_code = $1`, [
      NEW_PERMISSION.code,
    ]);
  }
}
