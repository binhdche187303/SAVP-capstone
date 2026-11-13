import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { UelApiClient } from './uel-api.client.js';
import { UelLookupService } from './uel-lookup.service.js';
import { UEL_API_CLIENT } from './uel-sync.constants.js';
import { UelSyncController } from './uel-sync.controller.js';
import { UelSyncScheduler } from './uel-sync.scheduler.js';
import { UelSyncSettingsService } from './uel-sync-settings.service.js';
import { UelSyncService } from './uel-sync.service.js';

/**
 * UelSyncModule — đồng bộ đơn vị, cán bộ, SV, lớp HP, đăng ký, lịch học từ API Đào tạo UEL.
 * Cron động `uel-sync-auto` (SchedulerRegistry) dùng ScheduleModule.forRoot() đã đăng ký ở SchedulerModule.
 */
@Module({
  // JwtAuthGuard + PermissionsGuard của controller cần JwtService/AuthConfigService từ AuthModule.
  imports: [AuthModule],
  controllers: [UelSyncController],
  providers: [
    {
      provide: UEL_API_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new UelApiClient({
          baseUrl: config.get<string>('UEL_API_BASE_URL', ''),
          projectCode: config.get<string>('UEL_API_PROJECT_CODE', 'uelapi'),
          apiKey: config.get<string>('UEL_API_KEY', ''),
          timeoutMs: config.get<number>('UEL_API_TIMEOUT_MS', 30000),
        }),
    },
    UelSyncService,
    UelSyncSettingsService,
    UelSyncScheduler,
    UelLookupService,
  ],
  exports: [UelSyncService],
})
export class UelSyncModule {}
