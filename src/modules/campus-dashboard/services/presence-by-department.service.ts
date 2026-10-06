import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  DepartmentPresenceDto,
  PresenceByDepartmentResponseDto,
} from '../dto/presence-by-department-response.dto.js';

/** startOfDay theo server local timezone (mirror pattern UC-126 §2.4). */
function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Log cổng CUỐI CÙNG hôm nay của mỗi user (đã nhận diện). Người có log cuối là `enter` được
 * coi là đang có mặt trong khuôn viên. Chỉ xét trong ngày ⇒ quên quét lúc về thì sang ngày
 * hôm sau tự về 0. `id` làm tie-break khi 2 log trùng `access_time`.
 */
const PRESENCE_BY_DEPARTMENT_SQL = `
  WITH last_log AS (
    SELECT DISTINCT ON (user_id) user_id, direction
    FROM gate_access_logs
    WHERE user_id IS NOT NULL
      AND direction IN ('enter', 'leave')
      AND access_time >= $1
    ORDER BY user_id, access_time DESC, id DESC
  ),
  staff AS (
    SELECT u.id, u.department_id, (l.direction = 'enter') AS present
    FROM users u
    LEFT JOIN last_log l ON l.user_id = u.id
    WHERE u.deleted_at IS NULL AND u.employment_status = 'active'
  )
  SELECT d.id AS department_id, d.department_code, d.department_name,
         COUNT(s.id)::int AS total_staff,
         COUNT(s.id) FILTER (WHERE s.present)::int AS present_count
  FROM departments d
  LEFT JOIN staff s ON s.department_id = d.id
  WHERE d.deleted_at IS NULL AND d.is_active = true
  GROUP BY d.id, d.department_code, d.department_name
  UNION ALL
  SELECT NULL, NULL, NULL,
         COUNT(s.id)::int,
         COUNT(s.id) FILTER (WHERE s.present)::int
  FROM staff s
  WHERE s.department_id IS NULL
  HAVING COUNT(s.id) > 0
`;

interface PresenceRow {
  department_id: string | null;
  department_code: string | null;
  department_name: string | null;
  total_staff: number;
  present_count: number;
}

/**
 * PresenceByDepartmentService (2.12 — thống kê hiện diện theo phòng ban).
 * Module 100% READ-ONLY (DATA-01). Nguồn: `gate_access_logs` (nhận diện tại cổng) — KHÁC nguồn
 * camera đếm đầu người của overview (ẩn danh, đếm cả khách) ⇒ hai con số không khớp nhau.
 */
@Injectable()
export class PresenceByDepartmentService {
  constructor(private readonly dataSource: DataSource) {}

  async getPresence(): Promise<PresenceByDepartmentResponseDto> {
    const now = new Date();
    const rows: PresenceRow[] = await this.dataSource.query(
      PRESENCE_BY_DEPARTMENT_SQL,
      [startOfDay(now)],
    );

    const departments: DepartmentPresenceDto[] = rows
      .map((r) => ({
        departmentId: r.department_id,
        departmentCode: r.department_code,
        departmentName: r.department_name,
        presentCount: Number(r.present_count) || 0,
        totalStaff: Number(r.total_staff) || 0,
      }))
      .sort(
        (a, b) =>
          b.presentCount - a.presentCount ||
          // Nhóm "chưa gán phòng ban" luôn đứng cuối khi bằng số.
          (a.departmentName === null ? 1 : 0) -
            (b.departmentName === null ? 1 : 0) ||
          (a.departmentName ?? '').localeCompare(b.departmentName ?? ''),
      );

    return {
      generatedAt: now.toISOString(),
      totalPresent: departments.reduce((s, d) => s + d.presentCount, 0),
      departments,
    };
  }
}
