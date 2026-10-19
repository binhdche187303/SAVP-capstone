import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UpdateCalendarRolesDto } from '../dto/update-calendar-roles.dto.js';

export const SCHOOL_APPROVER_DEPT_KEY = 'meeting.school_approver_department_id';

/**
 * Lịch tuần UEL — vai trò lịch gán trên tài khoản:
 * văn thư đơn vị (users.is_unit_clerk), Ban Giám hiệu (users.leadership_title),
 * đơn vị duyệt lịch cấp trường (system_configs).
 */
@Injectable()
export class CalendarRolesService {
  constructor(private readonly dataSource: DataSource) {}

  async getConfig() {
    const [cfg] = await this.dataSource.query(
      `SELECT config_value FROM system_configs WHERE config_key = $1`,
      [SCHOOL_APPROVER_DEPT_KEY],
    );
    const departments = await this.dataSource.query(
      `SELECT id, department_code AS "departmentCode", department_name AS "departmentName"
         FROM departments WHERE deleted_at IS NULL ORDER BY department_code`,
    );
    const users = await this.dataSource.query(
      `SELECT u.id, u.full_name AS "fullName", u.email, u.position_title AS "positionTitle",
              u.department_id AS "departmentId", d.department_name AS "departmentName",
              u.is_unit_clerk AS "isUnitClerk", u.leadership_title AS "leadershipTitle"
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.deleted_at IS NULL AND u.account_status = 'active'
        ORDER BY u.full_name`,
    );
    return {
      schoolApproverDepartmentId: cfg?.config_value || null,
      departments,
      users,
    };
  }

  /**
   * Dữ liệu cho form đặt lịch: người đặt có phải văn thư, danh sách BGH (chủ trì lịch lãnh đạo
   * trường) và người duyệt của lịch đơn vị / lịch cấp trường. Logic người duyệt khớp
   * MeetingsService.resolveCalendarApproverIds.
   */
  async getBookingContext(userId: string) {
    const [me] = await this.dataSource.query(
      `SELECT department_id, is_unit_clerk FROM users WHERE id = $1`,
      [userId],
    );
    const [cfg] = await this.dataSource.query(
      `SELECT config_value FROM system_configs WHERE config_key = $1`,
      [SCHOOL_APPROVER_DEPT_KEY],
    );
    const leaders = await this.dataSource.query(
      `SELECT id, full_name AS "fullName", leadership_title AS "leadershipTitle"
         FROM users WHERE leadership_title IS NOT NULL AND deleted_at IS NULL AND account_status = 'active'
        ORDER BY CASE leadership_title WHEN 'HIEU_TRUONG' THEN 1 WHEN 'BI_THU' THEN 2
                 WHEN 'PHO_HIEU_TRUONG' THEN 3 ELSE 4 END, full_name`,
    );
    const approversOf = async (departmentId: string | null) => {
      if (!departmentId) return { departmentId: null, departmentName: null, approvers: [] };
      const [dept] = await this.dataSource.query(
        `SELECT department_name FROM departments WHERE id = $1`,
        [departmentId],
      );
      const approvers = await this.dataSource.query(
        `SELECT u.id, u.full_name AS "fullName", u.is_unit_clerk AS "isUnitClerk"
           FROM users u
          WHERE u.department_id = $1 AND u.deleted_at IS NULL AND u.account_status = 'active'
            AND (u.is_unit_clerk OR EXISTS (
                  SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                   WHERE ur.user_id = u.id AND ur.is_active
                     AND (ur.expired_at IS NULL OR ur.expired_at > now())
                     AND r.role_code = 'MANAGER'))
          ORDER BY u.is_unit_clerk, u.full_name`,
        [departmentId],
      );
      return { departmentId, departmentName: dept?.department_name ?? null, approvers };
    };
    // Danh sách chọn Chủ trì: lịch đơn vị lọc theo departmentId, hoạt động khác cấp trường dùng toàn bộ.
    const staff = await this.dataSource.query(
      `SELECT u.id, u.full_name AS "fullName", u.email, u.department_id AS "departmentId",
              d.department_name AS "departmentName",
              EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                       WHERE ur.user_id = u.id AND ur.is_active
                         AND (ur.expired_at IS NULL OR ur.expired_at > now())
                         AND r.role_code = 'MANAGER') AS "isManager"
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.deleted_at IS NULL AND u.account_status = 'active'
        ORDER BY u.full_name`,
    );
    return {
      isUnitClerk: !!me?.is_unit_clerk && !!me?.department_id,
      leaders,
      staff,
      unit: await approversOf(me?.department_id ?? null),
      school: await approversOf(cfg?.config_value || null),
    };
  }

  async updateConfig(dto: UpdateCalendarRolesDto, actorId: string) {
    await this.dataSource.transaction(async (m) => {
      const [dept] = await m.query(
        `SELECT id FROM departments WHERE id = $1 AND deleted_at IS NULL`,
        [dto.schoolApproverDepartmentId],
      );
      if (!dept) {
        throw new BadRequestException({
          message: 'Đơn vị duyệt lịch cấp trường không tồn tại',
          error: 'DEPARTMENT_NOT_FOUND',
        });
      }
      const clerkIds = [...new Set(dto.clerkUserIds)];
      const [noDept] = await m.query(
        `SELECT full_name FROM users WHERE id = ANY($1) AND department_id IS NULL LIMIT 1`,
        [clerkIds],
      );
      if (noDept) {
        throw new BadRequestException({
          message: `${noDept.full_name} chưa thuộc đơn vị nào, không thể làm văn thư`,
          error: 'CLERK_WITHOUT_DEPARTMENT',
        });
      }

      await m.query(
        `UPDATE system_configs SET config_value = $2, version_no = version_no + 1, updated_by = $3, updated_at = NOW()
          WHERE config_key = $1`,
        [SCHOOL_APPROVER_DEPT_KEY, dto.schoolApproverDepartmentId, actorId],
      );
      await m.query(
        `UPDATE users SET is_unit_clerk = (id = ANY($1)), updated_at = NOW()
          WHERE is_unit_clerk <> (id = ANY($1))`,
        [clerkIds],
      );
      await m.query(
        `UPDATE users SET leadership_title = NULL, updated_at = NOW() WHERE leadership_title IS NOT NULL`,
      );
      for (const l of dto.leaders) {
        await m.query(
          `UPDATE users SET leadership_title = $2, updated_at = NOW() WHERE id = $1`,
          [l.userId, l.leadershipTitle],
        );
      }
    });
    return this.getConfig();
  }
}
