import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import {
  cronOf,
  intervalDueOf,
  nextIntervalRunOf,
  runAllPlanOf,
  UelSyncSettingsService,
} from './uel-sync-settings.service.js';
import type { UelSyncSettings } from './uel-sync-settings.service.js';
import { UelSyncService } from './uel-sync.service.js';

export const UEL_SYNC_JOB = 'uel-sync-auto';
export const UEL_SYNC_TIMEZONE = 'Asia/Ho_Chi_Minh';

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** Nhãn lịch chạy hiển thị trên trang quản trị, vd "02:00 hằng ngày" / "02:00 T2 hằng tuần". */
export function scheduleLabelOf(s: UelSyncSettings): string {
  if (!s.autoEnabled) return 'Đang tắt';
  if (s.frequency === 'interval') return `${s.time} mỗi ${s.intervalDays} ngày`;
  return s.frequency === 'weekly'
    ? `${s.time} ${WEEKDAYS[s.weekday] ?? ''} hằng tuần`
    : `${s.time} hằng ngày`;
}

/**
 * Đồng bộ UEL tự động theo cài đặt (bật/tắt, hằng ngày/hằng tuần/mỗi N ngày, giờ chạy) — cron động qua
 * SchedulerRegistry, đổi cài đặt là áp dụng ngay. Server chỉ cho phép khi
 * SCHEDULER_ENABLED && SCHEDULER_UEL_SYNC_ENABLED (mặc định tắt).
 * Mỗi lượt = "đồng bộ toàn bộ": lịch học từ hôm nay → hết năm học (31/08), không lấy quá khứ.
 * KHÔNG ném lỗi ra cron.
 */
@Injectable()
export class UelSyncScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(UelSyncScheduler.name);
  /** Env cho phép chạy hẹn giờ trên server này. */
  readonly serverAllowed: boolean;
  private job: CronJob | null = null;
  private current: UelSyncSettings | null = null;
  /** Giờ bắt đầu lượt tự động gần nhất chạy xong (cho lịch mỗi N ngày). */
  private lastScheduledAt: string | null = null;

  constructor(
    config: ConfigService,
    private readonly sync: UelSyncService,
    private readonly settings: UelSyncSettingsService,
    private readonly registry: SchedulerRegistry,
  ) {
    this.serverAllowed =
      config.get<boolean>('SCHEDULER_ENABLED', true) &&
      config.get<boolean>('SCHEDULER_UEL_SYNC_ENABLED', false);
  }

  /** Bộ hẹn giờ đang chạy (server cho phép + cài đặt bật). */
  get enabled(): boolean {
    return this.job !== null;
  }

  /** Giờ bắt đầu (ISO) lượt tự động gần nhất đã chạy xong, null nếu chưa có. */
  get lastScheduledRunAt(): string | null {
    return this.lastScheduledAt;
  }

  /** Lần chạy kế tiếp (ISO) hoặc null khi đang tắt. */
  get nextRunAt(): string | null {
    if (!this.job) return null;
    try {
      const cronNext = this.job.nextDate().toJSDate();
      const s = this.current;
      if (s?.frequency === 'interval') {
        return nextIntervalRunOf(
          this.lastScheduledAt,
          cronNext,
          s.intervalDays,
          s.time,
        ).toISOString();
      }
      return cronNext.toISOString();
    } catch {
      return null;
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.serverAllowed) return;
    try {
      this.apply(await this.settings.getSettings());
    } catch (e) {
      this.logger.warn(
        `Không đọc được cài đặt đồng bộ UEL: ${(e as Error).message}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /** Áp dụng cài đặt mới: dừng job cũ, tạo job mới nếu được phép và đang bật. */
  apply(s: UelSyncSettings): void {
    this.stop();
    if (!this.serverAllowed || !s.autoEnabled) return;
    this.current = s;
    void this.refreshLastScheduled();
    const job = CronJob.from({
      cronTime: cronOf(s),
      onTick: () => void this.tick(),
      start: false,
      timeZone: UEL_SYNC_TIMEZONE,
    });
    this.registry.addCronJob(UEL_SYNC_JOB, job);
    job.start();
    this.job = job;
    this.logger.log(
      `Đồng bộ UEL tự động: ${scheduleLabelOf(s)} (lần tới ${this.nextRunAt})`,
    );
  }

  /** Đọc lại lượt tự động gần nhất (lỗi thì giữ giá trị cũ). */
  async refreshLastScheduled(): Promise<void> {
    try {
      this.lastScheduledAt = await this.sync.lastScheduledRunAt();
    } catch (e) {
      this.logger.warn(
        `Không đọc được lượt đồng bộ tự động gần nhất: ${(e as Error).message}`,
      );
    }
  }

  private stop(): void {
    if (!this.job) return;
    void this.job.stop();
    try {
      this.registry.deleteCronJob(UEL_SYNC_JOB);
    } catch {
      // chưa đăng ký
    }
    this.job = null;
    this.current = null;
  }

  async tick(): Promise<void> {
    if (!this.serverAllowed) return;
    if (!this.sync.configured) {
      this.logger.warn(
        'Bỏ qua đồng bộ UEL tự động: chưa cấu hình UEL_API_BASE_URL / UEL_API_KEY.',
      );
      return;
    }
    try {
      const s = await this.settings.getSettings();
      if (!s.autoEnabled) return;
      if (s.frequency === 'interval') {
        const last = await this.sync.lastScheduledRunAt();
        if (!intervalDueOf(last, new Date(), s.intervalDays)) return;
      }
      await this.sync.startAll(runAllPlanOf(s, new Date()), {
        trigger: 'schedule',
      });
    } catch (e) {
      if (e instanceof ConflictException) {
        this.logger.warn('Bỏ qua đồng bộ UEL tự động: đang có lượt khác chạy.');
      } else {
        this.logger.error(`Đồng bộ UEL tự động lỗi: ${(e as Error).message}`);
      }
    }
    await this.refreshLastScheduled();
  }
}
