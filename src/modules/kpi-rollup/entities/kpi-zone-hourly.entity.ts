import { Column, Entity, PrimaryColumn } from 'typeorm';

/** KPI-001 — tổng hợp event `count` của zone theo giờ (ghi bởi ZoneHourlyRollupService). */
@Entity('kpi_zone_hourly')
export class KpiZoneHourlyEntity {
  @PrimaryColumn({ name: 'zone_id', type: 'uuid' })
  zoneId: string;

  @PrimaryColumn({ name: 'bucket_hour', type: 'timestamptz' })
  bucketHour: Date;

  @Column({ name: 'event_count', type: 'integer' })
  eventCount: number;

  @Column({ name: 'sample_count', type: 'integer' })
  sampleCount: number;

  @Column({ name: 'occupancy_sum', type: 'bigint' })
  occupancySum: string;

  @Column({ name: 'occupancy_peak', type: 'integer', nullable: true })
  occupancyPeak: number | null;

  @Column({ name: 'peak_at', type: 'timestamptz' })
  peakAt: Date;

  @Column({ name: 'computed_at', type: 'timestamptz', default: () => 'now()' })
  computedAt: Date;
}
