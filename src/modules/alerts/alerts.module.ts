import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdministrationModule } from '../administration/administration.module.js';
import { AlertRuleEntity } from './entities/alert-rule.entity.js';
import { SecurityAlertEntity } from './entities/security-alert.entity.js';
import { PersonControlListEntity } from './entities/person-control-list.entity.js';
import { ZoneEntity } from '../zones/entities/zone.entity.js';
import { AlertRulesService } from './services/alert-rules.service.js';
import { AlertRulesController } from './controllers/alert-rules.controller.js';
import { AlertsService } from './services/alerts.service.js';
import { AlertsController } from './controllers/alerts.controller.js';
import { PersonControlListService } from './services/person-control-list.service.js';
import { PersonControlListController } from './controllers/person-control-list.controller.js';
import { PersonWatchlistCheckService } from './services/person-watchlist-check.service.js';
import { SecurityAlertConfigService } from './services/security-alert-config.service.js';
import { SecurityAlertConfigController } from './controllers/security-alert-config.controller.js';
import { SecurityAlertAutoResolveService } from './services/security-alert-auto-resolve.service.js';
import { SecurityAlertNotifierService } from './services/security-alert-notifier.service.js';
import { WebsocketModule } from '../websocket/websocket.module.js';

/**
 * AlertsModule (SAVP Security Alert Center scope — SRS UC-121→125, UC-129).
 *
 * UC-122 (ARL-001): `AlertRulesService`/`AlertRulesController` — CRUD `alert_rules` +
 * `findActiveRule`/`findEffectiveRule` (dùng bởi UC-123/124/125/3d).
 * UC-123 (ASC-001): `AlertsService`/`AlertsController` — `recordAlert()` (điểm ghi DUY
 * NHẤT vào `security_alerts`, dùng chung cho 3d/124/125/UC-121 sau) + Trung tâm cảnh
 * báo (list/detail/acknowledge/resolve/bulk).
 * UC-125 (PWL-001): `PersonControlListService`/`PersonControlListController` — CRUD
 * `person_control_list` (watchlist người) + `PersonWatchlistCheckService.checkPersonWatchlist
 * (userId)` — điểm vào DUY NHẤT cho `face-access` gọi khi có event nhận diện. Import
 * `NotificationsModule` để lấy `NotificationsService` (mirror `AnprModule`).
 * Mirror `ZonesModule` lúc mới tạo (commit 11f3a60).
 *
 * Đã qua review Hải (BAO_CAO_DE_XUAT_3_BANG_ALERT_CENTER.md +
 * PHAN_HOI_DUYET_3_BANG_ALERT_CENTER.md, 2026-07-22):
 * - 3 bảng migration 20260722000006→000008 (SAU 20260722000005 của Hải).
 * - `alert_rules`: phương án A (bảng riêng), 2 partial unique vì zone_id NULL.
 * - `security_alerts`: KHÔNG soft-delete (audit trail); dedup "đang tiếp diễn" là
 *   UNIQUE partial (không phải index tra cứu) để chặn race — tầng service (UC-123)
 *   phải bắt lỗi 23505 và chuyển nhánh update `last_seen_at`/`occurrence_count`.
 * - `person_control_list`: mirror `vehicle_control_list`, thêm `list_type`.
 *
 * ⚠ RÀNG BUỘC KIẾN TRÚC — phụ thuộc `face-access/anpr → alerts` là MỘT CHIỀU,
 * VĨNH VIỄN: `AlertsModule` TUYỆT ĐỐI KHÔNG import ngược `FaceAccessModule`/
 * `AnprModule`, cấm `forwardRef` để lách. Khi module gọi (face-access, anpr) cần đối
 * chiếu watchlist/ghi alert, chúng import `AlertsModule`/`AlertsService` (thêm ở UC sau)
 * và truyền dữ liệu (plate, userId, zoneId, payload...) qua THAM SỐ hàm — `AlertsModule`
 * KHÔNG tự đi query module khác. Mirror pattern `zones → iot` (route cross-cutting đặt
 * ở phía "chủ động").
 *
 * CLI DataSource (`src/database/data-source.ts`) đã glob `modules/**\/*.entity.{ts,js}`
 * nên KHÔNG cần khai thêm ở đó.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AlertRuleEntity,
      SecurityAlertEntity,
      PersonControlListEntity,
      // [FIX 2026-08-11] ZoneEntity re-declare RIÊNG cho AlertRulesService.assertValidIntrusionZone()
      // (validate zone_type khi tạo/sửa rule intrusion) — mirror pattern campus-dashboard/
      // restricted-zone/crowd-alert: KHÔNG import ZonesModule (tránh kéo theo provider/controller
      // không cần, tránh vòng phụ thuộc).
      ZoneEntity,
    ]),
    AuthModule,
    NotificationsModule,
    AdministrationModule,
    // SecurityAlertNotifierService phát WS `security.alert.new` (NotificationsModule đã
    // import WebsocketModule sẵn — không tạo vòng mới).
    WebsocketModule,
  ],
  controllers: [
    AlertRulesController,
    AlertsController,
    PersonControlListController,
    SecurityAlertConfigController,
  ],
  providers: [
    AlertRulesService,
    AlertsService,
    PersonControlListService,
    PersonWatchlistCheckService,
    SecurityAlertConfigService,
    SecurityAlertAutoResolveService,
    SecurityAlertNotifierService,
  ],
  exports: [
    TypeOrmModule,
    AlertRulesService,
    AlertsService,
    PersonWatchlistCheckService,
    SecurityAlertAutoResolveService,
    SecurityAlertNotifierService,
  ],
})
export class AlertsModule {}
