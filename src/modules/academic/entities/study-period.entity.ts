import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tiết học (UEL): period_no → giờ bắt đầu/kết thúc.
 * Dùng để tính class_sessions.start_time/end_time từ tiet_bat_dau + so_tiet của API Đào tạo.
 */
@Entity('study_periods')
export class StudyPeriodEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'period_no', type: 'smallint', unique: true })
  periodNo: number;

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
}
