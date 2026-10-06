import { maxDate, minDate } from './hour.util.js';
import type { Watermark } from './kpi-window.types.js';

export class KpiWatermarkGapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KpiWatermarkGapError';
  }
}

/** Mở rộng watermark bằng `[from, until)`; từ chối khoảng làm watermark có lỗ (spec §4.3). */
export function extendWatermark(
  current: Watermark | null,
  from: Date,
  until: Date,
): Watermark {
  if (from.getTime() >= until.getTime()) {
    throw new Error(
      `KPI watermark: khoảng rỗng [${from.toISOString()}, ${until.toISOString()})`,
    );
  }
  if (!current) return { coveredFrom: from, coveredUntil: until };
  if (
    until.getTime() < current.coveredFrom.getTime() ||
    from.getTime() > current.coveredUntil.getTime()
  ) {
    throw new KpiWatermarkGapError(
      `KPI watermark: [${from.toISOString()}, ${until.toISOString()}) không liền với ` +
        `[${current.coveredFrom.toISOString()}, ${current.coveredUntil.toISOString()})`,
    );
  }
  return {
    coveredFrom: minDate(current.coveredFrom, from),
    coveredUntil: maxDate(current.coveredUntil, until),
  };
}
