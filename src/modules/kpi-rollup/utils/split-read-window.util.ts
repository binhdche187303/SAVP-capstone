import { ceilHour, floorHour, maxDate, minDate } from './hour.util.js';
import type { ReadWindow, TimeRange, Watermark } from './kpi-window.types.js';

/**
 * KPI-001 §5.1 — chia `[from, to]` (to inclusive) thành phần đọc aggregate (giờ tròn nằm trọn
 * trong khoảng VÀ đã rollup) và phần đọc raw (mép + phần ngoài watermark). Các phần rời nhau,
 * hợp lại đúng `[from, to]`, và mỗi giờ tròn chỉ thuộc 1 phần.
 */
export function splitReadWindow(
  from: Date,
  to: Date,
  wm: Watermark | null,
  enabled: boolean,
): ReadWindow {
  const allRaw: ReadWindow = {
    agg: null,
    raw: [{ from, to, toInclusive: true }],
  };
  if (!enabled || !wm) return allRaw;

  const aggStart = maxDate(ceilHour(from), wm.coveredFrom);
  const aggEnd = minDate(floorHour(to), wm.coveredUntil);
  if (aggStart.getTime() >= aggEnd.getTime()) return allRaw;

  const raw: TimeRange[] = [];
  if (from.getTime() < aggStart.getTime()) {
    raw.push({ from, to: aggStart, toInclusive: false });
  }
  raw.push({ from: aggEnd, to, toInclusive: true });
  return { agg: { from: aggStart, to: aggEnd }, raw };
}
