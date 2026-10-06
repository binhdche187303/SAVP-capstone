import {
  BACKFILL_CHUNK_HOURS,
  INCREMENTAL_OVERLAP_HOURS,
  RECONCILE_LOOKBACK_HOURS,
} from '../kpi-rollup.constants.js';
import { addHours, floorHour, maxDate, minDate } from './hour.util.js';
import type { HourWindow, Watermark } from './kpi-window.types.js';

function nonEmpty(from: Date, to: Date): HourWindow | null {
  return from.getTime() < to.getTime() ? { from, to } : null;
}

/** Cron mỗi giờ: làm lại 2h cuối đã phủ + phần mới tới giờ tròn hiện tại. */
export function incrementalWindow(
  wm: Watermark | null,
  now: Date,
): HourWindow | null {
  const end = floorHour(now);
  const start = wm
    ? maxDate(
        addHours(wm.coveredUntil, -INCREMENTAL_OVERLAP_HOURS),
        wm.coveredFrom,
      )
    : addHours(end, -INCREMENTAL_OVERLAP_HOURS);
  return nonEmpty(start, end);
}

/**
 * Cron 01:00: tính lại 72h gần nhất. Nếu job đã ngừng lâu hơn 72h thì bắt đầu từ
 * covered_until để cửa sổ vẫn liền với watermark (Review Focus #5).
 */
export function reconcileWindow(
  wm: Watermark | null,
  now: Date,
): HourWindow | null {
  const end = floorHour(now);
  const lookback = addHours(end, -RECONCILE_LOOKBACK_HOURS);
  const start = wm
    ? maxDate(minDate(lookback, wm.coveredUntil), wm.coveredFrom)
    : lookback;
  return nonEmpty(start, end);
}

/** Backfill: lùi từng chunk 24h từ `to` về `floorHour(from)` để mỗi chunk liền watermark. */
export function planBackfillChunks(from: Date, to: Date): HourWindow[] {
  const start = floorHour(from);
  const chunks: HourWindow[] = [];
  let cursor = to;
  while (cursor.getTime() > start.getTime()) {
    const chunkFrom = maxDate(addHours(cursor, -BACKFILL_CHUNK_HOURS), start);
    chunks.push({ from: chunkFrom, to: cursor });
    cursor = chunkFrom;
  }
  return chunks;
}
