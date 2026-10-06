import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { KpiRollupModule } from '../kpi-rollup/kpi-rollup.module.js';
import { GateAccessLogEntity } from '../zones/entities/gate-access-log.entity.js';
import { GateAccessHistoryService } from './services/gate-access-history.service.js';
import { VehicleTrafficStatsService } from './services/vehicle-traffic-stats.service.js';
import { GateAccessHistoryController } from './controllers/gate-access-history.controller.js';
import { VehicleTrafficStatsController } from './controllers/vehicle-traffic-stats.controller.js';
import { UserJourneyController } from './controllers/user-journey.controller.js';
import { UserJourneyService } from './services/user-journey.service.js';

/**
 * GateAccessModule (Bước 2 SAVP: GAP-001/UC-116 + GAH-001/UC-117 + VTS-001/UC-114) — logic
 * đọc + ghép cặp `gate_access_logs`, tra cứu lịch sử, thống kê lưu lượng phương tiện.
 *
 * Tách khỏi module `zones` theo đúng roadmap (`zones` chỉ schema-only cho phần Zone).
 * `GateAccessLogEntity` được khai/đăng ký ở `zones/entities` (Hải) — module này CHỈ import
 * class entity để `TypeOrmModule.forFeature`, KHÔNG khai lại entity.
 *
 * `AuthModule` cần cho `JwtAuthGuard`/`PermissionsGuard` (GAH-001/VTS-001 — GAP-001 tự nó
 * không có route HTTP nên không cần, nhưng module dùng chung nên import 1 lần).
 *
 * `VehicleTrafficStatsService` (VTS-001) đọc raw SQL bảng `iot_device_events` (module `iot`)
 * qua `DataSource` — KHÔNG `forFeature` entity đó (mirror tiền lệ `VehicleHistoryService`,
 * chấp nhận cross-module raw-SQL read qua `DataSource`).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([GateAccessLogEntity]),
    AuthModule,
    KpiRollupModule,
  ],
  controllers: [
    GateAccessHistoryController,
    VehicleTrafficStatsController,
    // UJN-001: hành trình khuôn viên 1 người (prefix `campus`, ghép 3 nguồn).
    UserJourneyController,
  ],
  providers: [
    GateAccessHistoryService,
    VehicleTrafficStatsService,
    UserJourneyService,
  ],
  // VehicleTrafficStatsService exported cho VehicleReportDataService (UC-128,
  // Bước 5 SAVP) gọi getStats() qua DI — KHÔNG fork logic, chỉ tái sử dụng.
  exports: [VehicleTrafficStatsService],
})
export class GateAccessModule {}
