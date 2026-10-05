import { lockRoomsForBooking } from '../../../common/utils/room-booking-lock.util.js';
﻿import { UserEntity } from '../../accounts/entities/user.entity.js';
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DataSource,
  In,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
  Not,
} from 'typeorm';

import { MeetingEntity, MeetingStatus } from '../entities/meeting.entity.js';
import {
  MeetingRequestEntity,
  MeetingRequestType,
  ApprovalStatus,
  ConflictCheckStatus,
} from '../entities/meeting-request.entity.js';
import { MeetingParticipantEntity } from '../entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../entities/meeting-external-participant.entity.js';
import {
  buildMeetingInviteEmail,
  buildMeetingRoomUpdatedEmail,
  buildMeetingTimeUpdatedEmail,
} from '../../mail/templates/builders.js';
import { formatDateTimeVN } from '../../mail/templates/layout.js';
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../entities/meeting-event.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
} from '../../rooms/entities/room-booking.entity.js';
import { RoomEventEntity } from '../../rooms/entities/room-event.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';

import { NotificationsService } from '../../notifications/notifications.service.js';
import { GuestInviteService } from '../../guest-access/services/guest-invite.service.js';
import { GuestEmailService } from '../../guest-access/services/guest-email.service.js';
import { GuestInviteIssueResult } from '../../guest-access/types/guest-invite-metadata.type.js';

import { ApproveMeetingRequestDto } from '../dto/approve-meeting-request.dto.js';
import { RejectMeetingRequestDto } from '../dto/reject-meeting-request.dto.js';
import { ApproveResponseDto } from '../dto/approve-response.dto.js';
import { RejectResponseDto } from '../dto/reject-response.dto.js';

import { MeetingsService } from './meetings.service.js';
import type { AuthUser, ClientContext } from './meetings.service.js';
import { ConflictDetailDto } from '../dto/conflict-detail.dto.js';

const SUPPORTED_REQUEST_TYPES = [
  MeetingRequestType.CREATE_MEETING,
  MeetingRequestType.UPDATE_TIME,
  MeetingRequestType.UPDATE_ROOM,
];

interface MeetingApprovalResult {
  meetingId: string;
  meetingTitle: string;
  meetingStartTime: Date;
  meetingEndTime: Date;
  requestType: MeetingRequestType;
  bookingId: string;
  appliedAt: Date;
  participantIds: string[];
  externalEmails: string[];
  /**
   * GLA-001: lời mời khách vừa được sinh trong transaction này (CHỈ
   * CREATE_MEETING, CHỈ khách có email — FR-GLA-004/006). Chứa secret gốc
   * trong bộ nhớ tức thời để ghép mail SAU KHI transaction commit — không
   * dùng lại đâu khác.
   */
  guestInvites: GuestInviteIssueResult[];
  requesterId: string;
  hostId: string | null;
  decisionNote: string | null;
  oldRoomName: string | null;
  newRoomName: string | null;
}

@Injectable()
export class MeetingRequestReviewService {
  private readonly logger = new Logger(MeetingRequestReviewService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    private readonly guestInviteService: GuestInviteService,
    private readonly guestEmailService: GuestEmailService,
    private readonly meetingsService: MeetingsService,
  ) {}

  /**
   * Đọc `system_configs.room_booking_buffer_minutes` (Nhóm B, mặc định 15 phút nếu thiếu
   * config/giá trị không hợp lệ). ORDER BY updated_at DESC vì config_key không có unique
   * constraint trên RDS thật (có thể tồn tại nhiều dòng trùng key).
   */
  private async getRoomBookingBufferMs(): Promise<number> {
    const DEFAULT_MINUTES = 15;
    try {
      const config = await this.dataSource
        .getRepository(SystemConfigEntity)
        .findOne({
          where: { configKey: 'room_booking_buffer_minutes' },
          order: { updatedAt: 'DESC' },
        });
      if (!config) return DEFAULT_MINUTES * 60_000;
      const parsed = parseInt(config.configValue ?? '', 10);
      if (isNaN(parsed) || parsed < 0) {
        return DEFAULT_MINUTES * 60_000;
      }
      return parsed * 60_000;
    } catch {
      return DEFAULT_MINUTES * 60_000;
    }
  }

  async approve(
    requestId: string,
    dto: ApproveMeetingRequestDto,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<ApproveResponseDto> {
    const approvalResult = await this.dataSource.transaction(async (em) => {
      const request = await em.findOne(MeetingRequestEntity, {
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!request) {
        throw new NotFoundException({
          success: false,
          message: 'Không tìm thấy yêu cầu cuộc họp',
          error: {
            code: 'RESOURCE_NOT_FOUND',
            details: { entityType: 'meeting_request', entityId: requestId },
          },
        });
      }

      if (!SUPPORTED_REQUEST_TYPES.includes(request.requestType)) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'Loại yêu cầu không được hỗ trợ',
          error: {
            code: 'UNSUPPORTED_REQUEST_TYPE',
            details: {
              requestType: request.requestType,
              supportedTypes: SUPPORTED_REQUEST_TYPES,
            },
          },
        });
      }

      const isUpdateRequest =
        request.requestType === MeetingRequestType.UPDATE_TIME ||
        request.requestType === MeetingRequestType.UPDATE_ROOM;

      if (request.approvalStatus !== ApprovalStatus.PENDING) {
        throw new ConflictException({
          success: false,
          message: 'Yêu cầu cuộc họp không còn trạng thái chờ duyệt',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: request.approvalStatus,
              expectedStatus: ApprovalStatus.PENDING,
            },
          },
        });
      }

      const meeting = await em.findOne(MeetingEntity, {
        where: { id: request.meetingId! },
      });

      if (!meeting) {
        throw new NotFoundException({
          success: false,
          message: 'Không tìm thấy cuộc họp liên quan',
          error: {
            code: 'RESOURCE_NOT_FOUND',
            details: { entityType: 'meeting', entityId: request.meetingId },
          },
        });
      }

      if (meeting.status !== MeetingStatus.PENDING_APPROVAL) {
        throw new ConflictException({
          success: false,
          message: 'Cuộc họp không còn trạng thái chờ phê duyệt',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: meeting.status,
              expectedStatus: MeetingStatus.PENDING_APPROVAL,
            },
          },
        });
      }

      // (2026-08-16) Phòng của meeting đã bị System/Business Admin xóa khỏi hệ
      // thống (roomId nulled bởi RoomsService.deleteRoom() — UC-ROOM-03) và
      // request này KHÔNG mang theo phòng mới (UPDATE_ROOM tự chọn
      // targetRoomId thì vẫn cho qua) — chặn duyệt tới khi host chọn lại
      // phòng và gửi yêu cầu mới. Chỉ áp dụng cho approve(), KHÔNG áp dụng
      // cho reject() — từ chối một yêu cầu không cần phòng còn tồn tại.
      if (!meeting.roomId && !request.targetRoomId) {
        throw new ConflictException({
          success: false,
          message:
            'Phòng họp của cuộc họp này đã bị xóa khỏi hệ thống. Vui lòng yêu cầu người tổ chức chọn lại phòng trước khi duyệt.',
          error: {
            code: 'MEETING_ROOM_REMOVED',
            details: { meetingId: meeting.id },
          },
        });
      }

      // Loại RELEASED/CANCELLED — 1 meeting có thể có nhiều dòng booking lịch
      // sử (vd đổi phòng khi còn PENDING_APPROVAL tạo booking mới, release
      // booking cũ). orderBy createdAt DESC để lấy booking đang hiệu lực gần
      // nhất nếu có nhiều hơn 1 dòng active (không nên xảy ra, phòng thủ).
      const booking = await em.findOne(RoomBookingEntity, {
        where: {
          meetingId: meeting.id,
          status: In([
            RoomBookingStatus.PENDING,
            RoomBookingStatus.APPROVED,
            RoomBookingStatus.ACTIVE,
          ]),
        },
        order: { createdAt: 'DESC' },
      });

      if (!booking) {
        throw new NotFoundException({
          success: false,
          message: 'Không tìm thấy booking phòng họp liên quan',
          error: {
            code: 'RESOURCE_NOT_FOUND',
            details: { entityType: 'room_booking', entityId: meeting.id },
          },
        });
      }

      // CREATE_MEETING: booking chưa từng được duyệt → phải PENDING.
      // UPDATE_TIME/UPDATE_ROOM: booking đang giữ slot CŨ của 1 meeting đã
      // SCHEDULED → phải APPROVED/ACTIVE (KHÔNG phải PENDING).
      const expectedBookingStatuses = isUpdateRequest
        ? [RoomBookingStatus.APPROVED, RoomBookingStatus.ACTIVE]
        : [RoomBookingStatus.PENDING];
      if (!expectedBookingStatuses.includes(booking.status)) {
        throw new ConflictException({
          success: false,
          message: 'Booking phòng họp không còn ở trạng thái hợp lệ để duyệt',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: booking.status,
              expectedStatus: expectedBookingStatuses,
            },
          },
        });
      }

      if (
        request.requestedBy === authUser.userId ||
        meeting.organizerId === authUser.userId
      ) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không thể tự duyệt yêu cầu cuộc họp do chính mình tạo',
          error: { code: 'SELF_APPROVAL_NOT_ALLOWED' },
        });
      }

      // Slot đích: với CREATE_MEETING, target === slot hiện tại của booking
      // (no-op). Với UPDATE_TIME/UPDATE_ROOM, target là giá trị yêu cầu mới —
      // PHẢI kiểm xung đột lại tại đây vì slot có thể đã bị chiếm giữa lúc
      // gửi yêu cầu và lúc duyệt.
      const targetRoomId = request.targetRoomId || meeting.roomId!;
      const targetStartTime = request.requestedStartTime || meeting.startTime;
      const targetEndTime = request.requestedEndTime || meeting.endTime;

      // F-R4a: deadline duyệt = targetStartTime (CREATE_MEETING → giờ họp gốc;
      // UPDATE_TIME/UPDATE_ROOM → giờ MỚI xin đổi). Quá hạn → chặn duyệt, KHÔNG
      // tự expire ở đây (đó là việc của cron expireOverdueBatch()).
      if (targetStartTime.getTime() <= Date.now()) {
        throw new ConflictException({
          success: false,
          message: 'Yêu cầu đã quá hạn (đã qua giờ họp), không thể duyệt.',
          error: {
            code: 'REQUEST_EXPIRED',
            details: { requestId, deadline: targetStartTime.toISOString() },
          },
        });
      }

      // Chỉ approved/active chặn — KHÔNG được thêm lại pending vào đây: vì
      // pending không còn chặn nhau lúc tạo (feat-create-meeting-manual
      // FR-012), nếu recheck này vẫn tính pending là chặn thì 2 request pending
      // trùng phòng/giờ sẽ mãi mãi chặn lẫn nhau — Manager sẽ không approve
      // được cái nào cả. Request được approve trước sẽ chuyển booking sang
      // approved, khiến các request pending còn lại tự động bị chặn ở đây khi
      // đến lượt duyệt — đó chính là cơ chế Manager "chọn ai được giữ phòng".
      // Buffer (Nhóm B): cần cách nhau tối thiểu bufferMs với booking approved/active.
      // A1 race: khóa phòng đích trước khi re-check để 2 approve đồng thời
      // (đổi giờ/đổi phòng) vào cùng phòng không cùng thấy "trống".
      await lockRoomsForBooking(em, [targetRoomId]);
      const bufferMs = await this.getRoomBookingBufferMs();
      const bufferedTargetStart = new Date(
        targetStartTime.getTime() - bufferMs,
      );
      const bufferedTargetEnd = new Date(targetEndTime.getTime() + bufferMs);
      const conflicts = await em.getRepository(RoomBookingEntity).find({
        where: {
          roomId: targetRoomId,
          id: Not(booking.id),
          status: In([RoomBookingStatus.APPROVED, RoomBookingStatus.ACTIVE]),
          reservedStartTime: LessThan(bufferedTargetEnd),
          reservedEndTime: MoreThan(bufferedTargetStart),
        },
      });

      if (conflicts.length > 0) {
        request.conflictCheckStatus = ConflictCheckStatus.BLOCKED;
        request.conflictCheckedAt = new Date();
        request.conflictSummaryJson = {
          conflicts: conflicts.map((c) => ({
            bookingId: c.id,
            roomId: c.roomId,
            startTime: c.reservedStartTime,
            endTime: c.reservedEndTime,
            status: c.status,
          })),
          checkedAt: new Date().toISOString(),
        };
        await em.save(MeetingRequestEntity, request);

        throw new ConflictException({
          success: false,
          message: 'Phòng họp đã có booking khác trong khung giờ này',
          error: {
            code: 'ROOM_CONFLICT',
            details: {
              conflictingBookings: conflicts.map((c) => c.id),
            },
          },
        });
      }

      const now = new Date();
      const oldMeetingSnapshot = {
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        roomId: meeting.roomId,
      };
      const oldBookingStatus = booking.status;

      request.approvalStatus = ApprovalStatus.APPROVED;
      request.decisionBy = authUser.userId;
      request.decisionAt = now;
      request.appliedAt = now;
      request.conflictCheckStatus = ConflictCheckStatus.CLEAR;
      request.conflictCheckedAt = now;
      if (dto.decisionNote) {
        request.notes = dto.decisionNote;
      }
      await em.save(MeetingRequestEntity, request);

      meeting.status = MeetingStatus.SCHEDULED;
      meeting.startTime = targetStartTime;
      meeting.endTime = targetEndTime;
      meeting.roomId = targetRoomId;
      meeting.updatedBy = authUser.userId;
      meeting.updatedAt = now;
      await em.save(MeetingEntity, meeting);

      // CREATE_MEETING: PENDING → APPROVED (booking mới lần đầu được duyệt).
      // UPDATE_TIME/UPDATE_ROOM: booking "di chuyển" sang slot mới, GIỮ
      // nguyên status hiện có (APPROVED/ACTIVE) — không hạ cấp ACTIVE.
      booking.roomId = targetRoomId;
      booking.reservedStartTime = targetStartTime;
      booking.reservedEndTime = targetEndTime;
      if (booking.status === RoomBookingStatus.PENDING) {
        booking.status = RoomBookingStatus.APPROVED;
      }
      booking.approvedBy = authUser.userId;
      booking.approvedAt = now;
      await em.save(RoomBookingEntity, booking);

      let oldRoomName: string | null = null;
      let newRoomName: string | null = null;
      const roomChanged = oldMeetingSnapshot.roomId !== targetRoomId;

      if (isUpdateRequest) {
        if (roomChanged) {
          const [oldRoom, newRoom] = await Promise.all([
            oldMeetingSnapshot.roomId
              ? em.findOne(RoomEntity, {
                  where: { id: oldMeetingSnapshot.roomId },
                })
              : Promise.resolve(null),
            em.findOne(RoomEntity, { where: { id: targetRoomId } }),
          ]);
          oldRoomName = oldRoom?.roomName || oldMeetingSnapshot.roomId;
          newRoomName = newRoom?.roomName || targetRoomId;

          await em.save(RoomEventEntity, {
            roomId: oldMeetingSnapshot.roomId!,
            meetingId: meeting.id,
            bookingId: booking.id,
            eventType: 'room_released',
            sourceType: 'manual',
            actorUserId: authUser.userId,
            oldStatus: oldBookingStatus,
            newStatus: booking.status,
            description: `Phòng được giải phóng do đổi sang "${newRoomName}" (yêu cầu đã duyệt)`,
          });
          await em.save(RoomEventEntity, {
            roomId: targetRoomId,
            meetingId: meeting.id,
            bookingId: booking.id,
            eventType: 'room_reserved',
            sourceType: 'manual',
            actorUserId: authUser.userId,
            newStatus: booking.status,
            description: `Phòng được đặt từ "${oldRoomName}" (yêu cầu đã duyệt)`,
          });
        }

        const changeEvent = em.create(MeetingEventEntity, {
          meetingId: meeting.id,
          eventType:
            request.requestType === MeetingRequestType.UPDATE_ROOM
              ? MeetingEventType.ROOM_CHANGED
              : MeetingEventType.MEETING_TIME_UPDATED,
          actorUserId: authUser.userId,
          sourceType: MeetingEventSourceType.MANUAL,
          description: `Yêu cầu ${request.requestType === MeetingRequestType.UPDATE_ROOM ? 'đổi phòng' : 'đổi thời gian'} cuộc họp "${meeting.title}" đã được phê duyệt và áp dụng`,
          oldValueJson: oldMeetingSnapshot as any,
          newValueJson: {
            startTime: targetStartTime,
            endTime: targetEndTime,
            roomId: targetRoomId,
          } as any,
        });
        await em.save(MeetingEventEntity, changeEvent);
      }

      const event = em.create(MeetingEventEntity, {
        meetingId: meeting.id,
        eventType: MeetingEventType.MEETING_REQUEST_APPROVED,
        actorUserId: authUser.userId,
        sourceType: MeetingEventSourceType.MANUAL,
        description: `Yêu cầu cuộc họp "${meeting.title}" đã được phê duyệt`,
        oldValueJson: {
          approvalStatus: ApprovalStatus.PENDING,
          meetingStatus: MeetingStatus.PENDING_APPROVAL,
          bookingStatus: oldBookingStatus,
          ...oldMeetingSnapshot,
        } as any,
        newValueJson: {
          approvalStatus: ApprovalStatus.APPROVED,
          meetingStatus: MeetingStatus.SCHEDULED,
          bookingStatus: booking.status,
          startTime: targetStartTime,
          endTime: targetEndTime,
          roomId: targetRoomId,
        } as any,
      });
      await em.save(MeetingEventEntity, event);

      const participants = await em.find(MeetingParticipantEntity, {
        where: { meetingId: meeting.id },
      });
      const externalParticipants = await em.find(
        MeetingExternalParticipantEntity,
        {
          where: { meetingId: meeting.id },
        },
      );

      const participantIds = participants
        .map((p) => p.userId)
        .filter((id): id is string => !!id);
      const externalEmails = externalParticipants
        .map((ep) => ep.email)
        .filter((email): email is string => !!email);

      // GLA-001 (FR-GLA-006): sinh lời mời khách CHỈ khi tạo mới cuộc họp
      // (UPDATE_TIME/UPDATE_ROOM không đổi danh sách khách ngoài công ty —
      // mirror đúng điều kiện `!isUpdateRequest` dùng cho email thông báo
      // chung ở enqueueApprovalNotifications()). CHỈ khách có email — không
      // có email thì không có nơi gửi OTP/link, bỏ qua không lỗi (FR-GLA-004).
      const guestInvites: GuestInviteIssueResult[] = [];
      if (request.requestType === MeetingRequestType.CREATE_MEETING) {
        for (const ep of externalParticipants) {
          if (!ep.email) continue;
          const issued = await this.guestInviteService.issueInvite(em, {
            externalParticipantId: ep.id,
            email: ep.email,
            meetingEndTime: targetEndTime,
            issuedBy: authUser.userId,
          });
          guestInvites.push(issued);
        }
      }

      const auditLog = em.create(AuditLogEntity, {
        userId: authUser.userId,
        actionType: 'approve',
        entityType: 'meeting_request',
        entityId: requestId,
        oldValueJson: {
          approvalStatus: ApprovalStatus.PENDING,
          meetingStatus: MeetingStatus.PENDING_APPROVAL,
          bookingStatus: oldBookingStatus,
          ...oldMeetingSnapshot,
        },
        newValueJson: {
          approvalStatus: ApprovalStatus.APPROVED,
          meetingStatus: MeetingStatus.SCHEDULED,
          bookingStatus: booking.status,
          startTime: targetStartTime,
          endTime: targetEndTime,
          roomId: targetRoomId,
        },
        metadataJson: {
          meetingId: meeting.id,
          bookingId: booking.id,
          decisionNote: dto.decisionNote || null,
          requestId,
          requestType: request.requestType,
        },
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        severity: AuditLogSeverity.INFO,
      });
      await em.save(AuditLogEntity, auditLog);

      return {
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        meetingStartTime: targetStartTime,
        meetingEndTime: targetEndTime,
        requestType: request.requestType,
        bookingId: booking.id,
        appliedAt: now,
        participantIds,
        externalEmails,
        guestInvites,
        requesterId: request.requestedBy,
        hostId: meeting.hostId,
        decisionNote: dto.decisionNote || null,
        oldRoomName,
        newRoomName,
      };
    });

    // ── After transaction: enqueue notifications ──
    await this.enqueueApprovalNotifications(
      approvalResult,
      authUser,
      clientContext,
    );
    // GLA-001: gửi link mời khách SAU commit, độc lập với email thông báo
    // chung ở trên. Best-effort — lỗi gửi mail KHÔNG rollback lời mời đã ghi
    // (mirror writeNotificationFailureAudit ở enqueueApprovalNotifications).
    await this.sendGuestInviteEmails(approvalResult, authUser, clientContext);

    // Best-effort — realtime cho hàng đợi /manager/meeting-approvals (xem
    // MeetingsService#emitMeetingRequestRealtime).
    const approverIds = await this.meetingsService.getMeetingRequestApproverIds();
    this.meetingsService.emitMeetingRequestUpdate(approverIds, {
      requestId,
      meetingId: approvalResult.meetingId,
      requestType: approvalResult.requestType,
      approvalStatus: ApprovalStatus.APPROVED,
      action: 'approved',
    });

    return new ApproveResponseDto({
      requestId,
      approvalStatus: ApprovalStatus.APPROVED,
      meetingId: approvalResult.meetingId,
      bookingId: approvalResult.bookingId,
      appliedAt: approvalResult.appliedAt,
    });
  }

  private async enqueueApprovalNotifications(
    result: MeetingApprovalResult,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<void> {
    const meetingId = result.meetingId;
    const isUpdateRequest =
      result.requestType === MeetingRequestType.UPDATE_TIME ||
      result.requestType === MeetingRequestType.UPDATE_ROOM;

    // CREATE_MEETING: participants đang biết đến meeting LẦN ĐẦU → MEETING_INVITE.
    // UPDATE_TIME/UPDATE_ROOM: participants đã được mời từ trước, chỉ báo thay
    // đổi giờ/phòng vừa được áp dụng → MEETING_TIME_UPDATED/MEETING_ROOM_UPDATED.
    const notifType = !isUpdateRequest
      ? NotificationType.MEETING_INVITE
      : result.requestType === MeetingRequestType.UPDATE_ROOM
        ? NotificationType.MEETING_ROOM_UPDATED
        : NotificationType.MEETING_TIME_UPDATED;
    const subject = !isUpdateRequest
      ? `Thư mời tham dự cuộc họp: ${result.meetingTitle}`
      : result.requestType === MeetingRequestType.UPDATE_ROOM
        ? `Cập nhật phòng họp: ${result.meetingTitle}`
        : `Cập nhật thời gian cuộc họp: ${result.meetingTitle}`;
    const content = !isUpdateRequest
      ? `Bạn được mời tham dự cuộc họp "${result.meetingTitle}" vào lúc ${formatDateTimeVN(result.meetingStartTime)}`
      : result.requestType === MeetingRequestType.UPDATE_ROOM
        ? `Phòng họp cho cuộc họp "${result.meetingTitle}" đã được thay đổi${result.oldRoomName && result.newRoomName ? ` từ "${result.oldRoomName}" sang "${result.newRoomName}"` : ''}.`
        : `Thời gian cuộc họp "${result.meetingTitle}" đã được cập nhật (${formatDateTimeVN(result.meetingStartTime)} → ${formatDateTimeVN(result.meetingEndTime)}).`;
    const emailHtml = !isUpdateRequest
      ? buildMeetingInviteEmail({
          meetingTitle: result.meetingTitle,
          startTime: result.meetingStartTime,
          endTime: result.meetingEndTime,
        })
      : result.requestType === MeetingRequestType.UPDATE_ROOM
        ? buildMeetingRoomUpdatedEmail({
            meetingTitle: result.meetingTitle,
            oldRoomName: result.oldRoomName,
            newRoomName: result.newRoomName ?? '(chưa xác định)',
          })
        : buildMeetingTimeUpdatedEmail({
            meetingTitle: result.meetingTitle,
            newStartTime: result.meetingStartTime,
            newEndTime: result.meetingEndTime,
          });

    // 1. Internal participants — in-app
    for (const uid of result.participantIds) {
      try {
        await this.notificationsService.createNotification({
          notificationType: notifType,
          channel: NotificationChannel.IN_APP,
          subject,
          content,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientScope: 'user_list',
          recipientUserIds: [uid],
          createdBy: authUser.userId,
        });
      } catch (error) {
        this.logger.error(
          `[Approve] Failed to send IN_APP notify to participant ${uid}: ${(error as Error).message}`,
        );
        await this.writeNotificationFailureAudit(
          meetingId,
          authUser,
          clientContext,
          `Failed to notify participant ${uid}: ${(error as Error).message}`,
        );
      }
    }

    // 2. External participants — email (chỉ áp dụng cho CREATE_MEETING —
    // UPDATE_TIME/UPDATE_ROOM không đổi danh sách người ngoài công ty)
    if (!isUpdateRequest) {
      for (const email of result.externalEmails) {
        try {
          await this.notificationsService.enqueueEmailNotification({
            notificationType: notifType,
            channel: NotificationChannel.EMAIL,
            subject,
            content,
            emailHtml,
            toEmails: [email],
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            recipientScope: 'user_list',
            createdBy: authUser.userId,
          });
        } catch (error) {
          this.logger.error(
            `[Approve] Failed to send email to external ${email}: ${(error as Error).message}`,
          );
          await this.writeNotificationFailureAudit(
            meetingId,
            authUser,
            clientContext,
            `Failed to email external ${email}: ${(error as Error).message}`,
          );
        }
      }
    }

    // 3. Requester + host — in-app MEETING_REQUEST_APPROVED
    const notifyUserIds: string[] = [result.requesterId];
    if (result.hostId && !notifyUserIds.includes(result.hostId)) {
      notifyUserIds.push(result.hostId);
    }
    for (const uid of notifyUserIds) {
      try {
        await this.notificationsService.createNotification({
          notificationType: NotificationType.MEETING_REQUEST_APPROVED,
          channel: NotificationChannel.IN_APP,
          subject: `Yêu cầu cuộc họp "${result.meetingTitle}" đã được phê duyệt`,
          content: `Yêu cầu cuộc họp "${result.meetingTitle}" của bạn đã được phê duyệt`,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientScope: 'user_list',
          recipientUserIds: [uid],
          createdBy: authUser.userId,
        });
      } catch (error) {
        this.logger.error(
          `[Approve] Failed to send approved notify to ${uid}: ${(error as Error).message}`,
        );
        await this.writeNotificationFailureAudit(
          meetingId,
          authUser,
          clientContext,
          `Failed to notify ${uid} of approval: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * GLA-001 (FR-GLA-006): gửi email chứa link mời cho từng khách vừa được
   * sinh lời mời trong transaction `approve()`. Độc lập hoàn toàn với luồng
   * `enqueueApprovalNotifications()` — mail này chứa BÍ MẬT (secret trong
   * link), nên PHẢI đi qua `GuestEmailService` (gọi `MailService` trực tiếp,
   * KHÔNG qua `NotificationsService` — xem `GuestEmailService` doc).
   *
   * Best-effort: lỗi gửi mail cho 1 khách KHÔNG ảnh hưởng khách khác, KHÔNG
   * rollback lời mời đã ghi (đã commit trong transaction chính từ trước).
   */
  private async sendGuestInviteEmails(
    result: MeetingApprovalResult,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<void> {
    if (result.guestInvites.length === 0) return;

    const hostId = result.hostId;
    let hostName = 'Chưa xác định';
    if (hostId) {
      const host = await this.dataSource
        .getRepository(UserEntity)
        .findOne({ where: { id: hostId } });
      if (host?.fullName) hostName = host.fullName;
    }

    for (const invite of result.guestInvites) {
      try {
        await this.guestEmailService.sendInviteLink({
          to: invite.email,
          meetingTitle: result.meetingTitle,
          startTime: result.meetingStartTime,
          endTime: result.meetingEndTime,
          hostName,
          link: invite.link,
        });
        await this.dataSource.manager.save(AuditLogEntity, {
          userId: authUser.userId,
          actionType: 'guest_invite_issued',
          entityType: 'meeting_external_participant',
          entityId: invite.externalParticipantId,
          severity: AuditLogSeverity.INFO,
          ipAddress: clientContext.ipAddress || null,
          userAgent: clientContext.userAgent || null,
          metadataJson: {
            meetingId: result.meetingId,
            externalParticipantId: invite.externalParticipantId,
            email: invite.email,
          },
        } as any);
      } catch (error) {
        this.logger.error(
          `[Approve] Failed to send guest invite email to ${invite.email}: ${(error as Error).message}`,
        );
        await this.writeNotificationFailureAudit(
          result.meetingId,
          authUser,
          clientContext,
          `Failed to send guest invite to ${invite.email}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async writeNotificationFailureAudit(
    meetingId: string,
    authUser: AuthUser,
    clientContext: ClientContext,
    detail: string,
  ): Promise<void> {
    try {
      await this.dataSource.manager.save(AuditLogEntity, {
        userId: authUser.userId,
        actionType: 'NOTIFICATION_FAILURE',
        entityType: 'meeting',
        entityId: meetingId,
        severity: AuditLogSeverity.WARNING,
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        metadataJson: { error: detail },
      } as any);
    } catch (auditError) {
      this.logger.error(
        `Failed to write notification failure audit log: ${(auditError as Error).message}`,
      );
    }
  }

  async reject(
    requestId: string,
    dto: RejectMeetingRequestDto,
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<RejectResponseDto> {
    const rejectResult = await this.dataSource.transaction(async (em) => {
      const request = await em.findOne(MeetingRequestEntity, {
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!request) {
        throw new NotFoundException({
          success: false,
          message: 'Không tìm thấy yêu cầu cuộc họp',
          error: {
            code: 'RESOURCE_NOT_FOUND',
            details: { entityType: 'meeting_request', entityId: requestId },
          },
        });
      }

      if (!SUPPORTED_REQUEST_TYPES.includes(request.requestType)) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'Loại yêu cầu không được hỗ trợ',
          error: {
            code: 'UNSUPPORTED_REQUEST_TYPE',
            details: {
              requestType: request.requestType,
              supportedTypes: SUPPORTED_REQUEST_TYPES,
            },
          },
        });
      }

      const isUpdateRequest =
        request.requestType === MeetingRequestType.UPDATE_TIME ||
        request.requestType === MeetingRequestType.UPDATE_ROOM;

      if (request.approvalStatus !== ApprovalStatus.PENDING) {
        throw new ConflictException({
          success: false,
          message: 'Yêu cầu cuộc họp không còn trạng thái chờ duyệt',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: request.approvalStatus,
              expectedStatus: ApprovalStatus.PENDING,
            },
          },
        });
      }

      const meeting = await em.findOne(MeetingEntity, {
        where: { id: request.meetingId! },
      });

      if (!meeting) {
        throw new NotFoundException({
          success: false,
          message: 'Không tìm thấy cuộc họp liên quan',
          error: {
            code: 'RESOURCE_NOT_FOUND',
            details: { entityType: 'meeting', entityId: request.meetingId },
          },
        });
      }

      if (meeting.status !== MeetingStatus.PENDING_APPROVAL) {
        throw new ConflictException({
          success: false,
          message: 'Cuộc họp không còn trạng thái chờ phê duyệt',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: meeting.status,
              expectedStatus: MeetingStatus.PENDING_APPROVAL,
            },
          },
        });
      }

      // Loại RELEASED/CANCELLED — 1 meeting có thể có nhiều dòng booking lịch
      // sử (vd đổi phòng khi còn PENDING_APPROVAL tạo booking mới, release
      // booking cũ). orderBy createdAt DESC để lấy booking đang hiệu lực gần
      // nhất nếu có nhiều hơn 1 dòng active (không nên xảy ra, phòng thủ).
      const booking = await em.findOne(RoomBookingEntity, {
        where: {
          meetingId: meeting.id,
          status: In([
            RoomBookingStatus.PENDING,
            RoomBookingStatus.APPROVED,
            RoomBookingStatus.ACTIVE,
          ]),
        },
        order: { createdAt: 'DESC' },
      });

      if (!booking) {
        throw new NotFoundException({
          success: false,
          message: 'Không tìm thấy booking phòng họp liên quan',
          error: {
            code: 'RESOURCE_NOT_FOUND',
            details: { entityType: 'room_booking', entityId: meeting.id },
          },
        });
      }

      const expectedBookingStatuses = isUpdateRequest
        ? [RoomBookingStatus.APPROVED, RoomBookingStatus.ACTIVE]
        : [RoomBookingStatus.PENDING];
      if (!expectedBookingStatuses.includes(booking.status)) {
        throw new ConflictException({
          success: false,
          message: 'Booking phòng họp không còn ở trạng thái hợp lệ để từ chối',
          error: {
            code: 'INVALID_STATE',
            details: {
              currentStatus: booking.status,
              expectedStatus: expectedBookingStatuses,
            },
          },
        });
      }

      if (
        request.requestedBy === authUser.userId ||
        meeting.organizerId === authUser.userId
      ) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không thể tự duyệt yêu cầu cuộc họp do chính mình tạo',
          error: { code: 'SELF_APPROVAL_NOT_ALLOWED' },
        });
      }

      const now = new Date();
      const oldBookingStatus = booking.status;

      request.approvalStatus = ApprovalStatus.REJECTED;
      request.rejectionReason = dto.rejectionReason;
      request.decisionBy = authUser.userId;
      request.decisionAt = now;
      await em.save(MeetingRequestEntity, request);

      if (isUpdateRequest) {
        // UPDATE_TIME/UPDATE_ROOM bị từ chối: meeting quay lại SCHEDULED với
        // giờ/phòng CŨ — KHÔNG đổi gì trên meeting (1c chưa từng áp dụng thay
        // đổi), KHÔNG đụng booking (vẫn đang giữ đúng slot cũ).
        meeting.status = MeetingStatus.SCHEDULED;
        meeting.updatedBy = authUser.userId;
        meeting.updatedAt = now;
        await em.save(MeetingEntity, meeting);
      } else {
        meeting.status = MeetingStatus.CANCELLED;
        meeting.cancellationReason = dto.rejectionReason;
        meeting.updatedBy = authUser.userId;
        meeting.updatedAt = now;
        await em.save(MeetingEntity, meeting);

        booking.status = RoomBookingStatus.CANCELLED;
        booking.cancellationReason = dto.rejectionReason;
        await em.save(RoomBookingEntity, booking);
      }

      const event = em.create(MeetingEventEntity, {
        meetingId: meeting.id,
        eventType: MeetingEventType.MEETING_REQUEST_REJECTED,
        actorUserId: authUser.userId,
        sourceType: MeetingEventSourceType.MANUAL,
        description: isUpdateRequest
          ? `Yêu cầu ${request.requestType === MeetingRequestType.UPDATE_ROOM ? 'đổi phòng' : 'đổi thời gian'} cuộc họp "${meeting.title}" đã bị từ chối. Giữ nguyên lịch cũ. Lý do: ${dto.rejectionReason}`
          : `Yêu cầu cuộc họp "${meeting.title}" đã bị từ chối. Lý do: ${dto.rejectionReason}`,
        oldValueJson: {
          approvalStatus: ApprovalStatus.PENDING,
          meetingStatus: MeetingStatus.PENDING_APPROVAL,
          bookingStatus: oldBookingStatus,
        } as any,
        newValueJson: {
          approvalStatus: ApprovalStatus.REJECTED,
          meetingStatus: meeting.status,
          bookingStatus: booking.status,
        } as any,
      });
      await em.save(MeetingEventEntity, event);

      const auditLog = em.create(AuditLogEntity, {
        userId: authUser.userId,
        actionType: 'reject',
        entityType: 'meeting_request',
        entityId: requestId,
        oldValueJson: {
          approvalStatus: ApprovalStatus.PENDING,
          meetingStatus: MeetingStatus.PENDING_APPROVAL,
          bookingStatus: oldBookingStatus,
        },
        newValueJson: {
          approvalStatus: ApprovalStatus.REJECTED,
          meetingStatus: meeting.status,
          bookingStatus: booking.status,
        },
        metadataJson: {
          meetingId: meeting.id,
          bookingId: booking.id,
          rejectionReason: dto.rejectionReason,
          requestId,
          requestType: request.requestType,
        },
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        severity: AuditLogSeverity.INFO,
      });
      await em.save(AuditLogEntity, auditLog);

      return {
        meetingTitle: meeting.title,
        meetingId: meeting.id,
        requestType: request.requestType,
        appliedAt: now,
        requesterId: request.requestedBy,
        hostId: meeting.hostId,
        // Nhóm E (2026-08-08) — dùng ở enqueueRejectionNotifications để đính
        // kèm conflictDetails/suggestedAlternatives vào notification. KHÔNG
        // dùng request.conflictSummaryJson: dữ liệu đó (nếu có) được ghi bởi
        // approve() lúc phát hiện ROOM_CONFLICT rồi throw NGAY trong cùng
        // transaction → transaction rollback → save đó KHÔNG BAO GIỜ thực sự
        // commit xuống DB. Phải tự kiểm tra lại xung đột phòng TƯƠI tại đây.
        bookingId: booking.id,
        targetRoomId: request.targetRoomId ?? meeting.roomId,
        requestedStartTime: request.requestedStartTime ?? meeting.startTime,
        requestedEndTime: request.requestedEndTime ?? meeting.endTime,
      };
    });

    // ── After transaction: enqueue notification ──
    await this.enqueueRejectionNotifications(
      rejectResult,
      authUser,
      clientContext,
    );

    // Best-effort — realtime cho hàng đợi /manager/meeting-approvals.
    const approverIds = await this.meetingsService.getMeetingRequestApproverIds();
    this.meetingsService.emitMeetingRequestUpdate(approverIds, {
      requestId,
      meetingId: rejectResult.meetingId,
      requestType: rejectResult.requestType,
      approvalStatus: ApprovalStatus.REJECTED,
      action: 'rejected',
    });

    return new RejectResponseDto({
      requestId,
      approvalStatus: ApprovalStatus.REJECTED,
      decisionAt: rejectResult.appliedAt,
    });
  }

  private async enqueueRejectionNotifications(
    result: {
      meetingTitle: string;
      meetingId: string;
      requesterId: string;
      hostId: string | null;
      bookingId: string;
      targetRoomId: string | null;
      requestedStartTime: Date;
      requestedEndTime: Date;
    },
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<void> {
    // Only the host is notified of a rejection — in-app only, no email.
    const hostUserId = result.hostId ?? result.requesterId;
    const payloadJson = await this.buildRejectionConflictPayload(result);
    try {
      await this.notificationsService.createNotification({
        notificationType: NotificationType.MEETING_REQUEST_REJECTED,
        channel: NotificationChannel.IN_APP,
        subject: `Yêu cầu cuộc họp "${result.meetingTitle}" đã bị từ chối`,
        content: `Yêu cầu cuộc họp "${result.meetingTitle}" của bạn đã bị từ chối.`,
        relatedEntityType: 'meeting',
        relatedEntityId: result.meetingId,
        recipientScope: 'user_list',
        recipientUserIds: [hostUserId],
        createdBy: authUser.userId,
        ...(payloadJson ? { payloadJson } : {}),
      });
    } catch (error) {
      this.logger.error(
        `[Reject] Failed to send rejection notify to ${hostUserId}: ${(error as Error).message}`,
      );
      await this.writeNotificationFailureAudit(
        result.meetingId,
        authUser,
        clientContext,
        `Failed to notify ${hostUserId} of rejection: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Nhóm E (2026-08-08) — kiểm tra TƯƠI (không đọc từ conflict_summary_json —
   * xem ghi chú tại lời gọi trong reject()) xem request vừa bị reject có đang
   * xung đột phòng với booking `approved`/`active` khác không (cùng buffer
   * policy với Nhóm A/B). Nếu có, enrich sang tên phòng/tên cuộc họp/tên host
   * (FR-038) và gợi ý tối đa 5 phòng còn trống cùng khung giờ (FR-039, tái
   * dùng MeetingsService.getAvailableRooms). Trả `null` nếu không có xung đột
   * phòng — reject vì lý do khác (vd participant conflict, hoặc manager chỉ
   * đơn giản không đồng ý) thì không đính kèm gì thêm.
   */
  private async buildRejectionConflictPayload(result: {
    bookingId: string;
    targetRoomId: string | null;
    requestedStartTime: Date;
    requestedEndTime: Date;
  }): Promise<Record<string, unknown> | null> {
    if (!result.targetRoomId) return null;

    const bufferMs = await this.getRoomBookingBufferMs();
    const bufferedStart = new Date(
      result.requestedStartTime.getTime() - bufferMs,
    );
    const bufferedEnd = new Date(result.requestedEndTime.getTime() + bufferMs);

    const bookings = await this.dataSource
      .getRepository(RoomBookingEntity)
      .find({
        where: {
          roomId: result.targetRoomId,
          id: Not(result.bookingId),
          status: In([RoomBookingStatus.APPROVED, RoomBookingStatus.ACTIVE]),
          reservedStartTime: LessThan(bufferedEnd),
          reservedEndTime: MoreThan(bufferedStart),
        },
        relations: { room: true, meeting: true, bookedByUser: true },
      });
    if (bookings.length === 0) return null;

    const conflictDetails: ConflictDetailDto[] = bookings.map((b) => ({
      bookingId: b.id,
      roomName: b.room?.roomName ?? null,
      meetingTitle: b.meeting?.title ?? null,
      startTime: b.reservedStartTime,
      endTime: b.reservedEndTime,
      hostName: b.bookedByUser?.fullName ?? null,
    }));

    let suggestedAlternatives: Array<{
      roomId: string;
      roomName: string;
      capacity: number;
    }> = [];
    try {
      const altRooms = await this.meetingsService.getAvailableRooms(
        result.requestedStartTime,
        result.requestedEndTime,
      );
      suggestedAlternatives = altRooms
        .filter((r) => r.id !== result.targetRoomId)
        .slice(0, 5)
        .map((r) => ({
          roomId: r.id,
          roomName: r.roomName,
          capacity: r.capacity,
        }));
    } catch (error) {
      this.logger.warn(
        `[Reject] Failed to build suggestedAlternatives: ${(error as Error).message}`,
      );
    }

    return { conflictDetails, suggestedAlternatives };
  }

  /**
   * F-R4b — quét meeting_requests PENDING đã quá deadline (requestedStartTime:
   * giờ họp gốc với CREATE_MEETING, giờ MỚI xin đổi với UPDATE_TIME/UPDATE_ROOM)
   * mà chưa ai duyệt/từ chối, tự chuyển sang EXPIRED. Gọi bởi cron
   * `meeting-request-expire` (scheduler.service.ts), gated SCHEDULER_ENABLED &&
   * SCHEDULER_MEETING_REQUEST_EXPIRE_ENABLED (default OFF). Mỗi request xử lý
   * trong transaction riêng, lỗi 1 request KHÔNG chặn batch.
   */
  async expireOverdueBatch(): Promise<{
    scanned: number;
    expired: number;
    failed: number;
  }> {
    const candidates = await this.dataSource
      .getRepository(MeetingRequestEntity)
      .find({
        where: {
          approvalStatus: ApprovalStatus.PENDING,
          requestType: In([
            MeetingRequestType.CREATE_MEETING,
            MeetingRequestType.UPDATE_TIME,
            MeetingRequestType.UPDATE_ROOM,
          ]),
          requestedStartTime: LessThanOrEqual(new Date()),
        },
      });

    let expired = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const done = await this.expireOne(candidate.id);
        if (done) expired++;
      } catch (e) {
        failed++;
        this.logger.error(
          `expireOverdueBatch: request ${candidate.id} failed: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    }
    return { scanned: candidates.length, expired, failed };
  }

  /** Idempotent guard: re-check PENDING trong lock, trả false nếu đã xử lý ở tick khác. */
  private async expireOne(requestId: string): Promise<boolean> {
    let expiredMeetingId: string | null = null;
    let expiredRequestType: MeetingRequestType | null = null;

    const done = await this.dataSource.transaction(async (em) => {
      const request = await em.findOne(MeetingRequestEntity, {
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!request || request.approvalStatus !== ApprovalStatus.PENDING) {
        return false;
      }

      const meeting = await em.findOne(MeetingEntity, {
        where: { id: request.meetingId! },
      });
      if (!meeting || meeting.status !== MeetingStatus.PENDING_APPROVAL) {
        return false;
      }
      expiredMeetingId = meeting.id;
      expiredRequestType = request.requestType;

      const isUpdateRequest =
        request.requestType === MeetingRequestType.UPDATE_TIME ||
        request.requestType === MeetingRequestType.UPDATE_ROOM;
      const now = new Date();
      const reason =
        'Yêu cầu đã hết hạn do không được duyệt trước giờ họp/giờ mới xin đổi.';

      request.approvalStatus = ApprovalStatus.EXPIRED;
      request.decisionAt = now;
      await em.save(MeetingRequestEntity, request);

      if (isUpdateRequest) {
        // UPDATE_TIME/UPDATE_ROOM hết hạn: CHỈ bỏ cờ pending, quay lại
        // SCHEDULED với giờ/phòng CŨ — start_time/room_id chưa từng bị ghi đè
        // lúc pending (xem updateMeetingTime/updateMeetingRoom), nên KHÔNG
        // đụng gì thêm. Booking vẫn giữ đúng slot cũ, không cần sửa.
        meeting.status = MeetingStatus.SCHEDULED;
        meeting.updatedAt = now;
        await em.save(MeetingEntity, meeting);
      } else {
        // CREATE_MEETING hết hạn: booking chết hẳn — hủy meeting + booking.
        meeting.status = MeetingStatus.CANCELLED;
        meeting.cancellationReason = reason;
        meeting.updatedAt = now;
        await em.save(MeetingEntity, meeting);

        const booking = await em.findOne(RoomBookingEntity, {
          where: {
            meetingId: meeting.id,
            status: In([
              RoomBookingStatus.PENDING,
              RoomBookingStatus.APPROVED,
              RoomBookingStatus.ACTIVE,
            ]),
          },
          order: { createdAt: 'DESC' },
        });
        if (booking) {
          booking.status = RoomBookingStatus.CANCELLED;
          booking.cancellationReason = reason;
          await em.save(RoomBookingEntity, booking);
        }
      }

      const event = em.create(MeetingEventEntity, {
        meetingId: meeting.id,
        eventType: MeetingEventType.STATUS_CHANGED,
        actorUserId: null,
        sourceType: MeetingEventSourceType.SCHEDULER,
        description: isUpdateRequest
          ? `Yêu cầu ${request.requestType === MeetingRequestType.UPDATE_ROOM ? 'đổi phòng' : 'đổi thời gian'} cuộc họp "${meeting.title}" đã hết hạn (quá giờ mới xin đổi). Giữ nguyên lịch cũ.`
          : `Yêu cầu cuộc họp "${meeting.title}" đã hết hạn do không được duyệt trước giờ họp. Cuộc họp đã bị hủy.`,
        oldValueJson: {
          approvalStatus: ApprovalStatus.PENDING,
          meetingStatus: MeetingStatus.PENDING_APPROVAL,
        } as any,
        newValueJson: {
          approvalStatus: ApprovalStatus.EXPIRED,
          meetingStatus: meeting.status,
        } as any,
      });
      await em.save(MeetingEventEntity, event);

      const auditLog = em.create(AuditLogEntity, {
        userId: null,
        actionType: 'expire',
        entityType: 'meeting_request',
        entityId: request.id,
        oldValueJson: {
          approvalStatus: ApprovalStatus.PENDING,
          meetingStatus: MeetingStatus.PENDING_APPROVAL,
        },
        newValueJson: {
          approvalStatus: ApprovalStatus.EXPIRED,
          meetingStatus: meeting.status,
        },
        metadataJson: {
          meetingId: meeting.id,
          requestType: request.requestType,
        },
        severity: AuditLogSeverity.WARNING,
      });
      await em.save(AuditLogEntity, auditLog);

      return true;
    });

    // Best-effort — realtime cho hàng đợi /manager/meeting-approvals: request
    // tự hết hạn (cron) trước đây không phát tín hiệu gì ngoài audit log,
    // khiến FE vẫn hiện request đã rời hàng đợi cho tới khi tự bấm "Tải lại".
    if (done && expiredMeetingId) {
      try {
        const approverIds =
          await this.meetingsService.getMeetingRequestApproverIds();
        this.meetingsService.emitMeetingRequestUpdate(approverIds, {
          requestId,
          meetingId: expiredMeetingId,
          requestType: expiredRequestType ?? '',
          approvalStatus: ApprovalStatus.EXPIRED,
          action: 'expired',
        });
      } catch (error) {
        this.logger.warn(
          `[expireOne] WS emit failed for request ${requestId}: ${(error as Error).message}`,
        );
      }
    }

    return done;
  }
}
