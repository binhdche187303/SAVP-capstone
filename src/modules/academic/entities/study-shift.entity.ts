import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Ca học — khung giờ cố định, giờ địa phương VN (ACD-001 D4). Seed SLOT1..SLOT6 (R10).
 * `start_time`/`end_time` kiểu `time` → string 'HH:mm:ss'. Giờ thực của 1 buổi học
 * được snapshot vào class_sessions.start_time/end_time (D5) qua buildSessionTimes().
 */
@Entity('study_shifts')
export class StudyShiftEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'shift_code', type: 'varchar', length: 20 })
  shiftCode: string;

  @Column({ name: 'shift_name', type: 'varchar', length: 100 })
  shiftName: string;

  @Column({ name: 'shift_order', type: 'smallint' })
  shiftOrder: number;

  @Column({ name: 'start_time', type: 'time' })
  startTime: string;

  @Column({ name: 'end_time', type: 'time' })
  endTime: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
