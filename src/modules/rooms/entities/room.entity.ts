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

export enum RoomType {
  MEETING_ROOM = 'meeting_room',
  TRAINING_ROOM = 'training_room',
  BOARD_ROOM = 'board_room',
  OPEN_SPACE = 'open_space',
}

export enum RoomStatus {
  AVAILABLE = 'available',
  OCCUPIED = 'occupied',
  RESERVED = 'reserved',
  MAINTENANCE = 'maintenance',
  INACTIVE = 'inactive',
}

@Entity('rooms')
export class RoomEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'room_code', type: 'varchar', length: 80 })
  roomCode: string;

  @Column({ name: 'room_name', type: 'varchar', length: 150 })
  roomName: string;

  @Column({ name: 'site_name', type: 'varchar', length: 150, nullable: true })
  siteName: string | null;

  @Column({ name: 'area_name', type: 'varchar', length: 150, nullable: true })
  areaName: string | null;

  @Column({ name: 'location_description', type: 'text', nullable: true })
  locationDescription: string | null;

  @Column({ type: 'integer', default: 0 })
  capacity: number;

  /** ma_day_nha của UEL. */
  @Column({
    name: 'building_code',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  buildingCode: string | null;

  /** ma_co_so của UEL. */
  @Column({ name: 'campus_code', type: 'varchar', length: 50, nullable: true })
  campusCode: string | null;

  @Column({
    name: 'room_type',
    type: 'varchar',
    length: 50,
    default: RoomType.MEETING_ROOM,
  })
  roomType: RoomType;

  @Column({
    name: 'current_status',
    type: 'varchar',
    length: 30,
    default: RoomStatus.AVAILABLE,
  })
  currentStatus: RoomStatus;

  /**
   * Trang thai CHU DONG do admin dat (available/maintenance/inactive), tach
   * bach khoi `currentStatus` (cot do OccupancyPersistenceService ghi tu
   * presence camera, chi flip sang 'occupied', khong bao gio tu reset).
   * Uu tien cao nhat khi RoomSearchService/RoomStatusService tinh trang thai
   * hien thi real-time. Xem migration 20260819000004.
   */
  @Column({
    name: 'administrative_status',
    type: 'varchar',
    length: 20,
    default: RoomStatus.AVAILABLE,
  })
  administrativeStatus: RoomStatus;

  @Column({ name: 'has_camera', type: 'boolean', default: false })
  hasCamera: boolean;

  @Column({ name: 'has_microphone', type: 'boolean', default: false })
  hasMicrophone: boolean;

  @Column({ name: 'has_display', type: 'boolean', default: false })
  hasDisplay: boolean;

  @Column({ name: 'allow_recording', type: 'boolean', default: false })
  allowRecording: boolean;

  @Column({ name: 'layout_json', type: 'jsonb', nullable: true })
  layoutJson: Record<string, unknown> | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Nguồn dữ liệu: 'manual' (nhập tay) | 'uel_api' (đồng bộ API Đào tạo UEL). */
  @Column({ type: 'varchar', length: 20, default: 'manual' })
  source: 'manual' | 'uel_api';

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser: UserEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by' })
  updatedByUser: UserEntity | null;
}
