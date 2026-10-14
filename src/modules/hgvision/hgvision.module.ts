import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IvssModule } from '../ivss/ivss.module.js';
import { AnprModule } from '../anpr/anpr.module.js';
import { HgvisionClient } from './hgvision.client.js';
import { HGVISION_CLIENT } from './hgvision.constants.js';
import { HgvisionPollerService } from './hgvision-poller.service.js';

/**
 * HgvisionModule — nguồn camera AI HGVision, chạy SONG SONG với IVSS.
 * Chọn nguồn bằng CAMERA_PROVIDER (ivss | hgvision, mặc định ivss).
 * Import IvssModule để lấy IVSS_EVENT_HANDLER (pipeline presence dùng chung) và
 * AnprModule để lấy VEHICLE_EVENT_HANDLER (pipeline biển số dùng chung).
 */
@Module({
  imports: [IvssModule, AnprModule],
  providers: [
    {
      provide: HGVISION_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new HgvisionClient({
          baseUrl: config.get<string>('HGVISION_BASE_URL', ''),
          clientId: config.get<string>('HGVISION_CLIENT_ID', ''),
          clientSecret: config.get<string>('HGVISION_CLIENT_SECRET', ''),
          timeoutMs: config.get<number>('HGVISION_TIMEOUT_MS', 8000),
        }),
    },
    HgvisionPollerService,
  ],
  exports: [HGVISION_CLIENT],
})
export class HgvisionModule {}
