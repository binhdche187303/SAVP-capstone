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
import { MeetingEntity } from './meeting.entity.js';

export enum ParticipantRole {
  HOST = 'host',
  ATTENDEE = 'attendee',
  APPROVER = 'approver',
  NOTE_TAKER = 'note_taker',
}

export enum InvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  TENTATIVE = 'tentative',
}

export enum ParticipantAttendanceStatus {
  NOT_CHECKED_IN = 'not_checked_in',
  PRESENT = 'present',
  ABSENT = 'absent',
  LATE = 'late',
  LEFT_EARLY = 'left_early',
}

@Entity('meeting_participants')
export class MeetingParticipantEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    name: 'participant_role',
    type: 'varchar',
    length: 40,
    default: ParticipantRole.ATTENDEE,
  })
  participantRole: ParticipantRole;

  @Column({ name: 'is_required', type: 'boolean', default: true })
  isRequired: boolean;

  @Column({ name: 'attendance_required', type: 'boolean', default: true })
  attendanceRequired: boolean;

  @Column({
    name: 'invitation_status',
    type: 'varchar',
    length: 30,
    default: InvitationStatus.PENDING,
  })
  invitationStatus: InvitationStatus;

  @Column({ name: 'response_at', type: 'timestamptz', nullable: true })
  responseAt: Date | null;

  @Column({
    name: 'attendance_status',
    type: 'varchar',
    length: 30,
    default: ParticipantAttendanceStatus.NOT_CHECKED_IN,
  })
  attendanceStatus: ParticipantAttendanceStatus;

  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
  joinedAt: Date | null;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt: Date | null;

  @Column({ name: 'invited_by', type: 'uuid', nullable: true })
  invitedBy: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Lý do vắng / đi trễ / về sớm do thành viên tự nhập (1 lần / cuộc họp). */
  @Column({ name: 'excuse_reason', type: 'text', nullable: true })
  excuseReason: string | null;

  /** pending | approved | rejected — chủ trì / thư ký duyệt. */
  @Column({ name: 'excuse_status', type: 'varchar', length: 20, nullable: true })
  excuseStatus: 'pending' | 'approved' | 'rejected' | null;

  @Column({ name: 'excuse_submitted_at', type: 'timestamptz', nullable: true })
  excuseSubmittedAt: Date | null;

  @Column({ name: 'excuse_reviewed_by', type: 'uuid', nullable: true })
  excuseReviewedBy: string | null;

  @Column({ name: 'excuse_reviewed_at', type: 'timestamptz', nullable: true })
  excuseReviewedAt: Date | null;

  @Column({ name: 'excuse_review_note', type: 'text', nullable: true })
  excuseReviewNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invited_by' })
  invitedByUser: UserEntity | null;
}
