import { DataSource, QueryRunner } from 'typeorm';
import {
  AuditLogQueryRepository,
  AuditLogFilters,
} from '../repositories/audit-log-query.repository.js';
import { SeedAuditSystemReadPermission20260703000000 } from '../../../database/migrations/20260703000000-SeedAuditSystemReadPermission.js';

/**
 * Unit tests cho AuditLogQueryRepository.
 *
 * T023 — findPaginated + countMatching với các filter AND kết hợp, phân trang, sort
 * T029 — seed permission audit.system.read (integration hint)
 */
describe('AuditLogQueryRepository', () => {
  let repository: AuditLogQueryRepository;
  let mockDataSource: { query: jest.Mock };

  beforeEach(() => {
    mockDataSource = { query: jest.fn() };
    repository = new AuditLogQueryRepository(
      mockDataSource as unknown as DataSource,
    );
  });

  // ---------------------------------------------------------------------------
  // T023: findPaginated — filter kết hợp AND, phân trang, sort
  // ---------------------------------------------------------------------------
  describe('T023 — findPaginated()', () => {
    it('should call query with no WHERE when filters is empty', async () => {
      mockDataSource.query.mockResolvedValue([]);

      await repository.findPaginated({}, 1, 20);

      const [sql, params] = mockDataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).not.toMatch(/WHERE/i);
      expect(params).toEqual([20, 0]); // limit=20, offset=0
    });

    it('should include WHERE clause when filters provided', async () => {
      mockDataSource.query.mockResolvedValue([]);

      const filters: AuditLogFilters = {
        userId: 'user-uuid-1',
        actionType: 'meeting.create',
      };
      await repository.findPaginated(filters, 1, 20);

      const [sql, params] = mockDataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toMatch(/WHERE/i);
      expect(sql).toMatch(/al\.user_id = \$1/);
      expect(sql).toMatch(/al\.action_type = \$2/);
      expect(params[0]).toBe('user-uuid-1');
      expect(params[1]).toBe('meeting.create');
      // limit=20 at $3, offset=0 at $4
      expect(params[2]).toBe(20);
      expect(params[3]).toBe(0);
    });

    it('should apply all 6 filters with AND (not OR)', async () => {
      mockDataSource.query.mockResolvedValue([]);

      const filters: AuditLogFilters = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-12-31T23:59:59Z',
        userId: 'uid',
        actionType: 'act',
        entityType: 'ent',
        severity: 'warning',
      };
      await repository.findPaginated(filters, 1, 10);

      const [sql] = mockDataSource.query.mock.calls[0] as [string, unknown[]];
      // All 6 conditions should be joined with AND (not OR)
      const andMatches = sql.match(/\bAND\b/gi);
      expect(andMatches).toHaveLength(5); // 6 conditions → 5 ANDs
      expect(sql).not.toMatch(/\bOR\b/i);
    });

    it('should ORDER BY al.created_at DESC (not changeable)', async () => {
      mockDataSource.query.mockResolvedValue([]);
      await repository.findPaginated({}, 1, 20);

      const [sql] = mockDataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/ORDER BY al\.created_at DESC/i);
    });

    it('should use correct LIMIT and OFFSET for page=2, limit=20', async () => {
      mockDataSource.query.mockResolvedValue([]);
      await repository.findPaginated({}, 2, 20);

      const [, params] = mockDataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(params[params.length - 2]).toBe(20); // LIMIT
      expect(params[params.length - 1]).toBe(20); // OFFSET = (2-1)*20
    });

    it('should LEFT JOIN users table', async () => {
      mockDataSource.query.mockResolvedValue([]);
      await repository.findPaginated({}, 1, 20);

      const [sql] = mockDataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/LEFT JOIN users/i);
      expect(sql).toMatch(/u\.full_name AS user_full_name/i);
    });

    it('should use parameterized query — no string concatenation', async () => {
      mockDataSource.query.mockResolvedValue([]);

      const filters: AuditLogFilters = {
        userId: "'; DROP TABLE audit_logs; --",
        entityType: 'malicious',
      };

      await repository.findPaginated(filters, 1, 10);

      const [sql] = mockDataSource.query.mock.calls[0] as [string, unknown[]];
      // The injected string should NOT appear in the SQL (it's a param, not concatenated)
      expect(sql).not.toContain("'; DROP TABLE");
      expect(sql).toMatch(/\$\d+/); // should have positional params
    });

    it('should SELECT the actor avatar_url column', async () => {
      mockDataSource.query.mockResolvedValue([]);
      await repository.findPaginated({}, 1, 20);

      const [sql] = mockDataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/u\.avatar_url AS user_avatar_url/i);
    });
  });

  // ---------------------------------------------------------------------------
  // findDistinctActionTypes — nguồn dựng dropdown lọc "Loại hành động"
  // ---------------------------------------------------------------------------
  describe('findDistinctActionTypes()', () => {
    it('should GROUP BY action_type and ORDER BY frequency desc', async () => {
      mockDataSource.query.mockResolvedValue([]);
      await repository.findDistinctActionTypes();

      const [sql] = mockDataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/GROUP BY al\.action_type/i);
      expect(sql).toMatch(/ORDER BY COUNT\(\*\) DESC/i);
    });

    it('should coerce count string to number', async () => {
      mockDataSource.query.mockResolvedValue([
        { action_type: 'login', count: '120' },
        { action_type: 'ACCOUNT_LOCK', count: '3' },
      ]);

      const rows = await repository.findDistinctActionTypes();

      expect(rows).toEqual([
        { action_type: 'login', count: 120 },
        { action_type: 'ACCOUNT_LOCK', count: 3 },
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // findAllForExport — dùng cho GET /audit-logs/export (2026-08-11)
  // ---------------------------------------------------------------------------
  describe('findAllForExport()', () => {
    it('should call query with no WHERE when filters is empty, LIMIT only (no OFFSET)', async () => {
      mockDataSource.query.mockResolvedValue([]);

      await repository.findAllForExport({}, 50000);

      const [sql, params] = mockDataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).not.toMatch(/WHERE/i);
      expect(sql).not.toMatch(/OFFSET/i);
      expect(sql).toMatch(/LIMIT \$1/);
      expect(params).toEqual([50000]);
    });

    it('should include WHERE clause when filters provided', async () => {
      mockDataSource.query.mockResolvedValue([]);

      const filters: AuditLogFilters = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-12-31T23:59:59Z',
      };
      await repository.findAllForExport(filters, 50000);

      const [sql, params] = mockDataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toMatch(/WHERE/i);
      expect(sql).toMatch(/al\.created_at >= \$1/);
      expect(sql).toMatch(/al\.created_at <= \$2/);
      expect(params).toEqual([
        '2026-01-01T00:00:00Z',
        '2026-12-31T23:59:59Z',
        50000,
      ]);
    });

    it('should ORDER BY al.created_at DESC and LEFT JOIN users', async () => {
      mockDataSource.query.mockResolvedValue([]);
      await repository.findAllForExport({}, 50000);

      const [sql] = mockDataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/ORDER BY al\.created_at DESC/i);
      expect(sql).toMatch(/LEFT JOIN users/i);
    });

    it('should use parameterized query — no string concatenation', async () => {
      mockDataSource.query.mockResolvedValue([]);

      const filters: AuditLogFilters = {
        actionType: "'; DROP TABLE audit_logs; --",
      };
      await repository.findAllForExport(filters, 50000);

      const [sql] = mockDataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toContain("'; DROP TABLE");
      expect(sql).toMatch(/\$\d+/);
    });
  });

  // ---------------------------------------------------------------------------
  // T023: countMatching — COUNT(*), no JOIN, no ORDER BY, no LIMIT
  // ---------------------------------------------------------------------------
  describe('T023 — countMatching()', () => {
    it('should return total from COUNT(*)', async () => {
      mockDataSource.query.mockResolvedValue([{ total: '42' }]);
      const total = await repository.countMatching({});
      expect(total).toBe(42);
    });

    it('should return 0 when no results', async () => {
      mockDataSource.query.mockResolvedValue([{ total: '0' }]);
      const total = await repository.countMatching({});
      expect(total).toBe(0);
    });

    it('should NOT contain JOIN in count query', async () => {
      mockDataSource.query.mockResolvedValue([{ total: '0' }]);
      await repository.countMatching({});

      const [sql] = mockDataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toMatch(/\bJOIN\b/i);
    });

    it('should NOT contain ORDER BY in count query', async () => {
      mockDataSource.query.mockResolvedValue([{ total: '0' }]);
      await repository.countMatching({});

      const [sql] = mockDataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toMatch(/ORDER BY/i);
    });

    it('should NOT contain LIMIT in count query', async () => {
      mockDataSource.query.mockResolvedValue([{ total: '0' }]);
      await repository.countMatching({});

      const [sql] = mockDataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toMatch(/\bLIMIT\b/i);
    });

    it('should apply same WHERE conditions as findPaginated', async () => {
      mockDataSource.query.mockResolvedValue([{ total: '5' }]);

      const filters: AuditLogFilters = {
        severity: 'critical',
        userId: 'uid-x',
      };
      await repository.countMatching(filters);

      const [sql, params] = mockDataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toMatch(/WHERE/i);
      expect(params).toContain('critical');
      expect(params).toContain('uid-x');
    });
  });

  // ---------------------------------------------------------------------------
  // BUG-005: tìm kiếm từ khóa
  // ---------------------------------------------------------------------------
  describe('search filter', () => {
    it('should OR-match actor name/email, action, entity, IP inside one AND group', async () => {
      mockDataSource.query.mockResolvedValue([]);
      await repository.findPaginated(
        { search: 'admin', severity: 'info' },
        1,
        10,
      );

      const [sql, params] = mockDataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toMatch(/unaccent\(su\.full_name\) ILIKE unaccent\(\$\d+\)/);
      expect(sql).toMatch(/su\.email ILIKE/);
      expect(sql).toMatch(/al\.entity_type ILIKE/);
      expect(sql).toMatch(/al\.ip_address ILIKE/);
      expect(sql).toMatch(/al\.severity = \$1 AND \(/);
      expect(params).toContain('%admin%');
    });

    it('should escape LIKE wildcards and keep keyword as a parameter', async () => {
      mockDataSource.query.mockResolvedValue([{ total: '0' }]);
      await repository.countMatching({ search: "50%_x'; DROP" });

      const [sql, params] = mockDataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).not.toContain('DROP');
      expect(sql).not.toMatch(/\bJOIN\b/i);
      expect(params[0]).toBe("%50\\%\\_x'; DROP%");
    });

    it('should add action/entity codes resolved from Vietnamese labels as OR', async () => {
      mockDataSource.query.mockResolvedValue([]);
      await repository.findPaginated(
        {
          search: 'đăng nhập',
          searchActionTypes: ['login'],
          searchEntityTypes: ['auth'],
        },
        1,
        10,
      );

      const [sql, params] = mockDataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toMatch(/OR al\.action_type = ANY\(\$2\)/);
      expect(sql).toMatch(/OR al\.entity_type = ANY\(\$3\)/);
      expect(params.slice(0, 3)).toEqual(['%đăng nhập%', ['login'], ['auth']]);
    });
  });

  // ---------------------------------------------------------------------------
  // T023: Pagination correctness — page 2 with 45 records returns rows 21-40
  // ---------------------------------------------------------------------------
  describe('T023 — pagination correctness', () => {
    it('page=2, limit=20 → OFFSET=20 (rows 21-40)', async () => {
      const fakeRows = Array.from({ length: 20 }, (_, i) => ({
        id: `uuid-${i + 21}`,
      }));
      mockDataSource.query.mockResolvedValue(fakeRows);

      const rows = await repository.findPaginated({}, 2, 20);

      expect(rows).toHaveLength(20);
      const [, params] = mockDataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(params[params.length - 1]).toBe(20); // offset = (2-1)*20 = 20
    });
  });
});

// ---------------------------------------------------------------------------
// T029: Seed permission unit test
// ---------------------------------------------------------------------------
describe('T029 — Seed permission audit.system.read', () => {
  let mockQueryRunner: {
    query: jest.Mock;
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
  };

  beforeEach(() => {
    mockQueryRunner = {
      query: jest.fn(),
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    };
  });

  it('should seed permission audit.system.read with correct metadata', async () => {
    const migration = new SeedAuditSystemReadPermission20260703000000();

    // Mock: INSERT returns new ID
    mockQueryRunner.query
      .mockResolvedValueOnce([{ id: 'perm-uuid-1' }]) // INSERT permission
      .mockResolvedValueOnce([]); // INSERT role_permission for SYSTEM_ADMIN

    await migration.up(mockQueryRunner as unknown as QueryRunner);

    // First call: INSERT permission
    const [insertPermSql, insertPermParams] = mockQueryRunner.query.mock
      .calls[0] as [string, unknown[]];
    expect(insertPermSql).toMatch(/INSERT INTO permissions/i);
    expect(insertPermParams[0]).toBe('audit.system.read');

    // Second call: INSERT role_permission
    const [insertRoleSql, insertRoleParams] = mockQueryRunner.query.mock
      .calls[1] as [string, unknown[]];
    expect(insertRoleSql).toMatch(/INSERT INTO role_permissions/i);
    // Should ONLY have SYSTEM_ADMIN — NOT MANAGER or BUSINESS_ADMIN
    expect(insertRoleParams[0]).toBe('SYSTEM_ADMIN');
  });

  it('should NOT assign permission to MANAGER or BUSINESS_ADMIN', async () => {
    const migration = new SeedAuditSystemReadPermission20260703000000();

    // Mock: INSERT returns new ID + role assignments
    mockQueryRunner.query
      .mockResolvedValueOnce([{ id: 'perm-uuid-1' }])
      .mockResolvedValue([]);

    await migration.up(mockQueryRunner as unknown as QueryRunner);

    // Collect all role codes used in role_permission inserts
    const roleCodes: string[] = [];
    for (const call of mockQueryRunner.query.mock.calls) {
      const [sql, params] = call as [string, unknown[]];
      if (sql.includes('role_permissions') && sql.includes('INSERT')) {
        roleCodes.push(params[0] as string);
      }
    }

    expect(roleCodes).toContain('SYSTEM_ADMIN');
    expect(roleCodes).not.toContain('MANAGER');
    expect(roleCodes).not.toContain('BUSINESS_ADMIN');
  });

  it('should rollback permission on down()', async () => {
    const migration = new SeedAuditSystemReadPermission20260703000000();
    mockQueryRunner.query.mockResolvedValue([]);

    await migration.down(mockQueryRunner as unknown as QueryRunner);

    const calls = mockQueryRunner.query.mock.calls as [string, unknown[]][];
    const deleteRolePerm = calls.find(([sql]) =>
      sql.includes('role_permissions'),
    );
    const deletePerm = calls.find(
      ([sql]) =>
        sql.includes('permissions') && !sql.includes('role_permissions'),
    );

    expect(deleteRolePerm).toBeDefined();
    expect(deletePerm).toBeDefined();
    // Both should reference the permission code
    expect(deleteRolePerm?.[1]).toContain('audit.system.read');
    expect(deletePerm?.[1]).toContain('audit.system.read');
  });
});
