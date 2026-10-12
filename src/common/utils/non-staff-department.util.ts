import { DataSource } from 'typeorm';

/** Đơn vị không phải nhân sự: đối tác (PARTNER) và tài khoản khách ẩn của phân hệ Khách (VISITOR). */
export const NON_STAFF_DEPARTMENT_CODES = ['PARTNER', 'VISITOR'] as const;

let cache: string[] | null = null;

export function clearNonStaffDepartmentCache(): void {
  cache = null;
}

export async function resolveNonStaffDepartmentIds(dataSource: Pick<DataSource, 'query'>): Promise<string[]> {
  if (cache) return cache;
  const rows: Array<{ id: string }> = await dataSource.query(
    `SELECT id FROM departments WHERE department_code = ANY($1) AND deleted_at IS NULL`,
    [NON_STAFF_DEPARTMENT_CODES],
  );
  cache = rows.map((r) => r.id);
  return cache;
}

export async function isNonStaffDepartment(
  departmentId: string | null | undefined,
  dataSource: Pick<DataSource, 'query'>,
): Promise<boolean> {
  if (!departmentId) return false;
  return (await resolveNonStaffDepartmentIds(dataSource)).includes(departmentId);
}
