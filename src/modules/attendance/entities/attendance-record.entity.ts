import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from '../../../modules/meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../../../modules/meetings/entities/meeting-participant.entity.js';

export enum CheckInMethod {
  MANUAL = 'manual',
  DOOR_CAMERA = 'door_camera',
  ROOM_CAMERA = 'room_camera',
  QR = 'qr',
  SYSTEM = 'system',
}

export enum AttendanceSource {
  MANUAL = 'manual',
  CAMERA = 'camera',
  PRESENCE_SNAPSHOT = 'presence_snapshot',
  MIXED = 'mixed',
}

export enum AttendanceRecordStatus {
  PRESENT = 'present',
  ABSENT = 'absent',
  LATE = 'late',
  LEFT_EARLY = 'left_early',
  INVALIDATED = 'invalidated',
  PENDING_REVIEW = 'pending_review',
}

@Entity('attendance_records')
export class AttendanceRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'participant_id', type: 'uuid', nullable: true })
  participantId: string | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    name: 'check_in_method',
    type: 'varchar',
    length: 40,
    default: CheckInMethod.SYSTEM,
  })
  checkInMethod: CheckInMethod;

  @Column({
    name: 'attendance_source',
    type: 'varchar',
    length: 40,
    default: AttendanceSource.MIXED,
  })
  attendanceSource: AttendanceSource;

  @Column({ name: 'check_in_time', type: 'timestamptz', nullable: true })
  checkInTime: Date | null;

  @Column({ name: 'check_out_time', type: 'timestamptz', nullable: true })
  checkOutTime: Date | null;

  @Column({ name: 'first_detected_at', type: 'timestamptz', nullable: true })
  firstDetectedAt: Date | null;

  @Column({ name: 'last_detected_at', type: 'timestamptz', nullable: true })
  lastDetectedAt: Date | null;

  @Column({ name: 'is_present', type: 'boolean', default: false })
  isPresent: boolean;

  @Column({ name: 'is_late', type: 'boolean', default: false })
  isLate: boolean;

  @Column({ name: 'left_early', type: 'boolean', default: false })
  leftEarly: boolean;

  @Column({ name: 'late_minutes', type: 'integer', nullable: true })
  lateMinutes: number | null;

  @Column({
    name: 'presence_duration_minutes',
    type: 'integer',
    nullable: true,
  })
  presenceDurationMinutes: number | null;

  @Column({
    name: 'confidence_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  confidenceScore: number | null;

  @Column({
    name: 'attendance_status',
    type: 'varchar',
    length: 30,
    default: AttendanceRecordStatus.PENDING_REVIEW,
  })
  attendanceStatus: AttendanceRecordStatus;

  @Column({ name: 'verified_by', type: 'uuid', nullable: true })
  verifiedBy: string | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** Hình thức vi phạm thư ký chọn tay (attendance_violation_rules.rule_code); null = suy từ attendance_status. */
  @Column({ name: 'violation_rule_code', type: 'varchar', length: 50, nullable: true })
  violationRuleCode: string | null;

  /** Điểm trừ — DB trigger fn_attendance_penalty chốt lúc ghi nhận; app chỉ đọc. */
  @Column({ name: 'penalty_points', type: 'integer', nullable: true, insert: false, update: false })
  penaltyPoints: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;

  @ManyToOne(() => MeetingParticipantEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'participant_id' })
  participant: MeetingParticipantEntity | null;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'verified_by' })
  verifiedByUser: UserEntity | null;
}
