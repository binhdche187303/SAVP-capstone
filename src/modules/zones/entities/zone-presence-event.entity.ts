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
import { ZoneEntity } from './zone.entity.js';

/**
 * ZonePresenceEventEntity (SAVP Zone scope) — sự kiện hiện diện theo zone.
 *
 * Schema-only: KHÔNG logic nghiệp vụ (ingestion từ camera service, đánh giá occupancy = UC sau).
 * - KHÔNG soft-delete: đây là event log.
 * - `event_type` phân loại enter/exit/count... (giữ varchar, không ràng enum ở DB).
 * - `user_id` NULL cho event room-level (chỉ biết có người, không định danh);
 *   chỉ set khi nguồn có định danh (Face Server).
 * - `confidence_score` numeric(5,4): độ tin cậy 0.0000–1.0000 từ nguồn nhận diện.
 * - `zone_id` khai ON DELETE RESTRICT ở DB, nhưng ràng buộc này CHỈ kích hoạt với hard-delete
 *   — mà hard-delete bị DATA-01 cấm. Hệ thống xóa zone bằng soft-delete (`UPDATE deleted_at`)
 *   nên hàng `zones` vẫn tồn tại và FK action KHÔNG BAO GIỜ chạy. Việc chặn hay không chặn xóa
 *   zone hoàn toàn do tầng application quyết định: UC-92 chốt **chặn theo THIẾT BỊ đang gán,
 *   KHÔNG chặn theo event** (event chỉ tăng, chặn theo event sẽ khiến zone bất tử).
 */
@Entity('zone_presence_events')
export class ZonePresenceEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'zone_id', type: 'uuid' })
  zoneId: string;

  @Column({ name: 'device_id', type: 'uuid', nullable: true })
  deviceId: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 20 })
  eventType: string;

  @Column({ name: 'occupancy_count', type: 'integer', nullable: true })
  occupancyCount: number | null;

  @Column({
    name: 'confidence_score',
    type: 'numeric',
    precision: 5,
    scale: 4,
    nullable: true,
  })
  confidenceScore: string | null;

  @Column({ name: 'event_time', type: 'timestamptz' })
  eventTime: Date;

  @Column({ name: 'source_type', type: 'varchar', length: 30, default: 'ivss' })
  sourceType: string;

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

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity | null;
}
