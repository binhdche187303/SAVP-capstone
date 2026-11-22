import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

interface AuthzRow {
  role_code: string | null;
  permission_code: string | null;
}

interface EffectiveAuthz {
  roles: string[];
  permissions: string[];
}

const CLERK_PERMISSIONS = [
  'meeting_request.read',
  'meeting_request.approve',
  'meeting_request.reject',
];

/**
 * Cache rất ngắn theo userId: một request thường đi qua PermissionsGuard, BiometricEnforcementGuard
 * rồi service lại gọi tiếp — trước đây mỗi lần là 2 query. TTL 3 giây đủ gộp các lần gọi trong cùng
 * request (và các request song song của một màn hình), còn thay đổi role/quyền có hiệu lực gần như
 * ngay; gọi `invalidate()` sau khi sửa role_permissions / user_roles để áp dụng tức thì.
 */
const CACHE_TTL_MS = 3_000;
const CACHE_MAX_ENTRIES = 5_000;

@Injectable()
export class AuthzReadRepository {
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: Promise<EffectiveAuthz> }
  >();

  constructor(private readonly dataSource: DataSource) {}

  async getEffectiveRolesAndPermissions(
    userId: string,
  ): Promise<EffectiveAuthz> {
    const now = Date.now();
    const hit = this.cache.get(userId);
    let pending: Promise<EffectiveAuthz>;
    if (hit && hit.expiresAt > now) {
      pending = hit.value;
    } else {
      if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.clear();
      pending = this.load(userId);
      this.cache.set(userId, { expiresAt: now + CACHE_TTL_MS, value: pending });
      // Lỗi DB không được cache lại.
      pending.catch(() => this.cache.delete(userId));
    }
    const value = await pending;
    // Trả bản sao: caller có thể push/sort mảng mà không làm bẩn cache.
    return { roles: [...value.roles], permissions: [...value.permissions] };
  }

  /** Xoá cache của một user (hoặc toàn bộ) sau khi đổi role / quyền. */
  invalidate(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }

  private async load(userId: string): Promise<EffectiveAuthz> {
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
