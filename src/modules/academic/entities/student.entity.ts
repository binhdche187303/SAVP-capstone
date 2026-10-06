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
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { DepartmentEntity } from '../../accounts/entities/department.entity.js';

export enum StudentStudyStatus {
  STUDYING = 'studying',
  SUSPENDED = 'suspended',
  GRADUATED = 'graduated',
  DROPPED_OUT = 'dropped_out',
}

/**
 * Sinh viên (ACD-001 D3): hồ sơ học vụ 1-1 với `users` (user_id NOT NULL, partial unique)
 * → camera nhận diện user qua face_profiles có sẵn, tra ra sinh viên. KHÔNG sửa UserEntity.
 */
@Entity('students')
export class StudentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'student_code', type: 'varchar', length: 30 })
  studentCode: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cohort: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  major: string | null;

  @Column({
    name: 'administrative_class',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  administrativeClass: string | null;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({
    name: 'study_status',
    type: 'varchar',
    length: 20,
    default: StudentStudyStatus.STUDYING,
  })
  studyStatus: StudentStudyStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @ManyToOne(() => DepartmentEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  department: DepartmentEntity | null;
}
