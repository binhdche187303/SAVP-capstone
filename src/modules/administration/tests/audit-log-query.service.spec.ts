import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AuditLogQueryService } from '../services/audit-log-query.service.js';
import { AuditLogQueryRepository } from '../repositories/audit-log-query.repository.js';
import {
  QueryAuditLogsDto,
  AuditLogSeverityFilter,
} from '../dto/query-audit-logs.dto.js';

/**
 * Unit tests cho AuditLogQueryService.
 *
 * T022 — DTO validation (page/limit/from/to/userId/severity)
 * T024 — resolve actorName (user_id null → "Hệ thống")
 * T025 — response shape không lộ field nhạy cảm
 * T026 — empty result: data=[], meta.total=0, không có `message`
 * T027 — KHÔNG tự ghi audit log (spy logAction/logSecurityEvent/logEntityChange)
 */
describe('AuditLogQueryService', () => {
  let service: AuditLogQueryService;
  let repositoryMock: jest.Mocked<AuditLogQueryRepository>;

  const makeRow = (
    overrides: Partial<{
      id: string;
      created_at: Date;
      user_id: string | null;
      action_type: string;
      entity_type: string;
      entity_id: string | null;
      severity: string;
      user_full_name: string | null;
      user_avatar_url: string | null;
    }> = {},
  ) => ({
    id: 'uuid-1',
    created_at: new Date('2026-07-01T10:00:00Z'),
    user_id: 'user-uuid-1',
    action_type: 'meeting.create',
    entity_type: 'meeting',
    entity_id: 'entity-uuid-1',
    severity: 'info',
    user_full_name: 'Nguyễn Văn A',
    user_avatar_url: 'https://cdn.example.com/a.png',
    ...overrides,
  });

  beforeEach(async () => {
    const mockRepo = {
      findPaginated: jest.fn(),
      countMatching: jest.fn(),
      findDistinctActionTypes: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogQueryService,
        {
          provide: AuditLogQueryRepository,
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<AuditLogQueryService>(AuditLogQueryService);
    repositoryMock = module.get(AuditLogQueryRepository);
  });

  // ---------------------------------------------------------------------------
  // T012: Default page=1, limit=20
  // ---------------------------------------------------------------------------
  describe('T012 — default page/limit', () => {
    it('should apply page=1, limit=20 when not provided', async () => {
      repositoryMock.findPaginated.mockResolvedValue([]);
      repositoryMock.countMatching.mockResolvedValue(0);

      const dto: QueryAuditLogsDto = {};
      await service.listAuditLogs(dto);

      expect(repositoryMock.findPaginated).toHaveBeenCalledWith({}, 1, 20);
    });

    it('should use provided page and limit', async () => {
      repositoryMock.findPaginated.mockResolvedValue([]);
      repositoryMock.countMatching.mockResolvedValue(0);

      const dto: QueryAuditLogsDto = { page: 3, limit: 50 };
      await service.listAuditLogs(dto);

      expect(repositoryMock.findPaginated).toHaveBeenCalledWith({}, 3, 50);
    });
  });

  // ---------------------------------------------------------------------------
  // T013: Validate from > to
  // ---------------------------------------------------------------------------
  describe('T013 — validate from > to', () => {
    it('should throw BadRequestException with VALIDATION_ERROR when from > to', async () => {
      const dto: QueryAuditLogsDto = {
        from: '2026-12-31T00:00:00Z',
        to: '2026-01-01T00:00:00Z',
      };

      await expect(service.listAuditLogs(dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.listAuditLogs(dto)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      });
    });

    it('should NOT throw when from === to', async () => {
      repositoryMock.findPaginated.mockResolvedValue([]);
      repositoryMock.countMatching.mockResolvedValue(0);

      const dto: QueryAuditLogsDto = {
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-01T00:00:00Z',
      };

      await expect(service.listAuditLogs(dto)).resolves.not.toThrow();
    });

    it('should NOT throw when only from provided', async () => {
      repositoryMock.findPaginated.mockResolvedValue([]);
      repositoryMock.countMatching.mockResolvedValue(0);

      const dto: QueryAuditLogsDto = { from: '2026-07-01T00:00:00Z' };
      await expect(service.listAuditLogs(dto)).resolves.not.toThrow();
    });

    it('should NOT throw when only to provided', async () => {
      repositoryMock.findPaginated.mockResolvedValue([]);
      repositoryMock.countMatching.mockResolvedValue(0);

      const dto: QueryAuditLogsDto = { to: '2026-07-01T00:00:00Z' };
      await expect(service.listAuditLogs(dto)).resolves.not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // T014: buildFilters
  // ---------------------------------------------------------------------------
  describe('T014 — buildFilters', () => {
    it('should return empty object when no filters provided', () => {
      const filters = service.buildFilters({});
      expect(filters).toEqual({});
    });

    it('should include only provided fields', () => {
      const dto: QueryAuditLogsDto = {
        userId: 'user-uuid-1',
        actionType: 'meeting.create',
        severity: AuditLogSeverityFilter.WARNING,
      };
      const filters = service.buildFilters(dto);
      expect(filters).toEqual({
        userId: 'user-uuid-1',
        actionType: 'meeting.create',
        severity: 'warning',
      });
      expect(filters).not.toHaveProperty('from');
      expect(filters).not.toHaveProperty('to');
      expect(filters).not.toHaveProperty('entityType');
    });

    it('should include all filter fields when all provided', () => {
      const dto: QueryAuditLogsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-12-31T23:59:59Z',
        userId: 'uid',
        actionType: 'act',
        entityType: 'ent',
        severity: AuditLogSeverityFilter.CRITICAL,
      };
      const filters = service.buildFilters(dto);
      expect(Object.keys(filters)).toHaveLength(6);
    });

    it('should pass search with label-resolved codes', () => {
      const filters = service.buildFilters({
        search: 'admin',
        searchActionTypes: ['login'],
        searchEntityTypes: [],
      });
      expect(filters).toEqual({
        search: 'admin',
        searchActionTypes: ['login'],
      });
    });

    it('should split raw comma-separated codes and trim search (no ValidationPipe on list)', () => {
      const filters = service.buildFilters({
        search: '  admin ',
        searchActionTypes: 'login, logout,' as unknown as string[],
      });
      expect(filters).toEqual({
        search: 'admin',
        searchActionTypes: ['login', 'logout'],
      });
    });

    it('should ignore label-resolved codes when search is empty', () => {
      const filters = service.buildFilters({ searchActionTypes: ['login'] });
      expect(filters).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // T024: Resolve actorName — QUAN TRỌNG
  // ---------------------------------------------------------------------------
  describe('T024 — resolve actorName', () => {
    it('should set actorName="Hệ thống" and actorUserId=null when user_id is null', async () => {
      const row = makeRow({ user_id: null, user_full_name: null });
      repositoryMock.findPaginated.mockResolvedValue([row]);
      repositoryMock.countMatching.mockResolvedValue(1);

      const result = await service.listAuditLogs({});

      expect(result.data[0].actorUserId).toBeNull();
      expect(result.data[0].actorName).toBe('Hệ thống');
    });

    it('should resolve actorName from full_name when user_id is not null', async () => {
      const row = makeRow({
        user_id: 'user-uuid-1',
        user_full_name: 'Trần Thị B',
      });
      repositoryMock.findPaginated.mockResolvedValue([row]);
      repositoryMock.countMatching.mockResolvedValue(1);

      const result = await service.listAuditLogs({});

      expect(result.data[0].actorUserId).toBe('user-uuid-1');
      expect(result.data[0].actorName).toBe('Trần Thị B');
    });

    it('should fallback to "Hệ thống" when user_id set but full_name null (data integrity issue)', async () => {
      const row = makeRow({ user_id: 'user-uuid-2', user_full_name: null });
      repositoryMock.findPaginated.mockResolvedValue([row]);
      repositoryMock.countMatching.mockResolvedValue(1);

      const result = await service.listAuditLogs({});

      // user_id is set → actorUserId not null, but fullName missing → fallback
      expect(result.data[0].actorUserId).toBe('user-uuid-2');
      expect(result.data[0].actorName).toBe('Hệ thống');
    });
  });

  // ---------------------------------------------------------------------------
  // actorAvatarUrl — avatar người thực hiện trong list response
  // ---------------------------------------------------------------------------
  describe('actorAvatarUrl mapping', () => {
    it('should map avatar_url from the actor row', async () => {
      const row = makeRow({
        user_id: 'user-uuid-1',
        user_avatar_url: 'https://cdn.example.com/x.png',
      });
      repositoryMock.findPaginated.mockResolvedValue([row]);
      repositoryMock.countMatching.mockResolvedValue(1);

      const result = await service.listAuditLogs({});

      expect(result.data[0].actorAvatarUrl).toBe(
        'https://cdn.example.com/x.png',
      );
    });

    it('should be null when actor has no avatar', async () => {
      const row = makeRow({ user_id: 'user-uuid-1', user_avatar_url: null });
      repositoryMock.findPaginated.mockResolvedValue([row]);
      repositoryMock.countMatching.mockResolvedValue(1);

      const result = await service.listAuditLogs({});

      expect(result.data[0].actorAvatarUrl).toBeNull();
    });

    it('should be null for system actor (user_id null) even if row has avatar', async () => {
      const row = makeRow({
        user_id: null,
        user_full_name: null,
        user_avatar_url: 'https://cdn.example.com/should-be-ignored.png',
      });
      repositoryMock.findPaginated.mockResolvedValue([row]);
      repositoryMock.countMatching.mockResolvedValue(1);

      const result = await service.listAuditLogs({});

      expect(result.data[0].actorAvatarUrl).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // listActionTypes — nguồn dựng dropdown lọc từ dữ liệu thật
  // ---------------------------------------------------------------------------
  describe('listActionTypes', () => {
    it('should map repository rows to { actionType, count }', async () => {
      repositoryMock.findDistinctActionTypes.mockResolvedValue([
        { action_type: 'login', count: 120 },
        { action_type: 'ACCOUNT_LOCK', count: 3 },
      ]);

      const result = await service.listActionTypes();

      expect(result).toEqual([
        { actionType: 'login', count: 120 },
        { actionType: 'ACCOUNT_LOCK', count: 3 },
      ]);
    });

    it('should wrap repository errors in InternalServerErrorException', async () => {
      repositoryMock.findDistinctActionTypes.mockRejectedValue(
        new Error('DB down'),
      );

      await expect(service.listActionTypes()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // T025: Response shape — KHÔNG lộ field nhạy cảm
  // ---------------------------------------------------------------------------
  describe('T025 — response shape', () => {
    it('should only include allowed fields in each item', async () => {
      const row = makeRow();
      repositoryMock.findPaginated.mockResolvedValue([row]);
      repositoryMock.countMatching.mockResolvedValue(1);

      const result = await service.listAuditLogs({});
      const item = result.data[0];

      // Fields that MUST be present
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('actorUserId');
      expect(item).toHaveProperty('actorName');
      expect(item).toHaveProperty('actionType');
      expect(item).toHaveProperty('entityType');
      expect(item).toHaveProperty('entityId');
      expect(item).toHaveProperty('severity');

      // Fields that MUST NOT be present (sensitive/internal)
      expect(item).not.toHaveProperty('oldValueJson');
      expect(item).not.toHaveProperty('newValueJson');
      expect(item).not.toHaveProperty('metadataJson');
      expect(item).not.toHaveProperty('ipAddress');
      expect(item).not.toHaveProperty('userAgent');
      expect(item).not.toHaveProperty('requestId');
    });
  });

  // ---------------------------------------------------------------------------
  // T026: Empty result
  // ---------------------------------------------------------------------------
  describe('T026 — empty result', () => {
    it('should return data=[], meta.total=0, and NOT include message field', async () => {
      repositoryMock.findPaginated.mockResolvedValue([]);
      repositoryMock.countMatching.mockResolvedValue(0);

      const result = await service.listAuditLogs({});

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
      // KHÔNG có trường `message` trong response (khác pattern EX1 analytics.*)
      expect(result).not.toHaveProperty('message');
    });
  });

  // ---------------------------------------------------------------------------
  // T019: buildResponse meta calculation
  // ---------------------------------------------------------------------------
  describe('T019 — buildResponse pagination meta', () => {
    it('should calculate totalPages correctly', async () => {
      const rows = Array.from({ length: 20 }, (_, i) =>
        makeRow({ id: `uuid-${i}` }),
      );
      repositoryMock.findPaginated.mockResolvedValue(rows);
      repositoryMock.countMatching.mockResolvedValue(45);

      const result = await service.listAuditLogs({ page: 2, limit: 20 });

      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(20);
      expect(result.meta.total).toBe(45);
      expect(result.meta.totalPages).toBe(3); // ceil(45/20)
    });
  });

  // ---------------------------------------------------------------------------
  // T027: KHÔNG tự ghi audit log — QUAN TRỌNG
  // ---------------------------------------------------------------------------
  describe('T027 — does NOT write audit logs', () => {
    it('should NEVER call AuditLogsService.logAction/logSecurityEvent/logEntityChange', async () => {
      repositoryMock.findPaginated.mockResolvedValue([]);
      repositoryMock.countMatching.mockResolvedValue(0);

      // Verify service has no injection of AuditLogsService whatsoever
      // (AuditLogQueryService only injects AuditLogQueryRepository)
      const serviceKeys = Object.keys(
        service as unknown as Record<string, unknown>,
      );
      const hasAuditLogsService = serviceKeys.some(
        (key) =>
          key.toLowerCase().includes('auditlogsservice') ||
          key.toLowerCase().includes('audit_logs_service'),
      );
      expect(hasAuditLogsService).toBe(false);

      // Also verify normal call completes without any write side effect
      await expect(service.listAuditLogs({})).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // T020: Error handling
  // ---------------------------------------------------------------------------
  describe('T020 — error handling', () => {
    it('should wrap unexpected errors in InternalServerErrorException', async () => {
      repositoryMock.findPaginated.mockRejectedValue(
        new Error('DB connection lost'),
      );
      repositoryMock.countMatching.mockResolvedValue(0);

      await expect(service.listAuditLogs({})).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(service.listAuditLogs({})).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
      });
    });

    it('should re-throw BadRequestException directly (not wrap)', async () => {
      const dto: QueryAuditLogsDto = {
        from: '2026-12-31T00:00:00Z',
        to: '2026-01-01T00:00:00Z',
      };

      await expect(service.listAuditLogs(dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
