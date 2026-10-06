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
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import { SemesterEntity } from './semester.entity.js';
import { SubjectEntity } from './subject.entity.js';

export enum ClassSectionStatus {
  PLANNED = 'planned',
  OPEN = 'open',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
}

/**
 * Lớp học = lớp học phần (ACD-001 D1): môn × học kỳ × mã lớp — đơn vị điểm danh.
 * (semester_id, subject_id, class_code) partial unique (R3) — khoá đồng bộ.
 * lecturer_user_id / default_room_id → SET NULL (R9).
 */
@Entity('class_sections')
export class ClassSectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'class_code', type: 'varchar', length: 50 })
  classCode: string;

  @Column({ name: 'semester_id', type: 'uuid' })
  semesterId: string;

  @Column({ name: 'subject_id', type: 'uuid' })
  subjectId: string;

  @Column({ name: 'lecturer_user_id', type: 'uuid', nullable: true })
  lecturerUserId: string | null;

  @Column({ name: 'default_room_id', type: 'uuid', nullable: true })
  defaultRoomId: string | null;

  @Column({ name: 'max_students', type: 'integer', nullable: true })
  maxStudents: number | null;

  @Column({ type: 'varchar', length: 20, default: ClassSectionStatus.PLANNED })
  status: ClassSectionStatus;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => SemesterEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'semester_id' })
  semester: SemesterEntity;

  @ManyToOne(() => SubjectEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subject_id' })
  subject: SubjectEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'lecturer_user_id' })
  lecturer: UserEntity | null;

  @ManyToOne(() => RoomEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'default_room_id' })
  defaultRoom: RoomEntity | null;
}
