import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationType,
} from '../entities/notification.entity.js';
import { NotificationsService } from '../notifications.service.js';
import { buildMeetingReminderContent } from './meeting-reminder-dispatch.service.js';
import {
  buildMeetingInviteEmail,
  buildMeetingReminderEmail,
  buildMeetingCancelledEmail,
  buildMinutesPublishedEmail,
  buildMinutesPublishedGuestEmail,
} from '../../mail/templates/builders.js';
import { formatDateTimeVN } from '../../mail/templates/layout.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { StorageService } from '../../storage/storage.service.js';
import {
  MediaFileEntity,
  MediaFileType,
  MediaVisibilityLevel,
  StorageProvider,
} from '../../recording/entities/media-file.entity.js';
import { TranscriptEntity } from '../../transcription/entities/transcript.entity.js';
import { renderMeetingMinutesPdf } from '../../minutes/renderers/meeting-minutes-pdf-renderer.js';
import {
  MinutesExportData,
  normalizeMinutesJsonList,
} from '../../minutes/renderers/meeting-minutes-export-data.js';
import { slugifyFileNamePart } from '../../../common/utils/filename.util.js';

import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../../meetings/entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity.js';
import { MeetingAgendaEntity } from '../../meetings/entities/meeting-agenda.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
} from '../../minutes/entities/meeting-minutes.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';

import { SendMeetingInvitationDto } from '../dto/send-meeting-invitation.dto.js';
import { SendMeetingReminderDto } from '../dto/send-meeting-reminder.dto.js';
import { ResendCancellationNotificationDto } from '../dto/resend-cancellation-notification.dto.js';
import { DistributeMeetingMinutesDto } from '../dto/distribute-meeting-minutes.dto.js';

interface AuthUser {
  userId: string;
}

/**
 * MeetingNotificationsService — Service cho nhóm UC-143..146:
 * gửi invitation, reminder, cancellation notification, distribute minutes.
 *
 * KHÔNG import MeetingsModule để tránh circular dependency.
 * Chỉ inject repository đọc các entity cần thiết.
 */
@Injectable()
export class MeetingNotificationsService {
  private readonly logger = new Logger(MeetingNotificationsService.name);

  constructor(
    @InjectRepository(MeetingEntity)
    private readonly meetingRepo: Repository<MeetingEntity>,
    @InjectRepository(MeetingParticipantEntity)
    private readonly participantRepo: Repository<MeetingParticipantEntity>,
    @InjectRepository(MeetingExternalParticipantEntity)
    private readonly externalParticipantRepo: Repository<MeetingExternalParticipantEntity>,
    @InjectRepository(MeetingAgendaEntity)
    private readonly agendaRepo: Repository<MeetingAgendaEntity>,
    @InjectRepository(MeetingMinutesEntity)
    private readonly minutesRepo: Repository<MeetingMinutesEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(MediaFileEntity)
    private readonly mediaFileRepo: Repository<MediaFileEntity>,
    @InjectRepository(TranscriptEntity)
    private readonly transcriptRepo: Repository<TranscriptEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly authzReadRepo: AuthzReadRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  // ──────────────────────────────────────────────
  //  UC-143: Send / Resend Meeting Invitation
  // ──────────────────────────────────────────────
  async sendMeetingInvitation(
    meetingId: string,
    authUser: AuthUser,
    dto: SendMeetingInvitationDto,
  ): Promise<{
    notificationId: string;
    deliveryStatus: string;
    queuedRecipientCount: number;
    skippedRecipientCount: number;
  }> {
    const meeting = await this.findMeetingOrThrow(meetingId);
    await this.ensureOwnershipOrAdmin(meeting, authUser);
    this.ensureNotCancelled(meeting);

    const { internalParticipants, externalParticipants } =
      await this.loadParticipants(meetingId);
    const content = await this.buildInvitationContent(meeting, dto);
    const userIds = this.dedupIds([
      ...internalParticipants.map((p) => p.userId),
      meeting.organizerId,
      ...(meeting.hostId ? [meeting.hostId] : []),
    ]);

    let notificationId: string | undefined;
    let deliveryStatus: string = NotificationDeliveryStatus.DRAFT;
    let queued = 0;
    let skipped = 0;

    if (dto.channels.includes('in_app')) {
      const n = await this.notificationsService.createNotification({
        notificationType: NotificationType.MEETING_INVITE,
        channel: NotificationChannel.IN_APP,
        subject: 'Thư mời họp: ' + meeting.title,
        content,
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId,
        recipientUserIds: userIds,
        createdBy: authUser.userId,
        payloadJson: { meetingTitle: meeting.title, channels: dto.channels },
      });
      notificationId = n.id;
      deliveryStatus = n.deliveryStatus;
      queued += userIds.length;
    }

    if (dto.channels.includes('email')) {
      const emails: string[] = [];
      for (const p of internalParticipants) {
        const user = await this.userRepo.findOne({ where: { id: p.userId } });
        if (user?.email) emails.push(user.email);
        else skipped++;
      }
      for (const ep of externalParticipants) {
        if (ep.email) emails.push(ep.email);
      }
      if (emails.length > 0) {
        let agendaItems: string[] | undefined;
        if (dto.includeAgenda) {
          const agendas = await this.agendaRepo.find({
            where: { meetingId: meeting.id },
            order: { agendaOrder: 'ASC' },
          });
          agendaItems = agendas.map((a) => a.title);
        }
        const result = await this.notificationsService.enqueueEmailNotification(
          {
            notificationType: NotificationType.MEETING_INVITE,
            channel: NotificationChannel.EMAIL,
            subject: 'Thư mời họp: ' + meeting.title,
            content,
            emailHtml: buildMeetingInviteEmail({
              meetingTitle: meeting.title,
              startTime: meeting.startTime,
              endTime: meeting.endTime,
              message: dto.message,
              agendaItems,
            }),
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            toEmails: emails,
            createdBy: authUser.userId,
          },
        );
        if (!notificationId) {
          notificationId = result.notification.id;
          deliveryStatus = result.notification.deliveryStatus;
        }
        queued += emails.length;
      }
    }

    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_invitation_sent',
      entityType: 'meeting',
      entityId: meetingId,
      metadataJson: {
        queuedRecipientCount: queued,
        skippedRecipientCount: skipped,
        channels: dto.channels,
      },
    });

    this.logger.log(
      '[MeetingNotifications] Invitation sent — meeting=' +
        meetingId +
        ', queued=' +
        queued +
        ', skipped=' +
        skipped,
    );
    return {
      notificationId: notificationId ?? '',
      deliveryStatus,
      queuedRecipientCount: queued,
      skippedRecipientCount: skipped,
    };
  }

  // ──────────────────────────────────────────────
  //  UC-144: Send Meeting Reminder
  // ──────────────────────────────────────────────
  async sendMeetingReminder(
    meetingId: string,
    authUser: AuthUser,
    dto: SendMeetingReminderDto,
  ): Promise<{
    notificationId: string;
    deliveryStatus: string;
    scheduledSendAt: string | null;
  }> {
    const meeting = await this.findMeetingOrThrow(meetingId);
    await this.ensureOwnershipOrAdmin(meeting, authUser);
    this.ensureMeetingIsUpcoming(meeting);

    const { internalParticipants, externalParticipants } =
      await this.loadParticipants(meetingId);
    const content = this.buildReminderContent(meeting);

    if (dto.reminderType === 'scheduled') {
      if (!dto.sendAt) {
        throw new BadRequestException({
          success: false,
          message: 'sendAt is required when reminderType=scheduled',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
      const sendAtDate = new Date(dto.sendAt);
      if (isNaN(sendAtDate.getTime()) || sendAtDate <= new Date()) {
        throw new BadRequestException({
          success: false,
          message: 'sendAt must be a future datetime',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
      if (sendAtDate >= new Date(meeting.startTime)) {
        throw new ConflictException({
          success: false,
          message: 'sendAt must be before meeting start time',
          error: { code: 'REMINDER_AFTER_MEETING_START', details: {} },
        });
      }

      // Tạo 1 row draft/scheduled cho MỖI channel được yêu cầu (không hardcode IN_APP) —
      // MeetingReminderDispatchService (cron notification-reminder) đọc đúng channel của
      // từng row khi tới hạn sendAt.
      let notificationId: string | undefined;
      let deliveryStatus: string = NotificationDeliveryStatus.DRAFT;
      const recipientUserIds = internalParticipants.map((p) => p.userId);

      for (const channel of dto.channels) {
        const n = await this.notificationsService.createNotification({
          notificationType: NotificationType.REMINDER,
          channel:
            channel === 'email'
              ? NotificationChannel.EMAIL
              : NotificationChannel.IN_APP,
          subject: 'Nhắc lịch họp: ' + meeting.title,
          content,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientUserIds,
          scheduledSendAt: sendAtDate,
          createdBy: authUser.userId,
          payloadJson: {
            reminderType: 'scheduled',
            meetingTitle: meeting.title,
          },
        });
        if (!notificationId) {
          notificationId = n.id;
          deliveryStatus = n.deliveryStatus;
        }
      }

      await this.auditLogsService.logAction({
        userId: authUser.userId,
        actionType: 'meeting_reminder_scheduled',
        entityType: 'meeting',
        entityId: meetingId,
        metadataJson: {
          reminderType: 'scheduled',
          sendAt: dto.sendAt,
          channels: dto.channels,
        },
      });

      return {
        notificationId: notificationId ?? '',
        deliveryStatus,
        scheduledSendAt: dto.sendAt,
      };
    }

    // manual — send immediately
    const userIds = this.dedupIds([
      ...internalParticipants.map((p) => p.userId),
      meeting.organizerId,
      ...(meeting.hostId ? [meeting.hostId] : []),
    ]);

    let notificationId: string | undefined;
    let deliveryStatus: string = NotificationDeliveryStatus.DRAFT;

    if (dto.channels.includes('in_app')) {
      const n = await this.notificationsService.createNotification({
        notificationType: NotificationType.REMINDER,
        channel: NotificationChannel.IN_APP,
        subject: 'Nhắc lịch họp: ' + meeting.title,
        content,
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId,
        recipientUserIds: userIds,
        createdBy: authUser.userId,
        payloadJson: { reminderType: 'manual' },
      });
      notificationId = n.id;
      deliveryStatus = n.deliveryStatus;
    }

    if (dto.channels.includes('email')) {
      const emails: string[] = [];
      for (const p of internalParticipants) {
        const user = await this.userRepo.findOne({ where: { id: p.userId } });
        if (user?.email) emails.push(user.email);
      }
      for (const ep of externalParticipants) {
        if (ep.email) emails.push(ep.email);
      }
      if (emails.length > 0) {
        const result = await this.notificationsService.enqueueEmailNotification(
          {
            notificationType: NotificationType.REMINDER,
            channel: NotificationChannel.EMAIL,
            subject: 'Nhắc lịch họp: ' + meeting.title,
            content,
            emailHtml: buildMeetingReminderEmail({
              meetingTitle: meeting.title,
              startTime: meeting.startTime,
            }),
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            toEmails: emails,
            createdBy: authUser.userId,
          },
        );
        if (!notificationId) {
          notificationId = result.notification.id;
          deliveryStatus = result.notification.deliveryStatus;
        }
      }
    }

    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_reminder_sent',
      entityType: 'meeting',
      entityId: meetingId,
      metadataJson: { reminderType: 'manual', channels: dto.channels },
    });

    this.logger.log(
      '[MeetingNotifications] Reminder sent — meeting=' +
        meetingId +
        ', type=manual',
    );
    return {
      notificationId: notificationId ?? '',
      deliveryStatus,
      scheduledSendAt: null,
    };
  }

  // ──────────────────────────────────────────────
  //  UC-145: Resend Cancellation Notification
  // ──────────────────────────────────────────────
  async resendCancellationNotification(
    meetingId: string,
    authUser: AuthUser,
    dto: ResendCancellationNotificationDto,
  ): Promise<{
    meetingId: string;
    notificationId: string;
    queuedRecipientCount: number;
  }> {
    const meeting = await this.findMeetingOrThrow(meetingId);
    await this.ensureOwnershipOrAdmin(meeting, authUser);

    if (meeting.status !== MeetingStatus.CANCELLED) {
      throw new ConflictException({
        success: false,
        message: 'Meeting is not cancelled',
        error: { code: 'MEETING_NOT_CANCELLED', details: {} },
      });
    }

    const { internalParticipants, externalParticipants } =
      await this.loadParticipants(meetingId);
    const reason = dto.reason ?? meeting.cancellationReason ?? 'Không có lý do';
    const content = this.buildCancellationContent(meeting, reason);

    const userIds = this.dedupIds([
      ...internalParticipants.map((p) => p.userId),
      meeting.organizerId,
      ...(meeting.hostId ? [meeting.hostId] : []),
    ]);

    let notificationId: string | undefined;
    let queued = 0;

    if (dto.channels.includes('in_app')) {
      const n = await this.notificationsService.createNotification({
        notificationType: NotificationType.CANCELLATION,
        channel: NotificationChannel.IN_APP,
        subject: 'Hủy cuộc họp: ' + meeting.title,
        content,
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId,
        recipientUserIds: userIds,
        createdBy: authUser.userId,
      });
      notificationId = n.id;
      queued += userIds.length;
    }

    if (dto.channels.includes('email')) {
      const emails: string[] = [];
      for (const p of internalParticipants) {
        const user = await this.userRepo.findOne({ where: { id: p.userId } });
        if (user?.email) emails.push(user.email);
      }
      for (const ep of externalParticipants) {
        if (ep.email) emails.push(ep.email);
      }
      if (emails.length > 0) {
        const result = await this.notificationsService.enqueueEmailNotification(
          {
            notificationType: NotificationType.CANCELLATION,
            channel: NotificationChannel.EMAIL,
            subject: 'Hủy cuộc họp: ' + meeting.title,
            content,
            emailHtml: buildMeetingCancelledEmail({
              meetingTitle: meeting.title,
              reason,
            }),
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            toEmails: emails,
            createdBy: authUser.userId,
          },
        );
        if (!notificationId) {
          notificationId = result.notification.id;
        }
        queued += emails.length;
      }
    }

    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_cancellation_notification_resent',
      entityType: 'meeting',
      entityId: meetingId,
      metadataJson: {
        queuedRecipientCount: queued,
        reason,
        channels: dto.channels,
      },
    });

    this.logger.log(
      '[MeetingNotifications] Cancellation resent — meeting=' +
        meetingId +
        ', queued=' +
        queued,
    );
    return {
      meetingId,
      notificationId: notificationId ?? '',
      queuedRecipientCount: queued,
    };
  }

  // ──────────────────────────────────────────────
  //  UC-146: Distribute Meeting Minutes
  // ──────────────────────────────────────────────
  async distributeMeetingMinutes(
    meetingId: string,
    authUser: AuthUser,
    dto: DistributeMeetingMinutesDto,
  ): Promise<{
    notificationId: string;
    queuedRecipientCount: number;
    minutesId: string;
  }> {
    const meeting = await this.findMeetingOrThrow(meetingId);
    const minutes = await this.minutesRepo.findOne({
      where: { id: dto.minutesId, meetingId },
    });
    if (!minutes || minutes.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Meeting minutes not found or does not belong to this meeting',
        error: { code: 'MINUTES_NOT_FOUND', details: {} },
      });
    }
    await this.ensureMinutesOwnerOrAdmin(meeting, minutes, authUser);
    if (minutes.status !== MeetingMinutesStatus.PUBLISHED) {
      throw new ConflictException({
        success: false,
        message: 'Minutes must be published to distribute',
        error: { code: 'MINUTES_NOT_PUBLISHED', details: {} },
      });
    }

    let queued = 0;
    let skipped = 0;
    let userIds: string[] = [];
    let internalParticipants: MeetingParticipantEntity[] = [];
    let externalParticipants: MeetingExternalParticipantEntity[] = [];

    if (dto.recipientScope === 'participants') {
      const participants = await this.loadParticipants(meetingId);
      internalParticipants = participants.internalParticipants;
      externalParticipants = participants.externalParticipants;
      userIds = internalParticipants.map((p) => p.userId);
    } else {
      // custom
      if (!dto.recipientUserIds || dto.recipientUserIds.length === 0) {
        throw new BadRequestException({
          success: false,
          message: 'recipientUserIds is required when recipientScope=custom',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
      userIds = dto.recipientUserIds;
    }

    const content = this.buildMinutesDistributionContent(
      meeting,
      minutes,
      dto.message,
    );

    let notificationId: string | undefined;

    if (dto.channels.includes('in_app')) {
      const validUserIds: string[] = [];
      for (const uid of userIds) {
        const user = await this.userRepo.findOne({ where: { id: uid } });
        if (user) validUserIds.push(uid);
        else skipped++;
      }
      if (validUserIds.length > 0) {
        const n = await this.notificationsService.createNotification({
          notificationType: NotificationType.MINUTES_DISTRIBUTION,
          channel: NotificationChannel.IN_APP,
          subject: 'Biên bản họp đã được ban hành: ' + meeting.title,
          content,
          relatedEntityType: 'meeting_minutes',
          relatedEntityId: minutes.id,
          recipientUserIds: validUserIds,
          createdBy: authUser.userId,
        });
        notificationId = n.id;
        queued += validUserIds.length;
      }
    }

    if (dto.channels.includes('email')) {
      const internalEmails: string[] = [];
      const externalEmails: string[] = [];
      if (dto.recipientScope === 'participants') {
        for (const p of internalParticipants) {
          const user = await this.userRepo.findOne({ where: { id: p.userId } });
          if (user?.email) internalEmails.push(user.email);
        }
        for (const ep of externalParticipants) {
          if (ep.email) externalEmails.push(ep.email);
        }
      } else {
        for (const uid of userIds) {
          const user = await this.userRepo.findOne({ where: { id: uid } });
          if (user?.email) internalEmails.push(user.email);
          else skipped++;
        }
      }

      // Nội bộ: mời đăng nhập xem (đã có quyền qua canAccessMinutes) — không đính kèm.
      if (internalEmails.length > 0) {
        const result = await this.notificationsService.enqueueEmailNotification(
          {
            notificationType: NotificationType.MINUTES_DISTRIBUTION,
            channel: NotificationChannel.EMAIL,
            subject: 'Biên bản họp đã được ban hành: ' + meeting.title,
            content,
            emailHtml: buildMinutesPublishedEmail({
              meetingTitle: meeting.title,
              minutesTitle: minutes.title,
              message: dto.message ?? null,
            }),
            relatedEntityType: 'meeting_minutes',
            relatedEntityId: minutes.id,
            toEmails: internalEmails,
            createdBy: authUser.userId,
          },
        );
        if (!notificationId) {
          notificationId = result.notification.id;
        }
        queued += internalEmails.length;
      }

      // Khách ngoài công ty: không có tài khoản để đăng nhập xem sau này
      // (guest-access magic link chỉ còn hiệu lực trong khung giờ họp) — đính
      // kèm thẳng file PDF biên bản vào email.
      if (externalEmails.length > 0) {
        const attachment = await this.getOrCreateMinutesPdfAttachment(
          minutes,
          meeting,
          authUser.userId,
        );
        const result = await this.notificationsService.enqueueEmailNotification(
          {
            notificationType: NotificationType.MINUTES_DISTRIBUTION,
            channel: NotificationChannel.EMAIL,
            subject: 'Biên bản họp đã được ban hành: ' + meeting.title,
            content,
            emailHtml: buildMinutesPublishedGuestEmail({
              meetingTitle: meeting.title,
              minutesTitle: minutes.title,
              message: dto.message ?? null,
            }),
            relatedEntityType: 'meeting_minutes',
            relatedEntityId: minutes.id,
            toEmails: externalEmails,
            createdBy: authUser.userId,
            attachment,
          },
        );
        if (!notificationId) {
          notificationId = result.notification.id;
        }
        queued += externalEmails.length;
      }
    }

    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_minutes_distributed',
      entityType: 'meeting_minutes',
      entityId: minutes.id,
      metadataJson: {
        meetingId,
        recipientScope: dto.recipientScope,
        queuedRecipientCount: queued,
        skippedRecipientCount: skipped,
      },
    });

    this.logger.log(
      '[MeetingNotifications] Minutes distributed — minutes=' +
        minutes.id +
        ', meeting=' +
        meetingId +
        ', queued=' +
        queued +
        ', skipped=' +
        skipped,
    );
    return {
      notificationId: notificationId ?? '',
      queuedRecipientCount: queued,
      minutesId: minutes.id,
    };
  }

  // ───────────── Private helpers ─────────────

  private async findMeetingOrThrow(meetingId: string): Promise<MeetingEntity> {
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId },
    });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Meeting not found or deleted',
        error: { code: 'MEETING_NOT_FOUND', details: {} },
      });
    }
    return meeting;
  }

  private async ensureOwnershipOrAdmin(
    meeting: MeetingEntity,
    authUser: AuthUser,
  ): Promise<void> {
    const isOwner =
      meeting.organizerId === authUser.userId ||
      meeting.hostId === authUser.userId;
    if (isOwner) return;
    const { roles } = await this.authzReadRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    if (roles.includes('BUSINESS_ADMIN') || roles.includes('SYSTEM_ADMIN'))
      return;
    throw new ForbiddenException({
      success: false,
      message: 'You are not the meeting owner or an admin',
      error: { code: 'NOT_MEETING_OWNER', details: {} },
    });
  }

  private async ensureMinutesOwnerOrAdmin(
    meeting: MeetingEntity,
    minutes: MeetingMinutesEntity,
    authUser: AuthUser,
  ): Promise<void> {
    const isOwner =
      minutes.preparedBy === authUser.userId ||
      meeting.organizerId === authUser.userId ||
      meeting.hostId === authUser.userId;
    if (isOwner) return;
    const { roles } = await this.authzReadRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    if (roles.includes('BUSINESS_ADMIN') || roles.includes('SYSTEM_ADMIN'))
      return;
    throw new ForbiddenException({
      success: false,
      message: 'You are not the minutes owner or an admin',
      error: { code: 'NOT_MINUTES_OWNER', details: {} },
    });
  }

  /**
   * Lấy (hoặc tự render+lưu nếu chưa có) file PDF đầy đủ của biên bản, dùng để
   * đính kèm email gửi khách ngoài (distributeMeetingMinutes). Ưu tiên tái sử
   * dụng `minutes.fileId` nếu host đã từng export PDF mặc định (UC-147:
   * MinutesExportWorkerProcessor set field này khi format=pdf +
   * includeTranscript+includeActionItems=true) — tránh render trùng.
   *
   * KHÔNG gọi MinutesExportService (module `minutes`) để tránh import
   * MinutesModule → MeetingsModule → NotificationsModule (circular — xem
   * notifications.module.ts). Thay vào đó dùng lại renderer thuần
   * (renderMeetingMinutesPdf) trực tiếp, cùng cách MinutesExportWorkerProcessor làm.
   */
  private async getOrCreateMinutesPdfAttachment(
    minutes: MeetingMinutesEntity,
    meeting: MeetingEntity,
    requestedByUserId: string,
  ): Promise<{ storageKey: string; fileName: string; mimeType: string }> {
    if (minutes.fileId) {
      const existing = await this.mediaFileRepo.findOne({
        where: { id: minutes.fileId, deletedAt: IsNull() },
      });
      if (existing) {
        return {
          storageKey: existing.storageKey,
          fileName: existing.fileName,
          mimeType: existing.mimeType,
        };
      }
    }

    let transcriptText: string | null = null;
    if (minutes.linkedTranscriptId) {
      const transcript = await this.transcriptRepo.findOne({
        where: { id: minutes.linkedTranscriptId },
      });
      transcriptText = transcript?.cleanedText || transcript?.rawText || null;
    }

    const exportData: MinutesExportData = {
      title: minutes.title,
      meetingTitle: meeting.title ?? null,
      status: minutes.status,
      issuedAt: minutes.issuedAt,
      generatedAt: new Date(),
      minutesContent: minutes.minutesContent,
      decisions: normalizeMinutesJsonList(minutes.decisionsJson),
      actionItems: normalizeMinutesJsonList(minutes.actionItemsJson),
      includeActionItems: true,
      transcriptText,
    };

    const fileBuffer = await renderMeetingMinutesPdf(exportData);
    const saveResult = await this.storageService.saveFile({
      buffer: fileBuffer,
      originalName: `minutes-${minutes.id}.pdf`,
      folder: 'exports',
    });

    const storageProv =
      this.storageService.getDriver() === 's3'
        ? StorageProvider.S3
        : this.storageService.getDriver() === 'minio'
          ? StorageProvider.MINIO
          : StorageProvider.LOCAL;

    const meetingSlug = slugifyFileNamePart(meeting.title || minutes.title);
    const mediaFile = this.mediaFileRepo.create({
      fileName: `Tom_tat_cuoc_hop_${meetingSlug}.pdf`,
      fileType: MediaFileType.EXPORT,
      mimeType: 'application/pdf',
      storageProvider: storageProv,
      storageKey: saveResult.storageKey,
      fileSizeBytes: saveResult.sizeBytes.toString(),
      relatedEntityType: 'meeting_minutes',
      relatedEntityId: minutes.id,
      meetingId: minutes.meetingId,
      uploadedBy: requestedByUserId,
      visibilityLevel: MediaVisibilityLevel.INTERNAL,
      isActive: true,
    });
    const saved = await this.mediaFileRepo.save(mediaFile);

    // Đây tương đương "export mặc định" (pdf + transcript + action items) —
    // set làm fileId chính thức để lần sau (export tay hoặc distribute khác)
    // tái dùng, giống hành vi MinutesExportWorkerProcessor bước isDefaultExport.
    await this.minutesRepo.update(minutes.id, { fileId: saved.id });

    return {
      storageKey: saved.storageKey,
      fileName: saved.fileName,
      mimeType: saved.mimeType,
    };
  }

  private ensureNotCancelled(meeting: MeetingEntity): void {
    if (meeting.status === MeetingStatus.CANCELLED) {
      throw new ConflictException({
        success: false,
        message: 'Meeting is cancelled, cannot send invitations',
        error: { code: 'MEETING_CANCELLED', details: {} },
      });
    }
  }

  private ensureMeetingIsUpcoming(meeting: MeetingEntity): void {
    if (
      meeting.status !== MeetingStatus.SCHEDULED ||
      new Date(meeting.startTime) <= new Date()
    ) {
      throw new ConflictException({
        success: false,
        message:
          'Meeting is not upcoming (status must be scheduled with future start time)',
        error: { code: 'MEETING_NOT_UPCOMING', details: {} },
      });
    }
  }

  private async loadParticipants(meetingId: string): Promise<{
    internalParticipants: MeetingParticipantEntity[];
    externalParticipants: MeetingExternalParticipantEntity[];
  }> {
    const internalParticipants = await this.participantRepo.find({
      where: { meetingId },
    });
    const externalParticipants = await this.externalParticipantRepo.find({
      where: { meetingId },
    });
    return { internalParticipants, externalParticipants };
  }

  private dedupIds(ids: string[]): string[] {
    return [...new Set(ids.filter(Boolean))];
  }

  private async buildInvitationContent(
    meeting: MeetingEntity,
    dto: SendMeetingInvitationDto,
  ): Promise<string> {
    let content =
      'Bạn được mời tham dự cuộc họp: <b>' + meeting.title + '</b><br/>';
    content +=
      'Thời gian: ' +
      formatDateTimeVN(meeting.startTime) +
      ' — ' +
      formatDateTimeVN(meeting.endTime) +
      '<br/>';
    if (dto.includeAgenda) {
      const agendas = await this.agendaRepo.find({
        where: { meetingId: meeting.id },
        order: { agendaOrder: 'ASC' },
      });
      if (agendas.length > 0) {
        content += '<br/>Chương trình họp:<br/><ul>';
        for (const a of agendas) {
          content += '<li>' + a.title + '</li>';
        }
        content += '</ul>';
      }
    }
    if (dto.message) {
      content += '<br/>Lời nhắn: ' + dto.message;
    }
    return content;
  }

  private buildReminderContent(meeting: MeetingEntity): string {
    return buildMeetingReminderContent(meeting);
  }

  private buildCancellationContent(
    meeting: MeetingEntity,
    reason: string,
  ): string {
    return (
      'Cuộc họp <b>' + meeting.title + '</b> đã bị hủy.<br/>Lý do: ' + reason
    );
  }

  private buildMinutesDistributionContent(
    meeting: MeetingEntity,
    minutes: MeetingMinutesEntity,
    message?: string,
  ): string {
    let content =
      'Biên bản cuộc họp <b>' + meeting.title + '</b> đã được ban hành.<br/>';
    content += 'Tiêu đề biên bản: ' + minutes.title + '<br/>';
    if (message) {
      content += '<br/>Lời nhắn: ' + message;
    }
    return content;
  }
}
