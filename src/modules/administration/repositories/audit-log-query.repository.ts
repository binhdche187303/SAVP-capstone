import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface AuditLogFilters {
  from?: string;
  to?: string;
  userId?: string;
  actionType?: string;
  entityType?: string;
  severity?: string;
  search?: string;
  searchActionTypes?: string[];
  searchEntityTypes?: string[];
}

/** Escape ký tự đặc biệt của LIKE để từ khóa được so khớp nguyên văn. */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

export interface AuditLogRow {
  id: string;
  created_at: Date;
  user_id: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  severity: string;
  user_full_name: string | null;
  // Chỉ có ở findPaginated (list). findAllForExport KHÔNG select cột này.
  user_avatar_url?: string | null;
}

/** Một giá trị action_type có trong dữ liệu + số bản ghi tương ứng. */
export interface ActionTypeCountRow {
  action_type: string;
  count: number;
}

/**
 * Row giàu field cho GET /users/:userId/audit-logs — trả kèm actor email,
 * ip_address và các JSON payload (new/metadata/old) để service dựng
 * description/status/payload cho FE (be-user-activity-log-requirement.md).
 */
export interface UserAuditLogRow {
  id: string;
  created_at: Date;
  user_id: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  severity: string;
  ip_address: string | null;
  new_value_json: Record<string, unknown> | null;
  metadata_json: Record<string, unknown> | null;
  old_value_json: Record<string, unknown> | null;
  user_full_name: string | null;
  user_email: string | null;
}

/**
 * AuditLogQueryRepository — repository ĐỌC dành riêng cho feature view audit logs.
 *
 * KHÔNG sửa và KHÔNG mở rộng AuditLogsService (service GHI dùng chung).
 * Repository này dùng raw SQL parameterized để đảm bảo:
 * - Không nối chuỗi SQL (tránh SQL injection)
 * - LEFT JOIN users để resolve actorName trong 1 query (T015)
 * - COUNT(*) riêng biệt không JOIN/ORDER BY/LIMIT (T016)
 * - ORDER BY al.created_at DESC cố định, không thể thay đổi qua query param
 */
@Injectable()
export class AuditLogQueryRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * T015: Truy vấn phân trang audit_logs với LEFT JOIN users.
   *
   * @param filters - object điều kiện AND từ buildFilters()
   * @param page - trang hiện tại (bắt đầu từ 1)
   * @param limit - số bản ghi mỗi trang
   * @returns mảng row kết quả
   */
  async findPaginated(
    filters: AuditLogFilters,
    page: number,
    limit: number,
  ): Promise<AuditLogRow[]> {
    const { sql, params } = this.buildWhereClause(filters);

    const query = `
      SELECT
        al.id,
        al.created_at,
        al.user_id,
        al.action_type,
        al.entity_type,
        al.entity_id,
        al.severity,
        u.full_name AS user_full_name,
        u.avatar_url AS user_avatar_url
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ${sql}
      ORDER BY al.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const offset = (page - 1) * limit;
    return this.dataSource.query(query, [...params, limit, offset]);
  }

  /**
   * findAllForExport — dùng cho GET /audit-logs/export (audit-log-export.service.ts).
   *
   * KHÔNG phân trang (không OFFSET) — luôn lấy từ bản ghi mới nhất, cắt ở
   * LIMIT an toàn do caller truyền vào (MAX_EXPORT_ROWS). `filters.from`/
   * `filters.to` là bắt buộc ở tầng DTO (ExportAuditLogsDto) nên caller phải
   * truyền khoảng thời gian, nhưng hàm này không tự ép buộc — chỉ build WHERE
   * y hệt findPaginated/countMatching.
   */
  async findAllForExport(
    filters: AuditLogFilters,
    limit: number,
  ): Promise<AuditLogRow[]> {
    const { sql, params } = this.buildWhereClause(filters);

    const query = `
      SELECT
        al.id,
        al.created_at,
        al.user_id,
        al.action_type,
        al.entity_type,
        al.entity_id,
        al.severity,
        u.full_name AS user_full_name
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ${sql}
      ORDER BY al.created_at DESC
      LIMIT $${params.length + 1}
    `;

    return this.dataSource.query(query, [...params, limit]);
  }

  /**
   * T016: Đếm tổng bản ghi khớp filter — KHÔNG JOIN/ORDER BY/LIMIT.
   *
   * @param filters - cùng object điều kiện AND với findPaginated
   * @returns total count
   */
  async countMatching(filters: AuditLogFilters): Promise<number> {
    const { sql, params } = this.buildWhereClause(filters);

    const query = `
      SELECT COUNT(*) AS total
      FROM audit_logs al
      ${sql}
    `;

    const result = await this.dataSource.query(query, params);
    return parseInt(result[0]?.total ?? '0', 10);
  }

  /**
   * findDistinctActionTypes — liệt kê tất cả giá trị action_type CÓ THẬT trong
   * bảng audit_logs kèm số lượng bản ghi, sắp xếp theo tần suất giảm dần.
   *
   * Dùng cho GET /audit-logs/action-types để FE dựng dropdown "Loại hành động"
   * từ dữ liệu thật thay vì hard-code — action_type là chuỗi tự do (varchar),
   * không có enum cố định nên đây là nguồn tra cứu chính xác duy nhất.
   */
  async findDistinctActionTypes(): Promise<ActionTypeCountRow[]> {
    const query = `
      SELECT al.action_type, COUNT(*) AS count
      FROM audit_logs al
      GROUP BY al.action_type
      ORDER BY COUNT(*) DESC, al.action_type ASC
    `;
    const rows: Array<{ action_type: string; count: string }> =
      await this.dataSource.query(query);
    return rows.map((r) => ({
      action_type: r.action_type,
      count: parseInt(r.count ?? '0', 10),
    }));
  }

  /**
   * findUserAuditLogs — nhật ký hoạt động của MỘT user với tư cách ĐỐI TƯỢNG
   * bị tác động (entity_type='users' AND entity_id=userId).
   *
   * Khác findPaginated (lọc theo actor `user_id`). Dùng cho modal "Lịch sử
   * hoạt động" của Business Admin — xem be-user-activity-log-requirement.md.
   * ORDER BY created_at DESC cố định; LEFT JOIN users lấy tên + email actor.
   */
  async findUserAuditLogs(
    targetUserId: string,
    page: number,
    limit: number,
  ): Promise<UserAuditLogRow[]> {
    const offset = (page - 1) * limit;
    const query = `
      SELECT
        al.id,
        al.created_at,
        al.user_id,
        al.action_type,
        al.entity_type,
        al.entity_id,
        al.severity,
        al.ip_address,
        al.new_value_json,
        al.metadata_json,
        al.old_value_json,
        u.full_name AS user_full_name,
        u.email AS user_email
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.entity_type = 'users' AND al.entity_id = $1
      ORDER BY al.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    return this.dataSource.query(query, [targetUserId, limit, offset]);
  }

  /**
   * countUserAuditLogs — đếm tổng log của MỘT user (đối tượng bị tác động).
   * KHÔNG JOIN/ORDER BY/LIMIT.
   */
  async countUserAuditLogs(targetUserId: string): Promise<number> {
    const query = `
      SELECT COUNT(*) AS total
      FROM audit_logs al
      WHERE al.entity_type = 'users' AND al.entity_id = $1
    `;
    const result = await this.dataSource.query(query, [targetUserId]);
    return parseInt(result[0]?.total ?? '0', 10);
  }

  /**
   * Xây dựng mệnh đề WHERE parameterized từ object filters.
   * Bỏ qua field không truyền — tất cả điều kiện kết hợp AND.
   *
   * @param filters - object điều kiện
   * @returns { sql: WHERE clause string | empty, params: positional params }
   */
  private buildWhereClause(filters: AuditLogFilters): {
    sql: string;
    params: unknown[];
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.from) {
      params.push(filters.from);
      conditions.push(`al.created_at >= $${params.length}`);
    }

    if (filters.to) {
      params.push(filters.to);
      conditions.push(`al.created_at <= $${params.length}`);
    }

    if (filters.userId) {
      params.push(filters.userId);
      conditions.push(`al.user_id = $${params.length}`);
    }

    if (filters.actionType) {
      params.push(filters.actionType);
      conditions.push(`al.action_type = $${params.length}`);
    }

    if (filters.entityType) {
      params.push(filters.entityType);
      conditions.push(`al.entity_type = $${params.length}`);
    }

    if (filters.severity) {
      params.push(filters.severity);
      conditions.push(`al.severity = $${params.length}`);
    }

    if (filters.search) {
      // Subquery thay vì JOIN để countMatching vẫn không cần JOIN users.
      // Dòng user_id NULL hiển thị "Hệ thống" ở FE nên cũng khớp từ khóa đó.
      params.push(`%${escapeLike(filters.search)}%`);
      const p = `$${params.length}`;
      const any: string[] = [
        `al.user_id IN (SELECT su.id FROM users su WHERE unaccent(su.full_name) ILIKE unaccent(${p}) OR su.email ILIKE ${p})`,
        `(al.user_id IS NULL AND unaccent('Hệ thống') ILIKE unaccent(${p}))`,
        `replace(al.action_type, '_', ' ') ILIKE replace(${p}, '_', ' ')`,
        `al.entity_type ILIKE ${p}`,
        `al.ip_address ILIKE ${p}`,
      ];
      if (filters.searchActionTypes?.length) {
        params.push(filters.searchActionTypes);
        any.push(`al.action_type = ANY($${params.length})`);
      }
      if (filters.searchEntityTypes?.length) {
        params.push(filters.searchEntityTypes);
        any.push(`al.entity_type = ANY($${params.length})`);
      }
      conditions.push(`(${any.join(' OR ')})`);
    }

    const sql =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { sql, params };
  }
}
