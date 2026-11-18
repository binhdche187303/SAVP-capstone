import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import {
  TranscriptEntity,
  TranscriptStatus,
} from './entities/transcript.entity.js';
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
} from '../meetings/entities/meeting-participant.entity.js';
import {
  MeetingEventEntity,
  MeetingEventSourceType,
  MeetingEventType,
} from '../meetings/entities/meeting-event.entity.js';
import { RecordingSessionEntity } from '../recording/entities/recording-session.entity.js';
import { MeetingExternalParticipantEntity } from '../meetings/entities/meeting-external-participant.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import {
  CreateSpeakerMappingsDto,
  SpeakerMappingItemDto,
} from './dto/create-speaker-mappings.dto.js';
import { SpeakerClusterDto } from './dto/speaker-cluster-response.dto.js';
import { CreateLiveSpeakerTagDto } from './dto/create-live-speaker-tag.dto.js';
import { SetManualRecordingStartDto } from './dto/set-manual-recording-start.dto.js';
import { CreateOffsetSpeakerMarksDto } from './dto/create-offset-speaker-marks.dto.js';
import { TRANSCRIPTION_ERROR_CODES } from './constants/transcription-error-codes.js';
import { TranscriptSegment } from './types/transcript-segment.type.js';

/** ERR-LIVE-003 (feat-speaker-tagging-live) — đề xuất, chưa có căn cứ đo đạc,
 * xem plan.md mục 6. Chỉnh tại đây nếu team chốt số khác. */
const MANUAL_RECORDING_START_MAX_DRIFT_MS = 24 * 60 * 60 * 1000;

/** Danh tính đích của một mapping — CHÍNH XÁC một trong hai field khác null. */
interface ResolvedMappingTarget {
  speakerUserId: string | null;
  externalParticipantId: string | null;
  displayName: string;
}

/**
 * feat-speaker-tagging-post-meeting (GIAI ĐOẠN 2, GA-20→GA-27):
 * Host/Admin gán tên thật cho cụm giọng (Speaker_N) sau buổi họp, gán hàng
 * loạt theo cụm, sống sót qua mọi lần chạy lại transcription (GA-27).
 *
 * Tách riêng khỏi TranscriptionService (đã ~900 dòng) — xem plan.md mục 4.
 * Authz Host-of-meeting-or-Admin COPY pattern từ TranscriptionService (không
 * import chéo, tránh phụ thuộc vòng vì TranscriptionService sẽ gọi NGƯỢC lại
 * applySpeakerMappingsFromEvents() của service này ở updateTranscriptResult()).
 */
@Injectable()
export class SpeakerMappingService {
  private readonly logger = new Logger(SpeakerMappingService.name);

  constructor(
    @InjectRepository(TranscriptEntity)
    private readonly transcriptRepo: Repository<TranscriptEntity>,
    // feat-speaker-tagging-live (T-LIVE-002): cần đọc meetings.actual_start_time/
    // start_time để validate mốc nhập tay (ERR-LIVE-003, setManualRecordingStart).
    @InjectRepository(MeetingEntity)
    private readonly meetingRepo: Repository<MeetingEntity>,
    @InjectRepository(MeetingParticipantEntity)
    private readonly participantRepo: Repository<MeetingParticipantEntity>,
    @InjectRepository(MeetingEventEntity)
    private readonly meetingEventRepo: Repository<MeetingEventEntity>,
    @InjectRepository(RecordingSessionEntity)
    private readonly recordingSessionRepo: Repository<RecordingSessionEntity>,
    @InjectRepository(MeetingExternalParticipantEntity)
    private readonly externalParticipantRepo: Repository<MeetingExternalParticipantEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly dataSource: DataSource,
  ) {}

  // ─── GA-23: đọc danh sách cụm giọng ────────────────────────────────────

  async listSpeakerClusters(
    transcriptId: string,
    userId: string,
  ): Promise<SpeakerClusterDto[]> {
    const transcript = await this.transcriptRepo.findOne({
      where: { id: transcriptId },
    });
    if (!transcript) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy transcript.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.TRANSCRIPT_NOT_FOUND,
          details: {},
        },
      });
    }
    await this.assertHostOrAdmin(transcript.meetingId, userId);

    const segments = this.readSegments(transcript);
    const speakersByLabel = this.readDetectedSpeakersByLabel(transcript);

    const byLabel = new Map<string, TranscriptSegment[]>();
    for (const seg of segments) {
      if (!seg.speakerLabel || seg.speakerLabel === 'unknown') continue;
      const arr = byLabel.get(seg.speakerLabel) ?? [];
      arr.push(seg);
      byLabel.set(seg.speakerLabel, arr);
    }

    const clusters: SpeakerClusterDto[] = [];
    for (const [speakerLabel, segs] of byLabel) {
      const totalSpeakingMs = segs.reduce(
        (sum, s) => sum + Math.max(0, s.endMs - s.startMs),
        0,
      );
      const longest = this.longestSegment(segs);
      const speakerEntry = speakersByLabel.get(speakerLabel);

      clusters.push({
        speakerLabel,
        totalSpeakingMs,
        segmentCount: segs.length,
        sampleText: longest.text,
        sampleStartMs: longest.startMs,
        currentMapping:
          speakerEntry && speakerEntry['mappingSource'] === 'manual'
            ? {
                mappedUserId: (speakerEntry['mappedUserId'] as string) ?? null,
                mappingSource: speakerEntry['mappingSource'],
                displayName: speakerEntry['displayName'] as string | undefined,
              }
            : undefined,
      });
    }

    // Người nói nhiều nhất lên đầu — dễ chọn hơn cho Host.
    clusters.sort((a, b) => b.totalSpeakingMs - a.totalSpeakingMs);
    return clusters;
  }

  // ─── GA-20/21/22: gán hàng loạt + ghi meeting_events + áp ngay lập tức ──

  async createSpeakerMappings(
    transcriptId: string,
    dto: CreateSpeakerMappingsDto,
    userId: string,
  ): Promise<{
    appliedMappings: Array<{
      speakerLabel: string;
      speakerUserId: string | null;
      externalParticipantId: string | null;
      displayName: string;
    }>;
    mergedClusters: Array<{ speakerLabels: string[] }>;
  }> {
    const transcript = await this.transcriptRepo.findOne({
      where: { id: transcriptId },
    });
    if (!transcript) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy transcript.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.TRANSCRIPT_NOT_FOUND,
          details: {},
        },
      });
    }
    if (!transcript.recordingSessionId) {
      throw new ConflictException({
        success: false,
        message:
          'Transcript không có phiên ghi âm, không tính được mốc đại diện.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.RECORDING_SESSION_MISSING_FOR_TRANSCRIPT,
          details: {},
        },
      });
    }
    if (transcript.status === TranscriptStatus.PROCESSING) {
      throw new ConflictException({
        success: false,
        message: 'Transcript đang xử lý, chưa thể gán tên.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.TRANSCRIPT_NOT_DRAFT,
          details: {},
        },
      });
    }

    await this.assertHostOrAdmin(transcript.meetingId, userId);

    const recordingSession = await this.recordingSessionRepo.findOne({
      where: { id: transcript.recordingSessionId },
    });
    if (!recordingSession) {
      throw new ConflictException({
        success: false,
        message: 'Phiên ghi âm không tồn tại.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.RECORDING_SESSION_MISSING_FOR_TRANSCRIPT,
          details: {},
        },
      });
    }

    const segments = this.readSegments(transcript);
    const realLabels = new Set(
      segments
        .map((s) => s.speakerLabel)
        .filter((l): l is string => !!l && l !== 'unknown'),
    );

    // ERR-TAG-005 — đúng một trong speakerUserId/externalParticipantId.
    for (const item of dto.mappings) {
      const hasUser = !!item.speakerUserId;
      const hasExternal = !!item.externalParticipantId;
      if (hasUser === hasExternal) {
        throw new BadRequestException({
          success: false,
          message: `Gán tên cho "${item.speakerLabel}" phải có đúng một trong speakerUserId hoặc externalParticipantId.`,
          error: {
            code: 'VALIDATION_ERROR',
            details: { speakerLabel: item.speakerLabel },
          },
        });
      }
    }

    // ERR-TAG-004 — speakerLabel phải tồn tại thật trong transcript, all-or-nothing.
    const invalidLabels = dto.mappings
      .map((m) => m.speakerLabel)
      .filter((label) => !realLabels.has(label));
    if (invalidLabels.length > 0) {
      throw new BadRequestException({
        success: false,
        message: 'Một số speakerLabel không tồn tại trong transcript này.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.SPEAKER_LABEL_NOT_FOUND,
          details: { invalidLabels: [...new Set(invalidLabels)] },
        },
      });
    }

    // ERR-TAG-002 — cùng speakerLabel, khác identity trong CÙNG 1 request -> reject toàn bộ.
    const identityKeyOf = (item: SpeakerMappingItemDto): string =>
      item.speakerUserId
        ? `u:${item.speakerUserId}`
        : `e:${item.externalParticipantId}`;

    const keysByLabel = new Map<string, Set<string>>();
    for (const item of dto.mappings) {
      const set = keysByLabel.get(item.speakerLabel) ?? new Set<string>();
      set.add(identityKeyOf(item));
      keysByLabel.set(item.speakerLabel, set);
    }
    const conflictingLabels = [...keysByLabel.entries()]
      .filter(([, keys]) => keys.size > 1)
      .map(([label]) => label);
    if (conflictingLabels.length > 0) {
      throw new BadRequestException({
        success: false,
        message:
          'Một speakerLabel được gán cho nhiều người khác nhau trong cùng một yêu cầu.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.SPEAKER_MAPPING_CONFLICT,
          details: { conflictingLabels },
        },
      });
    }

    // Validate identity tồn tại thật (FK safety) — vẫn all-or-nothing.
    const userIds = [
      ...new Set(
        dto.mappings
          .map((m) => m.speakerUserId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (userIds.length > 0) {
      const foundUsers = await this.userRepo.findBy({ id: In(userIds) });
      const foundIds = new Set(foundUsers.map((u) => u.id));
      const missing = userIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException({
          success: false,
          message: 'Một số speakerUserId không tồn tại.',
          error: {
            code: TRANSCRIPTION_ERROR_CODES.TARGET_USER_NOT_FOUND,
            details: { missing },
          },
        });
      }
    }

    const externalIds = [
      ...new Set(
        dto.mappings
          .map((m) => m.externalParticipantId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (externalIds.length > 0) {
      const foundExternals = await this.externalParticipantRepo.findBy({
        id: In(externalIds),
        meetingId: transcript.meetingId,
      });
      const foundIds = new Set(foundExternals.map((e) => e.id));
      const missing = externalIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException({
          success: false,
          message:
            'Một số externalParticipantId không tồn tại hoặc không thuộc cuộc họp này.',
          error: {
            code: TRANSCRIPTION_ERROR_CODES.EXTERNAL_PARTICIPANT_NOT_FOUND,
            details: { missing },
          },
        });
      }
    }

    // Mọi thứ hợp lệ — build map label -> identity (duplicate cùng identity thì gộp lại, vô hại).
    const resolvedByLabel = new Map<string, ResolvedMappingTarget>();
    for (const item of dto.mappings) {
      resolvedByLabel.set(item.speakerLabel, {
        speakerUserId: item.speakerUserId ?? null,
        externalParticipantId: item.externalParticipantId ?? null,
        displayName: item.displayName,
      });
    }

    // Ghi meeting_events trong transaction — all-or-nothing (NFR-003).
    await this.dataSource.transaction(async (manager) => {
      for (const [label, resolved] of resolvedByLabel) {
        const eventTime = this.computeRepresentativeEventTime(
          segments,
          label,
          recordingSession.startedAt,
        );
        const event = manager.create(MeetingEventEntity, {
          meetingId: transcript.meetingId,
          eventType: MeetingEventType.SPEAKER_TAG,
          eventTime,
          actorUserId: userId,
          sourceType: MeetingEventSourceType.MANUAL,
          metadataJson: {
            recordingSessionId: transcript.recordingSessionId,
            speakerUserId: resolved.speakerUserId,
            externalParticipantId: resolved.externalParticipantId,
            displayName: resolved.displayName,
            tagSource: 'post',
          },
        });
        await manager.save(event);
      }
    });

    // GA-22 — áp NGAY vào transcript hiện tại, không chờ rerun.
    this.applyResolvedMappingsToTranscript(transcript, resolvedByLabel);
    await this.transcriptRepo.save(transcript);

    // mergedClusters — identity nào áp cho > 1 speakerLabel (ERR-TAG-001).
    const labelsByIdentity = new Map<string, string[]>();
    for (const [label, resolved] of resolvedByLabel) {
      const key = resolved.speakerUserId
        ? `u:${resolved.speakerUserId}`
        : `e:${resolved.externalParticipantId}`;
      const arr = labelsByIdentity.get(key) ?? [];
      arr.push(label);
      labelsByIdentity.set(key, arr);
    }
    const mergedClusters = [...labelsByIdentity.values()]
      .filter((labels) => labels.length > 1)
      .map((labels) => ({ speakerLabels: labels }));

    const appliedMappings = [...resolvedByLabel.entries()].map(
      ([speakerLabel, resolved]) => ({
        speakerLabel,
        speakerUserId: resolved.speakerUserId,
        externalParticipantId: resolved.externalParticipantId,
        displayName: resolved.displayName,
      }),
    );

    return { appliedMappings, mergedClusters };
  }

  // ─── GA-30/32/35 (feat-speaker-tagging-live): ghi mốc t=0 + gán live ────

  /**
   * GA-30 — Host bấm "Bắt đầu ghi âm" TRONG lúc họp. `recording_sessions`
   * CHƯA tồn tại tại thời điểm này (chỉ tạo lúc upload audio) — neo qua
   * `meeting_events` độc lập, không phải `recording_sessions.started_at`.
   * Cho phép gọi nhiều lần (CLR-001, spec.md) — mỗi lần tạo 1 bản ghi mới,
   * bước quy chiếu (applySpeakerMappingsFromEvents) luôn dùng bản ghi MỚI
   * NHẤT, không reject lần gọi thứ 2 trở đi.
   */
  async createStartMarker(
    meetingId: string,
    userId: string,
  ): Promise<{ eventTime: Date }> {
    await this.assertHostOrAdmin(meetingId, userId);

    const event = this.meetingEventRepo.create({
      meetingId,
      eventType: MeetingEventType.RECORDING_START_MARKER,
      eventTime: new Date(), // server đóng dấu — quyết định #7, không tin đồng hồ client
      actorUserId: userId,
      sourceType: MeetingEventSourceType.MANUAL,
      metadataJson: { source: 'live_tap' },
    });
    const saved = await this.meetingEventRepo.save(event);
    return { eventTime: saved.eventTime };
  }

  /**
   * GA-32 — Host bấm gán "người này đang nói ngay bây giờ" TRONG lúc họp.
   * KHÔNG có speakerLabel (khác createSpeakerMappings) — cụm giọng chưa tồn
   * tại ở thời điểm này, sẽ được xác định SAU ở bước quy chiếu. `metadataJson.
   * recordingSessionId` luôn null lúc ghi — khớp đúng với việc chưa có
   * recording session nào tồn tại (giống lý do của createStartMarker).
   */
  async createLiveSpeakerTag(
    meetingId: string,
    dto: CreateLiveSpeakerTagDto,
    userId: string,
  ): Promise<{ eventTime: Date }> {
    await this.assertHostOrAdmin(meetingId, userId);

    const hasUser = !!dto.speakerUserId;
    const hasExternal = !!dto.externalParticipantId;
    if (hasUser === hasExternal) {
      throw new BadRequestException({
        success: false,
        message:
          'Phải có đúng một trong speakerUserId hoặc externalParticipantId.',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
    if (dto.speakerUserId) {
      const user = await this.userRepo.findOne({
        where: { id: dto.speakerUserId },
      });
      if (!user) {
        throw new BadRequestException({
          success: false,
          message: 'speakerUserId không tồn tại.',
          error: {
            code: TRANSCRIPTION_ERROR_CODES.TARGET_USER_NOT_FOUND,
            details: {},
          },
        });
      }
    }
    if (dto.externalParticipantId) {
      const external = await this.externalParticipantRepo.findOne({
        where: { id: dto.externalParticipantId, meetingId },
      });
      if (!external) {
        throw new BadRequestException({
          success: false,
          message:
            'externalParticipantId không tồn tại hoặc không thuộc cuộc họp này.',
          error: {
            code: TRANSCRIPTION_ERROR_CODES.EXTERNAL_PARTICIPANT_NOT_FOUND,
            details: {},
          },
        });
      }
    }

    const event = this.meetingEventRepo.create({
      meetingId,
      eventType: MeetingEventType.SPEAKER_TAG, // cùng loại event GIAI ĐOẠN 2 dùng
      eventTime: new Date(),
      actorUserId: userId,
      sourceType: MeetingEventSourceType.MANUAL,
      metadataJson: {
        recordingSessionId: null, // chưa có session — khác GA-21 (post-meeting)
        speakerUserId: dto.speakerUserId ?? null,
        externalParticipantId: dto.externalParticipantId ?? null,
        displayName: dto.displayName,
        tagSource: 'live',
      },
    });
    const saved = await this.meetingEventRepo.save(event);
    return { eventTime: saved.eventTime };
  }

  /**
   * GA-35 — dự phòng khi Host quên bấm createStartMarker. Tạo CÙNG LOẠI sự
   * kiện `recording_start_marker` như bấm trực tiếp, chỉ khác nguồn thời
   * gian: đây là NGOẠI LỆ DUY NHẤT trong toàn bộ GIAI ĐOẠN 2+3 chấp nhận
   * event_time do CLIENT cung cấp (không thể server tự đóng dấu cho một thời
   * điểm đã qua) — phải validate chặt (ERR-LIVE-002/003) để bù lại.
   */
  async setManualRecordingStart(
    meetingId: string,
    dto: SetManualRecordingStartDto,
    userId: string,
  ): Promise<{ eventTime: Date }> {
    await this.assertHostOrAdmin(meetingId, userId);

    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId },
    });
    if (!meeting) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy cuộc họp.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.MEETING_NOT_FOUND,
          details: {},
        },
      });
    }

    const requested = new Date(dto.startedAt);
    const now = new Date();
    if (requested.getTime() > now.getTime()) {
      // ERR-LIVE-002 — không cho nhập thời điểm trong tương lai.
      throw new BadRequestException({
        success: false,
        message: 'Thời điểm nhập không được ở tương lai.',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }

    const anchor = meeting.actualStartTime ?? meeting.startTime;
    if (
      Math.abs(requested.getTime() - anchor.getTime()) >
      MANUAL_RECORDING_START_MAX_DRIFT_MS
    ) {
      // ERR-LIVE-003 — cách xa giờ họp thật quá bất thường, chặn nhập nhầm ngày/giờ.
      throw new BadRequestException({
        success: false,
        message: `Thời điểm nhập cách quá xa giờ họp thực tế (quá ngưỡng ${MANUAL_RECORDING_START_MAX_DRIFT_MS / 3600000} giờ).`,
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }

    const event = this.meetingEventRepo.create({
      meetingId,
      eventType: MeetingEventType.RECORDING_START_MARKER,
      eventTime: requested, // client-supplied, ĐÃ validate — ngoại lệ có chủ đích
      actorUserId: userId,
      sourceType: MeetingEventSourceType.MANUAL,
      metadataJson: { source: 'manual_entry' },
    });
    const saved = await this.meetingEventRepo.save(event);
    return { eventTime: saved.eventTime };
  }

  // ─── REC-006 (feat-fixed-station-browser-recording): mốc gán tên kèm offset ──

  /**
   * REC-006 — nhận mốc gán tên kèm offsetSeconds do FE tự tính (đồng hồ
   * trình duyệt cục bộ trong lúc ghi tại trạm cố định, KHÔNG qua marker
   * recording_start_marker của GIAI ĐOẠN 3). recordingSessionId đã tồn tại
   * thật lúc gọi (upload xảy ra NGAY sau khi dừng ghi) — nên tái dùng
   * NGUYÊN VẸN anchor recording_sessions.started_at + tagSource='post' của
   * GIAI ĐOẠN 2 (applySpeakerMappingsFromEvents xử lý y hệt GA-21, KHÔNG cần
   * sửa gì ở đó). all-or-nothing, giống createSpeakerMappings.
   */
  async createOffsetSpeakerMarks(
    meetingId: string,
    sessionId: string,
    dto: CreateOffsetSpeakerMarksDto,
    userId: string,
  ): Promise<{ savedCount: number }> {
    const session = await this.recordingSessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session || session.meetingId !== meetingId) {
      throw new NotFoundException({
        success: false,
        message:
          'Phiên ghi âm không tồn tại hoặc không thuộc cuộc họp này.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.RECORDING_SESSION_NOT_FOUND,
          details: {},
        },
      });
    }

    await this.assertHostOrAdmin(meetingId, userId);

    // ERR-TAG-005 pattern — đúng-một-trong-hai, copy từ createSpeakerMappings (all-or-nothing).
    for (const item of dto.marks) {
      const hasUser = !!item.speakerUserId;
      const hasExternal = !!item.externalParticipantId;
      if (hasUser === hasExternal) {
        throw new BadRequestException({
          success: false,
          message:
            'Mỗi mốc phải có đúng một trong speakerUserId hoặc externalParticipantId.',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
    }

    // P-1 (plan.md muc 6) — duration_seconds co the null neu ffprobe loi luc
    // upload (best-effort, uploadAudioForTranscription). Khi null: chi chan
    // offset am, KHONG chan can tren (khong du du lieu de biet gioi han that).
    const outOfRange = dto.marks.filter((m) => {
      if (m.offsetSeconds < 0) return true;
      if (
        session.durationSeconds != null &&
        m.offsetSeconds > session.durationSeconds
      ) {
        return true;
      }
      return false;
    });
    if (outOfRange.length > 0) {
      throw new BadRequestException({
        success: false,
        message:
          'Một số offsetSeconds không hợp lệ (âm hoặc vượt quá độ dài file).',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.OFFSET_OUT_OF_RANGE,
          details: { count: outOfRange.length },
        },
      });
    }

    // Validate identity ton tai that — TAI DUNG dung cach batch findBy+In()
    // ma createSpeakerMappings da lam (all-or-nothing), chi doi nguon du lieu.
    const userIds = [
      ...new Set(
        dto.marks
          .map((m) => m.speakerUserId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (userIds.length > 0) {
      const foundUsers = await this.userRepo.findBy({ id: In(userIds) });
      const foundIds = new Set(foundUsers.map((u) => u.id));
      const missing = userIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException({
          success: false,
          message: 'Một số speakerUserId không tồn tại.',
          error: {
            code: TRANSCRIPTION_ERROR_CODES.TARGET_USER_NOT_FOUND,
            details: { missing },
          },
        });
      }
    }

    const externalIds = [
      ...new Set(
        dto.marks
          .map((m) => m.externalParticipantId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (externalIds.length > 0) {
      const foundExternals = await this.externalParticipantRepo.findBy({
        id: In(externalIds),
        meetingId,
      });
      const foundIds = new Set(foundExternals.map((e) => e.id));
      const missing = externalIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException({
          success: false,
          message:
            'Một số externalParticipantId không tồn tại hoặc không thuộc cuộc họp này.',
          error: {
            code: TRANSCRIPTION_ERROR_CODES.EXTERNAL_PARTICIPANT_NOT_FOUND,
            details: { missing },
          },
        });
      }
    }

    // Ghi meeting_events trong transaction — all-or-nothing.
    await this.dataSource.transaction(async (manager) => {
      for (const item of dto.marks) {
        const event = manager.create(MeetingEventEntity, {
          meetingId,
          eventType: MeetingEventType.SPEAKER_TAG,
          eventTime: new Date(
            session.startedAt.getTime() + item.offsetSeconds * 1000,
          ),
          actorUserId: userId,
          sourceType: MeetingEventSourceType.MANUAL,
          metadataJson: {
            recordingSessionId: sessionId,
            speakerUserId: item.speakerUserId ?? null,
            externalParticipantId: item.externalParticipantId ?? null,
            displayName: item.displayName,
            tagSource: 'post', // D-4 research.md — TAI DUNG anchor GIAI DOAN 2, KHONG phai 'live'
          },
        });
        await manager.save(event);
      }
    });

    return { savedCount: dto.marks.length };
  }

  // ─── GA-27: áp lại mapping từ meeting_events khi transcript được chạy lại ──

  /**
   * Best-effort — gọi từ TranscriptionService.updateTranscriptResult() ngay
   * sau khi transcript draft MỚI được ghi. KHÔNG throw ra ngoài (fail-safe,
   * đúng pattern notifyTranscriptReady() — lỗi áp mapping không được làm fail
   * job transcription đã thành công, NFR-004 spec.md). Nếu muốn biết lỗi cụ
   * thể, catch ở caller và chỉ log.
   */
  async applySpeakerMappingsFromEvents(transcriptId: string): Promise<void> {
    const transcript = await this.transcriptRepo.findOne({
      where: { id: transcriptId },
    });
    if (!transcript || !transcript.recordingSessionId) return;

    const recordingSession = await this.recordingSessionRepo.findOne({
      where: { id: transcript.recordingSessionId },
    });
    if (!recordingSession) return;

    const events = await this.meetingEventRepo.find({
      where: {
        meetingId: transcript.meetingId,
        eventType: MeetingEventType.SPEAKER_TAG,
      },
    });
    // GA-33 (feat-speaker-tagging-live): chấp nhận cả event 'post' (khớp đúng
    // recordingSessionId, như trước) LẪN event 'live' (recordingSessionId=null
    // lúc ghi vì session chưa tồn tại — CLR-002 spec.md: giả định 1 meeting =
    // 1 recording session cho MVP, nên khớp theo meetingId là đủ an toàn).
    const relevantEvents = events.filter((e) => {
      const meta = e.metadataJson;
      if (meta?.['recordingSessionId'] === transcript.recordingSessionId) {
        return true;
      }
      return (
        meta?.['recordingSessionId'] === null && meta?.['tagSource'] === 'live'
      );
    });
    if (relevantEvents.length === 0) return;

    const segments = this.readSegments(transcript);
    if (segments.length === 0) return;

    const startedAtMs = recordingSession.startedAt.getTime();
    // Chỉ query marker khi thật sự có event 'live' cần nó — tránh 1 query DB
    // thừa cho luồng post-only vẫn còn chạy song song (đã verify thật, GIAI ĐOẠN 2).
    const hasLiveEvent = relevantEvents.some(
      (e) => e.metadataJson?.['tagSource'] === 'live',
    );
    const latestMarker = hasLiveEvent
      ? await this.meetingEventRepo.findOne({
          where: {
            meetingId: transcript.meetingId,
            eventType: MeetingEventType.RECORDING_START_MARKER,
          },
          order: { eventTime: 'DESC' },
        })
      : null;

    const resolvedListByNewLabel = new Map<string, ResolvedMappingTarget[]>();

    for (const event of relevantEvents) {
      const meta = (event.metadataJson as Record<string, unknown>) ?? {};
      const isLive = meta['tagSource'] === 'live';

      let anchorMs: number;
      if (isLive) {
        if (!latestMarker) continue; // FR-007/ERR-LIVE-004 — không có marker, không đoán.
        anchorMs = latestMarker.eventTime.getTime();
      } else {
        anchorMs = startedAtMs;
      }

      const offsetMs = event.eventTime.getTime() - anchorMs;
      const target = segments.find(
        (s) => offsetMs >= s.startMs && offsetMs < s.endMs,
      );
      if (!target) continue; // ERR-TAG-007/ERR-LIVE-005 — offset không rơi vào segment nào, bỏ qua.

      const resolved: ResolvedMappingTarget = {
        speakerUserId: (meta['speakerUserId'] as string) ?? null,
        externalParticipantId:
          (meta['externalParticipantId'] as string) ?? null,
        displayName: (meta['displayName'] as string) ?? '',
      };
      const list = resolvedListByNewLabel.get(target.speakerLabel) ?? [];
      list.push(resolved);
      resolvedListByNewLabel.set(target.speakerLabel, list);
    }

    if (resolvedListByNewLabel.size === 0) return;

    const identityKeyOf = (r: ResolvedMappingTarget): string =>
      r.speakerUserId ? `u:${r.speakerUserId}` : `e:${r.externalParticipantId}`;

    const finalByLabel = new Map<string, ResolvedMappingTarget | 'conflict'>();
    for (const [label, list] of resolvedListByNewLabel) {
      const distinctKeys = new Set(list.map(identityKeyOf));
      if (distinctKeys.size > 1) {
        // ERR-TAG-003 — 2 identity khác nhau cùng trỏ 1 label mới -> mâu thuẫn, không đoán.
        finalByLabel.set(label, 'conflict');
      } else {
        finalByLabel.set(label, list[0]);
      }
    }

    this.applyResolvedMappingsToTranscript(transcript, finalByLabel);
    await this.transcriptRepo.save(transcript);

    this.logger.log(
      `applySpeakerMappingsFromEvents: transcript=${transcriptId} appliedLabels=${finalByLabel.size}`,
    );
  }

  // ─── Helpers dùng chung ─────────────────────────────────────────────────

  /** CLR-002: mốc đại diện = điểm giữa segment DÀI NHẤT thuộc speakerLabel đó. */
  private computeRepresentativeEventTime(
    segments: TranscriptSegment[],
    speakerLabel: string,
    recordingSessionStartedAt: Date,
  ): Date {
    const matching = segments.filter((s) => s.speakerLabel === speakerLabel);
    if (matching.length === 0) {
      // Không xảy ra trong luồng bình thường — label đã được validate tồn tại
      // trước khi hàm này được gọi (xem createSpeakerMappings).
      throw new Error(
        `Khong tim thay segment nao cho speakerLabel ${speakerLabel}`,
      );
    }
    const longest = this.longestSegment(matching);
    const representativeOffsetMs = Math.round(
      (longest.startMs + longest.endMs) / 2,
    );
    return new Date(
      recordingSessionStartedAt.getTime() + representativeOffsetMs,
    );
  }

  private longestSegment(segments: TranscriptSegment[]): TranscriptSegment {
    return segments.reduce((a, b) =>
      b.endMs - b.startMs > a.endMs - a.startMs ? b : a,
    );
  }

  private readSegments(transcript: TranscriptEntity): TranscriptSegment[] {
    const segmentsJson =
      (transcript.speakerSegmentsJson as Record<string, unknown>) || {};
    return Array.isArray(segmentsJson['segments'])
      ? (segmentsJson['segments'] as TranscriptSegment[])
      : [];
  }

  private readDetectedSpeakersByLabel(
    transcript: TranscriptEntity,
  ): Map<string, Record<string, unknown>> {
    const detectedJson =
      (transcript.detectedSpeakersJson as Record<string, unknown>) || {};
    const speakers = Array.isArray(detectedJson['speakers'])
      ? (detectedJson['speakers'] as Array<Record<string, unknown>>)
      : [];
    const byLabel = new Map<string, Record<string, unknown>>();
    for (const s of speakers) {
      byLabel.set(s['speakerLabel'] as string, s);
    }
    return byLabel;
  }

  /**
   * Ghi mapping đã resolve vào speaker_segments_json.segments[] và
   * detected_speakers_json.speakers[] (mutate transcript in-memory, KHÔNG tự
   * save — caller chịu trách nhiệm gọi transcriptRepo.save()).
   *
   * Field mở rộng (KHÔNG có trong contract Python worker gốc — schemas.py
   * REQUIRED_SEGMENT_FIELDS/REQUIRED_DETECTED_SPEAKER_FIELDS — nhưng an toàn
   * vì đây là JSONB, Python không re-validate sau khi backend ghi bổ sung):
   * `mappedExternalParticipantId`, `displayName` ở cả segment lẫn detectedSpeaker,
   * `mappingSource='conflict'` mới ở detectedSpeaker (CLR-005, spec.md).
   */
  private applyResolvedMappingsToTranscript(
    transcript: TranscriptEntity,
    mappingByLabel: Map<string, ResolvedMappingTarget | 'conflict'>,
  ): void {
    const segmentsJson =
      (transcript.speakerSegmentsJson as Record<string, unknown>) || {};
    const segments: Array<Record<string, unknown>> = Array.isArray(
      segmentsJson['segments'],
    )
      ? (segmentsJson['segments'] as Array<Record<string, unknown>>)
      : [];

    const detectedJson =
      (transcript.detectedSpeakersJson as Record<string, unknown>) || {};
    const speakers: Array<Record<string, unknown>> = Array.isArray(
      detectedJson['speakers'],
    )
      ? (detectedJson['speakers'] as Array<Record<string, unknown>>)
      : [];

    for (const segment of segments) {
      const resolved = mappingByLabel.get(segment['speakerLabel'] as string);
      if (!resolved) continue;
      if (resolved === 'conflict') {
        segment['userId'] = null;
        segment['mappedExternalParticipantId'] = null;
        segment['displayName'] = null;
        segment['manualReviewRequired'] = true;
        continue;
      }
      segment['userId'] = resolved.speakerUserId;
      segment['mappedExternalParticipantId'] = resolved.externalParticipantId;
      segment['displayName'] = resolved.displayName;
    }

    for (const [label, resolved] of mappingByLabel) {
      let speaker = speakers.find((s) => s['speakerLabel'] === label);
      if (!speaker) {
        speaker = {
          speakerLabel: label,
          totalSpeakingMs: 0,
          segmentCount: 0,
          mappedUserId: null,
          mappingSource: 'unmapped',
          confidence: 0,
        };
        speakers.push(speaker);
      }
      if (resolved === 'conflict') {
        speaker['mappedUserId'] = null;
        speaker['mappedExternalParticipantId'] = null;
        speaker['displayName'] = null;
        speaker['mappingSource'] = 'conflict';
        continue;
      }
      speaker['mappedUserId'] = resolved.speakerUserId;
      speaker['mappedExternalParticipantId'] = resolved.externalParticipantId;
      speaker['displayName'] = resolved.displayName;
      speaker['mappingSource'] = 'manual';
    }

    transcript.speakerSegmentsJson = { ...segmentsJson, segments };
    transcript.detectedSpeakersJson = { ...detectedJson, speakers };
  }

  // ─── Authz — copy pattern từ TranscriptionService (không import chéo) ──

  private async assertHostOrAdmin(
    meetingId: string,
    userId: string,
  ): Promise<void> {
    const host = await this.participantRepo.findOne({
      where: { meetingId, userId, participantRole: ParticipantRole.HOST },
    });
    if (host) return;

    const { roleCodes } = await this.getEffectiveRolesAndPermissions(userId);
    if (!this.isAdminRole(roleCodes)) {
      throw new ForbiddenException({
        success: false,
        message: 'Chỉ Host hoặc Admin được gán tên người nói.',
        error: { code: 'PERMISSION_DENIED', details: {} },
      });
    }
  }

  private async getEffectiveRolesAndPermissions(
    userId: string,
  ): Promise<{ roleCodes: string[] }> {
    const userRoles: Array<{ role_code: string }> = await this.dataSource.query(
      'SELECT r.role_code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.is_active = true',
      [userId],
    );
    return { roleCodes: userRoles.map((r) => r.role_code) };
  }

  /**
   * BUSINESS_ADMIN/SYSTEM_ADMIN — đúng role code thật (xem
   * transcription.service.ts.isAdminRole() — cùng pattern, cố ý KHÔNG dùng
   * permission code 'admin.all'/'admin.manage' vì chưa từng được seed.
   */
  private isAdminRole(roleCodes: string[]): boolean {
    return roleCodes.some((code) =>
      ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'].includes(code),
    );
  }
}
