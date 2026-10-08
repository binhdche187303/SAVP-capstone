import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';

export enum NotificationType {
  MEETING_INVITE = 'meeting_invite',
  REMINDER = 'reminder',
  CANCELLATION = 'cancellation',
  NO_SHOW_ALERT = 'no_show_alert',
  ROOM_EARLY_VACANCY = 'room_early_vacancy',
  UNKNOWN_FACE_ALERT = 'unknown_face_alert',
  MINUTES_DISTRIBUTION = 'minutes_distribution',
  MEETING_REQUEST_CREATED = 'meeting_request_created',
  MEETING_REQUEST_APPROVED = 'meeting_request_approved',
  MEETING_REQUEST_REJECTED = 'meeting_request_rejected',
  MEETING_TIME_UPDATED = 'meeting_time_updated',
  MEETING_ROOM_UPDATED = 'meeting_room_updated',
  MEETING_PARTICIPANT_REMOVED = 'meeting_participant_removed',
  LATE_CHECKIN_ALERT = 'late_checkin_alert',
  LATE_CHECKIN_HOST_SUMMARY = 'late_checkin_host_summary',
  ACCOUNT_WELCOME = 'account_welcome',
  MEETING_TIME_WARNING = 'meeting_time_warning',
  MEETING_TIME_CONFLICT_WARNING = 'meeting_time_conflict_warning',
  // [SỬA 2026-07-29] Đổi từ AVATAR_REJECTED — luồng bị từ chối là sinh trắc học, không
  // phải avatar hiển thị. Xem spec/features/account/feat-split-avatar-and-biometric/plan.md.
  BIOMETRIC_REJECTED = 'biometric_rejected',
  // T029: transcript (draft) đã sẵn sàng cho Host review.
  TRANSCRIPT_READY = 'transcript_ready',
  MINUTES_DELETED_BY_ADMIN = 'minutes_deleted_by_admin',
  // UC-ROOM-03: phong hop cua cuoc hop da bi xoa, can chon lai dia diem.
  MEETING_ROOM_REMOVED = 'meeting_room_removed',
  // Gap fix (Nhóm A): nhắc participant upload audio track sau khi meeting
  // completed, chỉ khi recording_configs bật channel_by_zone STT.
  AUDIO_TRACK_UPLOAD_REQUESTED = 'audio_track_upload_requested',
  // UC9 (VCC-001): bien so khop vehicle_control_list (blocklist/watchlist) khi qua cong.
  VEHICLE_CONTROL_LIST_MATCH = 'vehicle_control_list_match',
  // UC-108: unknown vehicle alert
  UNKNOWN_VEHICLE_ALERT = 'unknown_vehicle_alert',
  // UC-108: unauthorized vehicle (pending/rejected registration)
  VEHICLE_UNAUTHORIZED_ALERT = 'vehicle_unauthorized_alert',
  // UC-125 (PWL-001): nguoi khop person_control_list (watchlist/blocklist) khi nhan dien.
  PERSON_WATCHLIST_MATCH = 'person_watchlist_match',
  // EQUIP-FAULT-LIFECYCLE-001
  EQUIPMENT_FAULT_REPORTED = 'equipment_fault_reported',
  EQUIPMENT_FAULT_CONFIRMED = 'equipment_fault_confirmed',
  EQUIPMENT_FAULT_RESOLVED = 'equipment_fault_resolved',
  // BAO_CAO 2026-08-23: cau hinh phong (has_camera/has_microphone/has_display)
  // bi tat trong khi thiet bi loai do van dang gan phong -> he thong tu go va
  // bao BUSINESS_ADMIN.
  EQUIPMENT_AUTO_UNASSIGNED = 'equipment_auto_unassigned',
  // Camera IP chuyen online -> offline (cron device-offline-detect) -> bao SA/BA.
  DEVICE_OFFLINE_ALERT = 'device_offline_alert',
  // Canh bao an ninh moi (security_alerts, recordAlert isNew) -> bao nguoi co quyen
  // security_alert.read (SecurityAlertNotifierService).
  SECURITY_ALERT = 'security_alert',
}

export enum NotificationChannel {
  EMAIL = 'email',
  IN_APP = 'in_app',
  WEBSOCKET = 'websocket',
  SMS = 'sms',
}

export enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum NotificationDeliveryStatus {
  DRAFT = 'draft',
  QUEUED = 'queued',
  SENT = 'sent',
  PARTIAL_FAILED = 'partial_failed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity('notifications')
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'notification_code',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  notificationCode: string | null;

  @Column({ name: 'notification_type', type: 'varchar', length: 60 })
  notificationType: NotificationType;

  @Column({ type: 'varchar', length: 30 })
  channel: NotificationChannel;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subject: string | null;

  @Column({ type: 'text' })
  content: string;

  @Column({
    name: 'related_entity_type',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  relatedEntityType: string | null;

  @Column({ name: 'related_entity_id', type: 'uuid', nullable: true })
  relatedEntityId: string | null;

  @Column({
    name: 'recipient_scope',
    type: 'varchar',
    length: 40,
    default: 'user_list',
  })
  recipientScope: string;

  @Column({ name: 'recipient_user_ids_json', type: 'jsonb', nullable: true })
  recipientUserIdsJson: string[] | null;

  @Column({ name: 'recipient_emails_json', type: 'jsonb', nullable: true })
  recipientEmailsJson: string[] | null;

  @Column({ name: 'recipient_phones_json', type: 'jsonb', nullable: true })
  recipientPhonesJson: string[] | null;

  @Column({ type: 'varchar', length: 20, default: NotificationPriority.NORMAL })
  priority: NotificationPriority;

  @Column({ name: 'scheduled_send_at', type: 'timestamptz', nullable: true })
  scheduledSendAt: Date | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({
    name: 'delivery_status',
    type: 'varchar',
    length: 30,
    default: NotificationDeliveryStatus.DRAFT,
  })
  deliveryStatus: NotificationDeliveryStatus;

  @Column({ name: 'read_count', type: 'integer', default: 0 })
  readCount: number;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number;

  @Column({ name: 'sent_by', type: 'uuid', nullable: true })
  sentBy: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'payload_json', type: 'jsonb', nullable: true })
  payloadJson: Record<string, unknown> | null;

  @Column({ name: 'delivery_result_json', type: 'jsonb', nullable: true })
  deliveryResultJson: Record<string, unknown> | null;

  // Relations
  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sent_by' })
  sentByUser: UserEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser: UserEntity | null;
}
