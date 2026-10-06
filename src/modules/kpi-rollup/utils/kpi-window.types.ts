/** Khoảng giờ tròn nửa mở `[from, to)`. */
export interface HourWindow {
  from: Date;
  to: Date;
}

/** Bất biến: mọi giờ H với coveredFrom ≤ H < coveredUntil đã được rollup. */
export interface Watermark {
  coveredFrom: Date;
  coveredUntil: Date;
}

export interface TimeRange {
  from: Date;
  to: Date;
  /** true ⇒ `<= to` (mép cuối giữ semantics BETWEEN của API cũ). */
  toInclusive: boolean;
}

export interface ReadWindow {
  agg: HourWindow | null;
  raw: TimeRange[];
}
