import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AutoAuditInterceptor } from './interceptors/auto-audit.interceptor.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AuditLogEntity } from './entities/audit-log.entity.js';
import { SystemConfigEntity } from './entities/system-config.entity.js';
import { BackgroundJobEntity } from './entities/background-job.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import { BackgroundJobsService } from './services/background-jobs.service.js';
import { AuditLogsService } from './services/audit-logs.service.js';
import { AuditLogQueryService } from './services/audit-log-query.service.js';
import { UserAuditLogQueryService } from './services/user-audit-log-query.service.js';
import { AuditLogExportService } from './services/audit-log-export.service.js';
import { AuditLogQueryRepository } from './repositories/audit-log-query.repository.js';
import { BackgroundJobsController } from './controllers/background-jobs.controller.js';
import { AuditLogsController } from './controllers/audit-logs.controller.js';
import { UserAuditLogsController } from './controllers/user-audit-logs.controller.js';
import { SystemConfigController } from './controllers/system-config.controller.js';
import { SystemConfigService } from './services/system-config.service.js';
import { ChannelMapConfigController } from './controllers/channel-map-config.controller.js';
import { ChannelMapConfigService } from './services/channel-map-config.service.js';
import { AuthModule } from '../auth/auth.module.js';

/**
 * AdministrationModule quản lý:
 * - AuditLogEntity (audit_logs)
 * - SystemConfigEntity (system_configs)
 * - BackgroundJobEntity (background_jobs)
 * - UserEntity (users) — cần thiết để AuditLogQueryRepository thực hiện LEFT JOIN
 * - BackgroundJobsService — lifecycle tracking cho background jobs
 * - AuditLogsService — ghi audit log dùng chung cho toàn hệ thống
 * - AuditLogQueryService — orchestrator ĐỌC cho UC-AA-11 (tách biệt hoàn toàn)
 * - AuditLogExportService — GET /audit-logs/export (2026-08-11, ngoài phạm vi UC-AA-11
 *   gốc — xem docblock service). Render đồng bộ XLSX, KHÔNG dùng background_jobs.
 * - AuditLogQueryRepository — raw SQL query ĐỌC, LEFT JOIN audit_logs + users
 * - BackgroundJobsController — GET /api/v1/background-jobs/:id (T007, poll status)
 * - AuditLogsController — GET /api/v1/audit-logs + GET /audit-logs/export (chỉ SYSTEM_ADMIN)
 * - SystemConfigController — GET/PATCH /api/v1/system-configurations (BE-09, 2026-07-27)
 * - SystemConfigService — allowlist 9 key phẳng FE quản trị, xem
 *   constants/system-config-allowlist.ts
 * - ChannelMapConfigController — GET/PATCH /api/v1/system-configurations/channel-maps
 *   (F7, 2026-08-04) — 7 key dấu chấm (4 channel-map JSON + 3 ngưỡng), TÁCH RIÊNG khỏi
 *   allowlist 9 key phẳng ở trên (2 hệ tên key không trộn, xem
 *   constants/channel-map-config.constant.ts)
 * - ChannelMapConfigService — validate + upsert system_configs.config_json/config_value
 *   cho 7 key đó, KHÔNG đụng logic đọc của các service nội bộ đang dùng chúng
 *
 * Module này KHÔNG import các business module (AccountsModule, RecordingModule...)
 * để tránh circular dependency. AuthModule là ngoại lệ AN TOÀN: chỉ import để
 * BackgroundJobsController/AuditLogsController dùng JwtAuthGuard + PermissionsGuard
 * (cần JwtService/AuthConfigService/RedisService) — AuthModule KHÔNG import ngược
 * AdministrationModule và KHÔNG inject BackgroundJobsService/AuditLogsService,
 * nên không tạo vòng phụ thuộc.
 *
 * @Global() — các module khác không cần import AdministrationModule
 * để dùng BackgroundJobsService và AuditLogsService.
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    AuthModule,
    TypeOrmModule.forFeature([
      AuditLogEntity,
      SystemConfigEntity,
      BackgroundJobEntity,
      UserEntity,
    ]),
  ],
  controllers: [
    BackgroundJobsController,
    AuditLogsController,
    UserAuditLogsController,
    SystemConfigController,
    ChannelMapConfigController,
  ],
  providers: [
    // Ghi nhật ký tự động mọi thao tác thay đổi dữ liệu (không sót module nào).
    { provide: APP_INTERCEPTOR, useClass: AutoAuditInterceptor },
    BackgroundJobsService,
    AuditLogsService,
    AuditLogQueryService,
    UserAuditLogQueryService,
    AuditLogExportService,
    AuditLogQueryRepository,
    SystemConfigService,
    ChannelMapConfigService,
  ],
  exports: [TypeOrmModule, BackgroundJobsService, AuditLogsService],
})
export class AdministrationModule {}
