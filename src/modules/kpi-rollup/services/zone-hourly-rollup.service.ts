import { Injectable } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';

export interface HourlyRollup {
  rollup(qr: QueryRunner, from: Date, to: Date): Promise<void>;
}

/**
 * KPI-001 §4.2 — tổng hợp `zone_presence_events` (event_type='count') theo zone × giờ trong
 * cửa sổ `[from, to)`. DELETE rồi INSERT ⇒ idempotent. `peak_at` theo đúng quy tắc của
 * ZoneTrafficHeatmapService cũ: occupancy cao nhất (NULL xếp cuối), hoà thì event muộn hơn.
 */
@Injectable()
export class ZoneHourlyRollupService implements HourlyRollup {
  async rollup(qr: QueryRunner, from: Date, to: Date): Promise<void> {
    await qr.query(
      `DELETE FROM kpi_zone_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
      [from, to],
    );
    await qr.query(
      `WITH src AS (
         SELECT zone_id, event_time, occupancy_count,
                date_trunc('hour', event_time, 'UTC') AS bucket_hour
         FROM zone_presence_events
         WHERE event_type = 'count' AND event_time >= $1 AND event_time < $2
           AND zone_id = ANY(ARRAY(SELECT id FROM zones))
       ), agg AS (
         SELECT bucket_hour, zone_id,
                COUNT(*) AS event_count,
                COUNT(occupancy_count) AS sample_count,
                COALESCE(SUM(occupancy_count), 0) AS occupancy_sum,
                MAX(occupancy_count) AS occupancy_peak
         FROM src GROUP BY bucket_hour, zone_id
       ), peak AS (
         SELECT DISTINCT ON (zone_id, bucket_hour) zone_id, bucket_hour, event_time AS peak_at
         FROM src
         ORDER BY zone_id, bucket_hour, occupancy_count DESC NULLS LAST, event_time DESC
       )
       INSERT INTO kpi_zone_hourly
         (bucket_hour, zone_id, event_count, sample_count, occupancy_sum, occupancy_peak, peak_at)
       SELECT a.bucket_hour, a.zone_id, a.event_count, a.sample_count, a.occupancy_sum,
              a.occupancy_peak, p.peak_at
       FROM agg a JOIN peak p USING (zone_id, bucket_hour)`,
      [from, to],
    );
  }
}
