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
 * VehicleControlListEntity (SAVP Zone scope) — allowlist/blocklist biển số.
 *
 * Schema-only: KHÔNG logic nghiệp vụ (CRUD, kiểm tra khi xe qua cổng = UC sau).
 * - `plate_number` (normalized) + `list_type` là cặp TRAP: partial unique WHERE
 *   deleted_at IS NULL (xem migration 20260721000006) → một biển chỉ nằm 1 lần trong
 *   mỗi loại danh sách ĐANG SỐNG, vẫn cho thêm lại sau soft-delete.
 * - `plate_raw` giữ biển gốc admin nhập (hiển thị).
 * - `active` tách khỏi soft-delete: tạm tắt kiểm soát mà không xoá bản ghi/lý do.
 * - Soft-delete (`deleted_at`) mirror pattern `vehicle_registrations`.
 */
@Entity('vehicle_control_list')
export class VehicleControlListEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'plate_number', type: 'varchar', length: 16 })
  plateNumber: string;

  @Column({ name: 'plate_raw', type: 'varchar', length: 20, nullable: true })
  plateRaw: string | null;

  @Column({
    name: 'list_type',
    type: 'varchar',
    length: 20,
    default: 'blocklist',
  })
  listType: string;

  // Loại phương tiện tùy chọn (car/motorbike/truck/bus/other) — chỉ mô tả/lọc.
  @Column({ name: 'vehicle_type', type: 'varchar', length: 20, nullable: true })
  vehicleType: string | null;

  @Column({ name: 'reason', type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser: UserEntity | null;
}
