import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';

/**
 * VehicleRegistrationEntity (VRS-001 / Setup-0 ANPR) — biển số ↔ user (1 user → nhiều biển).
 *
 * Nền dữ liệu mini-epic ANPR (UC1–UC7). Schema-only: KHÔNG logic nghiệp vụ (normalize/resolve = UC sau).
 * - `plate_number` (normalized) là cột TRAP: partial unique WHERE deleted_at IS NULL (xem migration)
 *   → chặn trùng biển ĐANG SỐNG, vẫn cho đăng ký lại sau soft-delete.
 * - `plate_raw` giữ biển gốc user nhập (hiển thị).
 * - Soft-delete (`deleted_at`) mirror pattern face (device-user-mapping).
 */
@Entity('vehicle_registrations')
export class VehicleRegistrationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'plate_number', type: 'varchar', length: 16 })
  plateNumber: string;

  @Column({ name: 'plate_raw', type: 'varchar', length: 20 })
  plateRaw: string;

  @Column({ name: 'vehicle_type', type: 'varchar', length: 50, nullable: true })
  vehicleType: string | null;

  @Column({ name: 'note', type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @Column({ name: 'status', type: 'varchar', length: 30, default: 'active' })
  status: string;

  // Đồng bộ sang HGVision (migration 20261119000001). NULL = chưa từng đồng bộ.
  @Column({
    name: 'hgvision_sync_status',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  hgvisionSyncStatus: string | null;

  @Column({ name: 'hgvision_synced_at', type: 'timestamptz', nullable: true })
  hgvisionSyncedAt: Date | null;

  @Column({
    name: 'hgvision_sync_error',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  hgvisionSyncError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;
}
