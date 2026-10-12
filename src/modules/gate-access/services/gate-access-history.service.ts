import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ListGateAccessHistoryQueryDto } from '../dto/list-gate-access-history-query.dto.js';
import type { ListGateAccessHistoryAdminQueryDto } from '../dto/list-gate-access-history-admin-query.dto.js';
import {
  toGateAccessHistoryItemDto,
  type GateAccessHistoryItemDto,
  type GateAccessHistoryRow,
} from '../dto/gate-access-history-item-response.dto.js';
import {
  toGateAccessHistoryDetailDto,
  type GateAccessHistoryDetailDto,
} from '../dto/gate-access-history-detail-response.dto.js';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * DATA-03 (crux): công thức lọc 1-dòng/1-phiên. Giữ toàn bộ `in` (đã ghép hoặc chưa —
 * "Hoàn tất"/"Chưa hoàn tất" EX1); giữ `out` CHỈ khi chưa ghép (EX2 "Không xác định thời điểm
 * vào"). `out` đã ghép bị loại vì đã được biểu diễn qua `check_out_time` của dòng `in`.
 */
const SESSION_FILTER = `(l.direction = 'enter' OR l.paired_log_id IS NULL)`;

/**
 * DATA-02 (crux): JOIN zone LUÔN kèm `z.deleted_at IS NULL`. Self-join `paired` lấy dòng đối
 * ứng. Bọc trong CTE `sessions` (KHÔNG phải subquery SELECT trần) vì Postgres KHÔNG cho phép
 * tham chiếu alias `CASE WHEN ... END AS check_in_time` bên trong biểu thức lồng như
 * `COALESCE(check_in_time, check_out_time)` ở `ORDER BY`/`WHERE` của CÙNG một SELECT (lỗi
 * thật đã gặp khi verify trên RDS: `42703 column "check_in_time" does not exist`) — alias chỉ
 * dùng được trực tiếp (bare reference), không dùng được lồng trong hàm khác ở cùng cấp SELECT.
 * CTE materialize xong thì `check_in_time`/`check_out_time` trở thành cột thật, dùng được ở
 * WHERE/ORDER BY của SELECT bên ngoài.
 */
export const SESSIONS_CTE = `
  WITH sessions AS (
    SELECT
      l.id, l.zone_id, z.zone_code, z.zone_name, l.user_id, l.plate_number, l.metadata_json,
      l.access_time,
      CASE WHEN l.direction = 'enter' THEN l.access_time ELSE NULL END AS check_in_time,
      CASE
        WHEN l.direction = 'leave' THEN l.access_time
        WHEN l.direction = 'enter' AND paired.id IS NOT NULL THEN paired.access_time
        ELSE NULL
      END AS check_out_time,
      l.duration_seconds,
      CASE WHEN l.paired_log_id IS NOT NULL THEN 'completed' ELSE 'incomplete' END AS session_status
    FROM gate_access_logs l
    LEFT JOIN zones z ON z.id = l.zone_id AND z.deleted_at IS NULL
    LEFT JOIN gate_access_logs paired ON paired.id = l.paired_log_id
    WHERE ${SESSION_FILTER}
  )
`;

const USER_JOIN = ` LEFT JOIN users u ON u.id = sessions.user_id`;

/**
 * GateAccessHistoryService (GAH-001 / UC-117) — tra cứu lịch sử ra/vào cổng, READ-ONLY tuyệt
 * đối. 1 dòng = 1 PHIÊN (self-join, xem `BASE_SELECT`/`SESSION_FILTER`) — KHÔNG PHẢI 1 dòng/1
 * log thô, đúng POST-1 SRS UC-117.
 *
 * Dùng raw SQL (`DataSource.manager.query`) mirror `VehicleHistoryService`: self-join + CASE
 * khó diễn đạt gọn bằng QueryBuilder khi điều kiện JOIN phụ thuộc giá trị cột `direction`.
 */
@Injectable()
export class GateAccessHistoryService {
  constructor(private readonly dataSource: DataSource) {}

  async listForUser(
    userId: string,
    query: ListGateAccessHistoryQueryDto,
  ): Promise<{ items: GateAccessHistoryItemDto[]; meta: PaginationMeta }> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    params.push(userId);
    conditions.push(`sessions.user_id = $${params.length}`);
    this.applyFilters(query, params, conditions);

    const { items, meta } = await this.paginate(
      conditions.join(' AND '),
      params,
      query,
      false,
    );
    return { items, meta };
  }

  async listAll(
    query: ListGateAccessHistoryAdminQueryDto,
  ): Promise<{ items: GateAccessHistoryItemDto[]; meta: PaginationMeta }> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (query.userId) {
      params.push(query.userId);
      conditions.push(`sessions.user_id = $${params.length}`);
    }
    const withUserJoin = Boolean(query.departmentId);
    if (query.departmentId) {
      params.push(query.departmentId);
      conditions.push(`u.department_id = $${params.length}`);
    }
    this.applyFilters(query, params, conditions);

    const { items, meta } = await this.paginate(
      conditions.join(' AND '),
      params,
      query,
      true,
      withUserJoin,
    );
    return { items, meta };
  }

  async getDetailForUser(
    id: string,
    userId: string,
  ): Promise<GateAccessHistoryDetailDto> {
    const rows: GateAccessHistoryRow[] = await this.dataSource.manager.query(
      `${SESSIONS_CTE} SELECT * FROM sessions WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    const row = rows[0];
    if (!row) {
      throw this.notFound();
    }
    return toGateAccessHistoryDetailDto(row, false);
  }

  async getDetailAny(id: string): Promise<GateAccessHistoryDetailDto> {
    const rows: GateAccessHistoryRow[] = await this.dataSource.manager.query(
      `${SESSIONS_CTE} SELECT * FROM sessions WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) {
      throw this.notFound();
    }
    return toGateAccessHistoryDetailDto(row, true);
  }

  /** Filter động dùng chung own + admin: `from`/`to` trên `access_time`, `zone_id` trực tiếp. */
  private applyFilters(
    query: ListGateAccessHistoryQueryDto,
    params: unknown[],
    conditions: string[],
  ): void {
    if (query.from) {
      params.push(query.from);
      conditions.push(`sessions.access_time >= $${params.length}`);
    }
    if (query.to) {
      params.push(query.to);
      conditions.push(`sessions.access_time <= $${params.length}`);
    }
    if (query.zoneId) {
      params.push(query.zoneId);
      conditions.push(`sessions.zone_id = $${params.length}`);
    }
  }

  private async paginate(
    where: string,
    params: unknown[],
    query: ListGateAccessHistoryQueryDto,
    includeUserId: boolean,
    withUserJoin = false,
  ): Promise<{ items: GateAccessHistoryItemDto[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const join = withUserJoin ? USER_JOIN : '';
    const whereClause = where ? `WHERE ${where}` : '';

    const countRows: Array<{ total: number }> =
      await this.dataSource.manager.query(
        `${SESSIONS_CTE} SELECT COUNT(*)::int AS total FROM sessions${join} ${whereClause}`,
        params,
      );
    const total = countRows[0]?.total ?? 0;

    const rows: GateAccessHistoryRow[] = await this.dataSource.manager.query(
      `${SESSIONS_CTE} SELECT sessions.* FROM sessions${join} ${whereClause}
       ORDER BY COALESCE(sessions.check_in_time, sessions.check_out_time) DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    return {
      items: rows.map((r) => toGateAccessHistoryItemDto(r, includeUserId)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'GATE_ACCESS_LOG_NOT_FOUND',
      message: 'Không tìm thấy lịch sử ra vào',
    });
  }
}
