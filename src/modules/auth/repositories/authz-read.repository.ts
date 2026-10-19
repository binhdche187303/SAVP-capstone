import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

interface AuthzRow {
  role_code: string | null;
  permission_code: string | null;
}

const CLERK_PERMISSIONS = [
  'meeting_request.read',
  'meeting_request.approve',
  'meeting_request.reject',
];

@Injectable()
export class AuthzReadRepository {
  constructor(private readonly dataSource: DataSource) {}

  async getEffectiveRolesAndPermissions(
    userId: string,
  ): Promise<{ roles: string[]; permissions: string[] }> {
    const rows = await this.dataSource.query(
      `
        SELECT DISTINCT r.role_code, p.permission_code
        FROM user_roles ur
        INNER JOIN roles r ON r.id = ur.role_id
        LEFT JOIN role_permissions rp ON rp.role_id = r.id
        LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = $1
          AND ur.is_active = true
          AND (ur.expired_at IS NULL OR ur.expired_at > now())
          AND r.is_active = true
          AND (p.id IS NULL OR p.is_active = true)
      `,
      [userId],
    );

    const roles = Array.from(
      new Set(
        (rows as AuthzRow[])
          .map((row) => row.role_code)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const permissions = Array.from(
      new Set(
        (rows as AuthzRow[])
          .map((row) => row.permission_code)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    // Lịch tuần UEL: văn thư đơn vị (users.is_unit_clerk) được duyệt lịch như trưởng phòng.
    // Phạm vi duyệt (đơn vị / cấp trường) do MeetingsService kiểm theo phòng ban.
    const [clerk] = await this.dataSource.query(
      `SELECT 1 FROM users WHERE id = $1 AND is_unit_clerk = true AND department_id IS NOT NULL`,
      [userId],
    );
    if (clerk) {
      for (const code of CLERK_PERMISSIONS) {
        if (!permissions.includes(code)) permissions.push(code);
      }
    }

    return { roles, permissions };
  }
}
