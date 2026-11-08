import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  scheduledOptionsOf,
  UelSyncSettingsService,
} from './uel-sync-settings.service.js';
import { UelSyncService } from './uel-sync.service.js';

/** Giờ chạy tự động (giờ Việt Nam) — hiển thị trên trang quản trị. */
export const UEL_SYNC_CRON = '0 0 2 * * *';
export const UEL_SYNC_CRON_LABEL = '02:00 hằng ngày';

/**
 * Đồng bộ UEL tự động mỗi đêm. Bật bằng SCHEDULER_ENABLED && SCHEDULER_UEL_SYNC_ENABLED (mặc định tắt).
 * Bước nào thiếu cài đặt (học kỳ hiện tại, bảng giờ tiết) thì bỏ qua bước đó, không làm hỏng cả lượt.
 * KHÔNG ném lỗi ra cron.
 */
@Injectable()
export class UelSyncScheduler {
  private readonly logger = new Logger(UelSyncScheduler.name);
  readonly enabled: boolean;

  constructor(
    config: ConfigService,
    private readonly sync: UelSyncService,
    private readonly settings: UelSyncSettingsService,
  ) {
    this.enabled =
      config.get<boolean>('SCHEDULER_ENABLED', true) &&
      config.get<boolean>('SCHEDULER_UEL_SYNC_ENABLED', false);
  }

  @Cron(UEL_SYNC_CRON, {
    name: 'uel-sync-nightly',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async nightly(): Promise<void> {
    if (!this.enabled) return;
    if (!this.sync.configured) {
      this.logger.warn(
        'Bỏ qua đồng bộ UEL tự động: chưa cấu hình UEL_API_BASE_URL / UEL_API_KEY.',
      );
      return;
    }
    try {
      const [s, periods] = await Promise.all([
        this.settings.getSettings(),
        this.settings.getPeriods(),
      ]);
      const { options, skipped } = scheduledOptionsOf(
        s,
        new Date(),
        periods.length > 0,
      );
      skipped.forEach((m) =>
        this.logger.warn(`Đồng bộ UEL tự động — bỏ qua ${m}`),
      );
      await this.sync.start(options, { trigger: 'schedule' });
    } catch (e) {
      if (e instanceof ConflictException) {
        this.logger.warn('Bỏ qua đồng bộ UEL tự động: đang có lượt khác chạy.');
      } else {
        this.logger.error(`Đồng bộ UEL tự động lỗi: ${(e as Error).message}`);
      }
    }
  }
}
