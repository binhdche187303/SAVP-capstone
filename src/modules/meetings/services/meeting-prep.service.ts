import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { CloudinaryService } from '../../storage/cloudinary.service.js';
import {
  MediaFileEntity,
  MediaFileType,
} from '../../recording/entities/media-file.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationChannel,
  NotificationType,
} from '../../notifications/entities/notification.entity.js';
import { formatDateTimeVN } from '../../mail/templates/layout.js';
import {
  AGENDA_ATTACHMENT_ALLOWED_MIME_TYPES,
  AGENDA_ATTACHMENT_MAX_BYTES_DEFAULT,
  AGENDA_ATTACHMENT_MIME_TO_EXTENSIONS,
} from '../constants/agenda-attachment.constants.js';
import type {
  MeetingReportRequirementDto,
  MeetingSignoffDto,
} from '../dto/create-meeting.dto.js';
import type { UploadedAgendaAttachmentFile } from './meetings.service.js';

type MeetingRow = {
  id: string;
  title: string;
  status: string;
  start_time: Date;
  organizer_id: string | null;
  host_id: string | null;
  secretary_id: string | null;
  report_required: boolean;
  report_deadline_minutes: number | null;
  report_note: string | null;
  signoff_required: boolean;
  signoff_user_id: string | null;
  signoff_status: 'pending' | 'approved' | 'returned' | null;
  signoff_minutes_id: string | null;
  signoff_note: string | null;
  signoff_at: Date | null;
};

/**
 * Lịch UEL mục 12 + 13: nộp báo cáo trước họp và trình ký biên bản sau họp.
 * Người quản lý = người đặt lịch / chủ trì / thư ký / admin.
 */
@Injectable()
export class MeetingPrepService {
  private readonly logger = new Logger(MeetingPrepService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly cloudinaryService?: CloudinaryService,
  ) {}

  /** Lưu yêu cầu nộp báo cáo / trình ký ngay sau khi tạo cuộc họp. */
  async applyCreateOptions(
    meetingId: string,
    opts: { reportRequirement?: MeetingReportRequirementDto; signoff?: MeetingSignoffDto },
  ): Promise<void> {
    const { reportRequirement: rep, signoff } = opts;
    if (!rep && !signoff) return;
    const meeting = await this.loadMeeting(meetingId);
    const memberIds = await this.memberIds(meetingId);
    if (rep) {
      const userIds = [...new Set(rep.userIds)].filter((id) => memberIds.has(id));
      if (userIds.length === 0) {
        throw new BadRequestException({
          success: false,
          message: 'Người nộp báo cáo phải là thành viên cuộc họp',
          error: { code: 'REPORT_ASSIGNEE_NOT_PARTICIPANT', details: {} },
        });
      }
      await this.dataSource.query(
        `UPDATE meetings SET report_required = true, report_deadline_minutes = $2, report_note = $3 WHERE id = $1`,
        [meetingId, rep.deadlineMinutes, rep.note?.trim() || null],
      );
      await this.dataSource.query(
        `INSERT INTO meeting_report_submissions (meeting_id, user_id)
         SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [meetingId, userIds],
      );
      const deadline = new Date(new Date(meeting.start_time).getTime() - rep.deadlineMinutes * 60_000);
      await this.notify(
        NotificationType.MEETING_REPORT_REQUESTED,
        meeting,
        userIds,
        `Yêu cầu nộp báo cáo: ${meeting.title}`,
        `Bạn được giao nộp báo cáo cho cuộc họp "${meeting.title}" (${formatDateTimeVN(meeting.start_time)}). Hạn nộp: ${formatDateTimeVN(deadline)}.${rep.note?.trim() ? ` Nội dung: ${rep.note.trim()}` : ''}`,
      );
    }
    if (signoff) {
      const signerId = signoff.signerId || meeting.host_id;
      if (!signerId || !memberIds.has(signerId)) {
        throw new BadRequestException({
          success: false,
          message: 'Người ký duyệt biên bản phải là thành viên cuộc họp',
          error: { code: 'SIGNER_NOT_PARTICIPANT', details: {} },
        });
      }
      await this.dataSource.query(
        `UPDATE meetings SET signoff_required = true, signoff_user_id = $2 WHERE id = $1`,
        [meetingId, signerId],
      );
    }
  }

  /** Thông tin báo cáo + trình ký cho trang chi tiết (chỉ thành viên / người quản lý). */
  async getPrep(meetingId: string, userId: string, isAdmin: boolean) {
    const m = await this.loadMeeting(meetingId);
    const memberIds = await this.memberIds(meetingId);
    const canManage = isAdmin || this.isManager(m, userId);
    if (!canManage && !memberIds.has(userId)) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không phải thành viên cuộc họp',
        error: { code: 'NOT_MEETING_MEMBER', details: {} },
      });
    }

    let report: Record<string, unknown> | null = null;
    if (m.report_required) {
      const rows: Array<{
        user_id: string;
        full_name: string;
        submitted_at: Date | null;
        file_id: string | null;
        file_name: string | null;
      }> = await this.dataSource.query(
        `SELECT s.user_id, u.full_name, s.submitted_at, f.id AS file_id, f.file_name
           FROM meeting_report_submissions s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN media_files f ON f.id = s.media_file_id AND f.deleted_at IS NULL
          WHERE s.meeting_id = $1
          ORDER BY u.full_name`,
        [meetingId],
      );
      const deadline = this.reportDeadline(m);
      const toItem = (r: (typeof rows)[number]) => ({
        userId: r.user_id,
        fullName: r.full_name,
        submittedAt: r.submitted_at,
        file: r.file_id ? { id: r.file_id, fileName: r.file_name } : null,
      });
      const mine = rows.find((r) => r.user_id === userId);
      report = {
        deadline,
        deadlineMinutes: m.report_deadline_minutes,
        note: m.report_note,
        isOverdue: deadline.getTime() < Date.now(),
        submittedCount: rows.filter((r) => r.submitted_at).length,
        totalCount: rows.length,
        mine: mine ? toItem(mine) : null,
        // Người được giao chỉ thấy phần của mình; người quản lý thấy cả danh sách.
        items: canManage ? rows.map(toItem) : null,
      };
    }

    let signoff: Record<string, unknown> | null = null;
    if (m.signoff_required) {
      const [signer] = await this.dataSource.query(
        `SELECT id, full_name FROM users WHERE id = $1`,
        [m.signoff_user_id],
      );
      const isSigner = m.signoff_user_id === userId;
      const logs: Array<{ action: string; note: string | null; created_at: Date; actor_name: string | null }> =
        canManage || isSigner
          ? await this.dataSource.query(
              `SELECT l.action, l.note, l.created_at, u.full_name AS actor_name
                 FROM meeting_signoff_logs l LEFT JOIN users u ON u.id = l.actor_id
                WHERE l.meeting_id = $1 ORDER BY l.created_at`,
              [meetingId],
            )
          : [];
      let minutes: Record<string, unknown> | null = null;
      if (m.signoff_minutes_id && (isSigner || canManage)) {
        const [mm] = await this.dataSource.query(
          `SELECT id, title, minutes_content, version_no, status FROM meeting_minutes
            WHERE id = $1 AND deleted_at IS NULL`,
          [m.signoff_minutes_id],
        );
        if (mm) {
          minutes = {
            id: mm.id,
            title: mm.title,
            content: mm.minutes_content,
            versionNo: mm.version_no,
            status: mm.status,
          };
        }
      }
      const [draft] = await this.dataSource.query(
        `SELECT updated_at FROM meeting_minutes WHERE meeting_id = $1 AND deleted_at IS NULL AND status = 'draft'
          ORDER BY updated_at DESC LIMIT 1`,
        [meetingId],
      );
      const needsEdit =
        m.signoff_status === 'returned' && !!draft && !!m.signoff_at && new Date(draft.updated_at) <= new Date(m.signoff_at);
      signoff = {
        hasDraft: !!draft,
        needsEdit,
        signer: signer ? { id: signer.id, fullName: signer.full_name } : null,
        status: m.signoff_status,
        note: m.signoff_note,
        signedAt: m.signoff_at,
        isSigner,
        canSubmit: canManage && m.status === 'completed' && m.signoff_status !== 'pending' && m.signoff_status !== 'approved' && !needsEdit,
        canReview: isSigner && m.signoff_status === 'pending',
        minutes,
        history: logs.map((l) => ({
          action: l.action,
          note: l.note,
          at: l.created_at,
          actorName: l.actor_name,
        })),
      };
    }

    return { canManage, report, signoff };
  }

  /** Người được giao nộp (hoặc nộp lại) file báo cáo. */
  async submitReport(
    meetingId: string,
    userId: string,
    file: UploadedAgendaAttachmentFile | undefined,
  ) {
    const m = await this.loadMeeting(meetingId);
    const [assigned] = await this.dataSource.query(
      `SELECT media_file_id FROM meeting_report_submissions WHERE meeting_id = $1 AND user_id = $2`,
      [meetingId, userId],
    );
    if (!m.report_required || !assigned) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không được giao nộp báo cáo cho cuộc họp này',
        error: { code: 'REPORT_NOT_ASSIGNED', details: {} },
      });
    }
    if (['completed', 'cancelled', 'in_progress'].includes(m.status)) {
      throw new ConflictException({
        success: false,
        message: 'Cuộc họp đã diễn ra hoặc đã huỷ, không thể nộp báo cáo',
        error: { code: 'REPORT_CLOSED', details: { status: m.status } },
      });
    }
    if (!file || !file.buffer?.length) {
      throw new BadRequestException({
        success: false,
        message: 'Vui lòng chọn file báo cáo',
        error: { code: 'REPORT_FILE_REQUIRED', details: {} },
      });
    }
    // multer giải mã tên file latin1 ⇒ đổi lại utf8 cho tên tiếng Việt.
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = extname(fileName).toLowerCase();
    if (
      file.size > AGENDA_ATTACHMENT_MAX_BYTES_DEFAULT ||
      !AGENDA_ATTACHMENT_ALLOWED_MIME_TYPES.includes(file.mimetype) ||
      !AGENDA_ATTACHMENT_MIME_TO_EXTENSIONS[file.mimetype]?.includes(ext)
    ) {
      throw new BadRequestException({
        success: false,
        message: 'Chỉ nhận file Word, Excel, PowerPoint hoặc PDF, tối đa 20MB',
        error: { code: 'REPORT_FILE_INVALID', details: {} },
      });
    }
    if (!this.cloudinaryService) {
      throw new BadGatewayException({
        success: false,
        message: 'Kho lưu trữ chưa được cấu hình',
        error: { code: 'STORAGE_UNAVAILABLE', details: {} },
      });
    }

    const mediaFileId = randomUUID();
    const uploaded = await this.cloudinaryService
      .uploadRawFile(file.buffer, `meeting-reports/${mediaFileId}${ext}`)
      .catch((e) => {
        this.logger.error(`submitReport upload failed: ${e instanceof Error ? e.message : e}`);
        throw new BadGatewayException({
          success: false,
          message: 'Không thể lưu file lên kho lưu trữ',
          error: { code: 'REPORT_STORAGE_FAILED', details: {} },
        });
      });

    const now = new Date();
    await this.dataSource.transaction(async (em) => {
      await em.getRepository(MediaFileEntity).insert({
        id: mediaFileId,
        meetingId,
        relatedEntityType: 'meeting_report',
        relatedEntityId: meetingId,
        uploadedBy: userId,
        fileName,
        fileType: MediaFileType.DOCUMENT,
        mimeType: file.mimetype,
        storageProvider: this.cloudinaryService!.resolveMediaStorageProvider(),
        storageKey: uploaded.publicId,
        fileUrl: uploaded.secureUrl,
        fileSizeBytes: String(file.buffer.length),
        isActive: true,
        uploadedAt: now,
      });
      if (assigned.media_file_id) {
        await em.query(`UPDATE media_files SET deleted_at = NOW(), is_active = false WHERE id = $1`, [
          assigned.media_file_id,
        ]);
      }
      await em.query(
        `UPDATE meeting_report_submissions SET media_file_id = $3, submitted_at = $4
          WHERE meeting_id = $1 AND user_id = $2`,
        [meetingId, userId, mediaFileId, now],
      );
    });
    return { fileId: mediaFileId, fileName, submittedAt: now };
  }

  /** Thư ký / người soạn trình biên bản cho người ký. */
  async submitSignoff(meetingId: string, userId: string, isAdmin: boolean, minutesId?: string) {
    const m = await this.loadMeeting(meetingId);
    if (!m.signoff_required) {
      throw new ConflictException({
        success: false,
        message: 'Cuộc họp này không yêu cầu trình ký biên bản',
        error: { code: 'SIGNOFF_NOT_REQUIRED', details: {} },
      });
    }
    if (!isAdmin && !this.isManager(m, userId)) {
      throw new ForbiddenException({
        success: false,
        message: 'Chỉ người đặt lịch, chủ trì hoặc thư ký được trình ký',
        error: { code: 'SIGNOFF_FORBIDDEN', details: {} },
      });
    }
    if (m.status !== 'completed') {
      throw new ConflictException({
        success: false,
        message: 'Cuộc họp chưa kết thúc, chưa thể trình ký biên bản',
        error: { code: 'MEETING_NOT_COMPLETED', details: { status: m.status } },
      });
    }
    if (m.signoff_status === 'pending' || m.signoff_status === 'approved') {
      throw new ConflictException({
        success: false,
        message: m.signoff_status === 'pending' ? 'Biên bản đang chờ ký' : 'Biên bản đã được ký duyệt',
        error: { code: 'SIGNOFF_INVALID_STATE', details: { status: m.signoff_status } },
      });
    }
    const [minutes] = await this.dataSource.query(
      `SELECT id, title, updated_at FROM meeting_minutes
        WHERE meeting_id = $1 AND deleted_at IS NULL AND status = 'draft'
          AND ($2::uuid IS NULL OR id = $2)
        ORDER BY updated_at DESC LIMIT 1`,
      [meetingId, minutesId ?? null],
    );
    if (!minutes) {
      throw new ConflictException({
        success: false,
        message: 'Chưa có biên bản nháp để trình ký',
        error: { code: 'SIGNOFF_NO_DRAFT', details: {} },
      });
    }
    // Bị trả lại ⇒ phải sửa biên bản theo góp ý rồi mới trình lại.
    if (m.signoff_status === 'returned' && m.signoff_at && new Date(minutes.updated_at) <= new Date(m.signoff_at)) {
      throw new ConflictException({
        success: false,
        message: 'Cần chỉnh sửa biên bản theo góp ý trước khi trình ký lại',
        error: { code: 'SIGNOFF_EDIT_REQUIRED', details: {} },
      });
    }
    await this.dataSource.transaction(async (em) => {
      await em.query(
        `UPDATE meetings SET signoff_status = 'pending', signoff_minutes_id = $2, signoff_note = NULL, signoff_at = NULL WHERE id = $1`,
        [meetingId, minutes.id],
      );
      await em.query(
        `INSERT INTO meeting_signoff_logs (meeting_id, minutes_id, action, actor_id) VALUES ($1, $2, 'submitted', $3)`,
        [meetingId, minutes.id, userId],
      );
    });
    await this.notify(MINUTES_SIGNOFF_REQ, m, [m.signoff_user_id], `Biên bản "${m.title}" chờ bạn ký duyệt`,
      `Biên bản cuộc họp "${m.title}" (${formatDateTimeVN(m.start_time)}) đã được trình ký. Vui lòng xem và duyệt hoặc trả lại.`);
    return { status: 'pending' };
  }

  /** Người ký duyệt / trả lại biên bản. */
  async reviewSignoff(meetingId: string, userId: string, decision: 'approve' | 'return', note?: string) {
    const m = await this.loadMeeting(meetingId);
    if (m.signoff_user_id !== userId) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không phải người ký duyệt biên bản này',
        error: { code: 'NOT_SIGNER', details: {} },
      });
    }
    if (m.signoff_status !== 'pending') {
      throw new ConflictException({
        success: false,
        message: 'Biên bản không ở trạng thái chờ ký',
        error: { code: 'SIGNOFF_INVALID_STATE', details: { status: m.signoff_status } },
      });
    }
    const trimmed = note?.trim() || null;
    if (decision === 'return' && !trimmed) {
      throw new BadRequestException({
        success: false,
        message: 'Vui lòng ghi góp ý khi trả lại biên bản',
        error: { code: 'SIGNOFF_NOTE_REQUIRED', details: {} },
      });
    }
    const status = decision === 'approve' ? 'approved' : 'returned';
    await this.dataSource.transaction(async (em) => {
      await em.query(
        `UPDATE meetings SET signoff_status = $2, signoff_note = $3, signoff_at = NOW() WHERE id = $1`,
        [meetingId, status, trimmed],
      );
      if (decision === 'approve') {
        await em.query(
          `UPDATE meeting_minutes SET approved_by = $2, approved_at = NOW() WHERE id = $1`,
          [m.signoff_minutes_id, userId],
        );
      }
      await em.query(
        `INSERT INTO meeting_signoff_logs (meeting_id, minutes_id, action, actor_id, note) VALUES ($1, $2, $3, $4, $5)`,
        [meetingId, m.signoff_minutes_id, status, userId, trimmed],
      );
    });
    const managers = [m.secretary_id, m.organizer_id, m.host_id].filter((x) => x && x !== userId);
    await this.notify(
      MINUTES_SIGNOFF_RES,
      m,
      managers,
      decision === 'approve' ? `Biên bản "${m.title}" đã được ký duyệt` : `Biên bản "${m.title}" bị trả lại`,
      decision === 'approve'
        ? `Biên bản cuộc họp "${m.title}" đã được ký duyệt, có thể ban hành.`
        : `Biên bản cuộc họp "${m.title}" bị trả lại. Góp ý: ${trimmed}`,
    );
    return { status };
  }

  /** Gọi từ issueMinutes: chặn ban hành khi cuộc họp yêu cầu trình ký mà chưa được duyệt. */
  async assertCanIssue(meetingId: string, minutesId: string): Promise<void> {
    const [m] = await this.dataSource.query(
      `SELECT signoff_required, signoff_status, signoff_minutes_id FROM meetings WHERE id = $1`,
      [meetingId],
    );
    if (m?.signoff_required && !(m.signoff_status === 'approved' && m.signoff_minutes_id === minutesId)) {
      throw new ConflictException({
        success: false,
        message: 'Biên bản cần được người ký duyệt trước khi ban hành',
        error: { code: 'MINUTES_SIGNOFF_REQUIRED', details: { signoffStatus: m.signoff_status } },
      });
    }
  }

  /** Gọi từ updateDraft: sửa biên bản đã trình / đã ký ⇒ phải trình ký lại. */
  async resetSignoffOnEdit(minutesId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE meetings SET signoff_status = NULL, signoff_at = NULL
        WHERE signoff_minutes_id = $1 AND signoff_status IN ('pending', 'approved')`,
      [minutesId],
    );
  }

  /**
   * Cron: thông báo người được giao khi có yêu cầu (lần đầu) và nhắc người chưa nộp khi
   * còn ≤ 1 ngày tới hạn. Đánh dấu reminded_at trước khi gửi ⇒ không nhắc trùng.
   */
  async remindReportsBatch(): Promise<{ reminded: number }> {
    const res = await this.dataSource.query(`
      UPDATE meeting_report_submissions s SET reminded_at = NOW()
        FROM meetings m
       WHERE m.id = s.meeting_id AND m.deleted_at IS NULL AND m.report_required
         AND m.status IN ('scheduled', 'pending_approval') AND s.submitted_at IS NULL AND s.reminded_at IS NULL
         AND m.start_time - make_interval(mins => COALESCE(m.report_deadline_minutes, 0)) > NOW()
         AND m.start_time - make_interval(mins => COALESCE(m.report_deadline_minutes, 0)) <= NOW() + interval '1 day'
      RETURNING s.meeting_id, s.user_id, m.title, m.start_time, m.report_deadline_minutes`);
    const rows: Array<{ meeting_id: string; user_id: string; title: string; start_time: Date; report_deadline_minutes: number }> =
      Array.isArray(res[0]) ? res[0] : res;
    const byMeeting = new Map<string, typeof rows>();
    for (const r of rows) byMeeting.set(r.meeting_id, [...(byMeeting.get(r.meeting_id) ?? []), r]);
    for (const [meetingId, list] of byMeeting) {
      const first = list[0];
      const deadline = new Date(new Date(first.start_time).getTime() - (first.report_deadline_minutes ?? 0) * 60_000);
      await this.notificationsService
        .createNotification({
          notificationType: NotificationType.MEETING_REPORT_REQUESTED,
          channel: NotificationChannel.IN_APP,
          subject: `Nhắc nộp báo cáo: ${first.title}`,
          content: `Bạn chưa nộp báo cáo cho cuộc họp "${first.title}". Hạn nộp: ${formatDateTimeVN(deadline)}.`,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          recipientScope: 'user_list',
          recipientUserIds: list.map((x) => x.user_id),
        })
        .catch((e) => this.logger.error(`remindReportsBatch ${meetingId}: ${e instanceof Error ? e.message : e}`));
    }
    return { reminded: rows.length };
  }

  // ── helpers ──

  private reportDeadline(m: MeetingRow): Date {
    return new Date(new Date(m.start_time).getTime() - (m.report_deadline_minutes ?? 0) * 60_000);
  }

  private isManager(m: MeetingRow, userId: string): boolean {
    return [m.organizer_id, m.host_id, m.secretary_id].includes(userId);
  }

  private async loadMeeting(meetingId: string): Promise<MeetingRow> {
    const [m] = await this.dataSource.query(
      `SELECT id, title, status, start_time, organizer_id, host_id, secretary_id,
              report_required, report_deadline_minutes, report_note,
              signoff_required, signoff_user_id, signoff_status, signoff_minutes_id, signoff_note, signoff_at
         FROM meetings WHERE id = $1 AND deleted_at IS NULL`,
      [meetingId],
    );
    if (!m) {
      throw new NotFoundException({
        success: false,
        message: 'Cuộc họp không tồn tại',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }
    return m;
  }

  private async memberIds(meetingId: string): Promise<Set<string>> {
    const rows: Array<{ user_id: string }> = await this.dataSource.query(
      `SELECT user_id FROM meeting_participants WHERE meeting_id = $1 AND user_id IS NOT NULL
       UNION SELECT host_id FROM meetings WHERE id = $1 AND host_id IS NOT NULL`,
      [meetingId],
    );
    return new Set(rows.map((r) => r.user_id));
  }

  private async notify(
    type: NotificationType,
    m: MeetingRow,
    userIds: Array<string | null>,
    subject: string,
    content: string,
  ): Promise<void> {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (ids.length === 0) return;
    await this.notificationsService
      .createNotification({
        notificationType: type,
        channel: NotificationChannel.IN_APP,
        subject,
        content,
        relatedEntityType: 'meeting',
        relatedEntityId: m.id,
        recipientScope: 'user_list',
        recipientUserIds: ids,
      })
      .catch((e) => this.logger.error(`notify ${type} ${m.id}: ${e instanceof Error ? e.message : e}`));
  }

  /**
   * Kho biên bản › "Cần xử lý": cuộc họp yêu cầu trình ký, đã kết thúc, chưa ban hành,
   * mà user là chủ trì / thư ký / người ký. Mỗi dòng = 1 việc cần làm.
   */
  async minutesInbox(userId: string) {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT m.id, m.title, m.start_time, m.end_time, m.host_id, m.secretary_id,
              m.signoff_user_id, m.signoff_status, m.signoff_note, m.signoff_minutes_id,
              r.room_name, h.full_name AS host_name, s.full_name AS secretary_name, g.full_name AS signer_name,
              (SELECT mm.id FROM meeting_minutes mm WHERE mm.meeting_id = m.id AND mm.deleted_at IS NULL
                  AND mm.status = 'draft' ORDER BY mm.updated_at DESC LIMIT 1) AS draft_id,
              (SELECT mm.title FROM meeting_minutes mm WHERE mm.meeting_id = m.id AND mm.deleted_at IS NULL
                  AND mm.status = 'draft' ORDER BY mm.updated_at DESC LIMIT 1) AS draft_title,
              m.signoff_at,
              (SELECT mm.updated_at FROM meeting_minutes mm WHERE mm.meeting_id = m.id AND mm.deleted_at IS NULL
                  AND mm.status = 'draft' ORDER BY mm.updated_at DESC LIMIT 1) AS draft_updated_at
         FROM meetings m
         LEFT JOIN rooms r ON r.id = m.room_id
         LEFT JOIN users h ON h.id = m.host_id
         LEFT JOIN users s ON s.id = m.secretary_id
         LEFT JOIN users g ON g.id = m.signoff_user_id
        WHERE m.deleted_at IS NULL AND m.signoff_required = true AND m.status = 'completed'
          AND (m.host_id = $1 OR m.secretary_id = $1 OR m.signoff_user_id = $1)
          AND NOT EXISTS (SELECT 1 FROM meeting_minutes mm WHERE mm.meeting_id = m.id
                AND mm.deleted_at IS NULL AND mm.status IN ('published', 'archived'))
        ORDER BY m.start_time DESC
        LIMIT 200`,
      [userId],
    );
    const items = rows.map((r) => {
      const isSigner = r.signoff_user_id === userId;
      const isHost = r.host_id === userId;
      const isSecretary = r.secretary_id === userId;
      let stage: 'not_drafted' | 'not_submitted' | 'pending_review' | 'returned' | 'approved';
      if (r.signoff_status === 'pending') stage = 'pending_review';
      else if (r.signoff_status === 'approved') stage = 'approved';
      else if (r.signoff_status === 'returned') stage = 'returned';
      else stage = r.draft_id ? 'not_submitted' : 'not_drafted';
      // Việc của chính user ở bước hiện tại (để đếm badge + tô nổi)
      // Người soạn = thư ký (không có thư ký thì chủ trì)
      const isComposer = isSecretary || (!r.secretary_id && isHost);
      const needsEdit =
        stage === 'returned' && !!r.draft_updated_at && !!r.signoff_at &&
        new Date(r.draft_updated_at) <= new Date(r.signoff_at);
      const mine =
        (stage === 'pending_review' && isSigner) ||
        (stage === 'approved' && isHost) ||
        (['not_drafted', 'not_submitted', 'returned'].includes(stage) && isComposer);
      return {
        meetingId: r.id,
        title: r.title,
        startTime: r.start_time,
        endTime: r.end_time,
        roomName: r.room_name,
        hostName: r.host_name,
        secretaryName: r.secretary_name,
        signerName: r.signer_name,
        stage,
        mine,
        note: r.signoff_note,
        minutesId: r.signoff_minutes_id || r.draft_id,
        minutesTitle: r.draft_title,
        canReview: stage === 'pending_review' && isSigner,
        needsEdit,
        canSubmit: (stage === 'not_submitted' || stage === 'returned') && !!r.draft_id && isComposer && !needsEdit,
        canEdit: (stage === 'not_drafted' || stage === 'returned') && isComposer,
        canIssue: stage === 'approved' && isHost,
      };
    });
    return { items, mineCount: items.filter((i) => i.mine).length };
  }
}

const MINUTES_SIGNOFF_REQ = NotificationType.MINUTES_SIGNOFF_REQUESTED;
const MINUTES_SIGNOFF_RES = NotificationType.MINUTES_SIGNOFF_RESULT;
