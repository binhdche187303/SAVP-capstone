import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** KPI-001 — biển số khác nhau theo giờ (phục vụ COUNT DISTINCT `unique_vehicles`). */
@Entity('kpi_vehicle_plate_hourly')
export class KpiVehiclePlateHourlyEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'bucket_hour', type: 'timestamptz' })
  bucketHour: Date;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId: string | null;

  @Column({ name: 'vehicle_type', type: 'text', nullable: true })
  vehicleType: string | null;

  @Column({ name: 'plate_number', type: 'text' })
  plateNumber: string;
}
