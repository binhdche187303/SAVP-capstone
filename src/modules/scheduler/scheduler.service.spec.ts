/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerService } from './scheduler.service.js';
import { CheckInAlertService } from '../attendance/services/checkin-alert.service.js';
import { IotDevicesService } from '../iot/services/iot-devices.service.js';
import { NoShowDetectionService } from '../rooms/services/no-show-detection.service.js';
import { NoShowLifecycleService } from '../rooms/services/no-show-lifecycle.service.js';
import { EarlyVacancyService } from '../rooms/services/early-vacancy.service.js';
import { FaceProvisioningService } from '../face-access/services/face-provisioning.service.js';
import { IvssPersonSyncService } from '../ivss/services/ivss-person-sync.service.js';
import { IvssPortraitSyncService } from '../ivss/services/ivss-portrait-sync.service.js';
import { RestrictedZoneIntrusionService } from '../restricted-zone/services/restricted-zone-intrusion.service.js';
import { CrowdAlertService } from '../crowd-alert/services/crowd-alert.service.js';
import { GateLogPairingService } from '../zones/services/gate-log-pairing.service.js';
import { LiveMeetingService } from '../live-meeting/services/live-meeting.service.js';
import { MeetingRequestReviewService } from '../meetings/services/meeting-request-review.service.js';
import { SecurityAlertAutoResolveService } from '../alerts/services/security-alert-auto-resolve.service.js';
import { RecordingSessionService } from '../recording/services/recording-session.service.js';
import { RecordingSystemConfigService } from '../recording/services/recording-system-config.service.js';
import { OccupancyPersistenceService } from '../presence/services/occupancy-persistence.service.js';
import { ReportScheduleDispatchService } from '../reports/schedules/report-schedule-dispatch.service.js';
import { VisitorSweepService } from '../visitors/services/visitor-sweep.service.js';
import { KpiRollupJobService } from '../kpi-rollup/services/kpi-rollup-job.service.js';
import { DataSource } from 'typeorm';

describe('SchedulerService (NSL-001 + EVD-001 + IPS-001 + GAP-001 cron wiring)', () => {
  let detectMock: any;
  let lifecycleMock: any;
  let earlyVacancyMock: any;
  let ivssMock: any;
  let portraitMock: any;
  let checkInAlertMock: any;
  let restrictedZoneMock: any;
  let crowdAlertMock: any;
  let gatePairingMock: any;
  let liveMeetingMock: any;
  let meetingRequestReviewMock: any;
  let securityAlertAutoResolveMock: any;
  let dataSourceMock: any;
  let recordingSessionServiceMock: any;
  let recordingSystemConfigServiceMock: any;
  let occupancyPersistenceMock: any;
  let kpiRollupMock: any;
  let cfg: Record<string, unknown>;
  const calls: string[] = [];

  const build = async (): Promise<SchedulerService> => {
    calls.length = 0;
    detectMock = {
      detect: jest.fn(async () => {
        calls.push('detect');
        return { scanned: 0, created: 0 };
      }),
    };
    lifecycleMock = {
      reconcilePresence: jest.fn(async () => {
        calls.push('reconcile');
        return { scanned: 0, resolved: 0 };
      }),
      warnBatch: jest.fn(async () => {
        calls.push('warn');
        return { scanned: 0, warned: 0 };
      }),
      autoReleaseBatch: jest.fn(async () => ({
        scanned: 0,
        released: 0,
        skipped: 0,
      })),
    };
    earlyVacancyMock = {
      detect: jest.fn(async () => ({ scanned: 0, flagged: 0 })),
    };
    portraitMock = {
      reconcilePortraits: jest.fn(async () => ({
        scanned: 0,
        enrolled: 0,
        removed: 0,
        failed: 0,
      })),
    };
    ivssMock = {
      provisionUpcoming: jest.fn(async () => ({
        scanned: 0,
        enrolled: 0,
        skipped: 0,
        failed: 0,
      })),
      cleanupEnded: jest.fn(async () => ({
        scanned: 0,
        removed: 0,
        failed: 0,
      })),
    };
    checkInAlertMock = {
      processMeetings: jest.fn(async () => undefined),
    };
    restrictedZoneMock = {
      evaluateIntrusions: jest.fn(async () => ({
        zonesScanned: 0,
        gateLogsChecked: 0,
        presenceEventsChecked: 0,
        violationsFound: 0,
      })),
    };
    crowdAlertMock = {
      evaluateCrowdAlerts: jest.fn(async () => ({
        zonesScanned: 0,
        eventsChecked: 0,
        violationsFound: 0,
      })),
    };
    gatePairingMock = {
      pairBatch: jest.fn(async () => ({ scanned: 0, paired: 0, skipped: 0 })),
    };
    liveMeetingMock = {
      autoCompleteOverdueMeetings: jest.fn(async () => ({
        scanned: 0,
        completed: 0,
        skipped: 0,
        failed: 0,
      })),
      advanceMeetingStatuses: jest.fn(async () => ({
        started: 0,
        scanned: 0,
        completed: 0,
        skipped: 0,
        failed: 0,
      })),
    };
    meetingRequestReviewMock = {
      expireOverdueBatch: jest.fn(async () => ({
        scanned: 0,
        expired: 0,
        failed: 0,
      })),
    };
    securityAlertAutoResolveMock = {
      autoResolveExpired: jest.fn(async () => ({ scanned: 0, resolved: 0 })),
    };
    dataSourceMock = {
      query: jest.fn(async () => []),
    };
    recordingSessionServiceMock = {
      stopVideo: jest.fn(async () => ({ status: 'stopped' })),
    };
    recordingSystemConfigServiceMock = {
      getMaxDurationHours: jest.fn(async () => 6),
    };
    occupancyPersistenceMock = {
      reconcilePendingConfirmations: jest.fn(async () => {
        calls.push('presence-reconcile');
        return { scanned: 0, confirmed: 0 };
      }),
    };
    kpiRollupMock = {
      runIncremental: jest.fn(async () => ({ skipped: false, windows: {} })),
      runReconcile: jest.fn(async () => ({ skipped: false, windows: {} })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
        { provide: CheckInAlertService, useValue: checkInAlertMock },
        { provide: IotDevicesService, useValue: {} },
        { provide: NoShowDetectionService, useValue: detectMock },
        { provide: NoShowLifecycleService, useValue: lifecycleMock },
        { provide: EarlyVacancyService, useValue: earlyVacancyMock },
        { provide: FaceProvisioningService, useValue: {} },
        { provide: IvssPersonSyncService, useValue: ivssMock },
        { provide: IvssPortraitSyncService, useValue: portraitMock },
        {
          provide: RestrictedZoneIntrusionService,
          useValue: restrictedZoneMock,
        },
        { provide: CrowdAlertService, useValue: crowdAlertMock },
        { provide: GateLogPairingService, useValue: gatePairingMock },
        { provide: LiveMeetingService, useValue: liveMeetingMock },
        {
          provide: MeetingRequestReviewService,
          useValue: meetingRequestReviewMock,
        },
        {
          provide: SecurityAlertAutoResolveService,
          useValue: securityAlertAutoResolveMock,
        },
        {
          provide: RecordingSessionService,
          useValue: recordingSessionServiceMock,
        },
        {
          provide: RecordingSystemConfigService,
          useValue: recordingSystemConfigServiceMock,
        },
        {
          provide: OccupancyPersistenceService,
          useValue: occupancyPersistenceMock,
        },
        { provide: KpiRollupJobService, useValue: kpiRollupMock },
        { provide: ReportScheduleDispatchService, useValue: { dispatchDue: jest.fn() } },
        {
          provide: VisitorSweepService,
          useValue: {
            runSweep: jest.fn(),
            runFaceReconcile: jest.fn(),
            runPhotoRetention: jest.fn(),
          },
        },
      ],
    }).compile();
    return module.get(SchedulerService);
  };

  it('checkNoShow gate OFF (default) → KHÔNG gọi presence-reconcile/detect/warn', async () => {
    cfg = { SCHEDULER_ENABLED: true }; // no-show check default false
    const s = await build();
    await s.checkNoShow();
    expect(
      occupancyPersistenceMock.reconcilePendingConfirmations,
    ).not.toHaveBeenCalled();
    expect(detectMock.detect).not.toHaveBeenCalled();
    expect(lifecycleMock.warnBatch).not.toHaveBeenCalled();
  });

  // [FIX 2026-08-13, R12] presence-reconcile phải chạy TRƯỚC detect — xác nhận có mặt
  // theo đồng hồ thực trước khi detect() quét, để cùng lần chạy không tạo case oan cho
  // booking vừa đủ ngưỡng presenceConfirmSeconds nhưng chưa có event mới nào kích hoạt lại.
  //
  // [FIX 2026-08-22, race no-show/auto-release] auto-release nay GỘP vào CUỐI chuỗi này
  // (không còn @Cron('auto-release') riêng) — reconcilePresence() LUÔN chạy xong (case đã
  // được "kept" nếu có presence hợp lệ) TRƯỚC KHI autoReleaseBatch() được gọi trong CÙNG
  // tick, xoá race giữa 2 cron độc lập trước đây (xem no-show-lifecycle.service.spec.ts).
  it('checkNoShow ON (autoReleaseEnabled mặc định OFF) → thứ tự presence-reconcile → detect → reconcile → warn, KHÔNG auto-release', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_NO_SHOW_CHECK_ENABLED: true };
    const s = await build();
    await s.checkNoShow();
    expect(calls).toEqual([
      'presence-reconcile',
      'detect',
      'reconcile',
      'warn',
    ]);
    expect(lifecycleMock.autoReleaseBatch).not.toHaveBeenCalled();
  });

  // Trường hợp bắt buộc: noShowEnabled=true NHƯNG autoReleaseEnabled=false — cảnh báo
  // no-show vẫn chạy đủ (detect/reconcile/warn), nhưng phòng KHÔNG bị tự động thu hồi.
  // 2 cờ ĐỘC LẬP — gộp cron KHÔNG được phép làm auto-release "ăn theo" cờ noShowEnabled.
  it('checkNoShow ON + autoReleaseEnabled=false → warn vẫn chạy, autoReleaseBatch KHÔNG được gọi', async () => {
    cfg = {
      SCHEDULER_ENABLED: true,
      SCHEDULER_NO_SHOW_CHECK_ENABLED: true,
      SCHEDULER_AUTO_RELEASE_ENABLED: false,
    };
    const s = await build();
    await s.checkNoShow();
    expect(lifecycleMock.warnBatch).toHaveBeenCalledTimes(1);
    expect(lifecycleMock.autoReleaseBatch).not.toHaveBeenCalled();
  });

  it('checkNoShow ON + autoReleaseEnabled=true → auto-release chạy SAU CÙNG, sau warn', async () => {
    cfg = {
      SCHEDULER_ENABLED: true,
      SCHEDULER_NO_SHOW_CHECK_ENABLED: true,
      SCHEDULER_AUTO_RELEASE_ENABLED: true,
    };
    const s = await build();
    // build() tạo lifecycleMock mới mỗi lần — override SAU build() để track thứ tự gọi
    // qua mảng `calls` dùng chung (object reference giữ nguyên sau khi Nest đã inject).
    lifecycleMock.autoReleaseBatch = jest.fn(async () => {
      calls.push('auto-release');
      return { scanned: 0, released: 0, skipped: 0 };
    });
    await s.checkNoShow();
    expect(calls).toEqual([
      'presence-reconcile',
      'detect',
      'reconcile',
      'warn',
      'auto-release',
    ]);
  });

  it('checkNoShow gate OFF (default) → KHÔNG gọi autoReleaseBatch (dù autoReleaseEnabled=true)', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_AUTO_RELEASE_ENABLED: true };
    const s = await build();
    await s.checkNoShow();
    expect(lifecycleMock.autoReleaseBatch).not.toHaveBeenCalled();
  });

  it('autoRelease() (method riêng) không còn tồn tại trên SchedulerService — đã gộp vào checkNoShow()', async () => {
    cfg = { SCHEDULER_ENABLED: true };
    const s = await build();
    expect((s as unknown as { autoRelease?: unknown }).autoRelease).toBeUndefined();
  });

  // ── EVD-001 earlyVacancy cron ──
  it('earlyVacancy gate OFF (default) → KHÔNG gọi detect', async () => {
    cfg = { SCHEDULER_ENABLED: true };
    const s = await build();
    await s.earlyVacancy();
    expect(earlyVacancyMock.detect).not.toHaveBeenCalled();
  });

  it('earlyVacancy ON → gọi detect 1 lần', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_EARLY_VACANCY_ENABLED: true };
    const s = await build();
    await s.earlyVacancy();
    expect(earlyVacancyMock.detect).toHaveBeenCalledTimes(1);
  });

  it('earlyVacancy: detect throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_EARLY_VACANCY_ENABLED: true };
    const s = await build();
    earlyVacancyMock.detect.mockRejectedValueOnce(new Error('boom'));
    await expect(s.earlyVacancy()).resolves.toBeUndefined();
  });

  // ── IPS-001 ivssSync cron ──
  it('ivssSync gate OFF (default) → KHÔNG gọi provision/cleanup', async () => {
    cfg = { SCHEDULER_ENABLED: true };
    const s = await build();
    await s.ivssSync();
    expect(ivssMock.provisionUpcoming).not.toHaveBeenCalled();
    expect(ivssMock.cleanupEnded).not.toHaveBeenCalled();
  });

  it('ivssSync ON → gọi provision + cleanup', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_IVSS_SYNC_ENABLED: true };
    const s = await build();
    await s.ivssSync();
    expect(ivssMock.provisionUpcoming).toHaveBeenCalledTimes(1);
    expect(ivssMock.cleanupEnded).toHaveBeenCalledTimes(1);
  });

  it('ivssSync: provision throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_IVSS_SYNC_ENABLED: true };
    const s = await build();
    ivssMock.provisionUpcoming.mockRejectedValueOnce(new Error('boom'));
    await expect(s.ivssSync()).resolves.toBeUndefined();
  });

  // ── PORTRAIT-001 ivssPortraitReconcile cron ──
  it('ivssPortraitReconcile gate OFF (default) → KHÔNG gọi reconcile', async () => {
    cfg = { SCHEDULER_ENABLED: true };
    const s = await build();
    await s.ivssPortraitReconcile();
    expect(portraitMock.reconcilePortraits).not.toHaveBeenCalled();
  });

  it('ivssPortraitReconcile ON → gọi reconcilePortraits', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_IVSS_PORTRAIT_ENABLED: true };
    const s = await build();
    await s.ivssPortraitReconcile();
    expect(portraitMock.reconcilePortraits).toHaveBeenCalledTimes(1);
  });

  it('ivssPortraitReconcile: throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_IVSS_PORTRAIT_ENABLED: true };
    const s = await build();
    portraitMock.reconcilePortraits.mockRejectedValueOnce(new Error('boom'));
    await expect(s.ivssPortraitReconcile()).resolves.toBeUndefined();
  });

  // [FIX 2026-08-11, Case 3] chặn hồi quy: cron rút ngắn 5 phút → 30 giây (cron expression
  // tường minh, KHÔNG có hằng số 30-giây trong CronExpression enum chuẩn của @nestjs/schedule).
  it("ivssPortraitReconcile: @Cron dùng '*/30 * * * * *' (30 giây), KHÔNG còn EVERY_5_MINUTES", () => {
    const src = readFileSync(join(__dirname, 'scheduler.service.ts'), 'utf8');
    const match =
      /@Cron\(([^,]+),\s*\{\s*name:\s*'ivss-portrait-reconcile'/.exec(src);
    expect(match).not.toBeNull();
    expect(match?.[1].trim()).toBe("'*/30 * * * * *'");
  });

  // ── ARZ-001 evaluateRestrictedZoneIntrusions cron ──
  it('evaluateRestrictedZoneIntrusions gate OFF (default) → KHÔNG gọi evaluateIntrusions', async () => {
    cfg = { SCHEDULER_ENABLED: true };
    const s = await build();
    await s.evaluateRestrictedZoneIntrusions();
    expect(restrictedZoneMock.evaluateIntrusions).not.toHaveBeenCalled();
  });

  it('evaluateRestrictedZoneIntrusions ON → gọi evaluateIntrusions 1 lần', async () => {
    cfg = {
      SCHEDULER_ENABLED: true,
      SCHEDULER_RESTRICTED_ZONE_ENABLED: true,
    };
    const s = await build();
    await s.evaluateRestrictedZoneIntrusions();
    expect(restrictedZoneMock.evaluateIntrusions).toHaveBeenCalledTimes(1);
  });

  it('evaluateRestrictedZoneIntrusions: evaluateIntrusions throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = {
      SCHEDULER_ENABLED: true,
      SCHEDULER_RESTRICTED_ZONE_ENABLED: true,
    };
    const s = await build();
    restrictedZoneMock.evaluateIntrusions.mockRejectedValueOnce(
      new Error('boom'),
    );
    await expect(s.evaluateRestrictedZoneIntrusions()).resolves.toBeUndefined();
  });

  // ── ACR-001 evaluateCrowdAlerts cron ──
  it('evaluateCrowdAlerts gate OFF (default) → KHÔNG gọi evaluateCrowdAlerts', async () => {
    cfg = { SCHEDULER_ENABLED: true };
    const s = await build();
    await s.evaluateCrowdAlerts();
    expect(crowdAlertMock.evaluateCrowdAlerts).not.toHaveBeenCalled();
  });

  it('evaluateCrowdAlerts ON → gọi evaluateCrowdAlerts 1 lần', async () => {
    cfg = {
      SCHEDULER_ENABLED: true,
      SCHEDULER_CROWD_ALERT_ENABLED: true,
    };
    const s = await build();
    await s.evaluateCrowdAlerts();
    expect(crowdAlertMock.evaluateCrowdAlerts).toHaveBeenCalledTimes(1);
  });

  it('evaluateCrowdAlerts: evaluateCrowdAlerts throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = {
      SCHEDULER_ENABLED: true,
      SCHEDULER_CROWD_ALERT_ENABLED: true,
    };
    const s = await build();
    crowdAlertMock.evaluateCrowdAlerts.mockRejectedValueOnce(new Error('boom'));
    await expect(s.evaluateCrowdAlerts()).resolves.toBeUndefined();
  });

  // ── GAP-001 gateLogPairing cron (UC-106) ──
  it('gateLogPairing gate OFF (default) → KHÔNG gọi pairBatch', async () => {
    cfg = { SCHEDULER_ENABLED: true }; // SCHEDULER_GATE_PAIRING_ENABLED default false
    const s = await build();
    await s.gateLogPairing();
    expect(gatePairingMock.pairBatch).not.toHaveBeenCalled();
  });

  it('gateLogPairing ON → gọi pairBatch 1 lần', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_GATE_PAIRING_ENABLED: true };
    const s = await build();
    await s.gateLogPairing();
    expect(gatePairingMock.pairBatch).toHaveBeenCalledTimes(1);
  });

  it('gateLogPairing: pairBatch throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_GATE_PAIRING_ENABLED: true };
    const s = await build();
    gatePairingMock.pairBatch.mockRejectedValueOnce(new Error('boom'));
    await expect(s.gateLogPairing()).resolves.toBeUndefined();
  });

  // ── recon B1: autoCompleteMeetings cron ──
  it('autoCompleteMeetings gate OFF (default) → KHÔNG gọi autoCompleteOverdueMeetings', async () => {
    cfg = { SCHEDULER_ENABLED: true }; // SCHEDULER_AUTO_COMPLETE_ENABLED default false
    const s = await build();
    await s.autoCompleteMeetings();
    expect(liveMeetingMock.autoCompleteOverdueMeetings).not.toHaveBeenCalled();
  });

  it('autoCompleteMeetings ON → gọi autoCompleteOverdueMeetings 1 lần', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_AUTO_COMPLETE_ENABLED: true };
    const s = await build();
    await s.autoCompleteMeetings();
    expect(liveMeetingMock.autoCompleteOverdueMeetings).toHaveBeenCalledTimes(
      1,
    );
  });

  it('autoCompleteMeetings: autoCompleteOverdueMeetings throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_AUTO_COMPLETE_ENABLED: true };
    const s = await build();
    liveMeetingMock.autoCompleteOverdueMeetings.mockRejectedValueOnce(
      new Error('boom'),
    );
    await expect(s.autoCompleteMeetings()).resolves.toBeUndefined();
  });

  // ── F-A (MST-001): cron meeting-status-advance ──
  it('advanceMeetingStatuses gate OFF (default) → KHÔNG gọi service', async () => {
    cfg = { SCHEDULER_ENABLED: true }; // SCHEDULER_MEETING_STATUS_ENABLED default false
    const s = await build();
    await s.advanceMeetingStatuses();
    expect(liveMeetingMock.advanceMeetingStatuses).not.toHaveBeenCalled();
  });

  it('advanceMeetingStatuses ON → gọi advanceMeetingStatuses 1 lần', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_MEETING_STATUS_ENABLED: true };
    const s = await build();
    await s.advanceMeetingStatuses();
    expect(liveMeetingMock.advanceMeetingStatuses).toHaveBeenCalledTimes(1);
  });

  it('advanceMeetingStatuses: SCHEDULER_ENABLED=false → KHÔNG chạy dù cờ riêng bật', async () => {
    cfg = { SCHEDULER_ENABLED: false, SCHEDULER_MEETING_STATUS_ENABLED: true };
    const s = await build();
    await s.advanceMeetingStatuses();
    expect(liveMeetingMock.advanceMeetingStatuses).not.toHaveBeenCalled();
  });

  it('advanceMeetingStatuses: service throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_MEETING_STATUS_ENABLED: true };
    const s = await build();
    liveMeetingMock.advanceMeetingStatuses.mockRejectedValueOnce(
      new Error('boom'),
    );
    await expect(s.advanceMeetingStatuses()).resolves.toBeUndefined();
  });

  it('cờ meeting-status KHÔNG bật nhầm cron auto-complete cũ (2 cờ độc lập)', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_MEETING_STATUS_ENABLED: true };
    const s = await build();
    await s.autoCompleteMeetings();
    expect(liveMeetingMock.autoCompleteOverdueMeetings).not.toHaveBeenCalled();
  });

  // ── F-R4b: cron meeting-request-expire ──
  it('expireMeetingRequests gate OFF (default) → KHÔNG gọi expireOverdueBatch', async () => {
    cfg = { SCHEDULER_ENABLED: true }; // SCHEDULER_MEETING_REQUEST_EXPIRE_ENABLED default false
    const s = await build();
    await s.expireMeetingRequests();
    expect(meetingRequestReviewMock.expireOverdueBatch).not.toHaveBeenCalled();
  });

  it('expireMeetingRequests ON → gọi expireOverdueBatch 1 lần', async () => {
    cfg = {
      SCHEDULER_ENABLED: true,
      SCHEDULER_MEETING_REQUEST_EXPIRE_ENABLED: true,
    };
    const s = await build();
    await s.expireMeetingRequests();
    expect(meetingRequestReviewMock.expireOverdueBatch).toHaveBeenCalledTimes(
      1,
    );
  });

  it('expireMeetingRequests: SCHEDULER_ENABLED=false → KHÔNG chạy dù cờ riêng bật', async () => {
    cfg = {
      SCHEDULER_ENABLED: false,
      SCHEDULER_MEETING_REQUEST_EXPIRE_ENABLED: true,
    };
    const s = await build();
    await s.expireMeetingRequests();
    expect(meetingRequestReviewMock.expireOverdueBatch).not.toHaveBeenCalled();
  });

  it('expireMeetingRequests: expireOverdueBatch throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = {
      SCHEDULER_ENABLED: true,
      SCHEDULER_MEETING_REQUEST_EXPIRE_ENABLED: true,
    };
    const s = await build();
    meetingRequestReviewMock.expireOverdueBatch.mockRejectedValueOnce(
      new Error('boom'),
    );
    await expect(s.expireMeetingRequests()).resolves.toBeUndefined();
  });

  // ── ASC-001: cron security-alert-auto-resolve ──
  it('securityAlertAutoResolve gate OFF (default) → KHÔNG gọi autoResolveExpired', async () => {
    cfg = { SCHEDULER_ENABLED: true }; // SCHEDULER_SECURITY_ALERT_AUTO_RESOLVE_ENABLED default false
    const s = await build();
    await s.securityAlertAutoResolve();
    expect(
      securityAlertAutoResolveMock.autoResolveExpired,
    ).not.toHaveBeenCalled();
  });

  it('securityAlertAutoResolve ON → gọi autoResolveExpired 1 lần', async () => {
    cfg = {
      SCHEDULER_ENABLED: true,
      SCHEDULER_SECURITY_ALERT_AUTO_RESOLVE_ENABLED: true,
    };
    const s = await build();
    await s.securityAlertAutoResolve();
    expect(
      securityAlertAutoResolveMock.autoResolveExpired,
    ).toHaveBeenCalledTimes(1);
  });

  it('securityAlertAutoResolve: SCHEDULER_ENABLED=false → KHÔNG chạy dù cờ riêng bật', async () => {
    cfg = {
      SCHEDULER_ENABLED: false,
      SCHEDULER_SECURITY_ALERT_AUTO_RESOLVE_ENABLED: true,
    };
    const s = await build();
    await s.securityAlertAutoResolve();
    expect(
      securityAlertAutoResolveMock.autoResolveExpired,
    ).not.toHaveBeenCalled();
  });

  it('securityAlertAutoResolve: autoResolveExpired throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = {
      SCHEDULER_ENABLED: true,
      SCHEDULER_SECURITY_ALERT_AUTO_RESOLVE_ENABLED: true,
    };
    const s = await build();
    securityAlertAutoResolveMock.autoResolveExpired.mockRejectedValueOnce(
      new Error('boom'),
    );
    await expect(s.securityAlertAutoResolve()).resolves.toBeUndefined();
  });

  // ── [FIX 2026-08-12, R9 — Lớp 2] cron recording-max-duration-enforce ──
  describe('recordingMaxDurationEnforce()', () => {
    it('gate OFF (default) → KHÔNG đọc config, KHÔNG query recording_sessions', async () => {
      cfg = { SCHEDULER_ENABLED: true }; // SCHEDULER_RECORDING_MAX_DURATION_ENABLED default false
      const s = await build();
      await s.recordingMaxDurationEnforce();
      expect(
        recordingSystemConfigServiceMock.getMaxDurationHours,
      ).not.toHaveBeenCalled();
      expect(dataSourceMock.query).not.toHaveBeenCalled();
    });

    it('SCHEDULER_ENABLED=false → KHÔNG chạy dù cờ riêng bật', async () => {
      cfg = {
        SCHEDULER_ENABLED: false,
        SCHEDULER_RECORDING_MAX_DURATION_ENABLED: true,
      };
      const s = await build();
      await s.recordingMaxDurationEnforce();
      expect(dataSourceMock.query).not.toHaveBeenCalled();
    });

    it('ON → query đúng status IN (recording,paused) AND started_at < NOW() - (maxHours * 1h)', async () => {
      cfg = {
        SCHEDULER_ENABLED: true,
        SCHEDULER_RECORDING_MAX_DURATION_ENABLED: true,
      };
      const s = await build();
      await s.recordingMaxDurationEnforce();

      const [sql, params] = dataSourceMock.query.mock.calls[0];
      expect(sql).toContain("status IN ('recording','paused')");
      expect(sql).toContain(
        "started_at < NOW() - ($1::int * INTERVAL '1 hour')",
      );
      expect(params).toEqual([6]); // maxHours mặc định từ mock RecordingSystemConfigService
    });

    it('session quá hạn (status=recording) → dừng thật: gọi stopVideo(meetingId, id, null) + tag metadata_json.auto_stop_reason', async () => {
      cfg = {
        SCHEDULER_ENABLED: true,
        SCHEDULER_RECORDING_MAX_DURATION_ENABLED: true,
      };
      const s = await build();
      dataSourceMock.query.mockResolvedValueOnce([
        { id: 'sess-1', meeting_id: 'm-1' },
      ]);
      await s.recordingMaxDurationEnforce();

      expect(recordingSessionServiceMock.stopVideo).toHaveBeenCalledWith(
        'm-1',
        'sess-1',
        null,
      );
      // Query thứ 2 = UPDATE tag metadata_json — KHÔNG lẫn với error_message
      // 'empty file'/'no video data' (mô tả trạng thái file, khác lý do gọi dừng).
      const [updateSql, updateParams] = dataSourceMock.query.mock.calls[1];
      expect(updateSql).toContain('UPDATE recording_sessions');
      expect(updateSql).toContain('metadata_json');
      const tagJson = JSON.parse(updateParams[0] as string) as {
        auto_stop_reason: string;
        max_duration_hours: number;
      };
      expect(tagJson.auto_stop_reason).toBe('max_duration_exceeded');
      expect(tagJson.max_duration_hours).toBe(6);
      expect(updateParams[1]).toBe('sess-1');
    });

    it('1 session lỗi → session còn lại VẪN được xử lý, KHÔNG ném ra cron (ARCH-02)', async () => {
      cfg = {
        SCHEDULER_ENABLED: true,
        SCHEDULER_RECORDING_MAX_DURATION_ENABLED: true,
      };
      const s = await build();
      dataSourceMock.query.mockResolvedValueOnce([
        { id: 'bad', meeting_id: 'm-1' },
        { id: 'good', meeting_id: 'm-2' },
      ]);
      recordingSessionServiceMock.stopVideo
        .mockRejectedValueOnce(new Error('ffmpeg concat failed'))
        .mockResolvedValueOnce({ status: 'stopped' });

      await expect(s.recordingMaxDurationEnforce()).resolves.toBeUndefined();
      expect(recordingSessionServiceMock.stopVideo).toHaveBeenCalledTimes(2);
    });

    it('đổi config qua RecordingSystemConfigService (vd 3 giờ) → cron dùng ĐÚNG giá trị mới, KHÔNG hardcode', async () => {
      cfg = {
        SCHEDULER_ENABLED: true,
        SCHEDULER_RECORDING_MAX_DURATION_ENABLED: true,
      };
      const s = await build();
      recordingSystemConfigServiceMock.getMaxDurationHours.mockResolvedValue(3);
      await s.recordingMaxDurationEnforce();

      const [, params] = dataSourceMock.query.mock.calls[0];
      expect(params).toEqual([3]);
    });

    it('query lỗi (vd DB down) → KHÔNG ném ra cron (ARCH-02)', async () => {
      cfg = {
        SCHEDULER_ENABLED: true,
        SCHEDULER_RECORDING_MAX_DURATION_ENABLED: true,
      };
      const s = await build();
      dataSourceMock.query.mockRejectedValueOnce(new Error('db down'));
      await expect(s.recordingMaxDurationEnforce()).resolves.toBeUndefined();
    });
  });

  // ── KPI-001 kpi-rollup cron ──
  it('kpiRollupHourly gate OFF (default) → KHÔNG gọi runIncremental', async () => {
    cfg = { SCHEDULER_ENABLED: true };
    const s = await build();
    await s.kpiRollupHourly();
    expect(kpiRollupMock.runIncremental).not.toHaveBeenCalled();
  });

  it('kpiRollupHourly ON → gọi runIncremental 1 lần', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_KPI_ROLLUP_ENABLED: true };
    const s = await build();
    await s.kpiRollupHourly();
    expect(kpiRollupMock.runIncremental).toHaveBeenCalledTimes(1);
  });

  it('kpiRollupHourly: throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_KPI_ROLLUP_ENABLED: true };
    const s = await build();
    kpiRollupMock.runIncremental.mockRejectedValueOnce(new Error('boom'));
    await expect(s.kpiRollupHourly()).resolves.toBeUndefined();
  });

  it('kpiRollupReconcile ON → gọi runReconcile; SCHEDULER_ENABLED=false → không gọi', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_KPI_ROLLUP_ENABLED: true };
    let s = await build();
    await s.kpiRollupReconcile();
    expect(kpiRollupMock.runReconcile).toHaveBeenCalledTimes(1);
    cfg = { SCHEDULER_ENABLED: false, SCHEDULER_KPI_ROLLUP_ENABLED: true };
    s = await build();
    await s.kpiRollupReconcile();
    expect(kpiRollupMock.runReconcile).not.toHaveBeenCalled();
  });

  it('kpi cron: lịch phút 05 mỗi giờ + 01:00 theo giờ VN', () => {
    const src = readFileSync(join(__dirname, 'scheduler.service.ts'), 'utf8');
    expect(src).toContain(
      `@Cron('0 5 * * * *', { name: 'kpi-rollup-hourly' })`,
    );
    expect(src).toMatch(
      /@Cron\('0 0 1 \* \* \*', \{\s*name: 'kpi-rollup-reconcile',\s*timeZone: 'Asia\/Ho_Chi_Minh',?\s*\}\)/,
    );
  });
});
