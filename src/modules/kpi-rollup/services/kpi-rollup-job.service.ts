import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ROLLUP_NAMES, type RollupName } from '../kpi-rollup.constants.js';
import { KpiWatermarkRepository } from '../repositories/kpi-watermark.repository.js';
import { acquireRollupLock } from '../utils/rollup-lock.util.js';
import { floorHour } from '../utils/hour.util.js';
import { extendWatermark } from '../utils/watermark.util.js';
import {
  incrementalWindow,
  reconcileWindow,
} from '../utils/rollup-window.util.js';
import type { HourWindow, Watermark } from '../utils/kpi-window.types.js';
import {
  ZoneHourlyRollupService,
  type HourlyRollup,
} from './zone-hourly-rollup.service.js';
import { VehicleHourlyRollupService } from './vehicle-hourly-rollup.service.js';

export interface RollupRunResult {
  skipped: boolean;
  windows: Partial<Record<RollupName, HourWindow>>;
}

/**
 * KPI-001 §4.3 — điều phối rollup: 1 transaction + advisory lock; với từng rollup: đọc
 * watermark → tính cửa sổ → kiểm tra liền mạch → rollup → lưu watermark. Lỗi ⇒ rollback
 * toàn bộ, watermark không tiến, lượt sau làm lại.
 */
@Injectable()
export class KpiRollupJobService {
  private readonly logger = new Logger(KpiRollupJobService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly watermarkRepo: KpiWatermarkRepository,
    private readonly zoneRollup: ZoneHourlyRollupService,
    private readonly vehicleRollup: VehicleHourlyRollupService,
  ) {}

  runIncremental(now: Date = new Date()): Promise<RollupRunResult> {
    return this.execute(false, ROLLUP_NAMES, (wm) =>
      incrementalWindow(wm, now),
    );
  }

  runReconcile(now: Date = new Date()): Promise<RollupRunResult> {
    return this.execute(false, ROLLUP_NAMES, (wm) => reconcileWindow(wm, now));
  }

  /** Backfill / chạy tay: cửa sổ phải là giờ tròn và liền watermark hiện có. */
  runRange(name: RollupName, from: Date, to: Date): Promise<RollupRunResult> {
    if (
      floorHour(from).getTime() !== from.getTime() ||
      floorHour(to).getTime() !== to.getTime()
    ) {
      return Promise.reject(
        new Error('KPI runRange: from/to phải là giờ tròn'),
      );
    }
    if (to.getTime() > floorHour(new Date()).getTime()) {
      return Promise.reject(
        new Error('KPI runRange: `to` không được vượt giờ tròn hiện tại'),
      );
    }
    return this.execute(true, [name], () => ({ from, to }));
  }

  private rollupFor(name: RollupName): HourlyRollup {
    return name === 'zone_hourly' ? this.zoneRollup : this.vehicleRollup;
  }

  private async execute(
    blocking: boolean,
    names: readonly RollupName[],
    pickWindow: (wm: Watermark | null) => HourWindow | null,
  ): Promise<RollupRunResult> {
    const qr = this.dataSource.createQueryRunner();
    try {
      await qr.connect();
      await qr.startTransaction();
      if (!(await acquireRollupLock(qr, blocking))) {
        this.logger.debug('[KPI] rollup đang chạy ở instance khác — bỏ lượt');
        if (qr.isTransactionActive) await qr.rollbackTransaction();
        return { skipped: true, windows: {} };
      }
      const windows: Partial<Record<RollupName, HourWindow>> = {};
      for (const name of names) {
        const wm = await this.watermarkRepo.get(name, qr);
        const window = pickWindow(wm);
        if (!window) continue;
        const next = extendWatermark(wm, window.from, window.to);
        await this.rollupFor(name).rollup(qr, window.from, window.to);
        await this.watermarkRepo.save(qr, name, next);
        windows[name] = window;
      }
      await qr.commitTransaction();
      return { skipped: false, windows };
    } catch (err) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }
}
