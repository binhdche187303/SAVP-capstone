import { filterValues } from '../../../common/utils/filter-selection.js';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import type { ReportDefinition, ReportFilters, ResolvedScope } from './report-model.js';

/** Báo cáo chuyên cần sinh viên lọc theo `department_id` của sinh viên → chỉ có nghĩa với đơn vị có sinh viên (khoa). */
const NO_STUDENT_REASON = 'Đơn vị bạn quản lý không có sinh viên.';

const forbid = (message: string, code: string) =>
  new ForbiddenException({ success: false, message, error: { code, details: {} } });

/**
 * Phạm vi dữ liệu theo vai trò (RPT-CENTER-BE-001 §9). Quy tắc chép từ `gate-access-report.service.ts#resolveScope`
 * (không sửa file đó): quản trị không giới hạn; MANAGER chỉ các đơn vị có `manager_user_id` là mình.
 */
@Injectable()
export class ReportScopeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authz: AuthzReadRepository,
  ) {}

  /**
   * Lý do người này KHÔNG dùng được loại báo cáo (null = dùng được). Cùng điều kiện với `resolve()` để danh mục
   * không mời MANAGER mở thẻ "Phương tiện" / "Sự kiện an ninh" rồi mới gặp khối lỗi 403.
   */
  async unavailableReason(userId: string, definition: ReportDefinition): Promise<string | null> {
    const { roles } = await this.authz.getEffectiveRolesAndPermissions(userId);
    if (roles.includes('SYSTEM_ADMIN') || roles.includes('BUSINESS_ADMIN')) return null;
    if (!roles.includes('MANAGER')) return 'Bạn không có quyền xem báo cáo này.';
    if (!definition.hasDepartmentScope) return 'Báo cáo này không có phạm vi theo đơn vị của bạn.';
    if (definition.type === 'student-attendance' && !(await this.hasStudents(await this.managedDepartments(userId)))) {
      return NO_STUDENT_REASON;
    }
    return null;
  }

  /** Đơn vị MANAGER quản lý (Ban giám hiệu — có `leadership_title` — quản lý mọi đơn vị). */
  private async managedDepartments(userId: string): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL))`,
      [userId],
    );
    return rows.map((r) => r.id);
  }

  /** Có ít nhất 1 sinh viên (vai trò STUDENT đang hiệu lực) thuộc các đơn vị này không. */
  private async hasStudents(departmentIds: string[]): Promise<boolean> {
    if (!departmentIds.length) return false;
    const [row]: Array<{ has: boolean }> = await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM users u
           JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true
           JOIN roles r ON r.id = ur.role_id AND r.role_code = 'STUDENT'
          WHERE u.deleted_at IS NULL AND u.department_id = ANY($1::uuid[])
       ) AS has`,
      [departmentIds],
    );
    return row?.has === true;
  }

  async resolve(userId: string, definition: ReportDefinition, filters: ReportFilters): Promise<ResolvedScope> {
    const { roles } = await this.authz.getEffectiveRolesAndPermissions(userId);
    if (roles.includes('SYSTEM_ADMIN') || roles.includes('BUSINESS_ADMIN')) {
      return { unrestricted: true, departmentIds: null };
    }
    if (!roles.includes('MANAGER')) throw forbid('Bạn không có quyền xem báo cáo này.', 'PERMISSION_DENIED');
    if (!definition.hasDepartmentScope) throw forbid('Báo cáo này không có phạm vi theo đơn vị của bạn.', 'REPORT_OUT_OF_SCOPE');

    const managed = await this.managedDepartments(userId);
    if (definition.type === 'student-attendance' && !(await this.hasStudents(managed))) {
      throw forbid(NO_STUDENT_REASON, 'REPORT_OUT_OF_SCOPE');
    }
    const requested = filters['departmentId'];
    if (requested && filterValues(requested).some(id => !managed.includes(id))) throw forbid('Phòng ban nằm ngoài phạm vi quản lý của bạn.', 'DEPARTMENT_OUT_OF_SCOPE');

    const staffId = filters['staffId'];
    if (staffId) {
      const rows: Array<{ department_id: string | null }> = await this.dataSource.query(`SELECT department_id FROM users WHERE id = ANY($1::uuid[])`, [filterValues(staffId)]);
      if (rows.length !== filterValues(staffId).length || rows.some(row => !row.department_id || !managed.includes(row.department_id))) throw forbid('Cá nhân nằm ngoài phạm vi quản lý của bạn.', 'DEPARTMENT_OUT_OF_SCOPE');
    }
    return { unrestricted: false, departmentIds: requested ? filterValues(requested) : managed };
  }
}
