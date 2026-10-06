import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { ZoneEntity } from '../zones/entities/zone.entity.js';
import { ZonePresenceEventEntity } from '../zones/entities/zone-presence-event.entity.js';
import { GateAccessLogEntity } from '../zones/entities/gate-access-log.entity.js';
import { IoTDeviceEntity } from '../iot/entities/iot-device.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import { VehicleRegistrationEntity } from '../anpr/entities/vehicle-registration.entity.js';
import { SecurityAlertEntity } from '../alerts/entities/security-alert.entity.js';
import { CampusDashboardRepository } from './repositories/campus-dashboard.repository.js';
import { DashboardOverviewService } from './services/dashboard-overview.service.js';
import { DashboardOverviewController } from './controllers/dashboard-overview.controller.js';
import { ZonePresenceTimelineService } from './services/zone-presence-timeline.service.js';
import { ZonePresenceTimelineController } from './controllers/zone-presence-timeline.controller.js';
import { ZoneTrafficHeatmapService } from './services/zone-traffic-heatmap.service.js';
import { ZoneTrafficHeatmapController } from './controllers/zone-traffic-heatmap.controller.js';
import { ManagerSummaryService } from './services/manager-summary.service.js';
import { ManagerSummaryController } from './controllers/manager-summary.controller.js';
import { EmployeeSummaryService } from './services/employee-summary.service.js';
import { EmployeeSummaryController } from './controllers/employee-summary.controller.js';
import { BusinessAdminSummaryService } from './services/business-admin-summary.service.js';
import { BusinessAdminSummaryController } from './controllers/business-admin-summary.controller.js';
import { PresenceByDepartmentService } from './services/presence-by-department.service.js';
import { PresenceByDepartmentController } from './controllers/presence-by-department.controller.js';
import { CampusMapService } from './services/campus-map.service.js';
import { CampusMapController } from './controllers/campus-map.controller.js';

/**
 * CampusDashboardModule (CDB-001 / UC-126, dùng chung cho UC-119/UC-120/CDB-RS-001 — Bước 4 SAVP).
 *
 * 100% READ-ONLY — không entity riêng, tự `forFeature` lại entity của `zones`/`iot`/`accounts`/
 * `anpr`/`alerts` (KHÔNG import `ZonesModule`/`IotModule`/`AccountsModule`/`AnprModule`/
 * `AlertsModule` — mirror lý do `restricted-zone`/`crowd-alert`: tránh kéo theo provider/
 * controller không cần, tránh rủi ro vòng phụ thuộc).
 *
 * UC-119 (`ZonePresenceTimelineController`), UC-120 (`ZoneTrafficHeatmapController`) và
 * CDB-RS-001 (`ManagerSummaryController`/`EmployeeSummaryController`/
 * `BusinessAdminSummaryController`) THÊM vào mảng `controllers`/`providers` của module NÀY khi
 * code — KHÔNG tạo module riêng.
 */
@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      ZoneEntity,
      ZonePresenceEventEntity,
      GateAccessLogEntity,
      IoTDeviceEntity,
      UserEntity,
      VehicleRegistrationEntity,
      SecurityAlertEntity,
    ]),
  ],
  controllers: [
    DashboardOverviewController,
    ZonePresenceTimelineController,
    ZoneTrafficHeatmapController,
    ManagerSummaryController,
    EmployeeSummaryController,
    BusinessAdminSummaryController,
    PresenceByDepartmentController,
    CampusMapController,
  ],
  providers: [
    CampusDashboardRepository,
    DashboardOverviewService,
    ZonePresenceTimelineService,
    ZoneTrafficHeatmapService,
    ManagerSummaryService,
    EmployeeSummaryService,
    BusinessAdminSummaryService,
    PresenceByDepartmentService,
    CampusMapService,
  ],
  exports: [],
})
export class CampusDashboardModule {}
