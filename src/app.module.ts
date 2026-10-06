import { APP_GUARD } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
// Infrastructure
import { envValidationSchema } from './config/env.validation.js';
import { RedisModule } from './modules/redis/redis.module.js';
import { MailModule } from './modules/mail/mail.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { QueueModule } from './modules/queue/queue.module.js';
import { SchedulerModule } from './modules/scheduler/scheduler.module.js';
import { WebsocketModule } from './modules/websocket/websocket.module.js';
// Business modules
import { AccountsModule } from './modules/accounts/accounts.module';
import { AdministrationModule } from './modules/administration/administration.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuthModule } from './modules/auth/auth.module';
import { MustChangePasswordGuard } from './modules/auth/guards/must-change-password.guard';
import { BiometricEnforcementGuard } from './modules/auth/guards/biometric-enforcement.guard';
import { PartnerAccountRestrictionGuard } from './modules/auth/guards/partner-account-restriction.guard';
import { DocumentsModule } from './modules/documents/documents.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { IotModule } from './modules/iot/iot.module';
import { LiveMeetingModule } from './modules/live-meeting/live-meeting.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { MinutesModule } from './modules/minutes/minutes.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PresenceModule } from './modules/presence/presence.module';
import { RecordingModule } from './modules/recording/recording.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { TranscriptionModule } from './modules/transcription/transcription.module';
import { UtilizationModule } from './modules/utilization/utilization.module';
import { IvssModule } from './modules/ivss/ivss.module';
import { AnprModule } from './modules/anpr/anpr.module';
import { ZonesModule } from './modules/zones/zones.module';
import { KpiRollupModule } from './modules/kpi-rollup/kpi-rollup.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { GateAccessModule } from './modules/gate-access/gate-access.module';
import { RestrictedZoneModule } from './modules/restricted-zone/restricted-zone.module';
import { CampusDashboardModule } from './modules/campus-dashboard/campus-dashboard.module';
import { CrowdAlertModule } from './modules/crowd-alert/crowd-alert.module';
import { SearchModule } from './modules/search/search.module';
import { GuestAccessModule } from './modules/guest-access/guest-access.module';

/**
 * Dev-only module — chỉ load khi NODE_ENV=development.
 * Tránh import static để không bị tree-shake sai hoặc load ở production.
 */
async function loadDevModule(): Promise<(new () => unknown)[]> {
  if (process.env['NODE_ENV'] === 'development') {
    const { DevModule } = await import('./modules/dev/dev.module.js');
    return [DevModule];
  }
  return [];
}

// Resolve dev modules synchronously at module definition time
const devModules =
  process.env['NODE_ENV'] === 'development'
    ? (() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DevModule } = require('./modules/dev/dev.module');
        return [DevModule];
      })()
    : [];

void loadDevModule; // suppress unused warning

@Module({
  imports: [
    // ─── Config với Joi validation ──────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false, // hiện tất cả lỗi validation cùng lúc
        allowUnknown: true, // cho phép env chưa khai báo
      },
    }),
    // ─── Core infrastructure (global modules) ──────────────────────────────────
    CommonModule,
    DatabaseModule,
    RedisModule,
    MailModule,
    StorageModule,
    AdministrationModule, // @Global — exports BackgroundJobsService, AuditLogsService
    QueueModule, // @Global — exports QueueService
    HealthModule,
    SchedulerModule,
    WebsocketModule,
    // ─── Business modules ──────────────────────────────────────────────────────
    AuthModule,
    AccountsModule,
    MeetingsModule,
    ApprovalsModule,
    SchedulingModule,
    RoomsModule,
    EquipmentModule,
    IotModule,
    AttendanceModule, // GET meetings/:meetingId/attendance (UC-APM-02)
    PresenceModule,
    UtilizationModule,
    // [P1 BE-05, 2026-07-27] LiveMeetingModule dùng path riêng
    // `live-meetings/:meetingId/attendance` (UC-IMM-08) — thứ tự import so với
    // AttendanceModule KHÔNG còn quyết định route nào thắng (2 path khác nhau).
    LiveMeetingModule,
    RecordingModule,
    TranscriptionModule,
    MinutesModule,
    DocumentsModule,
    NotificationsModule,
    ReportsModule,
    AnalyticsModule,
    IvssModule,
    AnprModule,
    ZonesModule, // schema-only: đăng ký entity scope Zone (SAVP)
    KpiRollupModule, // KPI-001 (#10): bảng tổng hợp theo giờ + cron rollup + đọc lai
    AlertsModule, // schema-only: đăng ký entity Security Alert Center (SAVP)
    GateAccessModule, // Bước 2 SAVP: ghép cặp + tra cứu + thống kê gate access (GAP-001/GAH-001/VTS-001)
    RestrictedZoneModule, // Bước 3 SAVP (ARZ-001/UC-124): cron xâm nhập khu vực hạn chế
    CampusDashboardModule, // Bước 4 SAVP (CDB-001/UC-126, ZPT-001/UC-119, ZTH-001/UC-120): dashboard + timeline + heatmap khu vực
    CrowdAlertModule, // Bước 4 SAVP (ACR-001/UC-121): cron cảnh báo tụ tập đông người
    SearchModule, // SRCH-01: tìm kiếm tổng hợp đa nguồn (zone/device/vehicle/user/meeting)
    GuestAccessModule, // GLA-001: khách ngoài công ty truy cập live-meeting qua magic link + OTP
    // ─── Dev-only (conditionally loaded) ───────────────────────────────────────
    ...devModules,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    /**
     * Global guard order matters: NestJS applies APP_GUARD in the order they are listed.
     * MustChangePasswordGuard runs AFTER JwtAuthGuard (which is applied per-endpoint via
     * @UseGuards(JwtAuthGuard)) so request.user will already be populated when
     * MustChangePasswordGuard.canActivate() is invoked.
     *
     * Routes in ALLOWED_ROUTE_PREFIXES (/auth/me, /auth/change-password, /auth/logout)
     * are whitelisted and bypass the must_change_password check.
     */
    {
      provide: APP_GUARD,
      useClass: MustChangePasswordGuard,
    },
    /**
     * [2026-08-09] Docs/Nam_Sent/be-biometric-enforcement.md §2 — server-side enforcement
     * cho luồng bắt buộc nộp sinh trắc học. Trước đây enforcement chỉ ở FE (bypass được
     * qua Postman/DevTools). Đăng ký SAU MustChangePasswordGuard nên request.user cũng đã
     * được populate. Routes whitelist (/me/biometric-status, /me/biometric-submission,
     * /auth/refresh, /auth/logout, /auth/me) và role exempt (BUSINESS_ADMIN, SYSTEM_ADMIN)
     * xem trong biometric-enforcement.guard.ts.
     */
    {
      provide: APP_GUARD,
      useClass: BiometricEnforcementGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PartnerAccountRestrictionGuard,
    },
  ],
})
export class AppModule {}
