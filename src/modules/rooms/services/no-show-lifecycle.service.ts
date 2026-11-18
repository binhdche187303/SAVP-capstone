import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuditLogSeverity } from '../../administration/entities/audit-log.entity.js';
import { NoShowConfigService } from './no-show-config.service.js';
import { NoShowConfirmTokenService } from './no-show-confirm-token.service.js';
import { buildNoShowAlertEmail } from '../../mail/templates/builders.js';
import { LiveMeetingService } from '../../live-meeting/services/live-meeting.service.js';
import { MEETING_END_ERRORS } from '../../live-meeting/constants/meeting-end-error.constant.js';

interface CaseRef {
  id: string;
  booking_id: string;
  meeting_id: string;
  room_id: string;
}

interface ReleaseTargetRow {
  booking_id: string;
  meeting_id: string;
  room_id: string;
}

interface IdRow {
  id: string;
}

interface MeetingPartyRow {
  organizer_id: string | null;
  host_id: string | null;
}

interface RoomNameRow {
  room_name: string | null;
}

interface EmailRow {
  email: string | null;
}

interface CaseStatusRow {
  id: string;
  detection_status: string;
}

export interface ReleaseParams {
  caseId: string;
  actor: string | null; // null = system (auto), uuid = admin (manual)
  reason: string;
  mode: 'auto' | 'manual';
}

export type ReleaseResult = {
  released: boolean;
  skipped?: 'already_released' | 'booking_changed';
};

/**
 * NoShowLifecycleService (NSL-001 #32/#33/#33b) — chuyển trạng thái no-show.
 *
 * reconcilePresence (R1): non-terminal có presence → resolved/kept (KHÔNG release).
 * warnBatch (#32): risk + no presence + đủ grace → warning_sent + notify (idempotent).
 * release (§4 dùng chung auto+manual): 1 transaction, guard rows-affected (case + booking).
 * autoReleaseBatch (#33): warning_sent quá deadline → release(auto).
 * manualRelease (#33b): pre-check 404/400 + map skip → 200/409.
 *
 * SEC-03 bind raw-SQL. SEC-01 notify/audit metadata-only.
 *
 * [FIX 2026-08-13] release() giờ CÓ mutate meetings (đổi từ ARCH-01 cũ): sau khi phòng
 * được giải phóng (auto lẫn manual), gọi endMeetingDueToNoShow() best-effort để kết thúc
 * luôn meeting gắn với booking đó — tránh trạng thái "phòng đã giải phóng nhưng meeting
 * vẫn in_progress + ghi hình chạy tiếp cho phòng trống" tới tận scheduled end_time (đã xác
 * nhận qua thực tế, không phải suy đoán). Tái dùng NGUYÊN LiveMeetingService.endMeeting()
 * (đã test kỹ, tự dừng ghi hình + hủy warning job + notify) — KHÔNG viết lại logic kết
 * thúc phiên. Có chủ đích đổi lại comment cũ ở autoStartDueMeetings() (live-meeting.service.ts)
 * từng ghi "no-show không chặn vòng đời trạng thái" — quyết định đó CHỈ còn đúng cho bước
 * detect/warn (không đổi), KHÔNG còn đúng cho bước release cuối cùng (nay chủ động kết thúc).
 * meeting kết thúc do no-show vẫn mang status COMPLETED như mọi meeting khác (giữ đúng luật
 * sẵn có "started meeting chỉ completed, không cancelled" — meetings.service.ts:2694-2710) —
 * phân biệt no-show bằng join no_show_cases/room_events, KHÔNG thêm status mới.
 */
@Injectable()
export class NoShowLifecycleService {
  private readonly logger = new Logger(NoShowLifecycleService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly websocketService: WebsocketService,
    private readonly notificationsService: NotificationsService,
    private readonly noShowConfigService: NoShowConfigService,
    private readonly auditLogsService: AuditLogsService,
    private readonly liveMeetingService: LiveMeetingService,
    private readonly noShowConfirmTokenService: NoShowConfirmTokenService,
  ) {}

  // ── R1: reconcile presence ────────────────────────────────────────────────
  /**
   * Non-terminal (risk|warning_sent|snoozed) có first_presence_at → resolved/kept.
   * [Việc B, tái đánh giá 2026-08-21] Thêm 'snoozed' — presence thật là câu trả lời
   * dứt khoát, không cần chờ hết hạn gia hạn (snooze_until) nữa.
   */
  async reconcilePresence(): Promise<{ scanned: number; resolved: number }> {
    const result: unknown = await this.dataSource.manager.query(
      `UPDATE no_show_cases nc
          SET detection_status = 'resolved',
              resolution_status = 'kept',
              note = COALESCE(nc.note, 'presence detected; not a no-show')
         FROM room_booking_usages u
        WHERE u.booking_id = nc.booking_id
          AND u.first_presence_at IS NOT NULL
          AND nc.detection_status IN ('risk','warning_sent','snoozed')
        RETURNING nc.id`,
    );
    const n = this.rowsOf<IdRow>(result).length;
    return { scanned: n, resolved: n };
  }

  // ── #32: warn ─────────────────────────────────────────────────────────────
  /** risk + no presence + (now ≥ detected_at + warning_grace) → warning_sent + notify. */
  async warnBatch(): Promise<{ scanned: number; warned: number }> {
    // E (chỉnh): fetch config 1 lần lấy cả warning_grace + auto_release_grace.
    const { warningGraceMinutes, autoReleaseGraceMinutes } =
      await this.noShowConfigService.getValues();

    const candidates: CaseRef[] = await this.dataSource.manager.query(
      `SELECT nc.id, nc.booking_id, nc.meeting_id, nc.room_id
         FROM no_show_cases nc
         JOIN room_bookings b ON b.id = nc.booking_id
         LEFT JOIN room_booking_usages u ON u.booking_id = nc.booking_id
        WHERE nc.detection_status = 'risk'
          AND b.status IN ('approved','active')
          AND u.first_presence_at IS NULL
          AND nc.detected_at + ($1::int * interval '1 minute') <= now()`,
      [warningGraceMinutes],
    );

    let warned = 0;
    for (const cand of candidates) {
      try {
        // Idempotent: chỉ chuyển khi vẫn 'risk' (race-safe giữa tick/instance).
        const upd: unknown = await this.dataSource.manager.query(
          `UPDATE no_show_cases
              SET detection_status = 'warning_sent',
                  warning_sent_at = now(),
                  warning_deadline_at = now() + ($2::int * interval '1 minute'),
                  auto_release_eligible_at = now() + ($2::int * interval '1 minute')
            WHERE id = $1 AND detection_status = 'risk'
            RETURNING id`,
          [cand.id, autoReleaseGraceMinutes],
        );
        if (this.rowsOf<IdRow>(upd).length === 0) continue; // đã warn ở tick khác
        warned++;
        await this.notifyNoShow(cand, 'warning');
      } catch (e) {
        this.logger.error(`warn case ${cand.id} failed: ${this.errMsg(e)}`);
      }
    }
    return { scanned: candidates.length, warned };
  }

  // ── §4: release dùng chung (auto + manual) ────────────────────────────────
  async release(params: ReleaseParams): Promise<ReleaseResult> {
    const { caseId, actor, reason, mode } = params;
    const isAuto = mode === 'auto';
    const resolutionStatus = isAuto ? 'released' : 'manual_override';
    // Nguồn hợp lệ: 'snoozed' thêm vào CẢ 2 nhánh (Việc B tái đánh giá 2026-08-21) —
    // auto: hết hạn gia hạn "Tôi vẫn đến" vẫn không có presence (autoReleaseBatch()).
    // manual: admin có quyền room.noshow.release được override release ngay cả khi
    // case đang snoozed (vd thấy rõ phòng trống dù còn hạn gia hạn) — mirror đúng
    // quyền admin đã có sẵn để release từ 'risk' (chưa từng cảnh báo) ở nhánh manual cũ.
    const validSources = isAuto
      ? ['warning_sent', 'snoozed']
      : ['risk', 'warning_sent', 'snoozed'];

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // B (chỉnh): UPDATE ... RETURNING lấy rows-affected + ids trong 1 query.
      const caseUpd: unknown = await queryRunner.manager.query(
        `UPDATE no_show_cases
            SET detection_status = 'released',
                resolution_status = $2,
                released_at = now(),
                resolved_by = $3,
                note = COALESCE($4, note)
          WHERE id = $1 AND detection_status = ANY($5)
          RETURNING booking_id, meeting_id, room_id`,
        [caseId, resolutionStatus, actor, reason, validSources],
      );
      const caseRows = this.rowsOf<ReleaseTargetRow>(caseUpd);
      if (caseRows.length === 0) {
        // R2: 0 row → đã released/transition khác → chống double-release.
        await queryRunner.rollbackTransaction();
        return { released: false, skipped: 'already_released' };
      }
      const { booking_id, meeting_id, room_id } = caseRows[0];

      // OQ-1 guard: chỉ release booking đang approved/active; 0 row → abort.
      const bookingUpd: unknown = await queryRunner.manager.query(
        `UPDATE room_bookings
            SET status = 'released', cancellation_reason = $2
          WHERE id = $1 AND status IN ('approved','active')
          RETURNING id`,
        [booking_id, reason],
      );
      if (this.rowsOf<IdRow>(bookingUpd).length === 0) {
        await queryRunner.rollbackTransaction();
        return { released: false, skipped: 'booking_changed' };
      }

      // OQ-5: mutate-if-exists (booking_id UNIQUE → ≤1 row).
      const usageUpd: unknown = await queryRunner.manager.query(
        `UPDATE room_booking_usages
            SET usage_status = 'released', auto_released = $2, released_by = $3,
                released_at = now(), release_reason = $4
          WHERE booking_id = $1
          RETURNING id`,
        [booking_id, isAuto, actor, reason],
      );
      const usageMutated = this.rowsOf<IdRow>(usageUpd).length > 0;

      // room_events: T0 — cột là description (không 'reason'); source_type NOT NULL.
      await queryRunner.manager.query(
        `INSERT INTO room_events
           (room_id, meeting_id, booking_id, event_type, source_type, actor_user_id, description, metadata_json)
         VALUES ($1, $2, $3, $4, 'system', $5, $6, $7::jsonb)`,
        [
          room_id,
          meeting_id,
          booking_id,
          isAuto ? 'room_auto_released' : 'room_manual_released',
          actor,
          reason,
          JSON.stringify({ noShowCaseId: caseId, usageMutated }),
        ],
      );

      await queryRunner.commitTransaction();

      // Sau commit (best-effort): notify + kết thúc meeting + (manual) audit.
      await this.notifyNoShow(
        { id: caseId, booking_id, meeting_id, room_id },
        'released',
      );
      await this.endMeetingDueToNoShow(meeting_id);
      if (mode === 'manual') {
        await this.auditLogsService.logAction({
          userId: actor ?? undefined,
          actionType: 'no_show_manual_release',
          entityType: 'no_show_case',
          entityId: caseId,
          severity: AuditLogSeverity.WARNING,
          metadataJson: { bookingId: booking_id, roomId: room_id, reason },
        });
      }
      return { released: true };
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  // ── #33: auto-release batch ───────────────────────────────────────────────
  async autoReleaseBatch(): Promise<{
    scanned: number;
    released: number;
    skipped: number;
  }> {
    // F3: đọc flag 1 lần/batch (NC-2 pattern). false → skip toàn bộ, không mutate.
    const { autoReleaseEnabled } = await this.noShowConfigService.getValues();
    if (!autoReleaseEnabled) {
      return { scanned: 0, released: 0, skipped: 0 };
    }

    // [Việc B, tái đánh giá 2026-08-21] Gộp thêm nhánh 'snoozed' hết hạn snooze_until
    // vào ĐÚNG cùng batch này (không tạo cron riêng) — cùng release() dùng chung phía
    // dưới đã tự nhận diện nguồn qua validSources.
    const candidates: IdRow[] = await this.dataSource.manager.query(
      `SELECT nc.id
         FROM no_show_cases nc
         JOIN room_bookings b ON b.id = nc.booking_id
         LEFT JOIN room_booking_usages u ON u.booking_id = nc.booking_id
        WHERE b.status IN ('approved','active')
          AND u.first_presence_at IS NULL
          AND (
            (nc.detection_status = 'warning_sent'
              AND nc.auto_release_eligible_at IS NOT NULL
              AND nc.auto_release_eligible_at <= now())
            OR
            (nc.detection_status = 'snoozed'
              AND nc.snooze_until IS NOT NULL
              AND nc.snooze_until <= now())
          )`,
    );

    let released = 0;
    let skipped = 0;
    for (const cand of candidates) {
      try {
        // C (chỉnh): reason='auto_release_no_show'.
        const r = await this.release({
          caseId: cand.id,
          actor: null,
          reason: 'auto_release_no_show',
          mode: 'auto',
        });
        if (r.released) released++;
        else skipped++;
      } catch (e) {
        skipped++;
        this.logger.error(
          `auto-release case ${cand.id} failed: ${this.errMsg(e)}`,
        );
      }
    }
    return { scanned: candidates.length, released, skipped };
  }

  // ── #33b: manual release (pre-check + map skip) ───────────────────────────
  async manualRelease(
    id: string,
    reason: string,
    adminId: string | null,
  ): Promise<Record<string, unknown>> {
    const rows: CaseStatusRow[] = await this.dataSource.manager.query(
      `SELECT id, detection_status FROM no_show_cases WHERE id = $1 LIMIT 1`,
      [id],
    );
    const current = rows[0];
    if (!current) {
      throw new NotFoundException({
        code: 'NO_SHOW_CASE_NOT_FOUND',
        message: 'No-show case not found.',
      });
    }
    // A (chỉnh): đã released → 200 no-op.
    if (current.detection_status === 'released') {
      return { noShowCaseId: id, detectionStatus: 'released', released: false };
    }
    // dismissed|resolved → 400.
    if (
      current.detection_status === 'dismissed' ||
      current.detection_status === 'resolved'
    ) {
      throw new BadRequestException({
        code: 'INVALID_NO_SHOW_TRANSITION',
        message: 'Cannot release a dismissed/resolved case.',
      });
    }

    const r = await this.release({
      caseId: id,
      actor: adminId,
      reason,
      mode: 'manual',
    });
    // A (chỉnh): map giá trị trả về.
    if (r.skipped === 'already_released') {
      return { noShowCaseId: id, detectionStatus: 'released', released: false };
    }
    if (r.skipped === 'booking_changed') {
      throw new ConflictException({
        code: 'BOOKING_NOT_RELEASABLE',
        message: 'Booking is no longer releasable (status changed).',
      });
    }
    return { noShowCaseId: id, detectionStatus: 'released', released: true };
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  /** D (chỉnh): recipientScope user_list + dedupe organizer/host + bỏ null. */
  private async notifyNoShow(
    c: CaseRef,
    kind: 'warning' | 'released',
  ): Promise<void> {
    try {
      const meetingRows: MeetingPartyRow[] =
        await this.dataSource.manager.query(
          `SELECT organizer_id, host_id FROM meetings WHERE id = $1 LIMIT 1`,
          [c.meeting_id],
        );
      const m = meetingRows[0];
      if (!m) return;
      const recipientUserIds = Array.from(
        new Set([m.organizer_id, m.host_id].filter((x): x is string => !!x)),
      );
      if (recipientUserIds.length === 0) return;

      const roomRows: RoomNameRow[] = await this.dataSource.manager.query(
        `SELECT room_name FROM rooms WHERE id = $1 LIMIT 1`,
        [c.room_id],
      );
      const roomLabel = roomRows[0]?.room_name ?? c.room_id;

      const subject =
        kind === 'warning'
          ? 'Cảnh báo no-show'
          : 'Phòng đã giải phóng (no-show)';
      const content =
        kind === 'warning'
          ? `Phòng ${roomLabel} chưa có người sau giờ bắt đầu — cảnh báo no-show.`
          : `Phòng ${roomLabel} đã được giải phóng do no-show.`;
      const meta = {
        noShowCaseId: c.id,
        bookingId: c.booking_id,
        meetingId: c.meeting_id,
        roomId: c.room_id,
        kind,
      };

      await this.notificationsService.createNotification({
        notificationType: NotificationType.NO_SHOW_ALERT,
        channel: NotificationChannel.IN_APP,
        subject,
        content,
        recipientScope: 'user_list',
        recipientUserIds,
        relatedEntityType: 'no_show_case',
        relatedEntityId: c.id,
        payloadJson: meta,
      });

      try {
        this.websocketService.emitToRoom(
          `meeting:${c.meeting_id}`,
          'meeting.noshow.alert',
          meta,
        );
      } catch (e) {
        this.logger.warn(`WS emit noshow failed: ${this.errMsg(e)}`);
      }

      const emailEnabled = this.configService.get<boolean>(
        'NO_SHOW_ALERT_EMAIL_ENABLED',
        false,
      );
      // [DEBUG TẠM 2026-08-21 — gỡ sau khi bắt được nguyên nhân, KHÔNG đổi hành vi]
      this.logger.debug(
        `[DEBUG notifyNoShow] case=${c.id} kind=${kind} emailEnabled=${emailEnabled} recipientUserIds=${JSON.stringify(recipientUserIds)}`,
      );
      if (emailEnabled) {
        const emailRows: EmailRow[] = await this.dataSource.manager.query(
          `SELECT email FROM users WHERE id = ANY($1) AND deleted_at IS NULL`,
          [recipientUserIds],
        );
        const toEmails = emailRows
          .map((r) => r.email)
          .filter((e): e is string => !!e);
        // [DEBUG TẠM 2026-08-21 — gỡ sau khi bắt được nguyên nhân, KHÔNG đổi hành vi]
        this.logger.debug(
          `[DEBUG notifyNoShow] case=${c.id} kind=${kind} toEmails=${JSON.stringify(toEmails)}`,
        );
        if (toEmails.length > 0) {
          // [Việc B, Hướng 2] Link "Tôi vẫn đến" — CHỈ build khi kind='warning' (case
          // còn non-terminal tại thời điểm soạn email). Best-effort: lỗi ký token
          // KHÔNG được làm hỏng cả email cảnh báo — bỏ qua CTA, vẫn gửi email thường.
          let confirmLink: string | undefined;
          if (kind === 'warning') {
            try {
              const token = await this.noShowConfirmTokenService.sign({
                caseId: c.id,
                userId: recipientUserIds[0],
              });
              confirmLink = this.noShowConfirmTokenService.buildLink(
                this.configService.get<string>('APP_URL', ''),
                token,
              );
            } catch (e) {
              this.logger.warn(
                `sign no-show confirm token failed (case ${c.id}): ${this.errMsg(e)}`,
              );
            }
          }
          // [DEBUG TẠM 2026-08-21 — gỡ sau khi bắt được nguyên nhân, KHÔNG đổi hành vi]
          this.logger.debug(
            `[DEBUG notifyNoShow] case=${c.id} kind=${kind} CHUẨN BỊ GỌI enqueueEmailNotification, confirmLink=${confirmLink ?? 'undefined'}`,
          );
          await this.notificationsService.enqueueEmailNotification({
            notificationType: NotificationType.NO_SHOW_ALERT,
            channel: NotificationChannel.EMAIL,
            subject,
            content,
            emailHtml: buildNoShowAlertEmail({
              kind,
              roomName: roomLabel,
              confirmLink,
            }),
            toEmails,
            payloadJson: meta,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`notifyNoShow ${c.id} failed: ${this.errMsg(e)}`);
    }
  }

  /**
   * [FIX 2026-08-13] Kết thúc meeting gắn với booking vừa bị no-show giải phóng — best-
   * effort, KHÔNG ném ra ngoài release() (giống notifyNoShow, ARCH-02). Tái dùng nguyên
   * LiveMeetingService.endMeeting() (đã tự dừng ghi hình/hủy warning job/notify) — actor
   * = organizer của chính meeting đó (system gọi thay, giống pattern
   * autoCompleteOverdueMeetings() ở live-meeting.service.ts).
   *
   * Bỏ qua êm (log info, KHÔNG coi là lỗi) các trạng thái đã hợp lệ không cần xử lý thêm:
   * meeting không còn tồn tại, đã completed/cancelled trước đó (race với luồng khác), hoặc
   * vẫn đang `scheduled` (SCHEDULER_MEETING_STATUS_ENABLED tắt/chưa kịp tick — endMeeting()
   * chỉ nhận IN_PROGRESS, cạnh hiếm này chưa xử lý, để nguyên chờ auto-complete theo end_time
   * như trước — KHÔNG mở rộng thêm nhánh cancelMeeting() vì cancelMeeting() cũng chặn cứng
   * bằng check `now() >= startTime`, luôn đúng ở đây nên vẫn sẽ throw MEETING_ALREADY_STARTED).
   */
  private async endMeetingDueToNoShow(meetingId: string): Promise<void> {
    try {
      const rows: Array<{ organizer_id: string | null }> =
        await this.dataSource.manager.query(
          `SELECT organizer_id FROM meetings WHERE id = $1 LIMIT 1`,
          [meetingId],
        );
      const organizerId = rows[0]?.organizer_id;
      if (!organizerId) {
        this.logger.warn(
          `endMeetingDueToNoShow: meeting ${meetingId} not found or no organizer, skip`,
        );
        return;
      }

      await this.liveMeetingService.endMeeting(
        meetingId,
        { userId: organizerId },
        { userAgent: 'no-show-auto-release' },
      );
      this.logger.log(
        `endMeetingDueToNoShow: meeting ${meetingId} ended (source=no_show_release)`,
      );
    } catch (e) {
      const code =
        e instanceof HttpException
          ? (e.getResponse() as { error?: { code?: string } })?.error?.code
          : undefined;
      if (
        code === MEETING_END_ERRORS.MEETING_ALREADY_COMPLETED ||
        code === MEETING_END_ERRORS.MEETING_NOT_FOUND ||
        code === MEETING_END_ERRORS.MEETING_CANCELLED
      ) {
        this.logger.debug(
          `endMeetingDueToNoShow: meeting ${meetingId} already terminal (${code}), skip`,
        );
      } else if (code === MEETING_END_ERRORS.MEETING_NOT_STARTED) {
        this.logger.log(
          `endMeetingDueToNoShow: meeting ${meetingId} still scheduled (chưa tới IN_PROGRESS), ` +
            `chưa kết thúc được — chờ auto-complete theo end_time như trước fix này`,
        );
      } else {
        this.logger.error(
          `endMeetingDueToNoShow: meeting ${meetingId} failed: ${this.errMsg(e)}`,
        );
      }
    }
  }

  /** UPDATE…RETURNING qua TypeORM trả [rows,count]; SELECT/INSERT trả rows. Chuẩn hoá. */
  private rowsOf<T>(result: unknown): T[] {
    if (Array.isArray(result)) {
      const head: unknown = result[0];
      if (Array.isArray(head)) return head as T[];
      return result as T[];
    }
    return [];
  }

  private errMsg(e: unknown): string {
    return e instanceof Error ? e.message : 'unknown';
  }
}
