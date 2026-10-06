import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KpiZoneHourlyEntity } from './entities/kpi-zone-hourly.entity.js';
import { KpiVehicleHourlyEntity } from './entities/kpi-vehicle-hourly.entity.js';
import { KpiVehiclePlateHourlyEntity } from './entities/kpi-vehicle-plate-hourly.entity.js';
import { KpiRollupWatermarkEntity } from './entities/kpi-rollup-watermark.entity.js';
import { KpiWatermarkRepository } from './repositories/kpi-watermark.repository.js';
import { ZoneHourlyRollupService } from './services/zone-hourly-rollup.service.js';
import { VehicleHourlyRollupService } from './services/vehicle-hourly-rollup.service.js';
import { KpiRollupJobService } from './services/kpi-rollup-job.service.js';
import { KpiReadWindowService } from './services/kpi-read-window.service.js';

/**
 * KpiRollupModule (KPI-001 / task #10) — bảng tổng hợp theo giờ + job rollup + phía đọc lai.
 * Không import module nghiệp vụ nào (đọc bảng raw qua SQL) ⇒ campus-dashboard, gate-access,
 * scheduler import module này một chiều, không circular.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      KpiZoneHourlyEntity,
      KpiVehicleHourlyEntity,
      KpiVehiclePlateHourlyEntity,
      KpiRollupWatermarkEntity,
    ]),
  ],
  providers: [
    KpiWatermarkRepository,
    ZoneHourlyRollupService,
    VehicleHourlyRollupService,
    KpiRollupJobService,
    KpiReadWindowService,
  ],
  exports: [KpiRollupJobService, KpiWatermarkRepository, KpiReadWindowService],
})
export class KpiRollupModule {}
