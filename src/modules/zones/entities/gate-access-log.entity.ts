import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { IoTDeviceEntity } from '../../../modules/iot/entities/iot-device.entity.js';
import { IoTDeviceEventEntity } from '../../../modules/iot/entities/iot-device-event.entity.js';
import { VehicleRegistrationEntity } from '../../../modules/anpr/entities/vehicle-registration.entity.js';
import { ZoneEntity } from './zone.entity.js';

/**
 * GateAccessLogEntity (SAVP Zone scope) — log ra/vào cổng theo zone.
 *
 * Schema-only: KHÔNG logic nghiệp vụ (ingestion, ghép cặp in/out, tính duration = UC sau).
 * - KHÔNG soft-delete: đây là audit log, bản ghi không được xóa mềm.
 * - `paired_log_id` self-FK: bản ghi `in` trỏ tới bản ghi `out` tương ứng (và ngược lại);
 *   `duration_seconds` chỉ có giá trị khi đã ghép cặp.
 * - `plate_number` (normalized) snapshot tại thời điểm qua cổng — giữ được cả khi biển
 *   chưa/không map được về `vehicle_registrations`.
 * - `zone_id` khai ON DELETE RESTRICT ở DB, nhưng ràng buộc này CHỈ kích hoạt với hard-delete
 *   — mà hard-delete bị DATA-01 cấm. Hệ thống xóa zone bằng soft-delete (`UPDATE deleted_at`)
 *   nên hàng `zones` vẫn tồn tại và FK action KHÔNG BAO GIỜ chạy. Việc chặn hay không chặn xóa
 *   zone hoàn toàn do tầng application quyết định: UC-92 chốt **chặn theo THIẾT BỊ đang gán,
 *   KHÔNG chặn theo log** (log chỉ tăng, chặn theo log sẽ khiến zone bất tử).
 */
@Entity('gate_access_logs')
export class GateAccessLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'zone_id', type: 'uuid' })
  zoneId: string;

  @Column({ name: 'device_id', type: 'uuid', nullable: true })
  deviceId: string | null;

  @Column({ name: 'event_id', type: 'uuid', nullable: true })
  eventId: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'vehicle_registration_id', type: 'uuid', nullable: true })
  vehicleRegistrationId: string | null;

  @Column({ name: 'plate_number', type: 'varchar', length: 16, nullable: true })
  plateNumber: string | null;

  @Column({ name: 'direction', type: 'varchar', length: 10 })
  direction: string;

  @Column({ name: 'access_time', type: 'timestamptz' })
  accessTime: Date;

  @Column({ name: 'paired_log_id', type: 'uuid', nullable: true })
  pairedLogId: string | null;

  @Column({ name: 'duration_seconds', type: 'integer', nullable: true })
  durationSeconds: number | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => ZoneEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'zone_id' })
  zone: ZoneEntity;

  @ManyToOne(() => IoTDeviceEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'device_id' })
  device: IoTDeviceEntity | null;

  @ManyToOne(() => IoTDeviceEventEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'event_id' })
  event: IoTDeviceEventEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity | null;

  @ManyToOne(() => VehicleRegistrationEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'vehicle_registration_id' })
  vehicleRegistration: VehicleRegistrationEntity | null;

  @ManyToOne(() => GateAccessLogEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'paired_log_id' })
  pairedLog: GateAccessLogEntity | null;
}
