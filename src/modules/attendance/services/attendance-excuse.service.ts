import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthzReadRepository } from '../../../modules/auth/repositories/authz-read.repository.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationChannel,
  NotificationType,
} from '../../notifications/entities/notification.entity.js';

const SYSTEM_ADMIN = 'SYSTEM_ADMIN';
const BUSINESS_ADMIN = 'BUSINESS_ADMIN';

/** Gửi / duyệt lý do được tới 24 giờ sau giờ kết thúc cuộc họp (cùng mốc khoá điểm danh). */
const EXCUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

type MeetingRow = {
  id: string;
  title: string;
  status: string;
  end_time: Date;
  host_id: string | null;
  secretary_id: string | null;
  attendance_enabled: boolean;
};

/**
 * Lý do vắng mặt / đi trễ / về sớm (quy định điểm danh dòng 5):
 * thành viên tự nhập 1 lần / cuộc họp (gửi trước được — xin vắng), chủ trì / thư ký duyệt ⇒ 0 điểm,
 * từ chối (bắt buộc ghi lý do) ⇒ giữ điểm trừ.
 */
@Injectable()
export class AttendanceExcuseService {
  private readonly logger = new Logger(AttendanceExcuseService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly authzRead: AuthzReadRepository,
    private readonly notificationsService: NotificationsService,
  ) {}

  async submit(meetingId: string, userId: string, reasonRaw: string) {
    const reason = (reasonRaw ?? '').trim();
    if (reason.length < 5 || reason.length > 1000) {
      throw new BadRequestException({
        message: 'Lý do phải từ 5 đến 1000 ký tự',
        error: 'INVALID_REASON',
      });
    }
    const meeting = await this.loadMeeting(meetingId);
    this.assertWithinWindow(meeting);

    const [participant] = await this.dataSource.query(
      `SELECT id, excuse_status FROM meeting_participants
        WHERE meeting_id = $1 AND user_id = $2 AND invitation_status <> 'declined'`,
      [meetingId, userId],
    );
    if (!participant) {
      throw new ForbiddenException({
        message: 'Bạn không phải thành viên cuộc họp này',
        error: 'USER_NOT_PARTICIPANT',
      });
    }
    if (participant.excuse_status) {
      throw new ConflictException({
        message: 'Bạn đã gửi lý do cho cuộc họp này (mỗi người chỉ gửi 1 lần)',
        error: 'EXCUSE_ALREADY_SUBMITTED',
      });
    }
    const [record] = await this.dataSource.query(
      `SELECT attendance_status, is_late, left_early FROM attendance_records
        WHERE meeting_id = $1 AND user_id = $2 ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      [meetingId, userId],
    );
    if (record && record.attendance_status === 'present' && !record.is_late && !record.left_early) {
      throw new BadRequestException({
        message: 'Bạn đã có mặt đúng giờ, không cần gửi lý do',
        error: 'NOTHING_TO_EXCUSE',
      });
    }

    await this.dataSource.query(
      `UPDATE meeting_participants
          SET excuse_reason = $2, excuse_status = 'pending', excuse_submitted_at = NOW(),
              excuse_reviewed_by = NULL, excuse_reviewed_at = NULL, excuse_review_note = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [participant.id, reason],
    );

    const [me] = await this.dataSource.query(`SELECT full_name FROM users WHERE id = $1`, [userId]);
    const reviewers = [...new Set([meeting.host_id, meeting.secretary_id].filter(
      (id): id is string => !!id && id !== userId,
    ))];
    await this.notify(
      reviewers,
      NotificationType.ATTENDANCE_EXCUSE_SUBMITTED,
      `Lý do vắng/trễ chờ duyệt: ${meeting.title}`,
      `${me?.full_name ?? 'Thành viên'} gửi lý do: "${reason}"`,
      meetingId,
      userId,
    );
    return this.getExcuse(meetingId, userId);
  }

  async review(
    meetingId: string,
    targetUserId: string,
    approve: boolean,
    noteRaw: string | undefined,
    actorUserId: string,
  ) {
    const note = (noteRaw ?? '').trim();
    if (!approve && note.length < 3) {
      throw new BadRequestException({
        message: 'Vui lòng nhập lý do từ chối',
        error: 'REVIEW_NOTE_REQUIRED',
      });
    }
    const meeting = await this.loadMeeting(meetingId);
    const isAdmin = await this.isAdmin(actorUserId);
    if (!isAdmin) {
      if (actorUserId !== meeting.host_id && actorUserId !== meeting.secretary_id) {
        throw new ForbiddenException({
          message: 'Chỉ chủ trì hoặc thư ký được duyệt lý do',
          error: 'PERMISSION_DENIED',
        });
      }
      this.assertWithinWindow(meeting);
    }
    if (actorUserId === targetUserId && !isAdmin) {
      throw new ForbiddenException({
        message: 'Không thể tự duyệt lý do của chính mình',
        error: 'SELF_REVIEW_NOT_ALLOWED',
      });
    }

    const [participant] = await this.dataSource.query(
      `SELECT id, excuse_status FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2`,
      [meetingId, targetUserId],
    );
    if (!participant || participant.excuse_status !== 'pending') {
      throw new ConflictException({
        message: 'Không có lý do nào đang chờ duyệt',
        error: 'EXCUSE_NOT_PENDING',
      });
    }

    await this.dataSource.transaction(async (m) => {
      await m.query(
        `UPDATE meeting_participants
            SET excuse_status = $2, excuse_reviewed_by = $3, excuse_reviewed_at = NOW(),
                excuse_review_note = $4, updated_at = NOW()
          WHERE id = $1`,
        [participant.id, approve ? 'approved' : 'rejected', actorUserId, note || null],
      );
      // penalty_points = NULL ⇒ trigger fn_attendance_penalty tính lại (EXCUSED nếu đã duyệt).
      await m.query(
        `UPDATE attendance_records SET penalty_points = NULL, updated_at = NOW()
          WHERE meeting_id = $1 AND user_id = $2`,
        [meetingId, targetUserId],
      );
    });

    await this.notify(
      [targetUserId],
      NotificationType.ATTENDANCE_EXCUSE_REVIEWED,
      approve
        ? `Lý do của bạn đã được duyệt: ${meeting.title}`
        : `Lý do của bạn bị từ chối: ${meeting.title}`,
      approve
        ? 'Bạn được ghi nhận "Có lý do" (0 điểm trừ).'
        : `Lý do từ chối: "${note}". Điểm trừ được giữ nguyên.`,
      meetingId,
      actorUserId,
    );
    return this.getExcuse(meetingId, targetUserId);
  }

  private async getExcuse(meetingId: string, userId: string) {
    const [row] = await this.dataSource.query(
      `SELECT user_id AS "userId", excuse_reason AS "excuseReason", excuse_status AS "excuseStatus",
              excuse_submitted_at AS "excuseSubmittedAt", excuse_reviewed_at AS "excuseReviewedAt",
              excuse_review_note AS "excuseReviewNote"
         FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2`,
      [meetingId, userId],
    );
    return row;
  }

  private async loadMeeting(meetingId: string): Promise<MeetingRow> {
    const [meeting] = await this.dataSource.query(
      `SELECT id, title, status, end_time, host_id, secretary_id, attendance_enabled
         FROM meetings WHERE id = $1 AND deleted_at IS NULL`,
      [meetingId],
    );
    if (!meeting) {
      throw new NotFoundException({ message: 'Meeting not found', error: 'MEETING_NOT_FOUND' });
    }
    if (!meeting.attendance_enabled) {
      throw new BadRequestException({
        message: 'Cuộc họp này không bật điểm danh',
        error: 'ATTENDANCE_DISABLED',
      });
    }
    if (meeting.status === 'cancelled') {
      throw new ConflictException({ message: 'Cuộc họp đã bị huỷ', error: 'MEETING_CANCELLED' });
    }
    return meeting;
  }

  private assertWithinWindow(meeting: MeetingRow) {
    if (Date.now() > new Date(meeting.end_time).getTime() + EXCUSE_WINDOW_MS) {
      throw new ConflictException({
        message: 'Đã quá 24 giờ sau khi cuộc họp kết thúc',
        error: 'ATTENDANCE_LOCKED',
      });
    }
  }

  private async isAdmin(userId: string) {
    const { roles } = await this.authzRead.getEffectiveRolesAndPermissions(userId);
    return roles.includes(SYSTEM_ADMIN) || roles.includes(BUSINESS_ADMIN);
  }

  private async notify(
    userIds: string[],
    type: NotificationType,
    subject: string,
    content: string,
    meetingId: string,
    createdBy: string,
  ) {
    for (const uid of userIds) {
      try {
        await this.notificationsService.createNotification({
          notificationType: type,
          channel: NotificationChannel.IN_APP,
          subject,
          content,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientScope: 'user_list',
          recipientUserIds: [uid],
          createdBy,
        });
      } catch (e) {
        this.logger.warn(`Gửi thông báo lý do điểm danh thất bại: ${(e as Error).message}`);
      }
    }
  }
}
