import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';

import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEntity,
  NotificationType,
} from '../entities/notification.entity.js';
import { NotificationsService } from '../notifications.service.js';
import { buildMeetingReminderEmail } from '../../mail/templates/builders.js';
import { formatDateTimeVN } from '../../mail/templates/layout.js';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import { InvitationStatus } from '../../meetings/entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';

export function buildMeetingReminderContent(meeting: MeetingEntity): string {
  return (
    'Nhắc nhở: Cuộc họp <b>' +
    meeting.title +
    '</b> sẽ diễn ra vào lúc ' +
    formatDateTimeVN(meeting.startTime) +
    '. Vui lòng tham dự đúng giờ.'
  );
}

/**
 * Gửi các nhắc lịch họp NGƯỜI DÙNG ĐÃ HẸN GIỜ (MeetingNotificationsService.sendMeetingReminder,
 * reminderType=scheduled) khi tới hạn — cron `notification-reminder` (gated SCHEDULER_ENABLED &&
 * SCHEDULER_NOTIFICATION_REMINDER_ENABLED). Nhắc tự động trước giờ họp do
 * MeetingRequestReviewService.remindUpcomingMeetingsBatch xử lý (cấu hình theo từng cuộc họp).
 *
 * Không ném lỗi ra cron: lỗi từng bản ghi được đếm vào `failed`.
 */
@Injectable()
export class MeetingReminderDispatchService {
  private readonly logger = new Logger(MeetingReminderDispatchService.name);

  constructor(
    @InjectRepository(MeetingEntity)
    private readonly meetingRepo: Repository<MeetingEntity>,
    @InjectRepository(MeetingExternalParticipantEntity)
    private readonly externalParticipantRepo: Repository<MeetingExternalParticipantEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async dispatchDueScheduledReminders(now: Date = new Date()): Promise<{
    due: number;
    sent: number;
    cancelled: number;
    failed: number;
  }> {
    const due = (
      await this.notificationRepo.find({
        where: {
          notificationType: NotificationType.REMINDER,
          deliveryStatus: NotificationDeliveryStatus.DRAFT,
          scheduledSendAt: LessThanOrEqual(now),
        },
      })
    ).filter((n) => n.payloadJson?.reminderType === 'scheduled');
    if (due.length === 0) return { due: 0, sent: 0, cancelled: 0, failed: 0 };

    const meetingIds = [
      ...new Set(due.map((n) => n.relatedEntityId).filter(Boolean)),
    ] as string[];
    const meetings = new Map(
      (await this.meetingRepo.find({ where: { id: In(meetingIds) } })).map(
        (m) => [m.id, m],
      ),
    );

    let sent = 0;
    let cancelled = 0;
    let failed = 0;
    for (const n of due) {
      const meeting = n.relatedEntityId
        ? meetings.get(n.relatedEntityId)
        : undefined;
      try {
        if (
          !meeting ||
          meeting.status !== MeetingStatus.SCHEDULED ||
          meeting.startTime <= now
        ) {
          await this.notificationsService.markCancelled(
            n.id,
            'Cuộc họp đã huỷ hoặc đã bắt đầu trước giờ nhắc',
          );
          cancelled++;
          continue;
        }
        if (n.channel === NotificationChannel.EMAIL) {
          if (await this.dispatchScheduledEmail(n, meeting)) sent++;
        } else if (
          await this.notificationsService.deliverScheduledInApp(n.id)
        ) {
          sent++;
        }
      } catch (e) {
        failed++;
        this.logger.error(
          `dispatchDueScheduledReminders: notification ${n.id} failed: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    }
    return { due: due.length, sent, cancelled, failed };
  }

  /** Email nhắc hẹn giờ: người nhận nội bộ đã lưu trên bản ghi + khách ngoài của cuộc họp. */
  private async dispatchScheduledEmail(
    n: NotificationEntity,
    meeting: MeetingEntity,
  ): Promise<boolean> {
    if (!(await this.notificationsService.claimDraft(n.id))) return false;
    const externals = await this.findActiveExternals(meeting.id);
    const emails = await this.collectEmails(
      n.recipientUserIdsJson ?? [],
      externals,
    );
    if (emails.length === 0) {
      await this.notificationsService.markCancelled(
        n.id,
        'Không có địa chỉ email người nhận',
      );
      return false;
    }
    await this.notificationsService.enqueueEmailForExistingNotification(
      n,
      emails,
      buildMeetingReminderEmail({
        meetingTitle: meeting.title,
        startTime: meeting.startTime,
      }),
    );
    return true;
  }

  /** Khách ngoài chưa từ chối lời mời. */
  private async findActiveExternals(
    meetingId: string,
  ): Promise<MeetingExternalParticipantEntity[]> {
    return (
      await this.externalParticipantRepo.find({ where: { meetingId } })
    ).filter(
      (e) => e.invitationStatus !== (InvitationStatus.DECLINED as string),
    );
  }

  private async collectEmails(
    userIds: string[],
    externals: MeetingExternalParticipantEntity[],
  ): Promise<string[]> {
    const users =
      userIds.length > 0
        ? await this.userRepo.find({ where: { id: In(userIds) } })
        : [];
    return [
      ...new Set(
        [...users.map((u) => u.email), ...externals.map((e) => e.email)]
          .filter((e): e is string => !!e)
          .map((e) => e.trim().toLowerCase()),
      ),
    ];
  }
}
