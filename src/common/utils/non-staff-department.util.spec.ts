import { DataSource } from 'typeorm';
import {
  NON_STAFF_DEPARTMENT_CODES,
  resolveNonStaffDepartmentIds,
  isNonStaffDepartment,
  clearNonStaffDepartmentCache,
} from './non-staff-department.util.js';

const ds = (rows: Array<{ id: string }>) => {
  const query = jest.fn(async () => rows);
  return { ds: { query } as unknown as DataSource, query };
};

describe('non-staff-department.util', () => {
  beforeEach(() => clearNonStaffDepartmentCache());

  it('gồm PARTNER và VISITOR', () => {
    expect(NON_STAFF_DEPARTMENT_CODES).toEqual(['PARTNER', 'VISITOR']);
  });
  it('trả id các đơn vị và nhớ đệm', async () => {
    const { ds: d, query } = ds([{ id: 'p' }, { id: 'v' }]);
    expect(await resolveNonStaffDepartmentIds(d)).toEqual(['p', 'v']);
    await resolveNonStaffDepartmentIds(d);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('isNonStaffDepartment', async () => {
    const { ds: d } = ds([{ id: 'p' }, { id: 'v' }]);
    expect(await isNonStaffDepartment('v', d)).toBe(true);
    expect(await isNonStaffDepartment('khac', d)).toBe(false);
    expect(await isNonStaffDepartment(null, d)).toBe(false);
  });
});
