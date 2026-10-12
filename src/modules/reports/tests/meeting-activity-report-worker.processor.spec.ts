/**
 * meeting-activity-report-worker.processor.spec.ts
 *
 * Unit tests cho MeetingActivityReportWorkerProcessor (T037).
 *
 * AC-001: Happy path — markRunning → aggregate → render → upload → markCompleted với outputFileId
 * AC-007: Lỗi giữa chừng → markFailed, KHÔNG throw, KHÔNG treo ở running
 * FR-011: Dữ liệu rỗng (không meeting) → vẫn markCompleted bình thường
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MeetingActivityReportWorkerProcessor } from '../processors/meeting-activity-report-worker.processor.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { MeetingActivityReportDataService } from '../services/meeting-activity-report-data.service.js';
import { MediaFileEntity } from '../../recording/entities/media-file.entity.js';
import { StorageService } from '../../storage/storage.service.js';
import { RoomUtilizationReportWorkerProcessor } from '../processors/room-utilization-report-worker.processor.js';
import { GateAccessReportWorkerProcessor } from '../processors/gate-access-report-worker.processor.js';
import { VehicleReportWorkerProcessor } from '../processors/vehicle-report-worker.processor.js';
import { SecurityAlertReportWorkerProcessor } from '../processors/security-alert-report-worker.processor.js';
import { ReportCenterWorkerProcessor } from '../center/report-center-worker.processor.js';
import { ReportScheduleRunWorker } from '../schedules/report-schedule-run.worker.js';

// Mock renderers — must be defined BEFORE module imports
const mockRenderPdf = jest.fn().mockResolvedValue(Buffer.from('PDF_CONTENT'));
const mockRenderXlsx = jest.fn().mockResolvedValue(Buffer.from('XLSX_CONTENT'));

jest.mock('../renderers/meeting-activity-pdf-renderer.js', () => ({
  renderMeetingActivityPdf: (...args: unknown[]) => mockRenderPdf(...args),
}));
jest.mock('../renderers/meeting-activity-xlsx-renderer.js', () => ({
  renderMeetingActivityXlsx: (...args: unknown[]) => mockRenderXlsx(...args),
}));

// Bước 5 SAVP: GateAccessReportWorkerProcessor is mocked via DI below (dispatch
// test only), but its static import chain still pulls in the real renderers
// (incl. exceljs) at module-load time — mock them too so the partial `fs` mock
// above doesn't break exceljs' internal `tmp` dependency (fs.constants.O_CREAT).
jest.mock('../renderers/gate-access-pdf-renderer.js', () => ({
  renderGateAccessPdf: jest.fn().mockResolvedValue(Buffer.from('PDF')),
}));
jest.mock('../renderers/gate-access-xlsx-renderer.js', () => ({
  renderGateAccessXlsx: jest.fn().mockResolvedValue(Buffer.from('XLSX')),
}));
jest.mock('../renderers/vehicle-pdf-renderer.js', () => ({
  renderVehiclePdf: jest.fn().mockResolvedValue(Buffer.from('PDF')),
}));
jest.mock('../renderers/vehicle-xlsx-renderer.js', () => ({
  renderVehicleXlsx: jest.fn().mockResolvedValue(Buffer.from('XLSX')),
}));
jest.mock('../renderers/security-alert-pdf-renderer.js', () => ({
  renderSecurityAlertPdf: jest.fn().mockResolvedValue(Buffer.from('PDF')),
}));
jest.mock('../renderers/security-alert-xlsx-renderer.js', () => ({
  renderSecurityAlertXlsx: jest.fn().mockResolvedValue(Buffer.from('XLSX')),
}));
// RPT-CENTER: worker Trung tâm báo cáo kéo theo các renderer dùng exceljs/pdfkit thật, vốn không chạy được khi `fs` bị mock ở dưới.
jest.mock('../center/report-center-worker.processor.js', () => ({ ReportCenterWorkerProcessor: class {} }));
jest.mock('../schedules/report-schedule-run.worker.js', () => ({ ReportScheduleRunWorker: class {} }));
jest.mock('../renderers/user-export-xlsx-renderer.js', () => ({
  renderUserExportXlsx: jest.fn().mockResolvedValue(Buffer.from('XLSX')),
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

describe('MeetingActivityReportWorkerProcessor', () => {
  let processor: MeetingActivityReportWorkerProcessor;

  const mockBackgroundJobsService = {
    markRunning: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };

  const mockDataService = {
    getReportMetadata: jest.fn().mockResolvedValue({
      organizationLabel: 'Test Org',
      period: { from: '2026-07-01', to: '2026-07-31' },
      extractedByEmail: 'test@test.com',
      generatedAt: new Date(),
    }),
    getCoreKpis: jest.fn().mockResolvedValue({
      meetingCount: 10,
      reservationUtilizationRate: 75.5,
      noShowRate: 5.0,
      onTimeRate: 90.0,
    }),
    getStatusBreakdown: jest.fn().mockResolvedValue([
      { status: 'Completed', count: 8, percentage: 80 },
      { status: 'Cancelled', count: 1, percentage: 10 },
      { status: 'No-show', count: 1, percentage: 10 },
      { status: 'Scheduled', count: 0, percentage: 0 },
    ]),
    getMeetingDetailList: jest.fn().mockResolvedValue([]),
  };

  const mockMediaFileRepo = {
    create: jest.fn().mockReturnValue({ id: 'media-file-123' }),
    save: jest.fn().mockResolvedValue({ id: 'media-file-123' }),
    manager: {
      query: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };

  const mockStorageService = {
    getDriver: jest.fn().mockReturnValue('local'),
    saveFile: jest.fn().mockResolvedValue({
      storageKey: 'exports/test-report.pdf',
      publicUrl: 'http://localhost:3000/uploads/exports/test-report.pdf',
      sizeBytes: 1234,
    }),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('./storage/recordings'),
  };

  // UC-RUM-16: MeetingActivityReportWorkerProcessor la @Processor duy nhat cho
  // queue 'report-export', dispatch sang RoomUtilizationReportWorkerProcessor
  // khi job.name='export:room-utilization' — khong lien quan test file nay
  // (chi test job.name='export:meeting-activity'), mock rong la du.
  const mockRoomUtilizationWorker = {
    processExport: jest.fn().mockResolvedValue(undefined),
  };

  // Bước 5 SAVP (UC-127): mock rỗng — dispatch correctness verified in a
  // dedicated 'dispatch' describe block below, not by exercising real logic here.
  const mockGateAccessWorker = {
    processExport: jest.fn().mockResolvedValue(undefined),
  };
  const mockVehicleWorker = {
    processExport: jest.fn().mockResolvedValue(undefined),
  };
  const mockSecurityAlertWorker = {
    processExport: jest.fn().mockResolvedValue(undefined),
  };

  const makeJob = (
    data: Partial<{
      backgroundJobId: string;
      from: string;
      to: string;
      format: string;
      scope: { departmentId: null; roomId: null; organizerId: null };
      requestedByEmail: string;
    }> = {},
  ) => ({
    id: 'bull-job-1',
    // UC-RUM-16: process() dispatches by job.name (queue 'report-export' shared
    // with export:room-utilization) — this test suite is for meeting-activity jobs.
    name: 'export:meeting-activity',
    data: {
      backgroundJobId: 'bg-job-1',
      from: '2026-07-01',
      to: '2026-07-31',
      format: 'pdf',
      scope: { departmentId: null, roomId: null, organizerId: null },
      requestedByEmail: 'test@test.com',
      ...data,
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingActivityReportWorkerProcessor,
        { provide: BackgroundJobsService, useValue: mockBackgroundJobsService },
        {
          provide: MeetingActivityReportDataService,
          useValue: mockDataService,
        },
        {
          provide: getRepositoryToken(MediaFileEntity),
          useValue: mockMediaFileRepo,
        },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        {
          provide: RoomUtilizationReportWorkerProcessor,
          useValue: mockRoomUtilizationWorker,
        },
        {
          provide: GateAccessReportWorkerProcessor,
          useValue: mockGateAccessWorker,
        },
        {
          provide: VehicleReportWorkerProcessor,
          useValue: mockVehicleWorker,
        },
        {
          provide: SecurityAlertReportWorkerProcessor,
          useValue: mockSecurityAlertWorker,
        },
        { provide: ReportCenterWorkerProcessor, useValue: { processExport: jest.fn() } },
        { provide: ReportScheduleRunWorker, useValue: { processExport: jest.fn() } },
      ],
    }).compile();

    processor = module.get<MeetingActivityReportWorkerProcessor>(
      MeetingActivityReportWorkerProcessor,
    );
  });

  // ─── AC-001: Happy path ───────────────────────────────────────────────────────

  describe('AC-001 — Happy path', () => {
    it('markRunning → aggregate → render PDF → upload media → markCompleted with outputFileId', async () => {
      await processor.process(makeJob() as any);

      // markRunning called first
      expect(mockBackgroundJobsService.markRunning).toHaveBeenCalledWith(
        'bg-job-1',
      );

      // Data service methods all called
      expect(mockDataService.getReportMetadata).toHaveBeenCalled();
      expect(mockDataService.getCoreKpis).toHaveBeenCalled();
      expect(mockDataService.getStatusBreakdown).toHaveBeenCalled();
      expect(mockDataService.getMeetingDetailList).toHaveBeenCalled();

      // MediaFile saved
      expect(mockMediaFileRepo.save).toHaveBeenCalled();

      // markCompleted called (not markFailed)
      expect(mockBackgroundJobsService.markCompleted).toHaveBeenCalled();
      expect(mockBackgroundJobsService.markFailed).not.toHaveBeenCalled();

      // output_file_id updated in DB
      expect(mockMediaFileRepo.manager.update).toHaveBeenCalledWith(
        expect.any(Function), // BackgroundJobEntity
        'bg-job-1',
        { outputFileId: 'media-file-123' },
      );
    });

    it('renders XLSX when format is xlsx', async () => {
      jest.clearAllMocks();
      // Reset mocks that were cleared
      mockBackgroundJobsService.markRunning.mockResolvedValue(undefined);
      mockBackgroundJobsService.markCompleted.mockResolvedValue(undefined);
      mockMediaFileRepo.create.mockReturnValue({ id: 'media-file-123' });
      mockMediaFileRepo.save.mockResolvedValue({ id: 'media-file-123' });
      mockMediaFileRepo.manager.update.mockResolvedValue(undefined);
      mockStorageService.saveFile.mockResolvedValue({
        storageKey: 'exports/test-report.xlsx',
        publicUrl: 'http://localhost:3000/uploads/exports/test-report.xlsx',
        sizeBytes: 1234,
      });
      mockDataService.getReportMetadata.mockResolvedValue({
        organizationLabel: 'Test',
        period: { from: '2026-07-01', to: '2026-07-31' },
        extractedByEmail: 'test@test.com',
        generatedAt: new Date(),
      });
      mockDataService.getCoreKpis.mockResolvedValue({
        meetingCount: 5,
        reservationUtilizationRate: 0,
        noShowRate: 0,
        onTimeRate: 0,
      });
      mockDataService.getStatusBreakdown.mockResolvedValue([]);
      mockDataService.getMeetingDetailList.mockResolvedValue([]);

      await processor.process(makeJob({ format: 'xlsx' }) as any);

      expect(mockRenderXlsx).toHaveBeenCalled();
      expect(mockBackgroundJobsService.markCompleted).toHaveBeenCalled();
    });
  });

  // ─── AC-007: Error handling ───────────────────────────────────────────────────

  describe('AC-007 — Error handling (ARCH-02)', () => {
    it('calls markFailed when aggregate throws, does NOT throw out of process()', async () => {
      mockDataService.getCoreKpis.mockRejectedValueOnce(
        new Error('DB connection timeout'),
      );

      // Should NOT throw
      await expect(
        processor.process(makeJob() as any),
      ).resolves.toBeUndefined();

      expect(mockBackgroundJobsService.markFailed).toHaveBeenCalledWith(
        'bg-job-1',
        'DB connection timeout',
      );
      // Must not stay in running state
      expect(mockBackgroundJobsService.markCompleted).not.toHaveBeenCalled();
    });

    it('calls markFailed when render throws, does NOT throw', async () => {
      mockRenderPdf.mockRejectedValueOnce(new Error('PDF render error'));

      await expect(
        processor.process(makeJob() as any),
      ).resolves.toBeUndefined();

      expect(mockBackgroundJobsService.markFailed).toHaveBeenCalledWith(
        'bg-job-1',
        'PDF render error',
      );
    });
  });

  // ─── FR-011: Empty data ───────────────────────────────────────────────────────

  describe('FR-011 — Empty data still completes', () => {
    it('markCompleted normally even when no meetings in period', async () => {
      mockDataService.getMeetingDetailList.mockResolvedValueOnce([]); // no meetings
      mockDataService.getCoreKpis.mockResolvedValueOnce({
        meetingCount: 0,
        reservationUtilizationRate: 0,
        noShowRate: 0,
        onTimeRate: 0,
      });

      await processor.process(makeJob() as any);

      // Should complete normally, not fail
      expect(mockBackgroundJobsService.markCompleted).toHaveBeenCalled();
      expect(mockBackgroundJobsService.markFailed).not.toHaveBeenCalled();
    });
  });

  // ─── Bước 5 SAVP: Dispatch regression (⚠️ CRITICAL) ───────────────────────────
  // Nếu nhánh job.name mới bị đặt sai vị trí (sau dòng return im lặng cuối
  // process()), job sẽ KHÔNG BAO GIỜ được markRunning — treo mãi ở queued.

  describe('Dispatch — job.name routing (Bước 5 SAVP)', () => {
    it('dispatches export:gate-access to GateAccessReportWorkerProcessor, not the meeting-activity path', async () => {
      const job = makeJob() as any;
      job.name = 'export:gate-access';

      await processor.process(job);

      expect(mockGateAccessWorker.processExport).toHaveBeenCalledWith(job);
      expect(mockBackgroundJobsService.markRunning).not.toHaveBeenCalled();
      expect(mockDataService.getReportMetadata).not.toHaveBeenCalled();
    });

    it('dispatches export:vehicle to VehicleReportWorkerProcessor', async () => {
      const job = makeJob() as any;
      job.name = 'export:vehicle';

      await processor.process(job);

      expect(mockVehicleWorker.processExport).toHaveBeenCalledWith(job);
      expect(mockBackgroundJobsService.markRunning).not.toHaveBeenCalled();
      expect(mockGateAccessWorker.processExport).not.toHaveBeenCalled();
    });

    it('dispatches export:security-alert to SecurityAlertReportWorkerProcessor', async () => {
      const job = makeJob() as any;
      job.name = 'export:security-alert';

      await processor.process(job);

      expect(mockSecurityAlertWorker.processExport).toHaveBeenCalledWith(job);
      expect(mockBackgroundJobsService.markRunning).not.toHaveBeenCalled();
      expect(mockVehicleWorker.processExport).not.toHaveBeenCalled();
    });

    it('[BE-04, 2026-07-27] no longer dispatches export:users — job.name falls through silently (job này giờ chạy đồng bộ trong UserExportService, không qua queue)', async () => {
      const job = makeJob() as any;
      job.name = 'export:users';

      await processor.process(job);

      expect(mockBackgroundJobsService.markRunning).not.toHaveBeenCalled();
      expect(mockSecurityAlertWorker.processExport).not.toHaveBeenCalled();
      expect(mockGateAccessWorker.processExport).not.toHaveBeenCalled();
      expect(mockVehicleWorker.processExport).not.toHaveBeenCalled();
      expect(mockRoomUtilizationWorker.processExport).not.toHaveBeenCalled();
    });

    it('still dispatches export:room-utilization correctly (no regression from adding gate-access branch)', async () => {
      const job = makeJob() as any;
      job.name = 'export:room-utilization';

      await processor.process(job);

      expect(mockRoomUtilizationWorker.processExport).toHaveBeenCalledWith(job);
      expect(mockGateAccessWorker.processExport).not.toHaveBeenCalled();
    });

    it('still processes export:meeting-activity correctly (no regression)', async () => {
      await processor.process(makeJob() as any);

      expect(mockBackgroundJobsService.markRunning).toHaveBeenCalled();
      expect(mockGateAccessWorker.processExport).not.toHaveBeenCalled();
      expect(mockRoomUtilizationWorker.processExport).not.toHaveBeenCalled();
      expect(mockVehicleWorker.processExport).not.toHaveBeenCalled();
      expect(mockSecurityAlertWorker.processExport).not.toHaveBeenCalled();
    });

    it('returns silently for unknown job.name (no crash)', async () => {
      const job = makeJob() as any;
      job.name = 'export:unknown-type';

      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(mockBackgroundJobsService.markRunning).not.toHaveBeenCalled();
    });
  });
});
