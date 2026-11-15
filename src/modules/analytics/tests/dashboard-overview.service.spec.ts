import { RedisService } from '../../redis/redis.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { DashboardOverviewService } from '../services/dashboard-overview.service';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { DashboardOverviewRepository } from '../repositories/dashboard-overview.repository';
import { DashboardOverviewConfigService } from '../services/dashboard-overview-config.service';
import { QueryDashboardOverviewDto } from '../dto/query-dashboard-overview.dto';

describe('DashboardOverviewService', () => {
  let service: DashboardOverviewService;
  let mockAuthzRepo: jest.Mocked<AuthzReadRepository>;
  let mockRepo: jest.Mocked<DashboardOverviewRepository>;
  let mockConfigService: jest.Mocked<DashboardOverviewConfigService>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    mockAuthzRepo = {
      getEffectiveRolesAndPermissions: jest.fn(),
    } as unknown as jest.Mocked<AuthzReadRepository>;

    mockRepo = {
      getManagerDepartmentIds: jest.fn(),
      countMeetings: jest.fn(),
      countActiveRooms: jest.fn(),
      getUtilizationAggregate: jest.fn(),
      getNoShowAggregate: jest.fn(),
      getAttendanceAggregate: jest.fn(),
      countActiveUsers: jest.fn(),
      countRecordingSessions: jest.fn(),
      getDailyTrend: jest.fn(),
    } as unknown as jest.Mocked<DashboardOverviewRepository>;

    mockConfigService = {
      getMaxRangeDays: jest.fn(),
    } as unknown as jest.Mocked<DashboardOverviewConfigService>;

    mockAuditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: RedisService, useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), getClient: jest.fn().mockReturnValue(null) } },
        DashboardOverviewService,
        { provide: AuthzReadRepository, useValue: mockAuthzRepo },
        { provide: DashboardOverviewRepository, useValue: mockRepo },
        {
          provide: DashboardOverviewConfigService,
          useValue: mockConfigService,
        },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<DashboardOverviewService>(DashboardOverviewService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolveScope', () => {
    it('SYSTEM_ADMIN -> isAdmin=true, scopeDepartmentIds=null', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['analytics.overview.read'],
      });

      const result = await service.resolveScope(mockUserId);
      expect(result).toEqual({
        isAdmin: true,
        scopeDepartmentIds: null,
        viewerRole: 'SYSTEM_ADMIN',
      });
    });

    it('BUSINESS_ADMIN -> isAdmin=true, scopeDepartmentIds=null', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.overview.read'],
      });

      const result = await service.resolveScope(mockUserId);
      expect(result).toEqual({
        isAdmin: true,
        scopeDepartmentIds: null,
        viewerRole: 'BUSINESS_ADMIN',
      });
    });

    it('MANAGER -> queries departments', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.overview.read'],
      });
      mockRepo.getManagerDepartmentIds.mockResolvedValue(['dept-1', 'dept-2']);

      const result = await service.resolveScope(mockUserId);
      expect(result).toEqual({
        isAdmin: false,
        scopeDepartmentIds: ['dept-1', 'dept-2'],
        viewerRole: 'MANAGER',
      });
      expect(mockRepo.getManagerDepartmentIds).toHaveBeenCalledWith(mockUserId);
    });

    it('MANAGER with 0 departments -> empty scope (no error)', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.overview.read'],
      });
      mockRepo.getManagerDepartmentIds.mockResolvedValue([]);

      const result = await service.resolveScope(mockUserId);
      expect(result).toEqual({
        isAdmin: false,
        scopeDepartmentIds: [],
        viewerRole: 'MANAGER',
      });
    });

    it('no valid role -> ForbiddenException', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: ['analytics.overview.read'],
      });

      await expect(service.resolveScope(mockUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('resolveDateRange', () => {
    it('missing from/to -> default 30 days', async () => {
      const query: QueryDashboardOverviewDto = {};
      const result = await service.resolveDateRange(query);
      const now = new Date();
      const expectedTo = now.toISOString().split('T')[0];
      const expectedFrom = new Date(now.getTime() - 30 * 86400000)
        .toISOString()
        .split('T')[0];

      expect(result.from).toBe(expectedFrom);
      expect(result.to).toBe(expectedTo);
    });

    it('from > to -> BadRequestException', async () => {
      const query: QueryDashboardOverviewDto = {
        from: '2026-07-01',
        to: '2026-06-01',
      };
      await expect(service.resolveDateRange(query)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('from = to -> passes (single day)', async () => {
      const query: QueryDashboardOverviewDto = {
        from: '2026-06-15',
        to: '2026-06-15',
      };
      const result = await service.resolveDateRange(query);
      expect(result.from).toBe('2026-06-15');
      expect(result.to).toBe('2026-06-15');
    });
  });

  describe('validateMaxRange', () => {
    it('range within max -> passes', async () => {
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      await expect(
        service.validateMaxRange('2026-01-01', '2026-06-30'),
      ).resolves.toBeUndefined();
    });

    it('range exceeds max -> BadRequestException DATE_RANGE_TOO_LARGE', async () => {
      mockConfigService.getMaxRangeDays.mockResolvedValue(30);
      await expect(
        service.validateMaxRange('2026-01-01', '2026-07-01'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateDepartmentOwnership', () => {
    it('admin -> passes', () => {
      const scope = { isAdmin: true, scopeDepartmentIds: null };
      expect(() =>
        service.validateDepartmentOwnership(scope, 'any-dept'),
      ).not.toThrow();
    });

    it('no departmentId -> passes', () => {
      const scope = { isAdmin: false, scopeDepartmentIds: ['d1', 'd2'] };
      expect(() =>
        service.validateDepartmentOwnership(scope, undefined),
      ).not.toThrow();
    });

    it('MANAGER, departmentId in scope -> passes', () => {
      const scope = { isAdmin: false, scopeDepartmentIds: ['d1', 'd2'] };
      expect(() =>
        service.validateDepartmentOwnership(scope, 'd1'),
      ).not.toThrow();
    });

    it('MANAGER, departmentId out of scope -> ForbiddenException', () => {
      const scope = { isAdmin: false, scopeDepartmentIds: ['d1', 'd2'] };
      expect(() => service.validateDepartmentOwnership(scope, 'd99')).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getOverview', () => {
    it('empty state -> all 0, trend=[], no aggregate calls', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['analytics.overview.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.countMeetings.mockResolvedValue(0);

      const result = await service.getOverview(
        { userId: mockUserId },
        { from: '2026-06-01', to: '2026-06-30' },
      );

      expect(result.meetingCount).toBe(0);
      expect(result.trend).toEqual([]);
      expect(mockRepo.countActiveRooms).not.toHaveBeenCalled();
    });

    it('full response with data -> all aggregates called', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['analytics.overview.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.countMeetings.mockResolvedValue(10);
      mockRepo.countActiveRooms.mockResolvedValue(5);
      mockRepo.getUtilizationAggregate.mockResolvedValue({
        actualMinutesSum: 600,
        reservedMinutesSum: 1000,
      });
      mockRepo.getNoShowAggregate.mockResolvedValue({
        noShowCount: 1,
        bookingCount: 10,
      });
      mockRepo.getAttendanceAggregate.mockResolvedValue({
        onTimeCount: 8,
        totalCount: 10,
      });
      mockRepo.countActiveUsers.mockResolvedValue(15);
      mockRepo.countRecordingSessions.mockResolvedValue(3);
      mockRepo.getDailyTrend.mockResolvedValue([
        {
          date: '2026-06-01',
          meetingCount: 2,
          actualMinutesSum: 120,
          reservedMinutesSum: 200,
        },
        {
          date: '2026-06-02',
          meetingCount: 3,
          actualMinutesSum: 180,
          reservedMinutesSum: 300,
        },
      ]);

      const result = await service.getOverview(
        { userId: mockUserId },
        { from: '2026-06-01', to: '2026-06-30' },
      );

      expect(result.meetingCount).toBe(10);
      expect(result.activeRooms).toBe(5);
      expect(result.utilizationRate).toBe(60.0);
      expect(result.noShowRate).toBe(10.0);
      expect(result.onTimeRate).toBe(80.0);
      expect(result.recordingCount).toBe(3);
      expect(result.activeUserCount).toBe(15);
      expect(result.trend).toHaveLength(2);
      expect(result.trend[0].utilizationRate).toBe(60.0);
    });

    it('denominator=0 -> KPI rate=0, not NaN', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['analytics.overview.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.countMeetings.mockResolvedValue(1);
      mockRepo.countActiveRooms.mockResolvedValue(1);
      mockRepo.getUtilizationAggregate.mockResolvedValue({
        actualMinutesSum: 0,
        reservedMinutesSum: 0,
      });
      mockRepo.getNoShowAggregate.mockResolvedValue({
        noShowCount: 0,
        bookingCount: 0,
      });
      mockRepo.getAttendanceAggregate.mockResolvedValue({
        onTimeCount: 0,
        totalCount: 0,
      });
      mockRepo.countActiveUsers.mockResolvedValue(1);
      mockRepo.countRecordingSessions.mockResolvedValue(0);
      mockRepo.getDailyTrend.mockResolvedValue([]);

      const result = await service.getOverview(
        { userId: mockUserId },
        { from: '2026-06-01', to: '2026-06-30' },
      );

      expect(result.utilizationRate).toBe(0);
      expect(result.noShowRate).toBe(0);
      expect(result.onTimeRate).toBe(0);
      expect(Number.isNaN(result.utilizationRate)).toBe(false);
    });
  });
});
