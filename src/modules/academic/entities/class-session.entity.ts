import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import { ClassSectionEntity } from './class-section.entity.js';
import { StudyShiftEntity } from './study-shift.entity.js';

export enum ClassSessionStatus {
  SCHEDULED = 'scheduled',
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

/**
 * Buổi học (ACD-001 D2) — cầu nối camera → phòng → thời điểm → lớp cho điểm danh (#23).
 * start_time/end_time: snapshot session_date + giờ ca (VN), tính bằng buildSessionTimes() (D5).
 * Unique (lớp, ngày, ca) (R7); unique (phòng, ngày, ca) khi chưa cancelled (R8).
 * Huỷ buổi = status 'cancelled', KHÔNG xoá (D6).
 */
@Entity('class_sessions')
export class ClassSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'class_section_id', type: 'uuid' })
  classSectionId: string;

  @Column({ name: 'session_no', type: 'smallint', nullable: true })
  sessionNo: number | null;

  @Column({ name: 'session_date', type: 'date' })
  sessionDate: string;

  @Column({ name: 'shift_id', type: 'uuid' })
  shiftId: string;

  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @Column({ name: 'start_time', type: 'timestamptz' })
  startTime: Date;

  @Column({ name: 'end_time', type: 'timestamptz' })
  endTime: Date;

  @Column({
    type: 'varchar',
    length: 20,
    default: ClassSessionStatus.SCHEDULED,
  })
  status: ClassSessionStatus;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => ClassSectionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'class_section_id' })
  classSection: ClassSectionEntity;

  @ManyToOne(() => StudyShiftEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shift_id' })
  shift: StudyShiftEntity;

  @ManyToOne(() => RoomEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'room_id' })
  room: RoomEntity;
}
