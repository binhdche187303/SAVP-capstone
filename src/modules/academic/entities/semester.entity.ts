import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum SemesterStatus {
  UPCOMING = 'upcoming',
  ONGOING = 'ongoing',
  CLOSED = 'closed',
}

/**
 * Học kỳ (ACD-001). Báo cáo chuyên cần theo học kỳ (docx §2.7).
 * `semester_code` partial unique WHERE deleted_at IS NULL (R3) — khoá đồng bộ hệ thống đào tạo.
 * `start_date`/`end_date` kiểu `date` → string 'YYYY-MM-DD' (tránh lệch múi giờ).
 */
@Entity('semesters')
export class SemesterEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'semester_code', type: 'varchar', length: 30 })
  semesterCode: string;

  @Column({ name: 'semester_name', type: 'varchar', length: 150 })
  semesterName: string;

  @Column({
    name: 'academic_year',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  academicYear: string | null;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate: string | null;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null;

  @Column({ type: 'varchar', length: 20, default: SemesterStatus.UPCOMING })
  status: SemesterStatus;

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
}
