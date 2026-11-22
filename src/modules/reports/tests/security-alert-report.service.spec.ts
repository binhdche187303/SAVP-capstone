/**
 * security-alert-report.service.spec.ts
 *
 * Unit tests cho SecurityAlertReportService (UC-129 T314, T315).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SecurityAlertReportService } from '../services/security-alert-report.service.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { DashboardOverviewConfigService } from '../../analytics/services/dashboard-overview-config.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { BackgroundJobType } from '../../administration/entities/background-job.entity.js';
import {
  REPORT_EXPORT_QUEUE_NAME,
  SECURITY_ALERT_EXPORT_JOB_NAME,
} from '../constants/report-export-job.constants.js';

describe('SecurityAlertReportService', () => {
  let service: SecurityAlertReportService;

  const mockBackgroundJobsService = { createQueuedJob: jest.fn() };
  const mockQueueService = { addJob: jest.fn() };
  const mockDashboardConfigService = { getMaxRangeDays: jest.fn() };
  const mockAuditLogsService = { logAction: jest.fn() };

  const user = { userId: 'user-1', email: 'user@test.com' };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
    mockBackgroundJobsService.createQueuedJob.mockResolvedValue({
      id: 'job-123',
    });
    mockQueueService.addJob.mockResolvedValue('bull-job-1');
    mockAuditLogsService.logAction.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityAlertReportService,
        { provide: BackgroundJobsService, useValue: mockBackgroundJobsService },
        { provide: QueueService, useValue: mockQueueService },
        {
          provide: DashboardOverviewConfigService,
          useValue: mockDashboardConfigService,
        },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<SecurityAlertReportService>(
      SecurityAlertReportService,
    );
  });

  describe('validation', () => {
    it('rejects missing from/to', async () => {
      await expect(
        service.createExportJob(user, {
          from: '',
          to: '',
          format: 'pdf',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects from > to', async () => {
      await expect(
        service.createExportJob(user, {
          from: '2026-07-31',
          to: '2026-07-01',
          format: 'pdf',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects range exceeding maxRangeDays', async () => {
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(5);
      await expect(
        service.createExportJob(user, {
          from: '2026-01-01',
          to: '2026-07-31',
          format: 'pdf',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('happy path — no department scope enforcement (§2.2 spec)', () => {
    it('creates background job and enqueues BullMQ job', async () => {
      const result = await service.createExportJob(user, {
        from: '2026-07-01',
        to: '2026-07-31',
        format: 'pdf',
        filters: { alertType: 'intrusion', zoneId: 'zone-1', status: 'new' },
      });

      expect(mockBackgroundJobsService.createQueuedJob).toHaveBeenCalledWith(
        expect.objectContaining({ jobType: BackgroundJobType.EXPORT_REPORT }),
      );
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        REPORT_EXPORT_QUEUE_NAME,
        SECURITY_ALERT_EXPORT_JOB_NAME,
        expect.objectContaining({
          backgroundJobId: 'job-123',
          filters: { alertType: 'intrusion', zoneId: 'zone-1', status: 'new', severity: null },
        }),
      );
      expect(result).toEqual({
        jobId: 'job-123',
        status: 'queued',
        delivery: 'download',
        outputFileId: null,
      });
    });

    it('defaults filters to null when not provided', async () => {
      await service.createExportJob(user, {
        from: '2026-07-01',
        to: '2026-07-31',
        format: 'xlsx',
      });

      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        REPORT_EXPORT_QUEUE_NAME,
        SECURITY_ALERT_EXPORT_JOB_NAME,
        expect.objectContaining({
          filters: { alertType: null, zoneId: null, status: null, severity: null },
        }),
      );
    });
  });
});
