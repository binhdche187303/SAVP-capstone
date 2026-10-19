import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotificationEntity } from './entities/notification.entity.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationWorkerService } from './notification-worker.service.js';
import { MeetingNotificationsService } from './services/meeting-notifications.service.js';
import { MeetingReminderDispatchService } from './services/meeting-reminder-dispatch.service.js';
import { NotificationReadStateService } from './services/notification-read-state.service.js';
import { NotificationsController } from './notifications.controller.js';
import { BackgroundJobEntity } from '../administration/entities/background-job.entity.js';
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../meetings/entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../meetings/entities/meeting-external-participant.entity.js';
import { MeetingAgendaEntity } from '../meetings/entities/meeting-agenda.entity.js';
import { MeetingMinutesEntity } from '../minutes/entities/meeting-minutes.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import { MediaFileEntity } from '../recording/entities/media-file.entity.js';
import { TranscriptEntity } from '../transcription/entities/transcript.entity.js';
import { AuthModule } from '../auth/auth.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';

/**
 * NotificationsModule — Module quản lý notifications.
 *
 * Gồm:
 * - NotificationsService: service gốc (create/enqueue/lifecycle + inbox list/detail)
 * - NotificationWorkerService: BullMQ worker xử lý send-email
 * - MeetingNotificationsService: service cho UC-143..146 (invite/reminder/cancel/distribute)
 * - NotificationReadStateService (BE-07): trạng thái đã đọc theo user, lưu ở Redis
 * - NotificationsController: REST endpoints cho cả meeting notifications và inbox
 *
 * [Đính chính 2026-07-27, BE-07] Bảng `notifications` KHÔNG có cột đã đọc theo user
 * (Product Owner từ chối bảng `notification_reads`, 2026-07-18) — NHƯNG trạng thái đã đọc
 * NAY ĐƯỢC theo dõi ở Redis qua NotificationReadStateService, không phải "không tracking"
 * như ghi chú cũ. Xem spec/features/notifications/feat-notification-inbox/spec.md.
 * RedisService là @Global() (RedisModule) nên không cần import RedisModule ở đây.
 *
 * KHÔNG import MeetingsModule/AccountsModule/MinutesModule (tránh circular —
 * MeetingsModule tự import NotificationsModule). Chỉ inject entity trực tiếp
 * qua TypeOrmModule.forFeature, không bao giờ import cả module đó.
 * Đa số entity ở đây chỉ đọc; ngoại lệ: MediaFileEntity/MeetingMinutesEntity
 * được ghi bởi getOrCreateMinutesPdfAttachment() (MeetingNotificationsService)
 * để tự render+lưu PDF biên bản khi gửi đính kèm cho khách ngoài (distributeMeetingMinutes),
 * tránh phải import MinutesModule chỉ để tái dùng MinutesExportService.
 *
 * CÓ import AuthModule: NotificationsController dùng JwtAuthGuard/PermissionsGuard
 * (cần JwtService/AuthConfigService), và MeetingNotificationsService dùng
 * AuthzReadRepository (export từ AuthModule). AuthModule không import ngược lại
 * NotificationsModule/AccountsModule nên không có circular dependency.
 *
 * [Sửa 2026-08-21] CÓ import WebsocketModule: createNotification() đẩy realtime
 * qua WebsocketService.emitToUser() ngay sau khi lưu DB, để chuông thông báo FE
 * không cần load lại trang. WebsocketModule không import lại NotificationsModule.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      NotificationEntity,
      BackgroundJobEntity,
      MeetingEntity,
      MeetingParticipantEntity,
      MeetingExternalParticipantEntity,
      MeetingAgendaEntity,
      MeetingMinutesEntity,
      UserEntity,
      MediaFileEntity,
      TranscriptEntity,
    ]),
    AuthModule,
    WebsocketModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationWorkerService,
    MeetingNotificationsService,
    MeetingReminderDispatchService,
    NotificationReadStateService,
  ],
  // MeetingReminderDispatchService: cron notification-reminder (SchedulerModule) gọi.
  exports: [
    TypeOrmModule,
    NotificationsService,
    MeetingReminderDispatchService,
  ],
})
export class NotificationsModule {}
