/** KPI-001 — tên các rollup (khớp `kpi_rollup_watermarks.rollup_name`). */
export type RollupName = 'zone_hourly' | 'vehicle_hourly';
export const ROLLUP_NAMES: readonly RollupName[] = [
  'zone_hourly',
  'vehicle_hourly',
];

/** Incremental làm lại N giờ cuối để bắt event đến trễ vài phút. */
export const INCREMENTAL_OVERLAP_HOURS = 2;
/** Reconcile 01:00 tính lại N giờ gần nhất (event trễ do bridge/queue). */
export const RECONCILE_LOOKBACK_HOURS = 72;
export const BACKFILL_CHUNK_HOURS = 24;
export const BUSINESS_TZ = 'Asia/Ho_Chi_Minh';

/** Mã classid (int4) cho advisory lock 2 khoá của KPI rollup — tránh đụng không gian khoá hashtext() đơn của module khác ('KPI' ~ 4932681). */
export const KPI_ROLLUP_LOCK_CLASSID = 4932681;
