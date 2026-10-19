import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, LessThanOrEqual, Repository } from 'typeorm';

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
import {
  InvitationStatus,
  MeetingParticipantEntity,
} from '../../meetings/entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';

/** VPĐT: "Thời gian nhắc nhở trước cuộc họp — 10 phút mặc định". */
const DEFAULT_LEAD_MINUTES = 10;
const MAX_LEAD_MINUTES = 24 * 60;
export const MEETING_REMINDER_MINUTES_KEY = 'meeting_reminder_minutes';

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
 * Nhắc lịch họp chạy nền (cron `notification-reminder`, gated SCHEDULER_ENABLED &&
 * SCHEDULER_NOTIFICATION_REMINDER_ENABLED):
 *
 * 1. sendAutoRemindersBatch — tự nhắc trước giờ họp `meeting_reminder_minutes` phút
 *    (system_configs, mặc định 10) qua in-app + email, mỗi cuộc họp 1 lần cho mỗi giờ bắt đầu
 *    (đổi giờ họp → nhắc lại theo giờ mới).
 * 2. dispatchDueScheduledReminders — gửi các nhắc lịch người dùng đã hẹn giờ
 *    (MeetingNotificationsService.sendMeetingReminder, reminderType=scheduled) khi tới hạn.
 *
 * Không ném lỗi ra cron: lỗi từng cuộc họp/bản ghi được đếm vào `failed`.
 */
@Injectable()
export class MeetingReminderDispatchService {
  private readonly logger = new Logger(MeetingReminderDispatchService.name);

  constructor(
    @InjectRepository(MeetingEntity)
    private readonly meetingRepo: Repository<MeetingEntity>,
    @InjectRepository(MeetingParticipantEntity)
    private readonly participantRepo: Repository<MeetingParticipantEntity>,
    @InjectRepository(MeetingExternalParticipantEntity)
    private readonly externalParticipantRepo: Repository<MeetingExternalParticipantEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  async sendAutoRemindersBatch(
    now: Date = new Date(),
  ): Promise<{ scanned: number; reminded: number; failed: number }> {
    const leadMinutes = await this.getLeadMinutes();
    const leadMs = leadMinutes * 60_000;
    const candidates = await this.meetingRepo.find({
      where: {
        status: MeetingStatus.SCHEDULED,
        startTime: Between(now, new Date(now.getTime() + leadMs)),
      },
    });
    // Cuộc họp tạo khi đã nằm trong cửa sổ nhắc: người tham dự vừa nhận thư mời, không nhắc.
    const due = candidates.filter(
      (m) => m.createdAt.getTime() <= m.startTime.getTime() - leadMs,
    );
    if (due.length === 0) {
      return { scanned: candidates.length, reminded: 0, failed: 0 };
    }

    const alreadyReminded = new Set(
      (
        await this.notificationRepo.find({
          select: { relatedEntityId: true, payloadJson: true },
          where: {
            notificationType: NotificationType.REMINDER,
            relatedEntityType: 'meeting',
            relatedEntityId: In(due.map((m) => m.id)),
          },
        })
      )
        .filter((n) => n.payloadJson?.reminderType === 'auto')
        .map((n) => `${n.relatedEntityId}|${String(n.payloadJson?.startTime)}`),
    );
    const pending = due.filter(
      (m) => !alreadyReminded.has(`${m.id}|${m.startTime.toISOString()}`),
    );

    let reminded = 0;
    let failed = 0;
    for (const meeting of pending) {
      try {
        await this.sendAutoReminder(meeting, leadMinutes);
        reminded++;
      } catch (e) {
        failed++;
        this.logger.error(
          `sendAutoRemindersBatch: meeting ${meeting.id} failed: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    }
    return { scanned: candidates.length, reminded, failed };
  }

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

  private async sendAutoReminder(
    meeting: MeetingEntity,
    leadMinutes: number,
  ): Promise<void> {
    const participants = (
      await this.participantRepo.find({ where: { meetingId: meeting.id } })
    ).filter((p) => p.invitationStatus !== InvitationStatus.DECLINED);
    const externals = await this.findActiveExternals(meeting.id);
    const userIds = [
      ...new Set(
        [
          meeting.organizerId,
          meeting.hostId,
          ...participants.map((p) => p.userId),
        ].filter((id): id is string => !!id),
      ),
    ];
    const subject = 'Nhắc lịch họp: ' + meeting.title;
    const content = buildMeetingReminderContent(meeting);
    const payloadJson = {
      reminderType: 'auto',
      startTime: meeting.startTime.toISOString(),
      leadMinutes,
    };

    await this.notificationsService.createNotification({
      notificationType: NotificationType.REMINDER,
      channel: NotificationChannel.IN_APP,
      subject,
      content,
      relatedEntityType: 'meeting',
      relatedEntityId: meeting.id,
      recipientUserIds: userIds,
      payloadJson,
    });

    const emails = await this.collectEmails(userIds, externals);
    if (emails.length > 0) {
      await this.notificationsService.enqueueEmailNotification({
        notificationType: NotificationType.REMINDER,
        channel: NotificationChannel.EMAIL,
        subject,
        content,
        emailHtml: buildMeetingReminderEmail({
          meetingTitle: meeting.title,
          startTime: meeting.startTime,
        }),
        relatedEntityType: 'meeting',
        relatedEntityId: meeting.id,
        toEmails: emails,
        payloadJson,
      });
    }
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

  private async getLeadMinutes(): Promise<number> {
    try {
      const config = await this.dataSource
        .getRepository(SystemConfigEntity)
        .findOne({
          where: { configKey: MEETING_REMINDER_MINUTES_KEY },
          order: { updatedAt: 'DESC' },
        });
      const parsed = parseInt(config?.configValue ?? '', 10);
      if (isNaN(parsed) || parsed <= 0 || parsed > MAX_LEAD_MINUTES) {
        return DEFAULT_LEAD_MINUTES;
      }
      return parsed;
    } catch {
      return DEFAULT_LEAD_MINUTES;
    }
  }
}
