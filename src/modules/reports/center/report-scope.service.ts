import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import type { ReportDefinition, ReportFilters, ResolvedScope } from './report-model.js';

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

  async resolve(userId: string, definition: ReportDefinition, filters: ReportFilters): Promise<ResolvedScope> {
    const { roles } = await this.authz.getEffectiveRolesAndPermissions(userId);
    if (roles.includes('SYSTEM_ADMIN') || roles.includes('BUSINESS_ADMIN')) {
      return { unrestricted: true, departmentIds: null };
    }
    if (!roles.includes('MANAGER')) throw forbid('Bạn không có quyền xem báo cáo này.', 'PERMISSION_DENIED');
    if (!definition.hasDepartmentScope) throw forbid('Báo cáo này không có phạm vi theo đơn vị của bạn.', 'REPORT_OUT_OF_SCOPE');

    const managed: string[] = (await this.dataSource.query(`SELECT id FROM departments WHERE manager_user_id = $1`, [userId])).map((r: { id: string }) => r.id);
    const requested = filters['departmentId'];
    if (requested && !managed.includes(requested)) throw forbid('Phòng ban nằm ngoài phạm vi quản lý của bạn.', 'DEPARTMENT_OUT_OF_SCOPE');

    const staffId = filters['staffId'];
    if (staffId) {
      const rows: Array<{ department_id: string | null }> = await this.dataSource.query(`SELECT department_id FROM users WHERE id = $1`, [staffId]);
      const dept = rows[0]?.department_id ?? null;
      if (!dept || !managed.includes(dept)) throw forbid('Cá nhân nằm ngoài phạm vi quản lý của bạn.', 'DEPARTMENT_OUT_OF_SCOPE');
    }
    return { unrestricted: false, departmentIds: requested ? [requested] : managed };
  }
}
