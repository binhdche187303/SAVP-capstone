import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull, Not } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import {
  TranscriptEntity,
  TranscriptStatus,
} from './entities/transcript.entity.js';
import {
  BackgroundJobEntity,
  BackgroundJobType,
} from '../administration/entities/background-job.entity.js';
import {
  MediaFileEntity,
  MediaFileType,
} from '../recording/entities/media-file.entity.js';
import { RecordingSessionEntity } from '../recording/entities/recording-session.entity.js';
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
} from '../meetings/entities/meeting-participant.entity.js';
import { QueueService } from '../queue/queue.service.js';
import { BackgroundJobsService } from '../administration/services/background-jobs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
} from '../notifications/entities/notification.entity.js';
import { CreateTranscriptionJobDto } from './dto/create-transcription-job.dto.js';
import { QueryTranscriptDto } from './dto/query-transcript.dto.js';
import { UpdateTranscriptSegmentsDto } from './dto/update-transcript-segments.dto.js';
import { UpdateTranscriptContentDto } from './dto/update-transcript-content.dto.js';
import {
  UpdateTranscriptStatusDto,
  TranscriptStatusTransition,
} from './dto/update-transcript-status.dto.js';
import { TRANSCRIPTION_ERROR_CODES } from './constants/transcription-error-codes.js';
import { TRANSCRIPTION_QUEUE_NAME } from './constants/transcription-job.constants.js';
import { TranscriptionResult } from './types/transcript-segment.type.js';
import { SpeakerMappingService } from './speaker-mapping.service.js';

@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  constructor(
    @InjectRepository(TranscriptEntity)
    private readonly transcriptRepo: Repository<TranscriptEntity>,
    @InjectRepository(MeetingEntity)
    private readonly meetingRepo: Repository<MeetingEntity>,
    @InjectRepository(RecordingSessionEntity)
    private readonly recordingSessionRepo: Repository<RecordingSessionEntity>,
    @InjectRepository(MediaFileEntity)
    private readonly mediaFileRepo: Repository<MediaFileEntity>,
    @InjectRepository(MeetingParticipantEntity)
    private readonly participantRepo: Repository<MeetingParticipantEntity>,
    @InjectRepository(BackgroundJobEntity)
    private readonly backgroundJobRepo: Repository<BackgroundJobEntity>,
    private readonly queueService: QueueService,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    // GA-27 (feat-speaker-tagging-post-meeting): áp lại mapping đã gán từ
    // meeting_events mỗi khi transcript mới được ghi — xem updateTranscriptResult().
    private readonly speakerMappingService: SpeakerMappingService,
  ) {}

  async createTranscriptionJob(
    meetingId: string,
    dto: CreateTranscriptionJobDto,
    userId: string,
  ): Promise<{
    jobId: string;
    meetingId: string;
    status: string;
    transcriptStatus: string;
  }> {
    const transcriptionEnabled = this.configService.get<boolean>(
      'TRANSCRIPTION_ENABLED',
      true,
    );
    if (!transcriptionEnabled) {
      throw new ForbiddenException({
        success: false,
        message: 'Tinh nang transcription dang bi tat.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.TRANSCRIPTION_DISABLED,
          details: {},
        },
      });
    }

    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId },
    });
    if (!meeting) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.MEETING_NOT_FOUND,
          details: {},
        },
      });
    }

    const isHost = await this.participantRepo.findOne({
      where: { meetingId, userId, participantRole: ParticipantRole.HOST },
    });
    if (!isHost) {
      const { roleCodes } = await this.getEffectiveRolesAndPermissions(userId);
      if (!this.isAdminRole(roleCodes)) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong co quyen tao job nay.',
          error: { code: 'PERMISSION_DENIED', details: {} },
        });
      }
    }

    const recordingSession = await this.recordingSessionRepo.findOne({
      where: { id: dto.recordingSessionId, meetingId },
    });
    if (!recordingSession) {
      throw new NotFoundException({
        success: false,
        message: 'Recording session khong thuoc cuoc hop.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.RECORDING_SESSION_NOT_FOUND,
          details: {},
        },
      });
    }

    // Phase 2: lấy TẤT CẢ media files audio active của session (thay vì chỉ 1).
    const sourceMediaFiles = await this.mediaFileRepo.find({
      where: {
        recordingSessionId: dto.recordingSessionId,
        fileType: MediaFileType.AUDIO,
        isActive: true,
      },
      order: { uploadedAt: 'ASC' },
    });
    if (sourceMediaFiles.length === 0) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay media file audio hop le.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.SOURCE_MEDIA_NOT_FOUND,
          details: {},
        },
      });
    }

    // Phase 2: tự động chọn mode dựa trên số lượng file.
    // - 1 file → diarization_only (backward-compatible).
    // - Nhiều file (mỗi file = 1 user) → channel_zone (Whisper riêng từng channel).
    // Client vẫn có thể override qua dto.speakerMappingMode nếu muốn.
    const isMultiChannel = sourceMediaFiles.length > 1;
    const effectiveMode =
      dto.speakerMappingMode ||
      (isMultiChannel ? 'channel_zone' : 'diarization_only');

    // sourceMedia đầu tiên dùng làm fallback/backward-compatible reference.
    const primaryMedia = sourceMediaFiles[0];

    // Phase 2: build channels array cho multi-channel mode.
    const channels = isMultiChannel
      ? sourceMediaFiles.map((mf) => ({
          storageKey: mf.storageKey,
          storageBucket: mf.storageBucket || undefined,
          channelUserId: mf.channelUserId || '',
        }))
      : undefined;

    const existing = await this.transcriptRepo.findOne({
      where: {
        recordingSessionId: dto.recordingSessionId,
        status: TranscriptStatus.PROCESSING,
      },
    });
    if (existing && !dto.forceRerun) {
      throw new ConflictException({
        success: false,
        message: 'Da co job dang xu ly cho recording session nay.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.TRANSCRIPTION_JOB_ALREADY_RUNNING,
          details: {},
        },
      });
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const bgJob = await this.backgroundJobsService.createQueuedJob({
        jobType: BackgroundJobType.TRANSCRIPTION,
        queueName: TRANSCRIPTION_QUEUE_NAME,
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId,
        requestedBy: userId,
        inputJson: {
          meetingId,
          recordingSessionId: dto.recordingSessionId,
          sourceMediaFileId: primaryMedia.id,
          language: dto.language || 'vi-VN',
          speakerMappingMode: effectiveMode,
          forceRerun: dto.forceRerun || false,
          // Phase 2: channels array cho multi-channel mode.
          ...(channels ? { channels } : {}),
        },
      });

      const vNo = existing ? existing.versionNo + 1 : 1;
      const tx = this.transcriptRepo.create({
        meetingId,
        recordingSessionId: dto.recordingSessionId,
        sourceMediaFileId: primaryMedia.id,
        backgroundJobId: bgJob.id,
        languageCode: dto.language || 'vi-VN',
        status: TranscriptStatus.PROCESSING,
        versionNo: vNo,
      });
      const saved = await qr.manager.save(tx);

      await qr.commitTransaction();

      // QUAN TRỌNG: addJob() PHẢI đứng SAU commitTransaction(). Nếu enqueue
      // trước khi commit, worker (BullMQ, chạy cùng process, đọc Redis gần
      // như tức thời) có thể pick job và query transcriptRepo.findOne()
      // TRƯỚC KHI transaction Postgres commit xong — transcriptRepo dùng
      // connection/transaction khác nên không thấy row vừa insert, dẫn tới
      // lỗi "Transcript ... not found" dù transcript đã được tạo thành công.
      try {
        await this.queueService.addJob(
          TRANSCRIPTION_QUEUE_NAME,
          'transcription:' + bgJob.id,
          {
            backgroundJobId: bgJob.id,
            transcriptId: saved.id,
            meetingId,
            recordingSessionId: dto.recordingSessionId,
            sourceMediaFileId: primaryMedia.id,
            storageBucket: primaryMedia.storageBucket,
            storageKey: primaryMedia.storageKey,
            language: dto.language || 'vi-VN',
            speakerMappingMode: effectiveMode,
            initialPrompt: dto.initialPrompt,
            userId,
            // Phase 2: channels array để AI Worker xử lý multi-channel.
            ...(channels ? { channels } : {}),
          },
          { attempts: 3 },
        );
      } catch (enqueueError) {
        const errMsg =
          enqueueError instanceof Error
            ? enqueueError.message
            : 'Unknown enqueue error';
        await this.failTranscript(saved.id, errMsg);
        await this.backgroundJobsService.markFailed(bgJob.id, errMsg);
        throw enqueueError;
      }

      this.logger.log(
        'Created job ' +
          bgJob.id +
          ' for meeting ' +
          meetingId +
          ' (mode=' +
          effectiveMode +
          ', channels=' +
          sourceMediaFiles.length +
          ')',
      );
      return {
        jobId: bgJob.id,
        meetingId,
        status: 'queued',
        transcriptStatus: TranscriptStatus.PROCESSING,
      };
    } catch (error) {
      if (qr.isTransactionActive) {
        await qr.rollbackTransaction();
      }
      throw error;
    } finally {
      await qr.release();
    }
  }

  async getTranscript(
    meetingId: string,
    userId: string,
    query: QueryTranscriptDto,
  ): Promise<any> {
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId },
    });
    if (!meeting) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.MEETING_NOT_FOUND,
          details: {},
        },
      });
    }

    const participant = await this.participantRepo.findOne({
      where: { meetingId, userId },
    });
    if (!participant) {
      const { roleCodes } = await this.getEffectiveRolesAndPermissions(userId);
      if (!this.isAdminRole(roleCodes)) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong co quyen xem transcript nay.',
          error: { code: 'PERMISSION_DENIED', details: {} },
        });
      }
    }

    // versionNo tăng theo từng recordingSessionId riêng (xem createTranscriptionJob),
    // không phải bộ đếm chung toàn meeting — 2 recording session khác nhau có thể
    // cùng versionNo=1. Sắp theo createdAt mới phản ánh đúng "mới nhất" của cả
    // meeting; versionNo chỉ dùng làm tiebreaker phụ khi createdAt trùng.
    const transcript = await this.transcriptRepo.findOne({
      where: { meetingId, status: Not(TranscriptStatus.HIDDEN) },
      order: { createdAt: 'DESC', versionNo: 'DESC' },
    });
    if (!transcript) {
      throw new NotFoundException({
        success: false,
        message: 'Chua co transcript cho cuoc hop nay.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.TRANSCRIPT_NOT_FOUND,
          details: {},
        },
      });
    }

    const includeSegments = query.includeSegments ?? false;
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    let segments: any[] | undefined;
    if (includeSegments && transcript.speakerSegmentsJson) {
      const allSegments =
        (transcript.speakerSegmentsJson as any)?.segments || [];
      segments = allSegments
        .slice((page - 1) * limit, (page - 1) * limit + limit)
        .map((s: any) => ({
          ...s,
          // Gap fix — startMs/endMs chỉ là offset tương đối so với lúc bắt đầu
          // ghi (actualStartTime), KHÔNG phải giờ đồng hồ thật. Quy đổi ra giờ
          // Việt Nam (UTC+7) để FE hiển thị trực tiếp, không phải tự tính lại.
          // null nếu meeting chưa từng start thật (actualStartTime chưa có).
          absoluteStartAt: this.toVietnamIso(
            meeting.actualStartTime,
            s.startMs,
          ),
          absoluteEndAt: this.toVietnamIso(meeting.actualStartTime, s.endMs),
        }));
    }

    return {
      transcriptId: transcript.id,
      meetingId: transcript.meetingId,
      // Cho FE match đúng file audio (media_files) đã sinh ra transcript này,
      // để phát lại từng đoạn theo startMs/endMs — nhiều recording session/audio
      // track có thể tồn tại trên cùng 1 meeting.
      recordingSessionId: transcript.recordingSessionId,
      status: transcript.status,
      language: transcript.languageCode || '',
      versionNo: transcript.versionNo,
      confidenceScore: transcript.confidenceScore
        ? Number(transcript.confidenceScore)
        : null,
      cleanedText: transcript.cleanedText,
      segments,
      warnings: Array.isArray((transcript.speakerSegmentsJson as any)?.warnings)
        ? (transcript.speakerSegmentsJson as any).warnings
        : [],
      manualReviewRequired:
        (transcript.speakerSegmentsJson as any)?.manualReviewRequired === true,
      manualReviewSegmentCount:
        Number(
          (transcript.speakerSegmentsJson as any)?.manualReviewSegmentCount || 0,
        ) || 0,
      generatedAt: transcript.createdAt,
      meta: includeSegments
        ? {
            page,
            limit,
            total: ((transcript.speakerSegmentsJson as any)?.segments || [])
              .length,
          }
        : undefined,
    };
  }

  async updateTranscriptResult(
    transcriptId: string,
    result: TranscriptionResult,
  ): Promise<void> {
    // QueryBuilder.set({ col: () => string }) chèn string trả về như RAW SQL
    // (không parameterize) — JSON.stringify({...}) chứa "{"/":" làm PostgreSQL
    // báo "syntax error at or near {". Phải truyền object thường cho cột jsonb,
    // KHÔNG dùng callback raw-SQL ở đây.
    // T028: đánh dấu ở cấp TRANSCRIPT (không chỉ per-segment) khi có segment
    // cần review thủ công — để UI/Host biết transcript này cần rà. KHÔNG thêm
    // bảng/workflow review mới (đúng T028), chỉ là metadata trong JSON.
    const reviewSegments = result.segments.filter(
      (s) => s.manualReviewRequired || s.lowConfidence,
    );
    const manualReviewRequired = reviewSegments.length > 0;

    await this.transcriptRepo.update(transcriptId, {
      status: TranscriptStatus.DRAFT,
      rawText: result.rawText,
      cleanedText: result.cleanedText,
      confidenceScore: result.confidenceScore,
      languageCode: result.languageCode,
      speakerSegmentsJson: {
        languageCode: result.languageCode,
        segments: result.segments,
        modelVersions: result.modelVersions,
        warnings: result.warnings,
        // T028 — transcript-level review indicator.
        manualReviewRequired,
        manualReviewSegmentCount: reviewSegments.length,
        // revision counter cho sửa tay (UC-127) — bắt đầu 0, tăng mỗi lần PATCH.
        editRevisionNo: 0,
      },
      detectedSpeakersJson: { speakers: result.detectedSpeakers },
    });
    this.logger.log(
      'Transcript ' +
        transcriptId +
        ' updated to draft (manualReview=' +
        manualReviewRequired +
        ', reviewSegments=' +
        reviewSegments.length +
        ')',
    );

    // GA-27 (feat-speaker-tagging-post-meeting) — áp lại mapping đã gán từ
    // meeting_events, nếu recording session này từng được Host gán tên trước
    // đó (ở bản transcript cũ hơn). Best-effort: lỗi ở đây KHÔNG được làm fail
    // job transcription đã ghi draft thành công (đúng pattern notifyTranscriptReady).
    try {
      await this.speakerMappingService.applySpeakerMappingsFromEvents(
        transcriptId,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        'applySpeakerMappingsFromEvents FAILED (bo qua, khong fail job): ' +
          msg,
      );
    }
  }

  /**
   * T029 — Gửi in-app notification cho Host khi transcript đã sẵn (draft).
   * FAIL-SAFE: mọi lỗi notification chỉ log warning, KHÔNG throw — không được
   * làm fail job transcription đã thành công. Gọi từ worker processor sau khi
   * transcript đã ghi draft + background_job completed.
   */
  async notifyTranscriptReady(transcriptId: string): Promise<void> {
    try {
      const transcript = await this.transcriptRepo.findOne({
        where: { id: transcriptId },
      });
      if (!transcript) return;

      const host = await this.participantRepo.findOne({
        where: {
          meetingId: transcript.meetingId,
          participantRole: ParticipantRole.HOST,
        },
      });
      if (!host) {
        this.logger.warn(
          'notifyTranscriptReady: khong tim thay Host cho meeting ' +
            transcript.meetingId +
            ' — bo qua notification',
        );
        return;
      }

      await this.notificationsService.createNotification({
        notificationType: NotificationType.TRANSCRIPT_READY,
        channel: NotificationChannel.IN_APP,
        subject: 'Transcript đã sẵn sàng',
        content:
          'Bản ghi lời nói (transcript) của cuộc họp đã được tạo xong và sẵn sàng để xem/review.',
        relatedEntityType: 'meeting',
        relatedEntityId: transcript.meetingId,
        recipientScope: 'user_list',
        recipientUserIds: [host.userId],
        payloadJson: { transcriptId, meetingId: transcript.meetingId },
      });
      this.logger.log(
        'notifyTranscriptReady: da tao in-app notification cho Host cua meeting ' +
          transcript.meetingId,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(
        'notifyTranscriptReady FAILED (bo qua, khong fail job): ' + msg,
      );
    }
  }

  /**
   * T-EDIT-001 (UC-127) — Sửa tay segment transcript.
   * Authorization: chỉ Host của meeting HOẶC role BUSINESS_ADMIN/SYSTEM_ADMIN
   * (participant thường 403 — nghiêm ngặt hơn quyền xem). KHÔNG tự đổi status
   * sang reviewed/approved (giữ nguyên draft — đúng FR-042/CLR-002).
   */
  async updateTranscriptSegments(
    transcriptId: string,
    dto: UpdateTranscriptSegmentsDto,
    userId: string,
  ): Promise<{
    transcriptId: string;
    revisionNo: number;
    updatedSegments: string[];
    editedBy: string;
    updatedAt: Date;
  }> {
    const transcript = await this.transcriptRepo.findOne({
      where: { id: transcriptId },
    });
    if (!transcript) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay transcript.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.TRANSCRIPT_NOT_FOUND,
          details: {},
        },
      });
    }

    // Authz: Host của meeting hoặc Admin.
    const isHost = await this.participantRepo.findOne({
      where: {
        meetingId: transcript.meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      },
    });
    if (!isHost) {
      const { roleCodes } = await this.getEffectiveRolesAndPermissions(userId);
      if (!this.isAdminRole(roleCodes)) {
        throw new ForbiddenException({
          success: false,
          message: 'Chi Host hoac Admin duoc sua transcript.',
          error: { code: 'PERMISSION_DENIED', details: {} },
        });
      }
    }

    const segmentsJson =
      (transcript.speakerSegmentsJson as Record<string, unknown>) || {};
    const segments = Array.isArray((segmentsJson as any).segments)
      ? [...((segmentsJson as any).segments as Array<Record<string, unknown>>)]
      : [];

    const byId = new Map<string, Record<string, unknown>>();
    segments.forEach((s) => byId.set(String(s.segmentId), s));

    // Validate tất cả segmentId tồn tại TRƯỚC khi sửa (all-or-nothing).
    for (const item of dto.segments) {
      if (!byId.has(item.segmentId)) {
        throw new NotFoundException({
          success: false,
          message: 'Segment khong ton tai trong transcript: ' + item.segmentId,
          error: {
            code: TRANSCRIPTION_ERROR_CODES.SEGMENT_NOT_FOUND,
            details: { segmentId: item.segmentId },
          },
        });
      }
    }

    const updatedSegments: string[] = [];
    for (const item of dto.segments) {
      const seg = byId.get(item.segmentId)!;
      if (item.text !== undefined) seg.text = item.text;
      if (item.speakerLabel !== undefined) seg.speakerLabel = item.speakerLabel;
      if (item.speakerUserId !== undefined) {
        seg.userId = item.speakerUserId;
        // Sửa tay -> nguồn speaker là manual, không còn là suy luận pyannote.
        seg.speakerSource = 'manual';
      }
      updatedSegments.push(item.segmentId);
    }

    const prevRevision = Number((segmentsJson as any).editRevisionNo || 0);
    const revisionNo = prevRevision + 1;
    const editedAt = new Date();

    const newSegmentsJson: Record<string, unknown> = {
      ...segmentsJson,
      segments,
      editRevisionNo: revisionNo,
      lastRevisionNote: dto.revisionNote ?? null,
    };

    // Cast payload: cột jsonb `speakerSegmentsJson` là Record<string, unknown>
    // (index signature) — TypeORM QueryDeepPartialEntity hiểu nhầm mỗi key là
    // raw-SQL callback nếu không cast (pattern đã dùng ở background-jobs.service).
    // KHÔNG đổi status — giữ nguyên (draft) theo FR-042/CLR-002.
    await this.transcriptRepo.update(transcriptId, {
      speakerSegmentsJson: newSegmentsJson,
      editedBy: userId,
      editedAt,
    } as Parameters<typeof this.transcriptRepo.update>[1]);

    this.logger.log(
      'Transcript ' +
        transcriptId +
        ' segments edited by ' +
        userId +
        ' (revision ' +
        revisionNo +
        ', ' +
        updatedSegments.length +
        ' segments)',
    );

    return {
      transcriptId,
      revisionNo,
      updatedSegments,
      editedBy: userId,
      updatedAt: editedAt,
    };
  }

  /**
   * Ghi đè trực tiếp `rawText`/`cleanedText` — nguồn text thật sự mà
   * `minutes-ai-draft.processor` dùng (`cleanedText || rawText`). Dùng để
   * test chất lượng AI summarize với input tự soạn, hoặc sửa tay khi STT
   * sai nhiều. Cùng authz với UC-127 (Host/Admin), KHÔNG đổi status.
   */
  async updateTranscriptContent(
    transcriptId: string,
    dto: UpdateTranscriptContentDto,
    userId: string,
  ): Promise<{
    transcriptId: string;
    editedBy: string;
    updatedAt: Date;
  }> {
    if (dto.rawText === undefined && dto.cleanedText === undefined) {
      throw new BadRequestException({
        success: false,
        message: 'Phai truyen it nhat rawText hoac cleanedText.',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }

    const transcript = await this.transcriptRepo.findOne({
      where: { id: transcriptId },
    });
    if (!transcript) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay transcript.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.TRANSCRIPT_NOT_FOUND,
          details: {},
        },
      });
    }

    // Authz: Host của meeting hoặc Admin — giống updateTranscriptSegments.
    const isHost = await this.participantRepo.findOne({
      where: {
        meetingId: transcript.meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      },
    });
    if (!isHost) {
      const { roleCodes } = await this.getEffectiveRolesAndPermissions(userId);
      if (!this.isAdminRole(roleCodes)) {
        throw new ForbiddenException({
          success: false,
          message: 'Chi Host hoac Admin duoc sua transcript.',
          error: { code: 'PERMISSION_DENIED', details: {} },
        });
      }
    }

    const editedAt = new Date();
    const updatePayload: Partial<TranscriptEntity> = {
      editedBy: userId,
      editedAt,
    };
    if (dto.rawText !== undefined) updatePayload.rawText = dto.rawText;
    if (dto.cleanedText !== undefined)
      updatePayload.cleanedText = dto.cleanedText;

    // KHÔNG đổi status — giữ nguyên (draft) theo FR-042/CLR-002.
    await this.transcriptRepo.update(
      transcriptId,
      updatePayload as Parameters<typeof this.transcriptRepo.update>[1],
    );

    this.logger.log(
      'Transcript ' +
        transcriptId +
        ' content (rawText/cleanedText) edited by ' +
        userId +
        (dto.revisionNote ? ' — ' + dto.revisionNote : ''),
    );

    return { transcriptId, editedBy: userId, updatedAt: editedAt };
  }

  /**
   * Gap fix (Nhóm A) — chưa từng có endpoint chuyển transcript từ `draft`
   * sang `reviewed`/`approved` dù enum đã có sẵn 2 trạng thái này (chỉ có
   * thể sửa segment/content, KHÔNG đổi status — theo đúng FR-042/CLR-002 cũ).
   * Chỉ cho chuyển TIẾN: draft→reviewed, draft/reviewed→approved. Không cho
   * lùi lại draft, không cho set từ processing/failed/hidden (trạng thái hệ
   * thống tự quản lý). Cùng authz Host/Admin như UC-127.
   */
  async updateTranscriptStatus(
    transcriptId: string,
    dto: UpdateTranscriptStatusDto,
    userId: string,
  ): Promise<{
    transcriptId: string;
    status: TranscriptStatus;
    updatedAt: Date;
  }> {
    const transcript = await this.transcriptRepo.findOne({
      where: { id: transcriptId },
    });
    if (!transcript) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay transcript.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.TRANSCRIPT_NOT_FOUND,
          details: {},
        },
      });
    }

    // Authz: Host của meeting hoặc Admin — giống updateTranscriptSegments/Content.
    const isHost = await this.participantRepo.findOne({
      where: {
        meetingId: transcript.meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      },
    });
    if (!isHost) {
      const { roleCodes } = await this.getEffectiveRolesAndPermissions(userId);
      if (!this.isAdminRole(roleCodes)) {
        throw new ForbiddenException({
          success: false,
          message: 'Chi Host hoac Admin duoc doi trang thai transcript.',
          error: { code: 'PERMISSION_DENIED', details: {} },
        });
      }
    }

    const target =
      dto.status === TranscriptStatusTransition.REVIEWED
        ? TranscriptStatus.REVIEWED
        : TranscriptStatus.APPROVED;
    const allowedFrom: Record<TranscriptStatus, TranscriptStatus[]> = {
      [TranscriptStatus.PROCESSING]: [],
      [TranscriptStatus.DRAFT]: [
        TranscriptStatus.REVIEWED,
        TranscriptStatus.APPROVED,
      ],
      [TranscriptStatus.REVIEWED]: [TranscriptStatus.APPROVED],
      [TranscriptStatus.APPROVED]: [],
      [TranscriptStatus.FAILED]: [],
      [TranscriptStatus.HIDDEN]: [],
    };
    if (!allowedFrom[transcript.status].includes(target)) {
      throw new ConflictException({
        success: false,
        message:
          'Khong the chuyen transcript tu trang thai "' +
          transcript.status +
          '" sang "' +
          target +
          '".',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.INVALID_TRANSCRIPT_STATUS_TRANSITION,
          details: { from: transcript.status, to: target },
        },
      });
    }

    const updatedAt = new Date();
    const updatePayload: Partial<TranscriptEntity> = { status: target };
    if (target === TranscriptStatus.APPROVED) {
      updatePayload.approvedBy = userId;
      updatePayload.approvedAt = updatedAt;
    }
    await this.transcriptRepo.update(
      transcriptId,
      updatePayload as Parameters<typeof this.transcriptRepo.update>[1],
    );

    this.logger.log(
      'Transcript ' +
        transcriptId +
        ' status ' +
        transcript.status +
        ' -> ' +
        target +
        ' by ' +
        userId +
        (dto.note ? ' — ' + dto.note : ''),
    );

    return { transcriptId, status: target, updatedAt };
  }

  /**
   * Ẩn transcript chưa được đánh dấu "đã xem" (DRAFT/FAILED) để dọn kết quả
   * STT cũ trước khi chạy lại. Soft-hide (status=HIDDEN) chứ không xóa cứng —
   * giữ dấu vết audit, đúng với enum TranscriptStatus.HIDDEN vốn đã có sẵn
   * trong schema nhưng chưa từng được set ở đâu.
   */
  async hideTranscript(
    transcriptId: string,
    userId: string,
  ): Promise<{
    transcriptId: string;
    status: TranscriptStatus;
    updatedAt: Date;
  }> {
    const transcript = await this.transcriptRepo.findOne({
      where: { id: transcriptId },
    });
    if (!transcript) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay transcript.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.TRANSCRIPT_NOT_FOUND,
          details: {},
        },
      });
    }

    // Authz: Host của meeting hoặc Admin — giống updateTranscriptStatus.
    const isHost = await this.participantRepo.findOne({
      where: {
        meetingId: transcript.meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      },
    });
    if (!isHost) {
      const { roleCodes } = await this.getEffectiveRolesAndPermissions(userId);
      if (!this.isAdminRole(roleCodes)) {
        throw new ForbiddenException({
          success: false,
          message: 'Chi Host hoac Admin duoc xoa transcript.',
          error: { code: 'PERMISSION_DENIED', details: {} },
        });
      }
    }

    const hideable = [TranscriptStatus.DRAFT, TranscriptStatus.FAILED];
    if (!hideable.includes(transcript.status)) {
      throw new ConflictException({
        success: false,
        message:
          'Chi co the xoa transcript chua duoc danh dau da xem (draft/failed).',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.TRANSCRIPT_NOT_DRAFT,
          details: { status: transcript.status },
        },
      });
    }

    const updatedAt = new Date();
    await this.transcriptRepo.update(transcriptId, {
      status: TranscriptStatus.HIDDEN,
    });

    this.logger.log(
      'Transcript ' +
        transcriptId +
        ' hidden (from ' +
        transcript.status +
        ') by ' +
        userId,
    );

    return { transcriptId, status: TranscriptStatus.HIDDEN, updatedAt };
  }

  async failTranscript(
    transcriptId: string,
    errorMessage: string,
  ): Promise<void> {
    await this.transcriptRepo.update(transcriptId, {
      status: TranscriptStatus.FAILED,
    });
    this.logger.warn('Transcript ' + transcriptId + ' failed: ' + errorMessage);
  }

  async getTranscriptionJobs(
    meetingId: string,
    userId: string,
  ): Promise<
    Array<{
      jobId: string;
      transcriptId: string | null;
      status: string;
      transcriptStatus: string | null;
      createdAt: string | null;
      completedAt: string | null;
    }>
  > {
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId },
    });
    if (!meeting) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop.',
        error: {
          code: TRANSCRIPTION_ERROR_CODES.MEETING_NOT_FOUND,
          details: {},
        },
      });
    }

    const participant = await this.participantRepo.findOne({
      where: { meetingId, userId },
    });
    if (!participant) {
      const { roleCodes } = await this.getEffectiveRolesAndPermissions(userId);
      if (!this.isAdminRole(roleCodes)) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong co quyen xem transcription jobs.',
          error: { code: 'PERMISSION_DENIED', details: {} },
        });
      }
    }

    const rows: Array<{
      job_id: string;
      status: string;
      created_at: string | null;
      completed_at: string | null;
      transcript_id: string | null;
      transcript_status: string | null;
    }> = await this.dataSource.query(
      // Gap fix (2026-08-16): sắp theo bj.started_at/completed_at khiến job vừa
      // enqueue (cả 2 cột đều NULL — started_at chỉ set khi worker markRunning(),
      // background_jobs không có created_at) bị NULLS LAST đẩy xuống cuối, đứng
      // sau job CŨ đã completed. FE lấy rows[0] làm "job mới nhất" nên bị "mù"
      // trước job mới cho tới khi worker thật sự chạy nó. transcripts.created_at
      // luôn được set ngay trong transaction tạo job (xem createTranscriptionJob)
      // nên dùng làm khóa sắp chính mới phản ánh đúng thứ tự tạo job.
      `SELECT
         bj.id            AS job_id,
         bj.status        AS status,
         t.created_at     AS created_at,
         bj.completed_at  AS completed_at,
         t.id             AS transcript_id,
         t.status         AS transcript_status
       FROM background_jobs bj
       LEFT JOIN transcripts t ON t.background_job_id = bj.id
       WHERE bj.job_type = $1
         AND bj.related_entity_type = 'meeting'
         AND bj.related_entity_id = $2
         AND (t.status IS NULL OR t.status <> 'hidden')
       ORDER BY t.created_at DESC NULLS LAST, bj.completed_at DESC NULLS LAST`,
      [BackgroundJobType.TRANSCRIPTION, meetingId],
    );

    return rows.map((r) => ({
      jobId: r.job_id,
      transcriptId: r.transcript_id,
      status: r.status,
      transcriptStatus: r.transcript_status,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    }));
  }

  private async getEffectiveRolesAndPermissions(
    userId: string,
  ): Promise<{ roleCodes: string[]; permissions: string[] }> {
    const userRoles = await this.dataSource.query(
      'SELECT r.role_code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.is_active = true',
      [userId],
    );
    const roleCodes = userRoles.map((r: any) => r.role_code);
    if (roleCodes.length === 0) return { roleCodes: [], permissions: [] };
    const perms = await this.dataSource.query(
      'SELECT DISTINCT p.permission_code FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id JOIN roles r ON r.id = rp.role_id WHERE r.role_code = ANY($1) AND p.is_active = true',
      [roleCodes],
    );
    return { roleCodes, permissions: perms.map((p: any) => p.permission_code) };
  }

  /**
   * BUSINESS_ADMIN/SYSTEM_ADMIN — đúng role code thật trong hệ thống (xem
   * meetings.service.ts/attendance.service.ts). KHÔNG dùng permission code
   * 'admin.all'/'admin.manage' — 2 code này chưa từng được seed vào DB nên
   * check theo permission sẽ luôn fail dù user là admin thật (bug đã fix).
   */
  private isAdminRole(roleCodes: string[]): boolean {
    return roleCodes.some((code) =>
      ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'].includes(code),
    );
  }

  /**
   * Gap fix — quy đổi (actualStartTime + offsetMs) sang ISO string giờ Việt
   * Nam (UTC+7 cố định, VN không có DST nên không cần thư viện timezone).
   * null nếu actualStartTime chưa có (meeting chưa từng start thật qua
   * live-meeting) hoặc offsetMs không hợp lệ — KHÔNG throw, chỉ là field
   * hiển thị tiện lợi cho FE, không được làm fail cả response transcript.
   */
  private toVietnamIso(
    actualStartTime: Date | null,
    offsetMs: unknown,
  ): string | null {
    if (!actualStartTime || typeof offsetMs !== 'number') return null;
    const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
    const vnTime = new Date(
      actualStartTime.getTime() + offsetMs + VN_OFFSET_MS,
    );
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    const yyyy = vnTime.getUTCFullYear();
    const mm = pad(vnTime.getUTCMonth() + 1);
    const dd = pad(vnTime.getUTCDate());
    const hh = pad(vnTime.getUTCHours());
    const mi = pad(vnTime.getUTCMinutes());
    const ss = pad(vnTime.getUTCSeconds());
    const ms = pad(vnTime.getUTCMilliseconds(), 3);
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}.${ms}+07:00`;
  }
}
