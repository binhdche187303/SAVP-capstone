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
import { DepartmentEntity } from '../../accounts/entities/department.entity.js';

/**
 * Môn học (ACD-001). Báo cáo chuyên cần theo môn (docx §2.7).
 * `subject_code` partial unique WHERE deleted_at IS NULL (R3). `department_id` → SET NULL (R9).
 */
@Entity('subjects')
export class SubjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subject_code', type: 'varchar', length: 30 })
  subjectCode: string;

  @Column({ name: 'subject_name', type: 'varchar', length: 255 })
  subjectName: string;

  @Column({ type: 'smallint', nullable: true })
  credits: number | null;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => DepartmentEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  department: DepartmentEntity | null;
}
