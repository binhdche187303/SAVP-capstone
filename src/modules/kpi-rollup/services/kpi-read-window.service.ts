import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RollupName } from '../kpi-rollup.constants.js';
import { KpiWatermarkRepository } from '../repositories/kpi-watermark.repository.js';
import { splitReadWindow } from '../utils/split-read-window.util.js';
import type { ReadWindow, Watermark } from '../utils/kpi-window.types.js';

/**
 * KPI-001 §5 — phía đọc: watermark + cờ `KPI_ROLLUP_READ_ENABLED` → ReadWindow.
 * Mọi lỗi đọc watermark ⇒ đọc 100% raw (đúng nhưng chậm), không làm hỏng API.
 */
@Injectable()
export class KpiReadWindowService {
  private readonly logger = new Logger(KpiReadWindowService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly watermarkRepo: KpiWatermarkRepository,
    configService: ConfigService,
  ) {
    this.enabled = configService.get<boolean>('KPI_ROLLUP_READ_ENABLED', true);
  }

  async resolve(name: RollupName, from: Date, to: Date): Promise<ReadWindow> {
    if (!this.enabled) return splitReadWindow(from, to, null, false);
    let wm: Watermark | null = null;
    try {
      wm = await this.watermarkRepo.get(name);
    } catch (err) {
      this.logger.warn(
        `[KPI] đọc watermark ${name} lỗi, dùng raw: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    return splitReadWindow(from, to, wm, true);
  }
}
