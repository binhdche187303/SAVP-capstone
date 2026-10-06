import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ClassSectionEntity } from './class-section.entity.js';
import { StudentEntity } from './student.entity.js';

export enum ClassEnrollmentStatus {
  ACTIVE = 'active',
  DROPPED = 'dropped',
}

/**
 * Danh sách lớp (ACD-001). Unique (class_section_id, student_id) (R6).
 * Rút lớp = status 'dropped', KHÔNG xoá — giữ lịch sử chuyên cần (D6, tiền lệ ADR-008).
 */
@Entity('class_enrollments')
export class ClassEnrollmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'class_section_id', type: 'uuid' })
  classSectionId: string;

  @Column({ name: 'student_id', type: 'uuid' })
  studentId: string;

  @Column({ name: 'enrolled_at', type: 'timestamptz', default: () => 'now()' })
  enrolledAt: Date;

  @Column({
    type: 'varchar',
    length: 20,
    default: ClassEnrollmentStatus.ACTIVE,
  })
  status: ClassEnrollmentStatus;

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

  @ManyToOne(() => StudentEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'student_id' })
  student: StudentEntity;
}
