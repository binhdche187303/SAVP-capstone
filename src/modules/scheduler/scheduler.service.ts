import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
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
import { SecurityAlertAutoResolveService } from '../alerts/services/security-alert-auto-resolve.service.js';
import { GateLogPairingService } from '../zones/services/gate-log-pairing.service.js';
import { LiveMeetingService } from '../live-meeting/services/live-meeting.service.js';
import { MeetingRequestReviewService } from '../meetings/services/meeting-request-review.service.js';
import { RecordingSessionService } from '../recording/services/recording-session.service.js';
import { RecordingSystemConfigService } from '../recording/services/recording-system-config.service.js';
import { OccupancyPersistenceService } from '../presence/services/occupancy-persistence.service.js';
import { ReportScheduleDispatchService } from '../reports/schedules/report-schedule-dispatch.service.js';
import { VisitorSweepService } from '../visitors/services/visitor-sweep.service.js';
import {
  KpiRollupJobService,
  type RollupRunResult,
} from '../kpi-rollup/services/kpi-rollup-job.service.js';

/**
 * SchedulerService — Skeleton cron jobs.
 *
 * Các job chỉ log TODO message nếu được enable.
 * Không implement business logic ở đây.
 *
 * Luồng thực tế (TODO):
 * - checkNoShow() → UtilizationService.detectNoShow()
 * - sendReminders() → NotificationsService.sendScheduledReminders()
 * - checkCheckinAlerts() → CheckInAlertService.processMeetings()
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  private readonly schedulerEnabled: boolean;
  private readonly noShowEnabled: boolean;
  private readonly autoReleaseEnabled: boolean;
  private readonly reminderEnabled: boolean;
  private readonly deviceOfflineDetectEnabled: boolean;
  private readonly faceSyncEnabled: boolean;
  private readonly earlyVacancyEnabled: boolean;
  private readonly ivssSyncEnabled: boolean;
  private readonly ivssPortraitEnabled: boolean;
  private readonly restrictedZoneEnabled: boolean;
  private readonly crowdAlertEnabled: boolean;
  private readonly gatePairingEnabled: boolean;
  private readonly autoCompleteEnabled: boolean;
  private readonly meetingStatusEnabled: boolean;
  private readonly meetingRequestExpireEnabled: boolean;
  private readonly securityAlertAutoResolveEnabled: boolean;
  private readonly recordingMaxDurationEnabled: boolean;
  private readonly kpiRollupEnabled: boolean;
  private readonly visitorEnabled: boolean;
  private readonly reportScheduleEnabled: boolean;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly checkInAlertService: CheckInAlertService,
    private readonly iotDevicesService: IotDevicesService,
    private readonly noShowDetectionService: NoShowDetectionService,
    private readonly noShowLifecycleService: NoShowLifecycleService,
    private readonly earlyVacancyService: EarlyVacancyService,
    private readonly faceProvisioningService: FaceProvisioningService,
    private readonly ivssPersonSyncService: IvssPersonSyncService,
    private readonly ivssPortraitSyncService: IvssPortraitSyncService,
    private readonly crowdAlertService: CrowdAlertService,
    private readonly restrictedZoneIntrusionService: RestrictedZoneIntrusionService,
    private readonly gateLogPairingService: GateLogPairingService,
    private readonly liveMeetingService: LiveMeetingService,
    private readonly meetingRequestReviewService: MeetingRequestReviewService,
    private readonly securityAlertAutoResolveService: SecurityAlertAutoResolveService,
    private readonly recordingSessionService: RecordingSessionService,
    private readonly recordingSystemConfigService: RecordingSystemConfigService,
    private readonly occupancyPersistenceService: OccupancyPersistenceService,
    private readonly kpiRollupJobService: KpiRollupJobService,
    private readonly visitorSweepService: VisitorSweepService,
    private readonly reportScheduleDispatchService: ReportScheduleDispatchService,
  ) {
    this.schedulerEnabled = this.configService.get<boolean>(
      'SCHEDULER_ENABLED',
      true,
    );
    this.noShowEnabled = this.configService.get<boolean>(
      'SCHEDULER_NO_SHOW_CHECK_ENABLED',
      false,
    );
    this.autoReleaseEnabled = this.configService.get<boolean>(
      'SCHEDULER_AUTO_RELEASE_ENABLED',
      false,
    );
    this.reminderEnabled = this.configService.get<boolean>(
      'SCHEDULER_NOTIFICATION_REMINDER_ENABLED',
      false,
    );
    this.deviceOfflineDetectEnabled = this.configService.get<boolean>(
      'DEVICE_OFFLINE_DETECT_ENABLED',
      true,
    );
    this.faceSyncEnabled = this.configService.get<boolean>(
      'FACE_SYNC_ENABLED',
      false,
    );
    this.earlyVacancyEnabled = this.configService.get<boolean>(
      'SCHEDULER_EARLY_VACANCY_ENABLED',
      false,
    );
    this.ivssSyncEnabled = this.configService.get<boolean>(
      'SCHEDULER_IVSS_SYNC_ENABLED',
      false,
    );
    // PORTRAIT-001: mặc định TẮT. ⚠ CHỈ bật sau khi luồng check-in họp (group "1") đã
    // verify chạy thật — yêu cầu của chủ dự án, tránh luồng mới làm rối luồng đang test.
    this.ivssPortraitEnabled = this.configService.get<boolean>(
      'SCHEDULER_IVSS_PORTRAIT_ENABLED',
      false,
    );
    this.restrictedZoneEnabled = this.configService.get<boolean>(
      'SCHEDULER_RESTRICTED_ZONE_ENABLED',
      false,
    );
    this.crowdAlertEnabled = this.configService.get<boolean>(
      'SCHEDULER_CROWD_ALERT_ENABLED',
      false,
    );
    this.gatePairingEnabled = this.configService.get<boolean>(
      'SCHEDULER_GATE_PAIRING_ENABLED',
      false,
    );
    // recon B1: cron auto-complete meeting quá end_time (gated default OFF).
    // ⚠ [F-A] BỊ THAY THẾ bởi SCHEDULER_MEETING_STATUS_ENABLED bên dưới (cron
    // meeting-status-advance làm CẢ start lẫn complete). Giữ cờ cũ để môi
    // trường đã set không đổi hành vi đột ngột; bật CẢ HAI là thừa nhưng vô
    // hại (đều idempotent, endMeeting có lock + check actualEndTime).
    this.autoCompleteEnabled = this.configService.get<boolean>(
      'SCHEDULER_AUTO_COMPLETE_ENABLED',
      false,
    );
    // F-A (MST-001): cron lật status theo thời gian (start + complete).
    this.meetingStatusEnabled = this.configService.get<boolean>(
      'SCHEDULER_MEETING_STATUS_ENABLED',
      false,
    );
    // F-R4b: cron tự expire meeting_requests PENDING quá deadline (default OFF).
    this.meetingRequestExpireEnabled = this.configService.get<boolean>(
      'SCHEDULER_MEETING_REQUEST_EXPIRE_ENABLED',
      false,
    );
    // ASC-001: cron tự resolve security_alerts không tái phát quá N phút (default OFF).
    this.securityAlertAutoResolveEnabled = this.configService.get<boolean>(
      'SCHEDULER_SECURITY_ALERT_AUTO_RESOLVE_ENABLED',
      false,
    );
    // [FIX 2026-08-12, R9 — Lớp 2] Lưới an toàn cuối: session recording chạy quá lâu (không
    // ai pause/stop, và Lớp 1 — auto-stop khi endMeeting() — không kích hoạt được vì lý do
    // nào đó) tự động bị dừng. Gate riêng, ĐỘC LẬP với meeting-status/auto-complete.
    this.recordingMaxDurationEnabled = this.configService.get<boolean>(
      'SCHEDULER_RECORDING_MAX_DURATION_ENABLED',
      false,
    );
    // KPI-001 (#10): rollup KPI theo giờ + đối soát 01:00 (default OFF).
    this.kpiRollupEnabled = this.configService.get<boolean>(
      'SCHEDULER_KPI_ROLLUP_ENABLED',
      false,
    );

    // VIS-BE-001: quét khách đến làm việc (default OFF).
    this.visitorEnabled = this.configService.get<boolean>(
      'SCHEDULER_VISITOR_ENABLED',
      false,
    );

    // RPT-CENTER-BE-001: gửi báo cáo theo lịch (default OFF).
    this.reportScheduleEnabled = this.configService.get<boolean>(
      'SCHEDULER_REPORT_SCHEDULE_ENABLED',
      false,
    );

    this.logger.log(
      `SchedulerService initialized — enabled=${this.schedulerEnabled} | no-show=${this.noShowEnabled} | auto-release=${this.autoReleaseEnabled} | reminder=${this.reminderEnabled} | device-offline-detect=${this.deviceOfflineDetectEnabled} | face-sync=${this.faceSyncEnabled} | early-vacancy=${this.earlyVacancyEnabled} | ivss-sync=${this.ivssSyncEnabled} | ivss-portrait=${this.ivssPortraitEnabled} | restricted-zone=${this.restrictedZoneEnabled} | crowd-alert=${this.crowdAlertEnabled} | gate-pairing=${this.gatePairingEnabled} | auto-complete=${this.autoCompleteEnabled} | meeting-status=${this.meetingStatusEnabled} | meeting-request-expire=${this.meetingRequestExpireEnabled} | security-alert-auto-resolve=${this.securityAlertAutoResolveEnabled} | recording-max-duration=${this.recordingMaxDurationEnabled} | kpi-rollup=${this.kpiRollupEnabled} | visitor=${this.visitorEnabled} | report-schedule=${this.reportScheduleEnabled}`,
    );
  }

  /**
   * FMP-001 (#FaceB): provision/deprovision khuôn mặt theo cuộc họp.
   * Gate SCHEDULER_ENABLED && FACE_SYNC_ENABLED (default OFF). KHÔNG ném ra cron.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'face-sync' })
  async faceSync(): Promise<void> {
    if (!this.schedulerEnabled || !this.faceSyncEnabled) return;
    try {
      const p = await this.faceProvisioningService.provisionUpcomingMeetings();
      const d = await this.faceProvisioningService.deprovisionEndedMeetings();
      // [FIX 2026-08-16] Lưới an toàn bổ sung — chạy SAU deprovisionEndedMeetings(),
      // bắt mapping mồ côi theo meeting.status (completed/cancelled) ngay lượt cron
      // kế tiếp, KHÔNG đợi end_time/grace như bước trên. Không thay thế bước trên.
      const s = await this.faceProvisioningService.deprovisionByMeetingStatus();
      this.logger.log(
        `[Scheduler] face-sync: provisioned-scan=${p.scanned} skipped=${p.skipped} deprovisioned-scan=${d.scanned} safety-net-deprovisioned=${s.scanned}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] face-sync failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'face-reconcile' })
  async faceReconcile(): Promise<void> {
    if (!this.schedulerEnabled || !this.faceSyncEnabled) return;
    try {
      const r = await this.faceProvisioningService.reconcile();
      this.logger.log(
        `[Scheduler] face-reconcile: stale=${r.stale} deduped=${r.deduped}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] face-reconcile failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  /**
   * IOT-014 — Active probe phát hiện camera offline.
   * Cron cố định EVERY_MINUTE; gate SCHEDULER_ENABLED && DEVICE_OFFLINE_DETECT_ENABLED.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'device-offline-detect' })
  async detectOfflineDevices(): Promise<void> {
    if (!this.schedulerEnabled || !this.deviceOfflineDetectEnabled) return;

    const r = await this.iotDevicesService.detectOfflineDevices(null);
    this.logger.log(
      `[Scheduler] device-offline-detect: checked=${r.checked} online=${r.online_count} offline=${r.offline_count} transitions=${r.transitions.length}`,
    );
  }

  /**
   * No-show detection job.
   *
   * EVERY_MINUTE chứ không phải 5 phút: threshold/warning-grace cấu hình được
   * qua NoShowConfigService (có thể đặt 1 phút) — cron 5 phút làm sai lệch tới
   * gần 5 phút so với ngưỡng đã cấu hình (xem phân tích 2026-08-13). Cùng lý do
   * với meeting-status-advance bên dưới. SCHEDULER_NO_SHOW_CHECK_CRON hiện KHÔNG
   * được đọc ở đâu (dead config) — @Cron() không thể nhận giá trị runtime từ
   * ConfigService, nên interval vẫn phải hardcode.
   *
   * [FIX 2026-08-13, R12] Gọi occupancyPersistenceService.reconcilePendingConfirmations()
   * TRƯỚC detect() — xác nhận có mặt theo đồng hồ thực cho các booking chỉ có 1 event dương
   * lúc vào (cảm biến báo-khi-chuyển-trạng-thái, không gửi liên tục), rồi detect() mới quét
   * dựa trên first_presence_at đã được cập nhật tới thời điểm mới nhất trong CÙNG lần chạy.
   *
   * [FIX 2026-08-22, race no-show/auto-release] auto-release GỘP vào CUỐI chuỗi này —
   * trước đây `autoRelease()` là 1 `@Cron(EVERY_MINUTE)` riêng, độc lập hoàn toàn (không
   * khoá, không đảm bảo thứ tự) với `checkNoShow()`. Xác nhận qua dữ liệu thật (case
   * a9225eae/7d1bf2ff, 2026-08-21): presence đã đủ `presenceConfirmSeconds` tới 21-41 GIÂY
   * TRƯỚC KHI phòng bị auto-release, nhưng `first_presence_at` chỉ được
   * `reconcilePendingConfirmations()` ghi nhận ~20s SAU KHI phòng đã bị thu hồi — vì tick
   * của 2 cron không đồng bộ, `autoReleaseBatch()` đọc thấy `first_presence_at IS NULL` và
   * release trước khi cron kia kịp xác nhận. Gộp tuần tự vào 1 luồng xoá hoàn toàn race này:
   * `reconcilePresence()` LUÔN chạy xong (case đã kept/resolved nếu có presence hợp lệ)
   * TRƯỚC KHI `autoReleaseBatch()` chạy trong CÙNG tick. `autoReleaseEnabled` GIỮ NGUYÊN
   * gate ĐỘC LẬP (KHÔNG gộp chung điều kiện với `noShowEnabled`) — admin vẫn bật được cảnh
   * báo no-show mà tắt riêng auto-release, đúng hành vi cũ.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'no-show-check' })
  async checkNoShow(): Promise<void> {
    if (!this.schedulerEnabled || !this.noShowEnabled) return;

    // R12 → NSC-001 (#31) → NSL-001 (OQ-4/#33): reconcile-presence-by-time → detect →
    // reconcile-presence(no_show_cases) → warn → auto-release (nếu bật). KHÔNG ném ra cron.
    try {
      const p =
        await this.occupancyPersistenceService.reconcilePendingConfirmations();
      const d = await this.noShowDetectionService.detect();
      const rec = await this.noShowLifecycleService.reconcilePresence();
      const w = await this.noShowLifecycleService.warnBatch();

      let releaseLog = 'auto-release SKIPPED (autoReleaseEnabled=false)';
      if (this.autoReleaseEnabled) {
        const r = await this.noShowLifecycleService.autoReleaseBatch();
        releaseLog = `auto-release scanned=${r.scanned} released=${r.released} skipped=${r.skipped}`;
      }

      this.logger.log(
        `[Scheduler] no-show-check: presence-reconcile scanned=${p.scanned} confirmed=${p.confirmed}` +
          ` | detected scanned=${d.scanned} created=${d.created}` +
          ` | reconcile resolved=${rec.resolved} | warn scanned=${w.scanned} warned=${w.warned}` +
          ` | ${releaseLog}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] no-show-check failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * EVD-001 (#34) — phát hiện phòng trống sớm (họp đã bắt đầu rồi trống).
   * Gate SCHEDULER_ENABLED && SCHEDULER_EARLY_VACANCY_ENABLED (default OFF). KHÔNG ném ra cron.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'early-vacancy' })
  async earlyVacancy(): Promise<void> {
    if (!this.schedulerEnabled || !this.earlyVacancyEnabled) return;

    try {
      const r = await this.earlyVacancyService.detect();
      this.logger.log(
        `[Scheduler] early-vacancy: scanned=${r.scanned} flagged=${r.flagged}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] early-vacancy failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * F-A (MST-001) — lật `meetings.status` theo thời gian, mỗi phút:
   * `scheduled` → `in_progress` (tới giờ) → `completed` (quá giờ).
   *
   * Vì sao EVERY_MINUTE chứ không phải 5 phút như auto-complete cũ: trạng thái
   * này chặn luồng điểm danh IVSS thời gian thực (`resolveMeeting` lọc theo
   * status) — trễ 5 phút đầu giờ là 5 phút quẹt mặt bị tính `unmatched`.
   *
   * Gate SCHEDULER_ENABLED && SCHEDULER_MEETING_STATUS_ENABLED (default OFF).
   * KHÔNG ném ra cron (ARCH-02).
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'meeting-status-advance' })
  async advanceMeetingStatuses(): Promise<void> {
    if (!this.schedulerEnabled || !this.meetingStatusEnabled) return;

    try {
      const r = await this.liveMeetingService.advanceMeetingStatuses();
      this.logger.log(
        `[Scheduler] meeting-status-advance: started=${r.started} scanned=${r.scanned} completed=${r.completed} skipped=${r.skipped} failed=${r.failed}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] meeting-status-advance failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * F-R4b — meeting_requests PENDING quá deadline (requestedStartTime) tự
   * chuyển EXPIRED: CREATE_MEETING → meeting CANCELLED; UPDATE_TIME/UPDATE_ROOM
   * → meeting revert SCHEDULED (giữ nguyên giờ/phòng cũ).
   * Gate SCHEDULER_ENABLED && SCHEDULER_MEETING_REQUEST_EXPIRE_ENABLED (default
   * OFF). KHÔNG ném ra cron (ARCH-02).
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'meeting-request-expire' })
  async expireMeetingRequests(): Promise<void> {
    if (!this.schedulerEnabled || !this.meetingRequestExpireEnabled) return;

    try {
      const r = await this.meetingRequestReviewService.expireOverdueBatch();
      this.logger.log(
        `[Scheduler] meeting-request-expire: scanned=${r.scanned} expired=${r.expired} failed=${r.failed}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] meeting-request-expire failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * recon B1 — auto-complete meeting đã quá end_time (reuse
   * LiveMeetingService.endMeeting(), KHÔNG viết lại logic kết thúc phiên).
   * Gate SCHEDULER_ENABLED && SCHEDULER_AUTO_COMPLETE_ENABLED (default OFF).
   * KHÔNG ném ra cron.
   *
   * ⚠ [F-A] BỊ THAY THẾ bởi cron `meeting-status-advance` ở trên (làm cả start
   * lẫn complete). Chỉ giữ cho môi trường đã bật cờ cũ; môi trường mới nên
   * dùng SCHEDULER_MEETING_STATUS_ENABLED.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'auto-complete-meetings' })
  async autoCompleteMeetings(): Promise<void> {
    if (!this.schedulerEnabled || !this.autoCompleteEnabled) return;

    try {
      const r = await this.liveMeetingService.autoCompleteOverdueMeetings();
      this.logger.log(
        `[Scheduler] auto-complete-meetings: scanned=${r.scanned} completed=${r.completed} skipped=${r.skipped} failed=${r.failed}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] auto-complete-meetings failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * IPS-001 (#37) — đồng bộ person IVSS theo cuộc họp (enroll + cleanup).
   * Gate SCHEDULER_ENABLED && SCHEDULER_IVSS_SYNC_ENABLED (default OFF). KHÔNG ném ra cron (ARCH-02).
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'ivss-sync' })
  async ivssSync(): Promise<void> {
    if (!this.schedulerEnabled || !this.ivssSyncEnabled) return;

    try {
      const p = await this.ivssPersonSyncService.provisionUpcoming();
      const c = await this.ivssPersonSyncService.cleanupEnded();
      this.logger.log(
        `[Scheduler] ivss-sync: provision scanned=${p.scanned} enrolled=${p.enrolled} skipped=${p.skipped} failed=${p.failed}` +
          ` | cleanup scanned=${c.scanned} removed=${c.removed} failed=${c.failed}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] ivss-sync failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * PORTRAIT-001 (UC-109+110) — đối chiếu kho mặt THƯỜNG TRỰC (portrait group) với
   * face_profiles/users: ảnh vừa được duyệt → enroll; account khoá/nghỉ hoặc ảnh hết
   * active → remove. Đây là nguồn điều khiển DUY NHẤT (F1: không móc vào accounts vì
   * IvssModule đã import AccountsModule ⇒ sẽ tạo vòng phụ thuộc; repo cấm forwardRef).
   *
   * Gate SCHEDULER_ENABLED && SCHEDULER_IVSS_PORTRAIT_ENABLED (default OFF).
   * ⚠ CHƯA BẬT PRODUCTION — chờ luồng check-in họp verify xong. KHÔNG ném ra cron (ARCH-02).
   */
  // [FIX 2026-08-11, Case 3] Rút ngắn 5 phút → 30 giây: reconcilePortraits() quét CÓ ĐIỀU
  // KIỆN (status='active'/deleted_at IS NULL, partial index ux_face_profiles_user_active),
  // tập dữ liệu "nóng" tỉ lệ theo headcount đang hoạt động, KHÔNG phình theo lịch sử — xác
  // nhận qua EXPLAIN thật trước khi đổi (không suy đoán). Mục đích: cùng cơ chế với
  // reconcilePortraits() (KHÔNG enroll tức thời lúc duyệt ảnh — xem admin-biometric-review
  // .service.ts, tránh vòng phụ thuộc AccountsModule↔IvssModule) nhưng rút ngắn độ trễ tối
  // đa từ 5 phút xuống 30 giây.
  @Cron('*/30 * * * * *', { name: 'ivss-portrait-reconcile' })
  async ivssPortraitReconcile(): Promise<void> {
    if (!this.schedulerEnabled || !this.ivssPortraitEnabled) return;

    try {
      const r = await this.ivssPortraitSyncService.reconcilePortraits();
      this.logger.log(
        `[Scheduler] ivss-portrait: scanned=${r.scanned} enrolled=${r.enrolled} removed=${r.removed} failed=${r.failed}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] ivss-portrait failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * ARZ-001 (UC-124) — đối chiếu `gate_access_logs`/`zone_presence_events` với rule
   * `intrusion` gắn zone cụ thể, phát hiện xâm nhập khu vực hạn chế.
   * Gate SCHEDULER_ENABLED && SCHEDULER_RESTRICTED_ZONE_ENABLED (default OFF). KHÔNG ném ra cron.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'restricted-zone-intrusion' })
  async evaluateRestrictedZoneIntrusions(): Promise<void> {
    if (!this.schedulerEnabled || !this.restrictedZoneEnabled) return;

    try {
      const r = await this.restrictedZoneIntrusionService.evaluateIntrusions();
      this.logger.log(
        `[Scheduler] restricted-zone-intrusion: zones=${r.zonesScanned} gateLogs=${r.gateLogsChecked} presenceEvents=${r.presenceEventsChecked} violations=${r.violationsFound}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] restricted-zone-intrusion failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * ACR-001 (UC-121) — đối chiếu `zone_presence_events` (`event_type='count'`) với rule
   * `crowd` gắn zone cụ thể, phát hiện tụ tập đông người.
   * Gate SCHEDULER_ENABLED && SCHEDULER_CROWD_ALERT_ENABLED (default OFF). KHÔNG ném ra cron.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'crowd-alert' })
  async evaluateCrowdAlerts(): Promise<void> {
    if (!this.schedulerEnabled || !this.crowdAlertEnabled) return;

    try {
      const r = await this.crowdAlertService.evaluateCrowdAlerts();
      this.logger.log(
        `[Scheduler] crowd-alert: zones=${r.zonesScanned} events=${r.eventsChecked} violations=${r.violationsFound}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] crowd-alert failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * ASC-001 — alert đang mở (status <> 'resolved') không tái phát mới
   * (COALESCE(last_seen_at, triggered_at)) quá N phút (cấu hình qua
   * SecurityAlertConfigService, mặc định 15 phút) → tự động resolved. Cron
   * dọn dẹp ĐỘC LẬP, KHÔNG đụng recordAlert()/dedupe.
   * Gate SCHEDULER_ENABLED && SCHEDULER_SECURITY_ALERT_AUTO_RESOLVE_ENABLED
   * (default OFF). KHÔNG ném ra cron.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'security-alert-auto-resolve' })
  async securityAlertAutoResolve(): Promise<void> {
    if (!this.schedulerEnabled || !this.securityAlertAutoResolveEnabled) return;

    try {
      const r = await this.securityAlertAutoResolveService.autoResolveExpired();
      this.logger.log(
        `[Scheduler] security-alert-auto-resolve: scanned=${r.scanned} resolved=${r.resolved}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] security-alert-auto-resolve failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * [FIX 2026-08-12, R9 — Lớp 2] Lưới an toàn cuối: session ghi hình chạy quá lâu (không ai
   * pause/stop, và Lớp 1 — auto-stop khi endMeeting() — không kích hoạt được, vd meeting
   * không bao giờ chuyển 'completed' vì lý do khác) sẽ tự động bị dừng. ĐỘC LẬP với Lớp 1 —
   * KHÔNG đụng gì tới executeEndMeetingInTransaction()/endMeeting()/stopAllActiveForMeeting().
   * Ngưỡng đọc qua RecordingSystemConfigService (mặc định 6 giờ, KHÔNG hardcode).
   * Gate SCHEDULER_ENABLED && SCHEDULER_RECORDING_MAX_DURATION_ENABLED (default OFF).
   * KHÔNG ném ra cron. metadata_json.auto_stop_reason='max_duration_exceeded' — tag RIÊNG,
   * KHÔNG lẫn với error_message='empty file'/'no video data received from camera' hiện có
   * (2 giá trị đó mô tả TRẠNG THÁI FILE lúc dừng; auto_stop_reason mô tả LÝ DO gọi dừng —
   * độc lập, có thể cùng xuất hiện, vd session tới hạn giờ NHƯNG camera cũng đang mất hình).
   */
  // CronExpression enum không có EVERY_15_MINUTES (chỉ 5/10/30) — dùng cron string tường
  // minh, mirror pattern ivssPortraitReconcile() ở trên.
  @Cron('0 */15 * * * *', {
    name: 'recording-max-duration-enforce',
  })
  async recordingMaxDurationEnforce(): Promise<void> {
    if (!this.schedulerEnabled || !this.recordingMaxDurationEnabled) return;

    try {
      const maxHours =
        await this.recordingSystemConfigService.getMaxDurationHours();
      const rows: Array<{ id: string; meeting_id: string }> =
        await this.dataSource.query(
          `SELECT id, meeting_id FROM recording_sessions
           WHERE status IN ('recording','paused')
             AND started_at < NOW() - ($1::int * INTERVAL '1 hour')`,
          [maxHours],
        );

      let stopped = 0;
      let failed = 0;
      for (const row of rows) {
        try {
          await this.recordingSessionService.stopVideo(
            row.meeting_id,
            row.id,
            null,
          );
          // Tag RIÊNG lý do dừng — merge (||) để KHÔNG đè metadata_json mà
          // stopVideo()/finalizeFileToStopped() vừa ghi (vd segments, orphan_stop).
          await this.dataSource.query(
            `UPDATE recording_sessions
             SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $1::jsonb
             WHERE id = $2`,
            [
              JSON.stringify({
                auto_stop_reason: 'max_duration_exceeded',
                max_duration_hours: maxHours,
              }),
              row.id,
            ],
          );
          stopped++;
        } catch (e) {
          failed++;
          this.logger.error(
            `[Scheduler] recording-max-duration-enforce: session ${row.id} (meeting ${row.meeting_id}) failed: ${
              e instanceof Error ? e.message : 'unknown'
            }`,
          );
        }
      }
      this.logger.log(
        `[Scheduler] recording-max-duration-enforce: maxHours=${maxHours} scanned=${rows.length} stopped=${stopped} failed=${failed}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] recording-max-duration-enforce failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * GAP-001 (UC-106) — ghép cặp enter/leave ở cổng, ghi paired_log_id + duration_seconds.
   * Gate SCHEDULER_ENABLED && SCHEDULER_GATE_PAIRING_ENABLED (default OFF). KHÔNG ném ra cron
   * (ARCH-02). Bảng gate_access_logs rỗng tới khi UC-105 (writer) hoạt động → scanned=0.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'gate-log-pairing' })
  async gateLogPairing(): Promise<void> {
    if (!this.schedulerEnabled || !this.gatePairingEnabled) return;

    try {
      const r = await this.gateLogPairingService.pairBatch();
      this.logger.log(
        `[Scheduler] gate-log-pairing: scanned=${r.scanned} paired=${r.paired} skipped=${r.skipped}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] gate-log-pairing failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * Meeting reminder notification job.
   * Cron: SCHEDULER_NOTIFICATION_REMINDER_CRON (default: every hour)
   *
   * TODO: Gọi NotificationsService.sendScheduledReminders() khi implement.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'notification-reminder' })
  sendReminders(): Promise<void> {
    // KHÔNG `async`: thân hàm chưa có await nào (stub, xem TODO dưới) — eslint
    // require-await. Vẫn trả Promise để chữ ký gọi được bằng `await` không đổi.
    if (!this.schedulerEnabled || !this.reminderEnabled)
      return Promise.resolve();

    this.logger.log(
      '[Scheduler] sendReminders() triggered — TODO: implement reminder notification logic.',
    );
    // TODO: inject NotificationsService và gọi sendScheduledReminders()
    return Promise.resolve();
  }

  /**
   * KPI-001 (task #10) — rollup bảng tổng hợp zone/xe theo giờ (phút 05 mỗi giờ).
   * Gate SCHEDULER_ENABLED && SCHEDULER_KPI_ROLLUP_ENABLED. Advisory lock trong job ⇒ nhiều
   * instance chỉ 1 bản chạy. KHÔNG ném ra cron (ARCH-02).
   */
  @Cron('0 5 * * * *', { name: 'kpi-rollup-hourly' })
  async kpiRollupHourly(): Promise<void> {
    if (!this.schedulerEnabled || !this.kpiRollupEnabled) return;
    try {
      const r = await this.kpiRollupJobService.runIncremental();
      this.logger.log(
        `[Scheduler] kpi-rollup-hourly: ${this.describeKpiRun(r)}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] kpi-rollup-hourly failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  /** KPI-001 — đối soát 72h gần nhất lúc 01:00 giờ VN (bắt event đến muộn). */
  @Cron('0 0 1 * * *', {
    name: 'kpi-rollup-reconcile',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async kpiRollupReconcile(): Promise<void> {
    if (!this.schedulerEnabled || !this.kpiRollupEnabled) return;
    try {
      const r = await this.kpiRollupJobService.runReconcile();
      this.logger.log(
        `[Scheduler] kpi-rollup-reconcile: ${this.describeKpiRun(r)}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] kpi-rollup-reconcile failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  private describeKpiRun(r: RollupRunResult): string {
    if (r.skipped) return 'skipped (đang chạy ở instance khác)';
    const parts = Object.entries(r.windows).map(
      ([name, w]) => `${name}=[${w.from.toISOString()}, ${w.to.toISOString()})`,
    );
    return parts.length ? parts.join(' ') : 'không có cửa sổ mới';
  }

  /**
   * Check-in alert job.
   * Cron: every 1 minute (scan_interval_seconds default=60)
   * Business logic checks config attendance.checkin_alert.enabled internally.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'checkin-alert' })
  async checkCheckinAlerts(): Promise<void> {
    if (!this.schedulerEnabled) return;

    this.logger.debug('[Scheduler] checkCheckinAlerts() triggered');
    try {
      await this.checkInAlertService.processMeetings();
    } catch (error) {
      this.logger.error(
        `[Scheduler] checkCheckinAlerts() failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * VIS-BE-001: hết hạn / quá giờ / chưa ghi giờ ra của khách. Gate SCHEDULER_ENABLED && SCHEDULER_VISITOR_ENABLED
   * (default OFF). Khóa Redis nằm trong service; KHÔNG ném ra cron.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'visitor-sweep' })
  async visitorSweep(): Promise<void> {
    if (!this.schedulerEnabled || !this.visitorEnabled) return;
    try {
      const r = await this.visitorSweepService.runSweep(new Date());
      if (!r.skipped) {
        this.logger.log(
          `[Scheduler] visitor-sweep: expired=${r.expired} overstay-notified=${r.overstayNotified} overstay-escalated=${r.overstayEscalated} exit-unrecorded=${r.exitUnrecorded}`,
        );
      }
    } catch (e) {
      this.logger.error(`[Scheduler] visitor-sweep failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  /** VIS-BE-001: đối soát khuôn mặt khách trên thiết bị (IVSS/FaceGate). Cùng cờ SCHEDULER_VISITOR_ENABLED. */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'visitor-face-reconcile' })
  async visitorFaceReconcile(): Promise<void> {
    if (!this.schedulerEnabled || !this.visitorEnabled) return;
    try {
      const r = await this.visitorSweepService.runFaceReconcile();
      if (!r.skipped) this.logger.log(`[Scheduler] visitor-face-reconcile: synced=${r.synced}`);
    } catch (e) {
      this.logger.error(`[Scheduler] visitor-face-reconcile failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  /** VIS-BE-001 (BR-V19): dọn ảnh khách quá hạn lưu giữ, 02:30 hằng ngày. Cùng cờ SCHEDULER_VISITOR_ENABLED. */
  @Cron('0 30 2 * * *', { name: 'visitor-photo-retention' })
  async visitorPhotoRetention(): Promise<void> {
    if (!this.schedulerEnabled || !this.visitorEnabled) return;
    try {
      const r = await this.visitorSweepService.runPhotoRetention(new Date());
      if (!r.skipped) this.logger.log(`[Scheduler] visitor-photo-retention: purged=${r.purged}`);
    } catch (e) {
      this.logger.error(`[Scheduler] visitor-photo-retention failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  /**
   * RPT-CENTER-BE-001: sinh lần chạy cho các lịch gửi báo cáo đến hạn. Gate SCHEDULER_ENABLED && SCHEDULER_REPORT_SCHEDULE_ENABLED
   * (default OFF). An toàn khi nhiều instance cùng chạy (FOR UPDATE SKIP LOCKED). KHÔNG ném ra cron.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'report-schedule-dispatch' })
  async reportScheduleDispatch(): Promise<void> {
    if (!this.schedulerEnabled || !this.reportScheduleEnabled) return;
    try {
      const r = await this.reportScheduleDispatchService.dispatchDue(new Date());
      if (r.dispatched > 0) this.logger.log(`[Scheduler] report-schedule-dispatch: dispatched=${r.dispatched}`);
    } catch (e) {
      this.logger.error(`[Scheduler] report-schedule-dispatch failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }
}
