import { DataSource } from 'typeorm';
import { AuthzReadRepository } from './authz-read.repository';

describe('AuthzReadRepository', () => {
  const rows = [
    { role_code: 'EMPLOYEE', permission_code: 'meeting.create' },
    { role_code: 'EMPLOYEE', permission_code: 'schedule.read.self' },
  ];

  const make = () => {
    const query = jest
      .fn()
      .mockImplementation((sql: string) =>
        Promise.resolve(sql.includes('is_unit_clerk') ? [] : rows),
      );
    return { query, repo: new AuthzReadRepository({ query } as unknown as DataSource) };
  };

  it('dedupes lookups for the same user within the TTL', async () => {
    const { query, repo } = make();
    await Promise.all([
      repo.getEffectiveRolesAndPermissions('u1'),
      repo.getEffectiveRolesAndPermissions('u1'),
    ]);
    await repo.getEffectiveRolesAndPermissions('u1');
    expect(query).toHaveBeenCalledTimes(2); // 1 lần roles/permissions + 1 lần văn thư
  });

  it('returns copies so callers cannot mutate the cached value', async () => {
    const { repo } = make();
    const first = await repo.getEffectiveRolesAndPermissions('u1');
    first.permissions.push('injected');
    const second = await repo.getEffectiveRolesAndPermissions('u1');
    expect(second.permissions).not.toContain('injected');
  });

  it('reloads after invalidate()', async () => {
    const { query, repo } = make();
    await repo.getEffectiveRolesAndPermissions('u1');
    repo.invalidate('u1');
    await repo.getEffectiveRolesAndPermissions('u1');
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('adds clerk permissions for unit clerks', async () => {
    const query = jest
      .fn()
      .mockImplementation((sql: string) =>
        Promise.resolve(sql.includes('is_unit_clerk') ? [{ '?column?': 1 }] : rows),
      );
    const repo = new AuthzReadRepository({ query } as unknown as DataSource);
    const { permissions } = await repo.getEffectiveRolesAndPermissions('u1');
    expect(permissions).toEqual(
      expect.arrayContaining(['meeting_request.approve', 'meeting_request.read']),
    );
  });
});
