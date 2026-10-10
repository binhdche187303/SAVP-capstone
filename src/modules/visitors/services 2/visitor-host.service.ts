import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { resolveNonStaffDepartmentIds } from '../../../common/utils/non-staff-department.util.js';

export interface PublicHost {
  id: string;
  fullName: string;
  departmentId: string | null;
  departmentName: string;
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Tìm người cần gặp cho trang công khai (BR-V20): chỉ họ tên + đơn vị, nhân sự đang hoạt động, không đối tác/khách. */
@Injectable()
export class VisitorHostService {
  constructor(private readonly dataSource: DataSource) {}

  async search(q: string): Promise<PublicHost[]> {
    const term = q.trim();
    if (term.length < 2) return [];
    const nonStaff = await resolveNonStaffDepartmentIds(this.dataSource);
    const rows: Array<{ id: string; full_name: string; department_id: string | null; department_name: string | null }> = await this.dataSource.query(
      `SELECT u.id, u.full_name, u.department_id, d.department_name
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.deleted_at IS NULL AND u.account_status = 'active' AND u.employment_status IN ('active','probation')
          AND (u.department_id IS NULL OR NOT (u.department_id = ANY($2::uuid[])))
          AND (unaccent(u.full_name) ILIKE unaccent($1) OR unaccent(COALESCE(d.department_name,'')) ILIKE unaccent($1))
        ORDER BY u.full_name LIMIT 10`,
      [`%${escapeLike(term)}%`, nonStaff],
    );
    return rows.map((r) => ({ id: r.id, fullName: r.full_name, departmentId: r.department_id, departmentName: r.department_name ?? '' }));
  }

  async findById(id: string): Promise<PublicHost | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const nonStaff = await resolveNonStaffDepartmentIds(this.dataSource);
    const rows: Array<{ id: string; full_name: string; department_id: string | null; department_name: string | null }> = await this.dataSource.query(
      `SELECT u.id, u.full_name, u.department_id, d.department_name
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.id = $1 AND u.deleted_at IS NULL AND u.account_status = 'active' AND u.employment_status IN ('active','probation')
          AND (u.department_id IS NULL OR NOT (u.department_id = ANY($2::uuid[])))`,
      [id, nonStaff],
    );
    const r = rows[0];
    return r ? { id: r.id, fullName: r.full_name, departmentId: r.department_id, departmentName: r.department_name ?? '' } : null;
  }
}
