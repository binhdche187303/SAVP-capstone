import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { SchedulerService } from './scheduler.service.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { IotModule } from '../iot/iot.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { FaceAccessModule } from '../face-access/face-access.module.js';
import { IvssModule } from '../ivss/ivss.module.js';
import { RestrictedZoneModule } from '../restricted-zone/restricted-zone.module.js';
import { CrowdAlertModule } from '../crowd-alert/crowd-alert.module.js';
import { AlertsModule } from '../alerts/alerts.module.js';
import { ZonesModule } from '../zones/zones.module.js';
import { LiveMeetingModule } from '../live-meeting/live-meeting.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RecordingModule } from '../recording/recording.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { KpiRollupModule } from '../kpi-rollup/kpi-rollup.module.js';

/**
 * SchedulerModule — Skeleton cho các cron job.
 *
 * Hiện tại chỉ tạo skeleton, chưa implement business logic.
 * Các job (no-show check, auto-release, reminder) bị disabled theo env mặc định.
 *
 * SCHEDULER_NO_SHOW_CHECK_ENABLED=false (mặc định)
 * SCHEDULER_AUTO_RELEASE_ENABLED=false (mặc định)
 * SCHEDULER_NOTIFICATION_REMINDER_ENABLED=false (mặc định)
 *
 * TODO: Implement business logic khi có yêu cầu cụ thể.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    AttendanceModule,
    IotModule,
    RoomsModule,
    FaceAccessModule,
    IvssModule,
    RestrictedZoneModule,
    CrowdAlertModule,
    // ASC-001: cron security-alert-auto-resolve inject SecurityAlertAutoResolveService
    // (alerts export). CrowdAlertModule đã import AlertsModule sẵn ⇒ không circular mới.
    AlertsModule,
    // GAP-001 (UC-106): cron gate-log-pairing inject GateLogPairingService (zones export).
    // Cạnh scheduler → zones MỘT CHIỀU (zones KHÔNG import scheduler) ⇒ không circular.
    ZonesModule,
    // recon B1: cron auto-complete inject LiveMeetingService (endMeeting() reuse).
    // Cạnh scheduler → live-meeting MỘT CHIỀU (live-meeting chỉ import
    // AuthModule + WebsocketModule) ⇒ không circular.
    LiveMeetingModule,
    // F-R4b: cron meeting-request-expire inject MeetingRequestReviewService.
    // Cạnh scheduler → meetings MỘT CHIỀU (meetings không import scheduler,
    // RoomsModule đã import MeetingsModule sẵn nên đây không phải circular mới).
    MeetingsModule,
    // R9 Lớp 2: cron recording-max-duration-enforce inject RecordingSessionService
    // (stopVideo) + RecordingSystemConfigService (ngưỡng giờ). Cạnh scheduler → recording
    // MỘT CHIỀU (recording không import scheduler) ⇒ không circular.
    RecordingModule,
    // [FIX 2026-08-13, R12] cron no-show-check gọi thêm OccupancyPersistenceService
    // .reconcilePendingConfirmations() TRƯỚC detect() — xác nhận có mặt theo đồng hồ thực,
    // không chờ event mới. Cạnh scheduler → presence MỘT CHIỀU (presence không import
    // scheduler) ⇒ không circular.
    PresenceModule,
    // KPI-001: cron kpi-rollup inject KpiRollupJobService. Cạnh scheduler → kpi-rollup MỘT
    // CHIỀU (kpi-rollup không import module nghiệp vụ nào) ⇒ không circular.
    KpiRollupModule,
  ],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
