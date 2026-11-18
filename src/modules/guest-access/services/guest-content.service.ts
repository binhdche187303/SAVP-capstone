import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import { MeetingAgendaEntity } from '../../meetings/entities/meeting-agenda.entity.js';
import { MeetingParticipantEntity } from '../../meetings/entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity.js';
import { MeetingNoteEntity } from '../../meetings/entities/meeting-note.entity.js';
import {
  RecordingSessionEntity,
  RecordingSessionStatus,
} from '../../recording/entities/recording-session.entity.js';
import { MediaFileEntity } from '../../recording/entities/media-file.entity.js';
import { MediaFilesService } from '../../recording/services/media-files.service.js';
import { GuestLobbyService } from './guest-lobby.service.js';
import { GuestAttendanceService } from './guest-attendance.service.js';
import { GuestRequestContext } from '../types/guest-jwt-payload.type.js';

/**
 * Quy ước "ghi chú được host chia sẻ" (spec mục 1.5.1 — Mức B): dùng giá trị
 * MỚI `guest_shared` cho `meeting_notes.visibility_level` — KHÔNG tái dụng
 * `participants` sẵn có (sẽ làm lộ hồi tố mọi note cũ, xem spec mục 7.1).
 *
 * LƯU Ý QUAN TRỌNG (giới hạn đã biết của đợt implement này): phía GHI (host
 * đánh dấu 1 note là `guest_shared` khi tạo/sửa) CHƯA được nối dây — đó thuộc
 * `feat-in-meeting-notes` (`CreateNoteDto` hiện chỉ cho phép
 * `private/participants/department/public_internal`), một feature khác đã
 * có spec/test riêng. Sửa DTO đó nằm NGOÀI phạm vi đã duyệt của GLA-001 (rủi
 * ro regression cho feature không thuộc diff này). Phần đọc ở đây đã sẵn
 * sàng đúng theo quy ước — chỉ cần bổ sung 1 task nhỏ ở `feat-in-meeting-notes`
 * để mở khóa phía ghi.
 */
export const GUEST_SHARED_NOTE_VISIBILITY = 'guest_shared';

export interface GuestMeetingParticipantView {
  fullName: string;
  organizationName: string | null;
}

export interface GuestAgendaAttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: string | null;
  downloadUrl: string | null;
}

export interface GuestMeetingViewDto {
  meetingId: string;
  meetingTitle: string;
  startTime: Date;
  endTime: Date;
  hostName: string;
  status: string;
  recordingActive: boolean;
  agenda: Array<{
    order: number;
    title: string;
    status: string;
    attachments: GuestAgendaAttachmentView[];
  }>;
  participants: GuestMeetingParticipantView[];
  sharedNotes: Array<{ content: string; pinned: boolean; createdAt: Date }>;
}

/**
 * GuestContentService — nội dung cuộc họp bản rút gọn cho khách (Mức B).
 *
 * KHÔNG BAO GIỜ trả: email/mã nhân viên/phòng ban của nhân viên, transcript,
 * recording file, biên bản chưa published, bảng điểm danh nhân sự (spec
 * mục 7.1 / OOS-003).
 */
@Injectable()
export class GuestContentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly lobbyService: GuestLobbyService,
    private readonly guestAttendanceService: GuestAttendanceService,
    private readonly mediaFilesService: MediaFilesService,
  ) {}

  /**
   * File đính kèm agenda cho khách xem/tải — tái dùng đúng logic sinh
   * Signed URL của `MediaFilesService.buildSignedDownloadUrl` (secure-download
   * endpoint KHÔNG yêu cầu JWT, chỉ cần HMAC token) nên phù hợp cho khách
   * ngoài công ty không có tài khoản nội bộ.
   */
  private async loadAgendaAttachmentsMap(
    agendaIds: string[],
  ): Promise<Map<string, GuestAgendaAttachmentView[]>> {
    const map = new Map<string, GuestAgendaAttachmentView[]>();
    if (agendaIds.length === 0) {
      return map;
    }

    const files = await this.dataSource.getRepository(MediaFileEntity).find({
      where: {
        relatedEntityType: 'meeting_agenda',
        relatedEntityId: In(agendaIds),
        deletedAt: IsNull(),
      },
      order: { uploadedAt: 'DESC' },
    });

    for (const file of files) {
      const agendaId = file.relatedEntityId as string;
      const list = map.get(agendaId) ?? [];
      list.push({
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        fileSizeBytes: file.fileSizeBytes,
        downloadUrl: this.mediaFilesService.buildSignedDownloadUrl(file),
      });
      map.set(agendaId, list);
    }

    return map;
  }

  async getGuestMeetingView(
    guest: GuestRequestContext,
  ): Promise<GuestMeetingViewDto> {
    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: guest.meetingId }, relations: { host: true } });
    // Guard đã xác nhận meeting tồn tại/hợp lệ trước khi tới đây
    // (GuestMeetingScopeGuard) — không throw lại ở đây, chỉ phòng hờ null.

    const lobbyStatus = await this.lobbyService.getStatusWithAutoAdmit(
      guest.meetingId,
      guest.externalParticipantId,
      meeting?.startTime,
    );
    this.lobbyService.assertAdmitted(lobbyStatus);

    // Ghi attendance_events(guest_join) đúng 1 lần/phiên (FR-GLA-038/039).
    await this.guestAttendanceService.logJoinOnce(guest);

    const meetingTitle = meeting?.title ?? '';
    const hostName = meeting?.host?.fullName ?? 'Chưa xác định';

    const [
      agendaItems,
      internalParticipants,
      externalParticipants,
      sharedNotes,
      activeRecording,
    ] = await Promise.all([
      this.dataSource.getRepository(MeetingAgendaEntity).find({
        where: { meetingId: guest.meetingId },
        order: { agendaOrder: 'ASC' },
      }),
      this.dataSource.getRepository(MeetingParticipantEntity).find({
        where: { meetingId: guest.meetingId },
        relations: { user: true },
      }),
      this.dataSource.getRepository(MeetingExternalParticipantEntity).find({
        where: { meetingId: guest.meetingId },
      }),
      this.dataSource.getRepository(MeetingNoteEntity).find({
        where: {
          meetingId: guest.meetingId,
          visibilityLevel: GUEST_SHARED_NOTE_VISIBILITY,
        },
        order: { createdAt: 'ASC' },
      }),
      this.dataSource.getRepository(RecordingSessionEntity).findOne({
        where: {
          meetingId: guest.meetingId,
          status: RecordingSessionStatus.RECORDING,
        },
      }),
    ]);

    const agendaAttachmentsMap = await this.loadAgendaAttachmentsMap(
      agendaItems.map((a) => a.id),
    );

    const participants: GuestMeetingParticipantView[] = [
      ...internalParticipants.map((p) => ({
        fullName: p.user?.fullName ?? 'N/A',
        organizationName: null,
      })),
      ...externalParticipants.map((ep) => ({
        fullName: ep.fullName,
        organizationName: ep.organizationName ?? null,
      })),
    ];

    return {
      meetingId: guest.meetingId,
      meetingTitle,
      startTime: meeting?.startTime as Date,
      endTime: meeting?.endTime as Date,
      hostName,
      status: meeting?.status ?? 'unknown',
      recordingActive: !!activeRecording,
      agenda: agendaItems.map((a) => ({
        order: a.agendaOrder,
        title: a.title,
        status: a.status,
        attachments: agendaAttachmentsMap.get(a.id) ?? [],
      })),
      participants,
      sharedNotes: sharedNotes.map((n) => ({
        content: n.content,
        pinned: n.pinned,
        createdAt: n.createdAt,
      })),
    };
  }
}
