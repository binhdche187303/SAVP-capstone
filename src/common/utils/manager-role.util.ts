import type { EntityManager } from 'typeorm';

/**
 * Trưởng đơn vị (departments.manager_user_id — gán tay ở màn Phòng ban, API UEL không có)
 * dùng role MANAGER. Thêm/bật MANAGER cho người mới; người cũ thôi làm trưởng (không còn đơn vị
 * nào, không thuộc BGH) thì gỡ MANAGER do hệ thống gán (assigned_by NULL) — MANAGER gán tay giữ nguyên.
 */
export async function syncDepartmentManagerRole(
  em: EntityManager,
  newManagerId: string | null,
  oldManagerId: string | null,
): Promise<void> {
  if (newManagerId === oldManagerId) return;
  if (newManagerId) {
    await em.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, r.id FROM roles r
        WHERE r.role_code = 'MANAGER'
          AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = $1 AND ur.role_id = r.id)`,
      [newManagerId],
    );
    await em.query(
      `UPDATE user_roles ur SET is_active = true, expired_at = NULL, assigned_at = now()
         FROM roles r
        WHERE ur.role_id = r.id AND r.role_code = 'MANAGER' AND ur.user_id = $1
          AND NOT ur.is_active`,
      [newManagerId],
    );
  }
  if (oldManagerId) {
    await em.query(
      `UPDATE user_roles ur SET is_active = false, expired_at = now()
         FROM roles r, users u
        WHERE ur.role_id = r.id AND r.role_code = 'MANAGER' AND ur.user_id = $1
          AND u.id = $1 AND u.leadership_title IS NULL
          AND ur.is_active AND ur.assigned_by IS NULL
          AND NOT EXISTS (SELECT 1 FROM departments d
                           WHERE d.manager_user_id = $1 AND d.deleted_at IS NULL)`,
      [oldManagerId],
    );
  }
}
