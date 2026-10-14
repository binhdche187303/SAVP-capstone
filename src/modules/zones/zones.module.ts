import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { IotModule } from '../iot/iot.module.js';
import { AcademicModule } from '../academic/academic.module.js';
import { ZoneEntity } from './entities/zone.entity.js';
import { GateAccessLogEntity } from './entities/gate-access-log.entity.js';
import { ZonePresenceEventEntity } from './entities/zone-presence-event.entity.js';
import { ZonesController } from './controllers/zones.controller.js';
import { GateAccessLogController } from './controllers/gate-access-log.controller.js';
import { ZonesService } from './services/zones.service.js';
import { GateAccessLogService } from './services/gate-access-log.service.js';
import { GateLogPairingService } from './services/gate-log-pairing.service.js';
import { ZonePresenceWriterService } from './services/zone-presence-writer.service.js';
import { ZonesAuditRepository } from './repositories/zones-audit.repository.js';

/**
 * ZonesModule (SAVP Zone scope).
 *
 * `TypeOrmModule.forFeature` đăng ký entity của scope Zone để runtime
 * (`autoLoadEntities: true` trong DatabaseModule) nhận metadata.
 * `GateAccessLogEntity` / `ZonePresenceEventEntity` vẫn SCHEMA-ONLY — ingestion gate/presence
 * làm ở UC sau.
 *
 * ZNC-001 (UC-90): thêm nghiệp vụ tạo khu vực — `ZonesController` + `ZonesService`.
 * Import `AuthModule` để dùng guard THẬT: `PermissionsGuard` inject `AuthzReadRepository`,
 * `JwtAuthGuard` cần `JwtService` + `CACHE_MANAGER` — cả ba do AuthModule export. THIẾU import
 * này là crash lúc boot (`UnknownDependenciesException`), KHÔNG phải lỗi 403. Mirror
 * `anpr.module.ts`.
 *
 * ZND-001 (UC-92): thêm xoá mềm + audit — `ZonesAuditRepository` (ghi `audit_logs` với
 * `entity_type='zones'`) và import `IotModule` để đếm thiết bị đang gán vào zone qua
 * `IotDevicesService` (ARCH-01: KHÔNG query thẳng bảng `iot_devices`).
 *
 * ⚠ RÀNG BUỘC KIẾN TRÚC (OQ-1b) — phụ thuộc `zones → iot` là **MỘT CHIỀU, VĨNH VIỄN**:
 * `IotModule` TUYỆT ĐỐI KHÔNG được import `ZonesModule`, và cấm dùng `forwardRef` để lách.
 * Hệ quả cho UC-94 (gán camera vào zone): route đặt ở phía `zones`
 * (`PATCH /api/v1/zones/:id/devices`), KHÔNG phải `PATCH /iot-devices/:id/zone`.
 *
 * CLI DataSource (`src/database/data-source.ts`) đã glob `modules/**\/*.entity.{ts,js}`
 * nên KHÔNG cần khai thêm ở đó.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ZoneEntity,
      GateAccessLogEntity,
      ZonePresenceEventEntity,
    ]),
    AuthModule,
    IotModule,
    AcademicModule,
  ],
  controllers: [ZonesController, GateAccessLogController],
  providers: [
    ZonesService,
    ZonesAuditRepository,
    GateAccessLogService,
    GateLogPairingService,
    ZonePresenceWriterService,
  ],
  // Export GateLogPairingService để SchedulerModule (cron gate-log-pairing) inject được.
  // Export GateAccessLogService để AnprModule (UC-105 writer) gọi writeGateLog (QC-3).
  // Export ZonePresenceWriterService để IvssModule (UC-109 writer) gọi writeAppearEvent (QC-4).
  exports: [
    TypeOrmModule,
    GateLogPairingService,
    GateAccessLogService,
    ZonePresenceWriterService,
  ],
})
export class ZonesModule {}
