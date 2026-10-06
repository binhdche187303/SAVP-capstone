import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** KPI-001 — đếm vehicle event theo giờ × zone × loại xe × hướng × trạng thái khớp. */
@Entity('kpi_vehicle_hourly')
export class KpiVehicleHourlyEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'bucket_hour', type: 'timestamptz' })
  bucketHour: Date;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId: string | null;

  @Column({ name: 'vehicle_type', type: 'text', nullable: true })
  vehicleType: string | null;

  @Column({ name: 'direction', type: 'text', nullable: true })
  direction: string | null;

  @Column({ name: 'match_state', type: 'text', nullable: true })
  matchState: string | null;

  @Column({ name: 'event_count', type: 'integer' })
  eventCount: number;

  @Column({ name: 'computed_at', type: 'timestamptz', default: () => 'now()' })
  computedAt: Date;
}
