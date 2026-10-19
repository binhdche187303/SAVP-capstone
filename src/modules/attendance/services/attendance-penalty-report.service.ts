import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthzReadRepository } from '../../../modules/auth/repositories/authz-read.repository.js';
import { SCHOOL_APPROVER_DEPT_KEY } from '../../meetings/services/calendar-roles.service.js';

const SYSTEM_ADMIN = 'SYSTEM_ADMIN';
const BUSINESS_ADMIN = 'BUSINESS_ADMIN';
const MANAGER = 'MANAGER';

export type PenaltyScope = 'unit' | 'school';

type Range = { from: Date; to: Date };

/**
 * Tổng hợp điểm trừ chuyên cần qua nhiều cuộc họp (3 mức: cá nhân / đơn vị / toàn trường).
 *
 * Quy ước: chỉ tính cuộc họp đã kết thúc (status completed hoặc end_time đã qua, không huỷ)
 * có bật điểm danh. Mỗi thành viên (không từ chối lời mời) 1 dòng / cuộc họp:
 * lý do đã duyệt ⇒ "Có lý do" 0 điểm; có bản ghi điểm danh hợp lệ ⇒ điểm của bản ghi;
 * không có bản ghi ⇒ Vắng (điểm ABSENT). Lý do chờ duyệt / bị từ chối vẫn giữ điểm trừ.
 */
@Injectable()
export class AttendancePenaltyReportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authzRead: AuthzReadRepository,
  ) {}

  /** Phạm vi xem bảng tổng hợp của người dùng (null = chỉ xem của mình). */
  async resolveScope(userId: string): Promise<{ scope: PenaltyScope | null; departmentId: string | null }> {
    const { roles } = await this.authzRead.getEffectiveRolesAndPermissions(userId);
    const [me] = await this.dataSource.query(
      `SELECT department_id, leadership_title FROM users WHERE id = $1`,
      [userId],
    );
    const [cfg] = await this.dataSource.query(
      `SELECT config_value FROM system_configs WHERE config_key = $1`,
      [SCHOOL_APPROVER_DEPT_KEY],
    );
    const isSchool =
      roles.includes(SYSTEM_ADMIN) ||
      roles.includes(BUSINESS_ADMIN) ||
      !!me?.leadership_title ||
      (!!cfg?.config_value && cfg.config_value === me?.department_id);
    if (isSchool) return { scope: 'school', departmentId: me?.department_id ?? null };
    if (roles.includes(MANAGER) && me?.department_id) {
      return { scope: 'unit', departmentId: me.department_id };
    }
    return { scope: null, departmentId: me?.department_id ?? null };
  }

  /** Mức 1 — cá nhân: tổng + danh sách từng cuộc họp. */
  async getUserDetail(actorId: string, targetUserId: string, fromRaw?: string, toRaw?: string) {
    const range = this.parseRange(fromRaw, toRaw);
    if (targetUserId !== actorId) {
      const { scope, departmentId } = await this.resolveScope(actorId);
      const [target] = await this.dataSource.query(
        `SELECT department_id FROM users WHERE id = $1`,
        [targetUserId],
      );
      const allowed =
        scope === 'school' || (scope === 'unit' && !!target && target.department_id === departmentId);
      if (!allowed) {
        throw new ForbiddenException({
          message: 'Bạn không có quyền xem điểm chuyên cần của người này',
          error: 'PERMISSION_DENIED',
        });
      }
    }
    const [user] = await this.dataSource.query(
      `SELECT u.id, u.full_name AS "fullName", u.email, d.department_name AS "departmentName"
         FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`,
      [targetUserId],
    );
    const items = await this.dataSource.query(
      `${this.baseCte()}
       SELECT meeting_id AS "meetingId", meeting_code AS "meetingCode", title, start_time AS "startTime",
              category, points, late_minutes AS "lateMinutes",
              excuse_status AS "excuseStatus", excuse_reason AS "excuseReason",
              excuse_review_note AS "excuseReviewNote"
         FROM rows WHERE user_id = $3
        ORDER BY start_time DESC`,
      [range.from, range.to, targetUserId],
    );
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      user,
      summary: this.summarize(items),
      items: items.map((i: any) => ({ ...i, points: Number(i.points) })),
    };
  }

  /** Mức 2 / 3 — bảng tổng hợp theo người (đơn vị của trưởng phòng, hoặc toàn trường). */
  async getSummary(
    actorId: string,
    q: { from?: string; to?: string; departmentId?: string; search?: string },
  ) {
    const { scope, departmentId: ownDept } = await this.resolveScope(actorId);
    if (!scope) {
      throw new ForbiddenException({
        message: 'Chỉ trưởng đơn vị, P.HC, BGH hoặc quản trị được xem bảng tổng hợp',
        error: 'PERMISSION_DENIED',
      });
    }
    const range = this.parseRange(q.from, q.to);
    const deptFilter = scope === 'unit' ? ownDept : q.departmentId || null;
    const search = q.search?.trim() ? `%${q.search.trim().toLowerCase()}%` : null;

    const rows = await this.dataSource.query(
      `${this.baseCte()}
       SELECT u.id AS "userId", u.full_name AS "fullName", u.email, u.employee_code AS "employeeCode",
              u.position_title AS "positionTitle", d.id AS "departmentId", d.department_name AS "departmentName",
              COUNT(r.meeting_id)::int AS "totalMeetings",
              COUNT(*) FILTER (WHERE r.category = 'present')::int AS present,
              COUNT(*) FILTER (WHERE r.category = 'late')::int AS late,
              COUNT(*) FILTER (WHERE r.category = 'left_early')::int AS "leftEarly",
              COUNT(*) FILTER (WHERE r.category = 'absent')::int AS absent,
              COUNT(*) FILTER (WHERE r.category = 'excused')::int AS excused,
              COUNT(*) FILTER (WHERE r.excuse_status = 'pending')::int AS "pendingExcuses",
              COALESCE(SUM(r.points), 0)::int AS "totalPoints"
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
         LEFT JOIN rows r ON r.user_id = u.id
        WHERE u.deleted_at IS NULL AND u.account_status = 'active'
          AND ($3::uuid IS NULL OR u.department_id = $3::uuid)
          AND ($4::text IS NULL OR lower(u.full_name) LIKE $4 OR lower(u.email) LIKE $4)
        GROUP BY u.id, d.id
       HAVING COUNT(r.meeting_id) > 0
        ORDER BY "totalPoints" ASC, u.full_name`,
      [range.from, range.to, deptFilter, search],
    );
    const departments =
      scope === 'school'
        ? await this.dataSource.query(
            `SELECT id, department_name AS "departmentName" FROM departments
              WHERE deleted_at IS NULL ORDER BY department_name`,
          )
        : await this.dataSource.query(
            `SELECT id, department_name AS "departmentName" FROM departments WHERE id = $1`,
            [ownDept],
          );
    return {
      scope,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      departmentId: deptFilter,
      departments,
      rows,
      totals: {
        people: rows.length,
        totalPoints: rows.reduce((s: number, r: any) => s + Number(r.totalPoints), 0),
        late: rows.reduce((s: number, r: any) => s + r.late, 0),
        leftEarly: rows.reduce((s: number, r: any) => s + r.leftEarly, 0),
        absent: rows.reduce((s: number, r: any) => s + r.absent, 0),
        excused: rows.reduce((s: number, r: any) => s + r.excused, 0),
      },
    };
  }

  /**
   * CTE "rows": 1 dòng / (cuộc họp đã kết thúc có điểm danh, thành viên).
   * $1 = from, $2 = to (theo giờ bắt đầu họp).
   */
  private baseCte() {
    return `
      WITH base AS (
        SELECT m.id AS meeting_id, m.meeting_code, m.title, m.start_time,
               mp.user_id, mp.excuse_status, mp.excuse_reason, mp.excuse_review_note,
               ar.late_minutes, ar.penalty_points AS record_points,
               CASE
                 WHEN mp.excuse_status = 'approved' OR ar.violation_rule_code = 'EXCUSED' THEN 'excused'
                 WHEN ar.id IS NULL THEN 'absent'
                 WHEN ar.attendance_status = 'left_early' OR ar.left_early THEN 'left_early'
                 WHEN ar.attendance_status = 'late' OR ar.is_late THEN 'late'
                 WHEN ar.attendance_status = 'absent' THEN 'absent'
                 ELSE 'present'
               END AS category
          FROM meetings m
          JOIN meeting_participants mp ON mp.meeting_id = m.id AND mp.invitation_status <> 'declined'
          LEFT JOIN LATERAL (
            SELECT a.* FROM attendance_records a
             WHERE a.meeting_id = m.id AND a.user_id = mp.user_id AND a.attendance_status <> 'invalidated'
             ORDER BY a.updated_at DESC, a.created_at DESC LIMIT 1
          ) ar ON TRUE
         WHERE m.deleted_at IS NULL AND m.attendance_enabled
           AND m.status <> 'cancelled'
           AND (m.status = 'completed' OR m.end_time < NOW())
           AND m.start_time >= $1 AND m.start_time < $2
      ),
      rows AS (
        -- Điểm: đã duyệt lý do ⇒ 0; bản ghi đã chốt ⇒ giữ; còn lại theo quy định của hình thức.
        SELECT b.*,
               CASE WHEN b.category = 'excused' THEN 0
                    ELSE COALESCE(b.record_points, vr.penalty_points, 0)
               END AS points
          FROM base b
          LEFT JOIN attendance_violation_rules vr ON vr.rule_code = CASE b.category
            WHEN 'present' THEN 'PRESENT' WHEN 'late' THEN 'LATE'
            WHEN 'left_early' THEN 'LEFT_EARLY' WHEN 'absent' THEN 'ABSENT' END
      )`;
  }

  private summarize(items: Array<{ category: string; points: number | string; excuseStatus: string | null }>) {
    const count = (c: string) => items.filter((i) => i.category === c).length;
    return {
      totalMeetings: items.length,
      present: count('present'),
      late: count('late'),
      leftEarly: count('left_early'),
      absent: count('absent'),
      excused: count('excused'),
      pendingExcuses: items.filter((i) => i.excuseStatus === 'pending').length,
      totalPoints: items.reduce((s, i) => s + Number(i.points), 0),
    };
  }

  /** Mặc định: tháng hiện tại (giờ VN). `to` tính hết ngày. */
  private parseRange(fromRaw?: string, toRaw?: string): Range {
    const now = new Date();
    const vn = new Date(now.getTime() + 7 * 3600 * 1000);
    const defFrom = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), 1) - 7 * 3600 * 1000);
    const defTo = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() + 1, 1) - 7 * 3600 * 1000);
    const day = (s: string, addDays: number) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        throw new BadRequestException({ message: 'Ngày phải có dạng YYYY-MM-DD', error: 'INVALID_DATE' });
      }
      const [y, mo, d] = s.split('-').map(Number);
      return new Date(Date.UTC(y, mo - 1, d + addDays) - 7 * 3600 * 1000);
    };
    const from = fromRaw ? day(fromRaw, 0) : defFrom;
    const to = toRaw ? day(toRaw, 1) : defTo;
    if (from >= to) {
      throw new BadRequestException({ message: 'Khoảng thời gian không hợp lệ', error: 'INVALID_RANGE' });
    }
    return { from, to };
  }
}
