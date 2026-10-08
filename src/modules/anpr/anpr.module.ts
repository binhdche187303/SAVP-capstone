import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AlertsModule } from '../alerts/alerts.module.js';
import { ZonesModule } from '../zones/zones.module.js';
import { VEHICLE_EVENT_HANDLER } from '../../common/ports/vehicle-event-hook.js';
import { VehicleRegistrationEntity } from './entities/vehicle-registration.entity.js';
import { VehicleControlListEntity } from './entities/vehicle-control-list.entity.js';
import { VehicleRegistrationController } from './controllers/vehicle-registration.controller.js';
import { VehicleWebhookController } from './controllers/vehicle-webhook.controller.js';
import { VehicleControlListController } from './controllers/vehicle-control-list.controller.js';
import { VehicleRegistrationService } from './services/vehicle-registration.service.js';
import { VehicleResolveService } from './services/vehicle-resolve.service.js';
import { VehicleUnknownService } from './services/vehicle-unknown.service.js';
import { VehicleHistoryService } from './services/vehicle-history.service.js';
import { VehicleControlListService } from './services/vehicle-control-list.service.js';
import { VehicleControlAlertService } from './services/vehicle-control-alert.service.js';
import { AnprInternalTokenGuard } from './guards/anpr-internal-token.guard.js';
import { DefaultVehicleEventHandler } from './handlers/default-vehicle-event.handler.js';
import { BullModule } from '@nestjs/bullmq';
import {
  VehicleEventProcessor,
  VEHICLE_EVENTS_QUEUE_NAME,
} from './processors/vehicle-event.processor.js';

/**
 * AnprModule (ANPR mini-epic) — biển số xe.
 *
 * VRS-001 (Setup-0): entity `VehicleRegistrationEntity` (forFeature) + export TypeOrmModule.
 * VPR-001 (UC1) + VPM-001 (UC2) + VPL-001 (UC3): đăng ký/sửa/xóa/xem biển — controller + service.
 * VWH-001 (UC4): webhook nhận vehicle event (internal token) + normalize → handoff qua
 *   VEHICLE_EVENT_HANDLER. UC4 bind default log-only.
 * VRE-001 (UC5): override VEHICLE_EVENT_HANDLER sang VehicleResolveService (resolve biển→user
 *   + persist iot_device_events, event_type='ivss_vehicle_event'). DefaultVehicleEventHandler giữ
 *   registered (fallback, mirror face giữ DefaultIvssEventHandler).
 * Import AuthModule để dùng PermissionsGuard thật (gate route admin) — AuthModule export sẵn.
 * VCL-001 (UC8): CRUD `vehicle_control_list` (blocklist/watchlist) — `VehicleControlListService`
 *   + `VehicleControlListController` (admin-gated, KHÔNG ownership). Entity đã `forFeature` sẵn
 *   từ trước (schema-only), UC8 chỉ thêm provider/controller, KHÔNG đổi `imports`.
 * VCC-001 (UC9): đối chiếu control-list khi xe qua cổng — `checkControlList` (pure lookup,
 *   thêm vào `VehicleControlListService`) + `VehicleControlAlertService` (đích cảnh báo).
 *   `VehicleResolveService.onVehicleEvent` gọi `VehicleControlAlertService.evaluate()`.
 *   Import `NotificationsModule` để lấy `NotificationsService` — KHÔNG import ngược
 *   `AnprModule` nên không circular.
 * ASM-001 (Bước 3 / 3d): import `AlertsModule` để `VehicleControlAlertService` inject
 *   `AlertRulesService`/`AlertsService` (ghi `security_alerts` song song notification cũ) —
 *   chiều `anpr → alerts` một chiều đã chốt, `AlertsModule` KHÔNG import ngược.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      VehicleRegistrationEntity,
      VehicleControlListEntity,
    ]),
    AuthModule,
    NotificationsModule,
    AlertsModule,
    // GAW-001 (UC-105): lấy GateAccessLogService (writer gate_access_logs) từ zones.
    // Cạnh anpr → zones một chiều (zones import Auth+Iot, KHÔNG import anpr) ⇒ không circular.
    ZonesModule,
    // STT 7: hàng đợi sự kiện xe (connection/defaultJobOptions từ BullModule.forRootAsync).
    BullModule.registerQueue({ name: VEHICLE_EVENTS_QUEUE_NAME }),
  ],
  controllers: [
    VehicleRegistrationController,
    VehicleWebhookController,
    VehicleControlListController,
  ],
  providers: [
    VehicleRegistrationService,
    VehicleUnknownService,
    VehicleHistoryService,
    AnprInternalTokenGuard,
    DefaultVehicleEventHandler,
    VehicleResolveService,
    VehicleControlListService,
    VehicleControlAlertService,
    // VRE-001 (UC5): handler thật thay default log-only (UC4).
    { provide: VEHICLE_EVENT_HANDLER, useExisting: VehicleResolveService },
    VehicleEventProcessor,
  ],
  // VPT-IMPORT-001: export VehicleRegistrationService để AccountsModule tái dùng
  // register() cho cột license_plate (tùy chọn) trong import Excel nhân viên —
  // KHÔNG trùng lặp logic normalize/validate/conflict biển số.
  exports: [
    TypeOrmModule,
    VehicleRegistrationService,
    VehicleControlAlertService,
  ],
})
export class AnprModule {}
