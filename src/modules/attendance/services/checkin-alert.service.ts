import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';

import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import { InvitationStatus } from '../../meetings/entities/meeting-participant.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../../meetings/entities/meeting-event.entity.js';

import {
  UserEntity,
  AccountStatus,
} from '../../accounts/entities/user.entity.js';

import { RedisService } from '../../redis/redis.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { formatDateTimeVN } from '../../mail/templates/layout.js';
import {
  buildLateCheckinAlertEmail,
  buildLateCheckinHostSummaryEmail,
} from '../../mail/templates/builders.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import {
  LateCheckinAlertResponseDto,
  PartialFailureItem,
} from '../dto/late-checkin-alert-response.dto.js';

interface CheckinAlertConfig {
  enabled: boolean;
  graceMinutes: number;
  channels: string[];
  notifyHostEnabled: boolean;
  maxRetryAttempts: number;
}

interface EligibleMeeting {
  id: string;
  title: string;
  startTime: Date;
  actualStartTime: Date | null;
  roomId: string | null;
  hostId: string | null;
  roomName: string | null;
}

interface RequiredParticipant {
  participantId: string;
  userId: string;
  email: string | null;
  isActive: boolean;
  fullName: string;
  attendanceStatus: string;
}

interface ProcessingResult {
  meetingId: string;
  totalParticipantsChecked: number;
  alertsSent: number;
  hostAlertSent: boolean;
  partialFailures: PartialFailureItem[];
}

@Injectable()
export class CheckInAlertService {
  private readonly logger = new Logger(CheckInAlertService.name);
  private readonly instanceId: string;
  private readonly redisKeyPrefix = 'attendance:checkin-alert';
  private readonly redisLockPrefix = 'attendance:checkin-alert-lock';

  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly configService: ConfigService,
  ) {
    this.instanceId = `${process.env.HOSTNAME ?? 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ───── T007: loadConfig ─────

  async loadConfig(): Promise<CheckinAlertConfig> {
    const configs = await this.dataSource
      .getRepository(SystemConfigEntity)
      .find({
        where: { configGroup: 'attendance', isActive: true },
      });

    const getValue = (key: string, defaultValue: string): string => {
      const found = configs.find((c) => c.configKey === key);
      return found?.configValue ?? defaultValue;
    };

    const parseBool = (val: string, def: boolean): boolean => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      return def;
    };

    const parseNum = (val: string, def: number): number => {
      const n = parseInt(val, 10);
      return isNaN(n) ? def : n;
    };

    const parseJsonArr = (val: string, def: string[]): string[] => {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : def;
      } catch {
        return def;
      }
    };

    const enabledRaw = getValue('attendance.checkin_alert.enabled', 'true');
    const graceMinutesRaw = getValue(
      'attendance.checkin_alert.grace_minutes',
      '5',
    );
    const channelsRaw = getValue(
      'attendance.checkin_alert.channels',
      '["email"]',
    );
    const notifyHostRaw = getValue(
      'attendance.checkin_alert.notify_host_enabled',
      'true',
    );
    const maxRetryRaw = getValue(
      'attendance.checkin_alert.max_retry_attempts',
      '3',
    );

    return {
      enabled: parseBool(enabledRaw, true),
      graceMinutes: parseNum(graceMinutesRaw, 5),
      channels: parseJsonArr(channelsRaw, ['email']),
      notifyHostEnabled: parseBool(notifyHostRaw, true),
      maxRetryAttempts: parseNum(maxRetryRaw, 3),
    };
  }

  // ───── T008: processMeetings ─────

  async processMeetings(): Promise<void> {
    const config = await this.loadConfig();

    if (!config.enabled) {
      this.logger.log(
        '[CheckInAlert] Feature disabled by config — skipping scan',
      );
      return;
    }

    const checkTime = new Date();
    checkTime.setMinutes(checkTime.getMinutes() - config.graceMinutes);

    const meetings: Array<{
      id: string;
      title: string;
      start_time: Date;
      actual_start_time: Date | null;
      room_id: string | null;
      host_id: string | null;
      room_name: string | null;
    }> = await this.dataSource.query(
      `SELECT m.id, m.title, m.start_time, m.actual_start_time,
              m.room_id, m.host_id, r.room_name
       FROM meetings m
       LEFT JOIN rooms r ON r.id = m.room_id
       WHERE m.status = $1
         AND COALESCE(m.actual_start_time, m.start_time) <= $2
         AND m.attendance_enabled = true
         AND m.deleted_at IS NULL`,
      [MeetingStatus.IN_PROGRESS, checkTime],
    );

    if (meetings.length === 0) {
      this.logger.log('[CheckInAlert] No eligible meetings found');
      return;
    }

    this.logger.log(
      `[CheckInAlert] Found ${meetings.length} eligible meeting(s) to process`,
    );

    let totalAlertsSent = 0;
    let totalMeetingsProcessed = 0;

    for (const raw of meetings) {
      const meeting: EligibleMeeting = {
        id: raw.id,
        title: raw.title,
        startTime: raw.start_time,
        actualStartTime: raw.actual_start_time ?? null,
        roomId: raw.room_id ?? null,
        hostId: raw.host_id ?? null,
        roomName: raw.room_name ?? null,
      };

      try {
        const result = await this.processMeeting(meeting, config);
        totalAlertsSent += result.alertsSent;
        totalMeetingsProcessed++;
        this.logger.log(
          `[CheckInAlert] Meeting ${result.meetingId}: ${result.alertsSent} alert(s) sent, ` +
            `${result.partialFailures.length} partial failure(s), hostAlerted=${result.hostAlertSent}`,
        );
      } catch (error) {
        this.logger.error(
          `[CheckInAlert] Failed to process meeting ${meeting.id}: ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(
      `[CheckInAlert] Scan complete: ${totalMeetingsProcessed} meeting(s), ${totalAlertsSent} alert(s) sent`,
    );
  }

  // ───── T009: processMeeting ─────

  async processMeeting(
    meeting: EligibleMeeting,
    config?: CheckinAlertConfig,
  ): Promise<ProcessingResult> {
    const cfg = config ?? (await this.loadConfig());

    // Re-check meeting status
    const currentMeeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: meeting.id } });

    if (
      !currentMeeting ||
      currentMeeting.status !== MeetingStatus.IN_PROGRESS
    ) {
      return {
        meetingId: meeting.id,
        totalParticipantsChecked: 0,
        alertsSent: 0,
        hostAlertSent: false,
        partialFailures: [],
      };
    }

    // Redis lock: try acquire
    const lockKey = `${this.redisLockPrefix}:${meeting.id}`;
    let lockAcquired = false;
    try {
      const lockSet = await this.redisService
        .getClient()
        .set(lockKey, this.instanceId, 'EX', cfg.graceMinutes * 120, 'NX');
      lockAcquired = lockSet === 'OK';
    } catch {
      this.logger.warn(
        `[CheckInAlert] Redis unavailable for lock, proceeding without lock for meeting ${meeting.id}`,
      );
      lockAcquired = true; // proceed without lock if Redis down
    }

    if (!lockAcquired) {
      this.logger.log(
        `[CheckInAlert] Meeting ${meeting.id} is being processed by another instance — skip`,
      );
      return {
        meetingId: meeting.id,
        totalParticipantsChecked: 0,
        alertsSent: 0,
        hostAlertSent: false,
        partialFailures: [],
      };
    }

    try {
      // Load required participants using raw query for precise control
      const participants: RequiredParticipant[] = await this.dataSource.query(
        `SELECT mp.id AS "participantId", mp.user_id AS "userId", mp.attendance_status AS "attendanceStatus",
                u.email, (u.account_status = 'active') AS "isActive", u.full_name AS "fullName"
         FROM meeting_participants mp
         JOIN users u ON u.id = mp.user_id
         WHERE mp.meeting_id = $1
           AND mp.is_required = true
           AND mp.attendance_required = true
           AND mp.invitation_status != $2
           AND mp.attendance_status NOT IN ('present', 'late')
           AND NOT EXISTS (
             SELECT 1 FROM attendance_records ar
             WHERE ar.meeting_id = mp.meeting_id
               AND ar.user_id = mp.user_id
               AND (ar.check_in_time IS NOT NULL OR ar.is_present = true)
           )`,
        [meeting.id, InvitationStatus.DECLINED],
      );

      const result: ProcessingResult = {
        meetingId: meeting.id,
        totalParticipantsChecked: participants.length,
        alertsSent: 0,
        hostAlertSent: false,
        partialFailures: [],
      };

      if (participants.length === 0) {
        return result;
      }

      // Grace period in minutes for the email template
      const graceMinutes = cfg.graceMinutes;
      const lateMinutes = Math.ceil(
        (Date.now() -
          new Date(meeting.actualStartTime ?? meeting.startTime).getTime()) /
          60000,
      );

      for (const participant of participants) {
        // Step 1: Check Redis idempotency key
        const idempotencyKey = `${this.redisKeyPrefix}:${meeting.id}:${participant.userId}:${graceMinutes}`;
        try {
          const alreadySent = await this.redisService.exists(idempotencyKey);
          if (alreadySent) {
            this.logger.debug(
              `[CheckInAlert] Skipping participant ${participant.userId} — already alerted (idempotency)`,
            );
            continue;
          }
        } catch {
          // Redis unavailable — skip idempotency check, proceed with DB fallback
          this.logger.warn(
            `[CheckInAlert] Redis unavailable for idempotency check, falling back to DB for meeting ${meeting.id}`,
          );
          const alreadySentDb = await this.hasExistingAlert(
            meeting.id,
            participant.userId,
            graceMinutes,
          );
          if (alreadySentDb) {
            continue;
          }
        }

        // Step 2: Re-check attendance before sending
        const hasCheckIn = await this.hasValidCheckIn(
          meeting.id,
          participant.userId,
        );
        if (hasCheckIn) {
          this.logger.debug(
            `[CheckInAlert] Skipping participant ${participant.userId} — just checked in`,
          );
          continue;
        }

        // Step 3: Check email validity
        if (!participant.email || !participant.isActive) {
          const reason = !participant.email
            ? 'missing_email'
            : 'account_inactive';
          this.logger.debug(
            `[CheckInAlert] Skipping participant ${participant.userId} — ${reason}`,
          );
          result.partialFailures.push({ userId: participant.userId, reason });
          continue;
        }

        // Step 4: Send email alert
        try {
          const subject = `[Nhắc nhở] Bạn chưa check-in cuộc họp "${meeting.title}"`;
          const content =
            `Xin chào ${participant.fullName},\n\n` +
            `Bạn chưa check-in cho cuộc họp sau:\n` +
            `  - Tên cuộc họp: ${meeting.title}\n` +
            `  - Phòng: ${meeting.roomName ?? 'N/A'}\n` +
            `  - Giờ bắt đầu: ${formatDateTimeVN(meeting.actualStartTime ?? meeting.startTime)}\n` +
            `  - Đã trễ: ${lateMinutes} phút\n\n` +
            `Vui lòng check-in ngay tại phòng họp để đảm bảo theo dõi tham dự.\n\n` +
            `-- Hệ thống quản lý cuộc họp`;

          await this.notificationsService.enqueueEmailNotification({
            notificationType: NotificationType.LATE_CHECKIN_ALERT,
            channel: NotificationChannel.EMAIL,
            subject,
            content,
            emailHtml: buildLateCheckinAlertEmail({
              fullName: participant.fullName,
              meetingTitle: meeting.title,
              roomName: meeting.roomName ?? null,
              startTime: meeting.actualStartTime ?? meeting.startTime,
              lateMinutes,
            }),
            relatedEntityType: 'meeting',
            relatedEntityId: meeting.id,
            toEmails: [participant.email],
            recipientUserIds: [participant.userId],
            payloadJson: {
              meetingId: meeting.id,
              participantId: participant.userId,
              graceMinutes,
            },
          });

          result.alertsSent++;
        } catch (error) {
          this.logger.error(
            `[CheckInAlert] Failed to send alert for participant ${participant.userId}: ${(error as Error).message}`,
          );
          result.partialFailures.push({
            userId: participant.userId,
            reason: 'send_failed',
          });
          continue;
        }

        // Step 5: Set Redis idempotency key
        try {
          await this.redisService.setWithTtl(idempotencyKey, '1', 86400);
        } catch {
          this.logger.warn(
            `[CheckInAlert] Failed to set Redis idempotency key for ${participant.userId}`,
          );
        }
      }

      // ───── Host Summary ─────
      if (result.alertsSent > 0 && cfg.notifyHostEnabled && meeting.hostId) {
        const hostIdempotencyKey = `${this.redisKeyPrefix}-host:${meeting.id}:${meeting.hostId}:${graceMinutes}`;
        let sendHostSummary = true;

        try {
          sendHostSummary =
            !(await this.redisService.exists(hostIdempotencyKey));
        } catch {
          this.logger.warn(
            `[CheckInAlert] Redis unavailable for host idempotency check`,
          );
          const alreadySentDb = await this.hasExistingHostAlert(
            meeting.id,
            meeting.hostId,
            graceMinutes,
          );
          if (alreadySentDb) sendHostSummary = false;
        }

        if (sendHostSummary) {
          try {
            // Get host email
            const hostUser = await this.dataSource
              .getRepository(UserEntity)
              .findOne({ where: { id: meeting.hostId } });

            if (
              hostUser?.email &&
              hostUser.accountStatus === AccountStatus.ACTIVE
            ) {
              const alertedNames = participants
                .filter(
                  (p) =>
                    !result.partialFailures.some((f) => f.userId === p.userId),
                )
                .map((p) => p.fullName);

              const hostSubject = `[Tổng hợp] Danh sách người chưa check-in cuộc họp "${meeting.title}"`;
              const hostContent =
                `Xin chào Host,\n\n` +
                `Cuộc họp "${meeting.title}" đã bắt đầu nhưng có ${alertedNames.length} người chưa check-in:\n\n` +
                alertedNames.map((name) => `  - ${name}`).join('\n') +
                '\n\n' +
                `Vui lòng kiểm tra và nhắc nhở người tham dự.\n\n` +
                `-- Hệ thống quản lý cuộc họp`;

              await this.notificationsService.enqueueEmailNotification({
                notificationType: NotificationType.LATE_CHECKIN_HOST_SUMMARY,
                channel: NotificationChannel.EMAIL,
                subject: hostSubject,
                content: hostContent,
                emailHtml: buildLateCheckinHostSummaryEmail({
                  meetingTitle: meeting.title,
                  alertedNames,
                }),
                relatedEntityType: 'meeting',
                relatedEntityId: meeting.id,
                toEmails: [hostUser.email],
                recipientUserIds: [meeting.hostId],
                payloadJson: {
                  meetingId: meeting.id,
                  hostId: meeting.hostId,
                  graceMinutes,
                  participantsAlerted: alertedNames,
                },
              });

              result.hostAlertSent = true;
            } else {
              result.partialFailures.push({
                userId: meeting.hostId,
                reason: 'host_missing_email_or_inactive',
              });
            }
          } catch (error) {
            this.logger.error(
              `[CheckInAlert] Failed to send host summary for meeting ${meeting.id}: ${(error as Error).message}`,
            );
            result.partialFailures.push({
              userId: meeting.hostId,
              reason: 'host_summary_failed',
            });
          }

          // Set host idempotency key
          try {
            await this.redisService.setWithTtl(hostIdempotencyKey, '1', 86400);
          } catch {
            this.logger.warn(
              `[CheckInAlert] Failed to set Redis host idempotency key`,
            );
          }
        }
      }

      // ───── Record MeetingEvent ─────
      if (result.alertsSent > 0 || result.partialFailures.length > 0) {
        await this.dataSource
          .createQueryBuilder()
          .insert()
          .into(MeetingEventEntity)
          .values({
            meetingId: meeting.id,
            eventType: MeetingEventType.ATTENDANCE_CHECKIN_ALERT_SENT,
            sourceType: MeetingEventSourceType.SCHEDULER,
            description: `${result.alertsSent} alert(s) sent, ${result.partialFailures.length} partial failure(s)`,
            metadataJson: {
              meetingId: meeting.id,
              graceMinutes,
              participantsAlerted: participants
                .filter(
                  (p) =>
                    !result.partialFailures.some((f) => f.userId === p.userId),
                )
                .map((p) => p.userId),
              hostAlerted: result.hostAlertSent,
              partialFailures: result.partialFailures,
              totalFound: participants.length,
              totalAlerted: result.alertsSent,
            },
          })
          .execute();
      }

      // ───── Record AuditLog ─────
      if (result.alertsSent > 0) {
        await this.auditLogsService.logAction({
          actionType: 'checkin_alert_sent',
          entityType: 'meeting',
          entityId: meeting.id,
          metadataJson: {
            meetingId: meeting.id,
            graceMinutes,
            participantsAlerted: result.alertsSent,
            hostAlerted: result.hostAlertSent,
            partialFailures: result.partialFailures,
          },
        });
      } else if (result.partialFailures.length > 0) {
        await this.auditLogsService.logAction({
          actionType: 'checkin_alert_skipped',
          entityType: 'meeting',
          entityId: meeting.id,
          metadataJson: {
            meetingId: meeting.id,
            reason: 'all_participants_skipped_or_failed',
            partialFailures: result.partialFailures,
          },
        });
      }

      return result;
    } finally {
      // Release Redis lock
      try {
        await this.redisService.del(lockKey);
      } catch {
        // Ignore lock release errors
      }
    }
  }

  // ───── T010: triggerForMeeting ─────

  async triggerForMeeting(
    meetingId: string,
  ): Promise<LateCheckinAlertResponseDto> {
    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: meetingId, deletedAt: IsNull() } });

    if (!meeting) {
      throw new NotFoundException({
        message: 'Meeting not found',
        error: 'MEETING_NOT_FOUND',
      });
    }

    if (meeting.status !== MeetingStatus.IN_PROGRESS) {
      throw new ConflictException({
        message: `Meeting is not in progress. Current status: ${meeting.status}`,
        error: 'MEETING_NOT_IN_PROGRESS',
        details: { currentStatus: meeting.status },
      });
    }

    const eligibleMeeting: EligibleMeeting = {
      id: meeting.id,
      title: meeting.title,
      startTime: meeting.startTime,
      actualStartTime: meeting.actualStartTime,
      roomId: meeting.roomId,
      hostId: meeting.hostId,
      roomName: null,
    };

    const result = await this.processMeeting(eligibleMeeting);

    return {
      meetingId: result.meetingId,
      status: 'processing',
      totalParticipantsChecked: result.totalParticipantsChecked,
      alertsSent: result.alertsSent,
      hostAlertSent: result.hostAlertSent,
      partialFailures:
        result.partialFailures.length > 0 ? result.partialFailures : undefined,
    };
  }

  // ───── T011: Redis fallback helpers ─────

  private async hasExistingAlert(
    meetingId: string,
    userId: string,
    graceMinutes: number,
  ): Promise<boolean> {
    try {
      const result = await this.dataSource.query(
        `SELECT 1 FROM meeting_events
         WHERE meeting_id = $1
           AND event_type = $2
           AND metadata_json->>'participantsAlerted' LIKE $3
         LIMIT 1`,
        [
          meetingId,
          MeetingEventType.ATTENDANCE_CHECKIN_ALERT_SENT,
          `%${userId}%`,
        ],
      );
      return result.length > 0;
    } catch {
      return false;
    }
  }

  private async hasExistingHostAlert(
    meetingId: string,
    hostId: string,
    graceMinutes: number,
  ): Promise<boolean> {
    try {
      const result = await this.dataSource.query(
        `SELECT 1 FROM meeting_events
         WHERE meeting_id = $1
           AND event_type = $2
           AND metadata_json->>'hostAlerted' = 'true'
         LIMIT 1`,
        [meetingId, MeetingEventType.ATTENDANCE_CHECKIN_ALERT_SENT],
      );
      return result.length > 0;
    } catch {
      return false;
    }
  }

  private async hasValidCheckIn(
    meetingId: string,
    userId: string,
  ): Promise<boolean> {
    try {
      const result = await this.dataSource.query(
        `SELECT 1 FROM attendance_records
         WHERE meeting_id = $1
           AND user_id = $2
           AND (check_in_time IS NOT NULL OR is_present = true)
         LIMIT 1`,
        [meetingId, userId],
      );
      if (result.length > 0) return true;
    } catch {
      // If DB error, assume not checked in to err on side of sending alert
    }

    // Also check meeting_participants.attendance_status
    try {
      const mpResult = await this.dataSource.query(
        `SELECT attendance_status FROM meeting_participants
         WHERE meeting_id = $1 AND user_id = $2
         LIMIT 1`,
        [meetingId, userId],
      );
      if (mpResult.length > 0) {
        const status = mpResult[0].attendance_status;
        if (status === 'present' || status === 'late') return true;
      }
    } catch {
      // ignore
    }

    return false;
  }
}
