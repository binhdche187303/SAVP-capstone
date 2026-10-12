import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { ZonesModule } from '../zones/zones.module.js';
import { RestrictedZoneModule } from '../restricted-zone/restricted-zone.module.js';
import { CrowdAlertModule } from '../crowd-alert/crowd-alert.module.js';
import { IVSS_EVENT_HANDLER } from '../../common/ports/ivss-event-hook.js';
import { IVSS_BRIDGE } from './ports/ivss-bridge.port.js';
import { ivssBridgeProvider } from './ivss-bridge.factory.js';
import { IvssInternalTokenGuard } from './guards/ivss-internal-token.guard.js';
import { DefaultIvssEventHandler } from './handlers/default-ivss-event.handler.js';
import { IvssPresenceIngestionService } from './services/ivss-presence-ingestion.service.js';
import { IvssPresenceQueryService } from './services/ivss-presence-query.service.js';
import { IvssPresenceReportService } from './services/ivss-presence-report.service.js';
import { IvssPersonSyncService } from './services/ivss-person-sync.service.js';
import { IvssPortraitSyncService } from './services/ivss-portrait-sync.service.js';
import { IvssWebhookController } from './controllers/ivss-webhook.controller.js';
import { IvssHealthController } from './controllers/ivss-health.controller.js';
import { IvssPresenceController } from './controllers/ivss-presence.controller.js';
import { IvssOccupancyController } from './controllers/ivss-occupancy.controller.js';
import { IvssRoomAccessController } from './controllers/ivss-room-access.controller.js';
import { IvssZoneAccessController } from './controllers/ivss-zone-access.controller.js';
import { IvssDeviceEventSnapshotController } from './controllers/ivss-device-event-snapshot.controller.js';
import { IvssPortraitAdminController } from './controllers/ivss-portrait-admin.controller.js';
import { IvssRoomAccessLogService } from './services/ivss-room-access-log.service.js';
import { IvssZoneAccessLogService } from './services/ivss-zone-access-log.service.js';
import { DeviceEventSnapshotService } from './services/device-event-snapshot.service.js';
import { JwtQueryOrHeaderAuthGuard } from '../auth/guards/jwt-query-or-header-auth.guard.js';
import { IvssOccupancyIngestService } from './services/ivss-occupancy-ingest.service.js';
import { IvssPresenceConfigService } from './services/ivss-presence-config.service.js';

/**
 * IvssModule (IVS-001 #36) — lớp tích hợp IVSS bridge: client (outbound) + webhook (inbound)
 * + health + config. KHÔNG nghiệp vụ (enroll #37; map presence #38–40).
 *
 * ConfigModule global → ConfigService inject sẵn. AuthModule cho JwtAuthGuard (health).
 * IVSS_EVENT_HANDLER bind DefaultIvssEventHandler (log-only); #38–40 override.
 */
@Module({
  imports: [
    AuthModule,
    AccountsModule,
    WebsocketModule,
    PresenceModule,
    // ZPW-001 (UC-109): lấy ZonePresenceWriterService (writer zone_presence_events) từ zones.
    // Cạnh ivss → zones một chiều (zones import Auth+Iot, KHÔNG import ivss) ⇒ không circular.
    ZonesModule,
    // Đường đánh giá intrusion TỨC THỜI (bên cạnh cron evaluateIntrusions() —
    // KHÔNG thay thế): lấy RestrictedZoneIntrusionService.evaluateZoneEventNow().
    // Cạnh ivss → restricted-zone một chiều (restricted-zone chỉ import
    // alerts, KHÔNG import ivss/zones module) ⇒ không circular.
    RestrictedZoneModule,
    // Đường đánh giá crowd TỨC THỜI (bên cạnh cron evaluateCrowdAlerts() — KHÔNG
    // thay thế): lấy CrowdAlertService.evaluateZoneCountNow(). Cạnh ivss →
    // crowd-alert một chiều (crowd-alert chỉ import alerts) ⇒ không circular.
    CrowdAlertModule,
  ],
  controllers: [
    IvssWebhookController,
    IvssHealthController,
    IvssPresenceController,
    IvssOccupancyController,
    // RAL-001 (Màn 2): nhật ký ra/vào theo phòng — prefix `ivss/rooms`, tách hẳn Màn 1.
    IvssRoomAccessController,
    // Zone Access Log (đường B, FIX 2026-08-11): nhật ký ra/vào theo zone khu vực —
    // prefix `ivss/zones`, mirror IvssRoomAccessController, đọc iot_device_events.zone_id.
    IvssZoneAccessController,
    // F-F fix: TÁCH RIÊNG khỏi IvssRoomAccessController — route ảnh snapshot cần
    // JwtQueryOrHeaderAuthGuard (fallback ?token=), 2 route access-log KHÔNG đụng.
    IvssDeviceEventSnapshotController,
    // Phương án c, phần 2: force re-sync mapping portrait theo yêu cầu admin.
    IvssPortraitAdminController,
  ],
  providers: [
    ivssBridgeProvider,
    IvssInternalTokenGuard,
    // F-F fix: guard riêng cho route snapshot (<img src> không gắn được header).
    JwtQueryOrHeaderAuthGuard,
    // DefaultIvssEventHandler giữ registered (fallback/log), KHÔNG bind token.
    DefaultIvssEventHandler,
    IvssPresenceIngestionService,
    // IPI-001 (#38+#39): handler thật thay log-only.
    { provide: IVSS_EVENT_HANDLER, useExisting: IvssPresenceIngestionService },
    IvssPersonSyncService,
    // PORTRAIT-001 (UC-109+110): kho mặt THƯỜNG TRỰC, group riêng IVSS_PORTRAIT_GROUP,
    // bridge device row riêng — song song, không đụng luồng check-in họp.
    IvssPortraitSyncService,
    IvssPresenceQueryService,
    IvssPresenceReportService,
    IvssRoomAccessLogService,
    // Zone Access Log (đường B, FIX 2026-08-11).
    IvssZoneAccessLogService,
    // F-F: đọc ảnh snapshot của iot_device_events (F-B/F-C/F-D ghi).
    DeviceEventSnapshotService,
    // IVSS-OCC-001 (A-OCC): occupancy ingest (dùng OccupancyPersistenceService từ PresenceModule).
    IvssOccupancyIngestService,
    // [FIX 2026-08-11, Phần B] ngưỡng similarity tối thiểu cho nhận diện khuôn mặt
    // — AuditLogsService inject trực tiếp (AdministrationModule @Global(), không cần import).
    IvssPresenceConfigService,
  ],
  // IVSS_EVENT_HANDLER export cho HgvisionModule (nguồn camera HGVision dùng chung pipeline).
  exports: [
    IVSS_BRIDGE,
    IVSS_EVENT_HANDLER,
    IvssPersonSyncService,
    IvssPortraitSyncService,
  ],
})
export class IvssModule {}
