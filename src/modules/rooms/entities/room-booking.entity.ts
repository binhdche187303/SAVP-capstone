import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Exclusion,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from '../../../modules/meetings/entities/meeting.entity.js';
import { RoomEntity } from './room.entity.js';

export enum BookingType {
  SCHEDULED = 'scheduled',
  AD_HOC = 'ad_hoc',
  EXTENSION = 'extension',
  RELOCATED = 'relocated',
}

export enum RoomBookingStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  RELEASED = 'released',
}

@Entity('room_bookings')
// A1 Lớp 2: khai báo để DB_SYNCHRONIZE=true không drop constraint do migration
// 20261005000001 tạo. Vi phạm → 23P01 → QueryFailedFilter trả 409 ROOM_CONFLICT.
@Exclusion(
  'ex_room_bookings_no_overlap',
  `USING gist ("room_id" WITH =, tstzrange("reserved_start_time", "reserved_end_time", '[)') WITH &&) WHERE ("status" IN ('approved', 'active'))`,
)
export class RoomBookingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_code', type: 'varchar', length: 80 })
  bookingCode: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @Column({
    name: 'booking_type',
    type: 'varchar',
    length: 30,
    default: BookingType.SCHEDULED,
  })
  bookingType: BookingType;

  @Column({ name: 'reserved_start_time', type: 'timestamptz' })
  reservedStartTime: Date;

  @Column({ name: 'reserved_end_time', type: 'timestamptz' })
  reservedEndTime: Date;

  @Column({ type: 'varchar', length: 30, default: RoomBookingStatus.PENDING })
  status: RoomBookingStatus;

  @Column({ name: 'booked_by', type: 'uuid' })
  bookedBy: string;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;

  @ManyToOne(() => RoomEntity)
  @JoinColumn({ name: 'room_id' })
  room: RoomEntity;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'booked_by' })
  bookedByUser: UserEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by' })
  approvedByUser: UserEntity | null;
}
