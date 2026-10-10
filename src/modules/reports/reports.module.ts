import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

// Entities cần đọc trong MeetingActivityReportDataService / RoomUtilizationReportDataService
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../meetings/entities/meeting-participant.entity.js';
import { RoomEntity } from '../rooms/entities/room.entity.js';
import { RoomBookingEntity } from '../rooms/entities/room-booking.entity.js';
import { RoomBookingUsageEntity } from '../rooms/entities/room-booking-usage.entity.js';
import { NoShowCaseEntity } from '../rooms/entities/no-show-case.entity.js';
import { RoomEventEntity } from '../rooms/entities/room-event.entity.js';
import { AttendanceRecordEntity } from '../attendance/entities/attendance-record.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import { UserRoleEntity } from '../accounts/entities/user-role.entity.js';
import { DepartmentEntity } from '../accounts/entities/department.entity.js';

// MediaFileEntity cần cho worker processor để lưu output
import { MediaFileEntity } from '../recording/entities/media-file.entity.js';

// AuthModule cần cho JwtAuthGuard + PermissionsGuard trong controller
import { AuthModule } from '../auth/auth.module.js';

// AnalyticsModule export DashboardOverviewConfigService (getMaxRangeDays)
import { AnalyticsModule } from '../analytics/analytics.module.js';

// StorageModule cung cấp StorageService để lưu file xuất báo cáo
import { StorageModule } from '../storage/storage.module.js';

// Bước 5 SAVP (UC-127): entity nguồn cho GateAccessReportDataService
import { GateAccessLogEntity } from '../zones/entities/gate-access-log.entity.js';
import { ZoneEntity } from '../zones/entities/zone.entity.js';

// Bước 5 SAVP (UC-128): entity nguồn cho VehicleReportDataService +
// GateAccessModule (export VehicleTrafficStatsService qua DI)
import { VehicleRegistrationEntity } from '../anpr/entities/vehicle-registration.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { GateAccessModule } from '../gate-access/gate-access.module.js';

// Bước 5 SAVP (UC-129): entity nguồn cho SecurityAlertReportDataService
import { SecurityAlertEntity } from '../alerts/entities/security-alert.entity.js';

// Controllers
import { MeetingActivityReportController } from './controllers/meeting-activity-report.controller.js';
import { RoomUtilizationReportController } from './controllers/room-utilization-report.controller.js';
import { GateAccessReportController } from './controllers/gate-access-report.controller.js';
import { VehicleReportController } from './controllers/vehicle-report.controller.js';
import { SecurityAlertReportController } from './controllers/security-alert-report.controller.js';

// Services
import { MeetingActivityReportService } from './services/meeting-activity-report.service.js';
import { MeetingActivityReportDataService } from './services/meeting-activity-report-data.service.js';
import { RoomUtilizationReportService } from './services/room-utilization-report.service.js';
import { RoomUtilizationReportDataService } from './services/room-utilization-report-data.service.js';
import { GateAccessReportService } from './services/gate-access-report.service.js';
import { GateAccessReportDataService } from './services/gate-access-report-data.service.js';
import { VehicleReportService } from './services/vehicle-report.service.js';
import { VehicleReportDataService } from './services/vehicle-report-data.service.js';
import { SecurityAlertReportService } from './services/security-alert-report.service.js';
import { SecurityAlertReportDataService } from './services/security-alert-report-data.service.js';

// Processor
import { MeetingActivityReportWorkerProcessor } from './processors/meeting-activity-report-worker.processor.js';
import { RoomUtilizationReportWorkerProcessor } from './processors/room-utilization-report-worker.processor.js';
import { GateAccessReportWorkerProcessor } from './processors/gate-access-report-worker.processor.js';
import { VehicleReportWorkerProcessor } from './processors/vehicle-report-worker.processor.js';
import { SecurityAlertReportWorkerProcessor } from './processors/security-alert-report-worker.processor.js';

// RPT-CENTER-BE-001: Trung tâm báo cáo (2.13)
import { ReportCenterController } from './center/controllers/report-center.controller.js';
import { ReportCenterService } from './center/report-center.service.js';
import { ReportCenterEnabledGuard } from './center/report-center-enabled.guard.js';
import { ReportCenterExportService } from './center/report-center-export.service.js';
import { ReportCenterWorkerProcessor } from './center/report-center-worker.processor.js';
import { ReportFileService } from './center/report-file.service.js';
import { ReportScheduleRunController } from './schedules/controllers/report-schedule-run.controller.js';
import { ReportScheduleDispatchService } from './schedules/report-schedule-dispatch.service.js';
import { ReportScheduleRunService } from './schedules/report-schedule-run.service.js';
import { ReportScheduleRunWorker } from './schedules/report-schedule-run.worker.js';
import { ReportScheduleController } from './schedules/controllers/report-schedule.controller.js';
import { ReportScheduleService } from './schedules/report-schedule.service.js';
import { ReportScopeService } from './center/report-scope.service.js';
import { REPORT_PROVIDERS, type ReportProvider } from './center/report-model.js';
import { GateAccessReportProvider } from './center/providers/gate-access.provider.js';
import { VehicleReportProvider } from './center/providers/vehicle.provider.js';
import { VisitorReportProvider } from './center/providers/visitor.provider.js';
import { StaffAttendanceReportProvider } from './center/providers/staff-attendance.provider.js';
import { RoomUtilizationReportProvider } from './center/providers/room-utilization.provider.js';
import { SecurityAlertReportProvider } from './center/providers/security-alert.provider.js';

// BE-04 (Đợt P1): user export
import { UserExportService } from './services/user-export.service.js';
import { UserExportDataService } from './services/user-export-data.service.js';

/**
 * ReportsModule — UC-AA-12 / UC-158: Xuất báo cáo tổng hợp hoạt động cuộc họp.
 *
 * Dependency strategy:
 * - AdministrationModule: @Global() → BackgroundJobsService, AuditLogsService auto-available
 * - QueueModule: @Global() → QueueService auto-available
 * - AuthModule: import để JwtAuthGuard + PermissionsGuard + AuthzReadRepository hoạt động
 * - AnalyticsModule: import để lấy DashboardOverviewConfigService (getMaxRangeDays)
 *   KHÔNG import theo cách khác để tránh circular dependency.
 *
 * ARCH: Không sửa BackgroundJobsService/QueueService/MediaFilesService/StorageService
 * — chỉ dùng qua Dependency Injection.
 */
@Module({
  imports: [
    ConfigModule,
    AuthModule,
    AnalyticsModule,
    StorageModule,
    // Bước 5 SAVP (UC-128): lấy VehicleTrafficStatsService qua DI (đã export ở
    // gate-access.module.ts), KHÔNG fork logic UC-114.
    GateAccessModule,
    // RPT-CENTER: lần chạy lịch gửi gửi email báo cáo qua NotificationsService.
    NotificationsModule,
    TypeOrmModule.forFeature([
      // Entities cho data aggregation
      MeetingEntity,
      MeetingParticipantEntity,
      RoomEntity,
      RoomBookingEntity,
      RoomBookingUsageEntity,
      NoShowCaseEntity,
      RoomEventEntity,
      AttendanceRecordEntity,
      UserEntity,
      UserRoleEntity,
      DepartmentEntity,
      // Entity cho worker processor (lưu media file)
      MediaFileEntity,
      // Bước 5 SAVP (UC-127): nguồn dữ liệu GateAccessReportDataService
      GateAccessLogEntity,
      ZoneEntity,
      // Bước 5 SAVP (UC-128): nguồn dữ liệu VehicleReportDataService
      VehicleRegistrationEntity,
      // Bước 5 SAVP (UC-129): nguồn dữ liệu SecurityAlertReportDataService
      SecurityAlertEntity,
    ]),
  ],
  controllers: [
    MeetingActivityReportController,
    RoomUtilizationReportController,
    GateAccessReportController,
    VehicleReportController,
    SecurityAlertReportController,
    ReportCenterController,
    ReportScheduleController,
    ReportScheduleRunController,
  ],
  providers: [
    ReportCenterService,
    ReportCenterExportService,
    ReportScheduleService,
    ReportScheduleDispatchService,
    ReportScheduleRunService,
    ReportScheduleRunWorker,
    ReportCenterWorkerProcessor,
    ReportFileService,
    ReportScopeService,
    ReportCenterEnabledGuard,
    // Các provider của 6 loại báo cáo được thêm vào mảng này theo từng task (gate-access, vehicle, …).
    GateAccessReportProvider,
    VehicleReportProvider,
    RoomUtilizationReportProvider,
    SecurityAlertReportProvider,
    StaffAttendanceReportProvider,
    VisitorReportProvider,
    {
      provide: REPORT_PROVIDERS,
      useFactory: (...providers: ReportProvider[]): ReportProvider[] => providers,
      inject: [GateAccessReportProvider, VehicleReportProvider, RoomUtilizationReportProvider, SecurityAlertReportProvider, StaffAttendanceReportProvider, VisitorReportProvider],
    },
    MeetingActivityReportService,
    MeetingActivityReportDataService,
    MeetingActivityReportWorkerProcessor,
    RoomUtilizationReportService,
    RoomUtilizationReportDataService,
    // RoomUtilizationReportWorkerProcessor/GateAccessReportWorkerProcessor/
    // VehicleReportWorkerProcessor/SecurityAlertReportWorkerProcessor là plain
    // @Injectable(), KHÔNG phải @Processor — được MeetingActivityReportWorkerProcessor
    // (giữ @Processor duy nhất trên queue 'report-export') gọi qua DI, xem ghi chú trong file đó.
    RoomUtilizationReportWorkerProcessor,
    GateAccessReportService,
    GateAccessReportDataService,
    GateAccessReportWorkerProcessor,
    VehicleReportService,
    VehicleReportDataService,
    VehicleReportWorkerProcessor,
    SecurityAlertReportService,
    SecurityAlertReportDataService,
    SecurityAlertReportWorkerProcessor,
    // BE-04 (2026-07-27): export đồng bộ, không còn worker/job — xem
    // UserExportService docblock.
    UserExportService,
    UserExportDataService,
  ],
  exports: [UserExportService, ReportScheduleDispatchService],
})
export class ReportsModule {}
