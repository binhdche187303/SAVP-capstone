import { Injectable, Logger } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../../meetings/entities/meeting-event.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
} from '../../meetings/entities/meeting-participant.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
} from '../../rooms/entities/room-booking.entity.js';
import {
  NotificationEntity,
  NotificationType,
  NotificationChannel,
  NotificationPriority,
  NotificationDeliveryStatus,
} from '../../notifications/entities/notification.entity.js';
import {
  BackgroundJobEntity,
  BackgroundJobType,
  BackgroundJobStatus,
} from '../../administration/entities/background-job.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { MEETING_WARNING_ERRORS } from '../constants/meeting-warning-error.constant.js';
import { WarningProcessorResult } from '../types/warning-processor-result.type.js';

@Injectable()
export class MeetingWarningService {
  private readonly logger = new Logger(MeetingWarningService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly websocketService: WebsocketService,
    private readonly configService: ConfigService,
  ) {}

  // ───────────────────────────────────────────────────────────
  // T005: readConflictBufferConfig
  // ───────────────────────────────────────────────────────────
  private async readConflictBufferConfig(): Promise<number> {
    try {
      const config = await this.dataSource
        .getRepository(SystemConfigEntity)
        .findOne({
          where: { configKey: 'meeting_warning_conflict_buffer_minutes' },
        });
      if (!config) {
        this.logger.warn(
          '[' +
            MEETING_WARNING_ERRORS.CONFLICT_BUFFER_CONFIG_INVALID +
            '] Config key meeting_warning_conflict_buffer_minutes not found, using default 0',
        );
        return 0;
      }
      const parsed = parseInt(config.configValue || '0', 10);
      if (isNaN(parsed)) {
        this.logger.warn(
          '[' +
            MEETING_WARNING_ERRORS.CONFLICT_BUFFER_CONFIG_INVALID +
            '] Config value not parseable: ' +
            config.configValue +
            ', using default 0',
        );
        return 0;
      }
      if (parsed < 0) {
        this.logger.warn(
          '[' +
            MEETING_WARNING_ERRORS.CONFLICT_BUFFER_CONFIG_INVALID +
            '] Config value negative: ' +
            parsed +
            ', using default 0',
        );
        return 0;
      }
      return parsed;
    } catch (error: unknown) {
      this.logger.warn(
        '[' +
          MEETING_WARNING_ERRORS.CONFLICT_BUFFER_CONFIG_INVALID +
          '] Error reading config: ' +
          (error as Error).message,
      );
      return 0;
    }
  }

  // ───────────────────────────────────────────────────────────
  // T006: resolveHost
  // ───────────────────────────────────────────────────────────
  private async resolveHost(
    meeting: MeetingEntity,
    meetingId: string,
  ): Promise<string | null> {
    if (meeting.hostId != null) {
      return meeting.hostId;
    }
    try {
      const hostParticipant = await this.dataSource
        .getRepository(MeetingParticipantEntity)
        .findOne({
          where: {
            meetingId,
            participantRole: ParticipantRole.HOST,
          },
          select: { userId: true },
        });
      if (hostParticipant) {
        return hostParticipant.userId;
      }
      return null;
    } catch (error: unknown) {
      this.logger.warn(
        '[' +
          MEETING_WARNING_ERRORS.HOST_NOT_RESOLVED +
          '] Query meeting_participants failed: ' +
          (error as Error).message,
      );
      return null;
    }
  }

  // ───────────────────────────────────────────────────────────
  // T007: detectConflict
  // ───────────────────────────────────────────────────────────
  private async detectConflict(
    roomId: string,
    meetingEndTime: Date,
    meetingId: string,
    bufferMinutes: number,
  ): Promise<RoomBookingEntity | null> {
    try {
      // Use QueryBuilder for NOT EQUAL on meetingId
      const qb = this.dataSource
        .getRepository(RoomBookingEntity)
        .createQueryBuilder('rb')
        .where('rb.room_id = :roomId', { roomId })
        .andWhere('rb.meeting_id != :meetingId', { meetingId })
        .andWhere('rb.reserved_start_time >= :endTime', {
          endTime: meetingEndTime,
        })
        .andWhere('rb.status IN (:...statuses)', {
          statuses: [
            RoomBookingStatus.PENDING,
            RoomBookingStatus.APPROVED,
            RoomBookingStatus.ACTIVE,
          ],
        })
        .orderBy('rb.reserved_start_time', 'ASC')
        .limit(1);

      const nextBooking2 = await qb.getOne();

      if (!nextBooking2) {
        return null;
      }

      const bufferMs = bufferMinutes * 60_000;
      const conflictThreshold = new Date(meetingEndTime.getTime() + bufferMs);

      if (nextBooking2.reservedStartTime <= conflictThreshold) {
        return nextBooking2;
      }

      return null;
    } catch (error) {
      this.logger.error(
        '[' +
          MEETING_WARNING_ERRORS.CONFLICT_DETECTION_FAILED +
          '] Query room_bookings failed: ' +
          (error as Error).message,
      );
      throw error;
    }
  }

  // ───────────────────────────────────────────────────────────
  // T008: buildNotificationPayload
  // ───────────────────────────────────────────────────────────
  private buildNotificationPayload(
    branch: 'A' | 'B',
    meeting: MeetingEntity,
    remainingMinutes: number,
    warningLevel: 'standard' | 'overdue' | 'strict' | 'urgent',
    hostId: string,
    nextBooking?: RoomBookingEntity,
  ): Partial<NotificationEntity> {
    const meetingId = meeting.id;
    const now = new Date();

    if (branch === 'A') {
      const subject =
        remainingMinutes > 0
          ? 'Cuộc họp sắp kết thúc — còn ' + remainingMinutes + ' phút'
          : 'Cuộc họp đã quá giờ kết thúc';

      const payloadJson: Record<string, unknown> = {
        warningLevel,
        remainingMinutes,
        extensionAllowed: true,
        conflictWithNextBooking: false,
        nextBooking: null,
        cta: {
          type: 'request_extension',
          label: 'Gia hạn cuộc họp',
        },
      };

      return {
        notificationType: NotificationType.MEETING_TIME_WARNING,
        channel: NotificationChannel.IN_APP,
        priority: NotificationPriority.NORMAL,
        subject,
        content: subject,
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId,
        recipientScope: 'user_list',
        recipientUserIdsJson: [hostId],
        payloadJson,
        deliveryStatus: NotificationDeliveryStatus.SENT,
        sentAt: now,
      };
    }

    // Branch B
    const subject =
      remainingMinutes > 0
        ? 'Cảnh báo: Phòng họp sắp bị xung đột — còn ' +
          remainingMinutes +
          ' phút'
        : 'Cuộc họp đã quá giờ và có xung đột';

    const payloadJson: Record<string, unknown> = {
      warningLevel,
      remainingMinutes,
      extensionAllowed: false,
      disableExtensionReason:
        'Phòng đã có lịch cuộc họp kế tiếp. Không thể gia hạn.',
      conflictWithNextBooking: true,
      cta: null,
      nextBooking: nextBooking
        ? {
            bookingId: nextBooking.id,
            reservedStartTime: nextBooking.reservedStartTime.toISOString(),
          }
        : null,
    };

    return {
      notificationType: NotificationType.MEETING_TIME_CONFLICT_WARNING,
      channel: NotificationChannel.IN_APP,
      priority: NotificationPriority.HIGH,
      subject,
      content: subject,
      relatedEntityType: 'meeting',
      relatedEntityId: meetingId,
      recipientScope: 'user_list',
      recipientUserIdsJson: [hostId],
      payloadJson,
      deliveryStatus: NotificationDeliveryStatus.SENT,
      sentAt: now,
    };
  }

  // ───────────────────────────────────────────────────────────
  // T009: WebSocket payload builders
  // ───────────────────────────────────────────────────────────
  private buildHostWsPayload(
    branch: 'A' | 'B',
    warningLevel: 'standard' | 'overdue' | 'strict' | 'urgent',
    remainingMinutes: number,
    extensionAllowed: boolean,
    disableExtensionReason: string | null,
    meetingId: string,
    endTime: Date,
    nextBooking?: { bookingId: string; reservedStartTime: string },
  ): Record<string, unknown> {
    const warningType = branch === 'B' ? 'conflict' : 'standard';
    return {
      meetingId,
      warningType,
      warningLevel,
      remainingMinutes,
      extensionAllowed,
      disableExtensionReason,
      nextBooking: nextBooking || null,
      endTime: endTime.toISOString(),
      timestamp: new Date().toISOString(),
    };
  }

  private buildParticipantWsPayload(
    warningType: 'standard' | 'conflict',
    remainingMinutes: number,
    meetingId: string,
    endTime: Date,
  ): Record<string, unknown> {
    return {
      meetingId,
      warningType,
      remainingMinutes,
      endTime: endTime.toISOString(),
      timestamp: new Date().toISOString(),
    };
  }

  // ───────────────────────────────────────────────────────────
  // Private helper: updateBackgroundJobStatus
  // ───────────────────────────────────────────────────────────
  private async updateBackgroundJobStatus(
    meetingId: string,
    status: BackgroundJobStatus,
    outputJson: Record<string, unknown> | null,
    errorMessage: string | null,
  ): Promise<void> {
    try {
      const bgRepo = this.dataSource.getRepository(BackgroundJobEntity);
      const existing = await bgRepo.findOne({
        where: {
          relatedEntityId: meetingId,
          jobType: BackgroundJobType.MEETING_TIME_WARNING,
        },
      });
      if (existing) {
        const updateData: Record<string, unknown> = { status };
        if (status === BackgroundJobStatus.COMPLETED) {
          updateData.completedAt = new Date();
        }
        if (outputJson) {
          updateData.outputJson = outputJson;
        }
        if (errorMessage) {
          updateData.errorMessage = errorMessage;
        }
        await bgRepo.update(existing.id, updateData);
        this.logger.log(
          '[processWarningJob] Updated background_job ' +
            existing.id +
            ' to ' +
            status,
        );
      } else {
        this.logger.warn(
          '[processWarningJob] No background_job found for meetingId=' +
            meetingId,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        '[' +
          MEETING_WARNING_ERRORS.BACKGROUND_JOB_UPDATE_FAILED +
          '] meetingId=' +
          meetingId +
          ' error=' +
          (error as Error).message,
      );
    }
  }

  // ───────────────────────────────────────────────────────────
  // T010: processWarningJob — 13-step main workflow
  // ───────────────────────────────────────────────────────────
  async processWarningJob(jobData: {
    meetingId: string;
    warningScheduledAt?: string;
    endTime?: string;
  }): Promise<WarningProcessorResult> {
    const meetingId = jobData.meetingId;
    this.logger.log('[processWarningJob] Starting for meetingId=' + meetingId);

    try {
      // STEP 1: Guard — Meeting tồn tại
      const meeting = await this.dataSource
        .getRepository(MeetingEntity)
        .findOne({
          where: { id: meetingId },
        });
      if (!meeting || meeting.deletedAt) {
        this.logger.error(
          '[' +
            MEETING_WARNING_ERRORS.MEETING_NOT_FOUND_FOR_WARNING +
            '] meetingId=' +
            meetingId,
        );
        return { skipped: true, reason: 'meeting_not_found' };
      }

      // STEP 2: Guard — Meeting status
      if (meeting.status !== MeetingStatus.IN_PROGRESS) {
        this.logger.warn(
          '[' +
            MEETING_WARNING_ERRORS.MEETING_NOT_IN_PROGRESS_FOR_WARNING +
            '] meetingId=' +
            meetingId +
            ' status=' +
            meeting.status,
        );
        return { skipped: true, reason: 'meeting_not_in_progress' };
      }

      // STEP 3: Idempotency — dual-source check
      const [existingEvent, existingNotification] = await Promise.all([
        this.dataSource.getRepository(MeetingEventEntity).findOne({
          where: { meetingId, eventType: MeetingEventType.WARNING_SENT },
        }),
        this.dataSource.getRepository(NotificationEntity).findOne({
          where: {
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            notificationType: In([
              NotificationType.MEETING_TIME_WARNING,
              NotificationType.MEETING_TIME_CONFLICT_WARNING,
            ]),
          },
        }),
      ]);

      if (existingEvent || existingNotification) {
        const source = existingEvent ? 'event' : 'notification';
        this.logger.log(
          '[processWarningJob] WARNING_ALREADY_SENT — meetingId=' +
            meetingId +
            ' source=' +
            source,
        );
        return { skipped: true, reason: 'already_sent' };
      }

      // STEP 4: Tính remainingMinutes
      const endTime = meeting.endTime;
      const now = new Date();
      const rawMinutes = Math.floor(
        (endTime.getTime() - now.getTime()) / 60_000,
      );
      const remainingMinutes = Math.max(0, rawMinutes);

      if (rawMinutes < 0) {
        this.logger.warn(
          '[processWarningJob] Late job — meetingId=' +
            meetingId +
            ' delay=' +
            Math.abs(rawMinutes) +
            'min',
        );
      }

      // STEP 5: Đọc conflictBufferConfig
      const conflictBufferMinutes = await this.readConflictBufferConfig();

      // STEP 6: Resolve Host
      const hostId = await this.resolveHost(meeting, meetingId);
      if (!hostId) {
        this.logger.warn(
          '[' +
            MEETING_WARNING_ERRORS.HOST_NOT_RESOLVED +
            '] meetingId=' +
            meetingId,
        );
        return { skipped: true, reason: 'host_not_found' };
      }

      // STEP 7: Conflict detection
      let nextBooking: RoomBookingEntity | null = null;
      if (meeting.roomId != null) {
        try {
          nextBooking = await this.detectConflict(
            meeting.roomId,
            endTime,
            meetingId,
            conflictBufferMinutes,
          );
        } catch (error: unknown) {
          this.logger.error(
            '[' +
              MEETING_WARNING_ERRORS.CONFLICT_DETECTION_FAILED +
              '] meetingId=' +
              meetingId +
              ' error=' +
              (error as Error).message,
          );
          nextBooking = null; // Fallback Branch A
        }
      }

      // STEP 8: Xác định warningLevel + branch
      const branch: 'A' | 'B' = nextBooking != null ? 'B' : 'A';
      let warningLevel: 'standard' | 'overdue' | 'strict' | 'urgent';

      if (branch === 'B') {
        warningLevel = remainingMinutes > 0 ? 'strict' : 'urgent';
      } else {
        warningLevel = remainingMinutes > 0 ? 'standard' : 'overdue';
      }

      const extensionAllowed = branch !== 'B';
      const disableExtensionReason =
        branch === 'B'
          ? 'Phòng đã có lịch cuộc họp kế tiếp. Không thể gia hạn.'
          : null;

      // STEP 9: Build notification payload
      const notificationPayload = this.buildNotificationPayload(
        branch,
        meeting,
        remainingMinutes,
        warningLevel,
        hostId,
        nextBooking ?? undefined,
      );

      // STEP 10: Tạo notifications record
      let notificationId: string | undefined;
      try {
        const saved = await this.dataSource
          .getRepository(NotificationEntity)
          .save(notificationPayload as NotificationEntity);
        notificationId = saved.id;
        this.logger.log(
          '[processWarningJob] Notification created: ' + notificationId,
        );
      } catch (error: unknown) {
        this.logger.error(
          '[' +
            MEETING_WARNING_ERRORS.WARNING_NOTIFICATION_CREATE_FAILED +
            '] meetingId=' +
            meetingId +
            ' error=' +
            (error as Error).message,
        );
        // Best-effort update background_jobs to failed
        await this.updateBackgroundJobStatus(
          meetingId,
          BackgroundJobStatus.FAILED,
          null,
          (error as Error).message,
        ).catch(() => {});
        throw error; // NACK → BullMQ retry
      }

      // STEP 11: Push WebSocket
      try {
        const warningType = branch === 'B' ? 'conflict' : 'standard';

        // Host payload (full)
        const hostPayload = this.buildHostWsPayload(
          branch,
          warningLevel,
          remainingMinutes,
          extensionAllowed,
          disableExtensionReason,
          meetingId,
          endTime,
          nextBooking
            ? {
                bookingId: nextBooking.id,
                reservedStartTime: nextBooking.reservedStartTime.toISOString(),
              }
            : undefined,
        );
        this.websocketService.emitToUser(
          hostId,
          'meeting.time.warning',
          hostPayload,
        );

        // Participant payload (safe)
        const participantPayload = this.buildParticipantWsPayload(
          warningType,
          remainingMinutes,
          meetingId,
          endTime,
        );
        this.websocketService.emitToRoom(
          'meeting:' + meetingId,
          'meeting.time.warning',
          participantPayload,
        );

        this.logger.log(
          '[processWarningJob] WebSocket pushed for meetingId=' + meetingId,
        );
      } catch (error: unknown) {
        this.logger.warn(
          '[' +
            MEETING_WARNING_ERRORS.WARNING_WEBSOCKET_PUSH_FAILED +
            '] meetingId=' +
            meetingId +
            ' error=' +
            (error as Error).message,
        );
        // Non-critical — continue
      }

      // STEP 12: Update background_jobs
      const outputJson: Record<string, unknown> = {
        notificationId,
        warningType: branch === 'B' ? 'conflict' : 'standard',
        warningLevel,
        remainingMinutes,
        branch,
      };
      await this.updateBackgroundJobStatus(
        meetingId,
        BackgroundJobStatus.COMPLETED,
        outputJson,
        null,
      ).catch(() => {});

      // STEP 13: Ghi meeting_events
      try {
        const eventMetadata: Record<string, unknown> = {
          warningType: branch === 'B' ? 'conflict' : 'standard',
          warningLevel,
          remainingMinutes,
          notificationId,
          extensionAllowed,
          conflictBufferMinutes,
        };
        if (nextBooking) {
          eventMetadata.conflictBookingId = nextBooking.id;
        }

        const event = this.dataSource.getRepository(MeetingEventEntity).create({
          meetingId,
          eventType: MeetingEventType.WARNING_SENT,
          eventTime: new Date(),
          actorUserId: null,
          sourceType: MeetingEventSourceType.SCHEDULER,
          description:
            'Warning sent — branch=' +
            branch +
            ' warningLevel=' +
            warningLevel +
            ' remainingMinutes=' +
            remainingMinutes,
          metadataJson: eventMetadata,
        });
        await this.dataSource.getRepository(MeetingEventEntity).save(event);
        this.logger.log(
          '[processWarningJob] meeting_events warning_sent created for meetingId=' +
            meetingId,
        );
      } catch (error: unknown) {
        this.logger.error(
          '[' +
            MEETING_WARNING_ERRORS.MEETING_EVENT_CREATE_FAILED +
            '] meetingId=' +
            meetingId +
            ' error=' +
            (error as Error).message,
        );
        // Non-critical — continue
      }

      // Done
      this.logger.log(
        '[processWarningJob] DONE — meetingId=' +
          meetingId +
          ' branch=' +
          branch +
          ' warningLevel=' +
          warningLevel,
      );
      return {
        skipped: false,
        branch,
        warningLevel,
        notificationId,
        remainingMinutes,
      };
    } catch (error: unknown) {
      // Outer catch — notification failure already logged + thrown
      this.logger.error(
        '[processWarningJob] Unexpected error for meetingId=' +
          meetingId +
          ' error=' +
          (error as Error).message,
      );
      throw error;
    }
  }
}
