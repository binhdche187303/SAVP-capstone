import { Test, TestingModule } from '@nestjs/testing';
import { SecurityAlertsDailyTrendService } from '../services/security-alerts-daily-trend.service';
import { SecurityAlertsDailyTrendRepository } from '../repositories/security-alerts-daily-trend.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

describe('SecurityAlertsDailyTrendService', () => {
  let service: SecurityAlertsDailyTrendService;
  let mockRepo: jest.Mocked<SecurityAlertsDailyTrendRepository>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    mockRepo = {
      countByDayAndType: jest.fn(),
    } as unknown as jest.Mocked<SecurityAlertsDailyTrendRepository>;

    mockAuditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityAlertsDailyTrendService,
        { provide: SecurityAlertsDailyTrendRepository, useValue: mockRepo },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<SecurityAlertsDailyTrendService>(
      SecurityAlertsDailyTrendService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to 7-day series when days is not provided', async () => {
    mockRepo.countByDayAndType.mockResolvedValue([]);

    const { data } = await service.getDailyTrend({ userId: mockUserId }, {});

    expect(data.series).toHaveLength(7);
    expect(data.totalInPeriod).toBe(0);
    for (const point of data.series) {
      expect(point.total).toBe(0);
      expect(point.byType).toEqual({});
    }
  });

  it('builds series with exact requested days count', async () => {
    mockRepo.countByDayAndType.mockResolvedValue([]);

    const { data } = await service.getDailyTrend(
      { userId: mockUserId },
      { days: 30 },
    );

    expect(data.series).toHaveLength(30);
  });

  it('maps grouped rows into byType and total, only including types with count > 0', async () => {
    mockRepo.countByDayAndType.mockImplementation(() => {
      const todayStr = new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0];
      return Promise.resolve([
        { alert_date: todayStr, alert_type: 'intrusion', cnt: '1' },
        { alert_date: todayStr, alert_type: 'stranger', cnt: '2' },
      ]);
    });

    const { data } = await service.getDailyTrend(
      { userId: mockUserId },
      { days: 1 },
    );

    expect(data.series).toHaveLength(1);
    const [point] = data.series;
    expect(point.total).toBe(3);
    expect(point.byType).toEqual({ intrusion: 1, stranger: 2 });
    expect(point.byType.crowd).toBeUndefined();
    expect(data.totalInPeriod).toBe(3);
  });

  it('keeps totalInPeriod equal to the sum of series totals', async () => {
    mockRepo.countByDayAndType.mockResolvedValue([
      { alert_date: '2026-08-01', alert_type: 'crowd', cnt: '5' },
    ]);

    const { data } = await service.getDailyTrend(
      { userId: mockUserId },
      { days: 7 },
    );

    const sum = data.series.reduce((acc, p) => acc + p.total, 0);
    expect(data.totalInPeriod).toBe(sum);
  });

  it('does not fail the request when audit logging throws', async () => {
    mockRepo.countByDayAndType.mockResolvedValue([]);
    mockAuditLogsService.logAction.mockRejectedValue(new Error('db down'));

    await expect(
      service.getDailyTrend({ userId: mockUserId }, {}),
    ).resolves.toBeDefined();
  });
});
