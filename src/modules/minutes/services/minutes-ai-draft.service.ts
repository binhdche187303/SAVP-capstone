import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';

import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import {
  TranscriptEntity,
  TranscriptSecurityStatus,
  TranscriptStatus,
} from '../../transcription/entities/transcript.entity.js';
import {
  BackgroundJobEntity,
  BackgroundJobStatus,
  BackgroundJobType,
} from '../../administration/entities/background-job.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
  MeetingMinutesSource,
} from '../entities/meeting-minutes.entity.js';
import { QueueService } from '../../queue/queue.service.js';
import { CreateAiDraftJobDto } from '../dto/create-ai-draft-job.dto.js';
import { AiDraftJobResponseDto } from '../dto/ai-draft-job-response.dto.js';
import { AiDraftJobSummaryDto } from '../dto/ai-draft-job-summary.dto.js';
import { AiDraftConfigDto } from '../dto/ai-draft-config.dto.js';
import {
  AI_MINUTES_CONFIG_KEY,
  AI_MINUTES_ERROR_CODES,
  AI_MINUTES_JOB_ATTEMPTS,
  AI_MINUTES_JOB_NAME,
  AI_MINUTES_QUEUE_NAME,
} from '../constants/ai-minutes-draft.constants.js';

export interface AiDraftAuthUser {
  userId: string;
}

/** Shape của system_configs['ai.minutes_summary'].config_json (spec 5.2.2). */
export interface AiMinutesSummaryConfig {
  enabled: boolean;
  provider: 'mock' | 'self_hosted_llm';
  modelName: string;
  allowExternalProvider: boolean;
  requireHumanReview: boolean;
  maxInputTokens: number;
  temperature: number;
  retentionDays: number;
  logRawTranscript: boolean;
}

/** Payload đẩy vào BullMQ queue — worker (Phase 2) consume shape này. */
export interface AiDraftJobPayload {
  backgroundJobId: string;
  meetingId: string;
  transcriptId: string;
  language: string;
  forceRerun: boolean;
  userId: string;
}

const TRANSCRIPT_READY_STATUSES = [
  TranscriptStatus.DRAFT,
  TranscriptStatus.REVIEWED,
  TranscriptStatus.APPROVED,
];

const TRANSCRIPT_BLOCKED_SECURITY = [
  TranscriptSecurityStatus.RESTRICTED,
  TranscriptSecurityStatus.BLOCKED,
];

@Injectable()
export class MinutesAiDraftService {
  private readonly logger = new Logger(MinutesAiDraftService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly queueService: QueueService,
  ) {}

  /**
   * MKM-AI-01 — tạo background job sinh AI draft minutes (plan 7.1).
   * Thứ tự validation CỐ ĐỊNH để error code deterministic cho test (plan 8.2).
   */
  async createAiDraftJob(
    meetingId: string,
    dto: CreateAiDraftJobDto,
    authUser: AiDraftAuthUser,
  ): Promise<AiDraftJobResponseDto> {
    const language = dto.language ?? 'vi-VN';
    const forceRerun = dto.forceRerun ?? false;

    const job = await this.dataSource.transaction(async (manager) => {
      // Step 1: Load + lock meeting (FOR UPDATE) — chống race với UC-MKM-01
      // tạo minutes tay và với request AI draft song song.
      const meeting = await manager
        .getRepository(MeetingEntity)
        .createQueryBuilder('meeting')
        .setLock('pessimistic_write')
        .where('meeting.id = :meetingId', { meetingId })
        .getOne();

      if (!meeting || meeting.deletedAt) {
        throw new NotFoundException({
          success: false,
          message: 'Khong tim thay cuoc hop.',
          error: {
            code: AI_MINUTES_ERROR_CODES.MEETING_NOT_FOUND,
            details: { meetingId },
          },
        });
      }

      // Step 2: Ownership — Host của meeting, hoặc SYSTEM_ADMIN (chỉ bypass
      // ownership, KHÔNG bypass các validation sau — spec 2.3).
      if (meeting.hostId !== authUser.userId) {
        const isSystemAdmin = await this.userIsSystemAdmin(
          manager,
          authUser.userId,
        );
        if (!isSystemAdmin) {
          throw new ForbiddenException({
            success: false,
            message:
              'Ban khong phai Host cua cuoc hop nay va khong phai System Admin.',
            error: {
              code: AI_MINUTES_ERROR_CODES.PERMISSION_DENIED,
              details: {},
            },
          });
        }
      }

      // Step 3: Feature flag — thiếu key = tắt (fail-safe FR-014).
      const config = await this.loadConfig(manager);
      if (!config?.enabled) {
        throw new ForbiddenException({
          success: false,
          message:
            'Tinh nang AI tao bien ban nhap dang tat (system_configs ai.minutes_summary).',
          error: {
            code: AI_MINUTES_ERROR_CODES.AI_SUMMARY_DISABLED,
            details: {},
          },
        });
      }

      // Step 4: Transcript tồn tại + thuộc meeting + hoàn tất + không restricted.
      const transcript = await manager
        .getRepository(TranscriptEntity)
        .findOne({ where: { id: dto.transcriptId } });

      if (!transcript || transcript.meetingId !== meetingId) {
        throw new NotFoundException({
          success: false,
          message: 'Khong tim thay transcript thuoc cuoc hop nay.',
          error: {
            code: AI_MINUTES_ERROR_CODES.TRANSCRIPT_NOT_FOUND,
            details: { transcriptId: dto.transcriptId },
          },
        });
      }

      if (!TRANSCRIPT_READY_STATUSES.includes(transcript.status)) {
        throw new UnprocessableEntityException({
          success: false,
          message:
            'Transcript chua hoan tat (status phai la draft/reviewed/approved).',
          error: {
            code: AI_MINUTES_ERROR_CODES.TRANSCRIPT_NOT_READY,
            details: { transcriptStatus: transcript.status },
          },
        });
      }

      if (TRANSCRIPT_BLOCKED_SECURITY.includes(transcript.securityStatus)) {
        throw new ForbiddenException({
          success: false,
          message: 'Transcript bi han che, khong duoc dua vao AI (FR-017).',
          error: {
            code: AI_MINUTES_ERROR_CODES.TRANSCRIPT_RESTRICTED,
            details: {},
          },
        });
      }

      // Step 5: Dedup — 1 AI job active/meeting (FR-011), query theo index
      // ix_background_jobs_related, không query input_json.
      const runningJob = await manager
        .getRepository(BackgroundJobEntity)
        .findOne({
          where: {
            relatedEntityType: 'meeting',
            relatedEntityId: meetingId,
            jobType: BackgroundJobType.AI_MEETING_SUMMARY,
            status: In([
              BackgroundJobStatus.QUEUED,
              BackgroundJobStatus.RUNNING,
              BackgroundJobStatus.RETRYING,
            ]),
          },
        });

      if (runningJob) {
        throw new ConflictException({
          success: false,
          message: 'Da co AI draft job dang chay cho cuoc hop nay.',
          error: {
            code: AI_MINUTES_ERROR_CODES.AI_JOB_ALREADY_RUNNING,
            details: { jobId: runningJob.id, jobStatus: runningJob.status },
          },
        });
      }

      // Step 6: Quy tắc 1 AI minutes active/meeting (MKM-MANUAL-01: FR-004 — bản manual không chặn AI job).
      const existingMinutes = await manager
        .getRepository(MeetingMinutesEntity)
        .findOne({
          where: {
            meetingId,
            source: MeetingMinutesSource.AI,
            deletedAt: IsNull(),
          },
        });

      if (existingMinutes) {
        if (!forceRerun) {
          throw new ConflictException({
            success: false,
            message:
              'Cuoc hop da co bien ban. Dung forceRerun=true neu muon ghi de ban nhap AI cu.',
            error: {
              code: AI_MINUTES_ERROR_CODES.MINUTES_ALREADY_EXISTS,
              details: { existingMinutesId: existingMinutes.id },
            },
          });
        }

        const isOverwritableAiDraft =
          existingMinutes.aiSummaryJson !== null &&
          existingMinutes.status === MeetingMinutesStatus.DRAFT;
        if (!isOverwritableAiDraft) {
          throw new ConflictException({
            success: false,
            message:
              'Bien ban hien tai khong phai ban nhap AI (soan tay hoac da ban hanh) — khong duoc ghi de (FR-020).',
            error: {
              code: AI_MINUTES_ERROR_CODES.MINUTES_NOT_AI_DRAFT,
              details: { existingMinutesId: existingMinutes.id },
            },
          });
        }
      }

      // Step 7: INSERT background_jobs trong cùng transaction.
      const jobRepo = manager.getRepository(BackgroundJobEntity);
      return jobRepo.save(
        jobRepo.create({
          jobType: BackgroundJobType.AI_MEETING_SUMMARY,
          queueName: AI_MINUTES_QUEUE_NAME,
          relatedEntityType: 'meeting',
          relatedEntityId: meetingId,
          requestedBy: authUser.userId,
          status: BackgroundJobStatus.QUEUED,
          retryCount: 0,
          inputJson: {
            transcriptId: dto.transcriptId,
            language,
            forceRerun,
          },
        }),
      );
    });

    // Step 8: Enqueue SAU commit — nếu fail thì compensating markFailed
    // (plan 9.3), không để job record "queued" mồ côi.
    const payload: AiDraftJobPayload = {
      backgroundJobId: job.id,
      meetingId,
      transcriptId: dto.transcriptId,
      language,
      forceRerun,
      userId: authUser.userId,
    };
    try {
      await this.queueService.addJob(
        AI_MINUTES_QUEUE_NAME,
        AI_MINUTES_JOB_NAME,
        payload,
        { attempts: AI_MINUTES_JOB_ATTEMPTS },
      );
    } catch {
      await this.dataSource.getRepository(BackgroundJobEntity).update(
        { id: job.id },
        {
          status: BackgroundJobStatus.FAILED,
          errorMessage: 'ENQUEUE_FAILED: khong day duoc job vao queue',
        },
      );
      this.logger.error(
        `Enqueue AI draft job failed — jobId=${job.id} meetingId=${meetingId}`,
      );
      throw new InternalServerErrorException({
        success: false,
        message: 'Khong the dua job vao hang doi. Vui long thu lai.',
        error: { code: 'ENQUEUE_FAILED', details: { jobId: job.id } },
      });
    }

    // FR-025: log chỉ chứa id/status — không log nội dung transcript.
    this.logger.log(
      `AI draft job queued — jobId=${job.id} meetingId=${meetingId} transcriptId=${dto.transcriptId}`,
    );

    return { jobId: job.id, meetingId, status: 'queued' };
  }

  /**
   * MKM-AI-02 (FR-008) — liệt kê AI draft job của một meeting để FE resume
   * polling sau reload. Auth: Host của meeting HOẶC Admin (SYSTEM_ADMIN/
   * BUSINESS_ADMIN) — rộng hơn create (chỉ đọc trạng thái, không tạo job).
   *
   * Sắp xếp theo timeline job có sẵn (`background_jobs` không có cột created_at):
   * COALESCE(completed_at, started_at, scheduled_at) DESC NULLS FIRST — job vừa
   * tạo (mọi mốc NULL) nổi lên đầu, job hoàn tất gần nhất kế tiếp. Do FR-011
   * chỉ cho 1 job active/meeting nên không có nhập nhằng giữa nhiều job queued.
   */
  async listAiDraftJobs(
    meetingId: string,
    authUser: AiDraftAuthUser,
  ): Promise<AiDraftJobSummaryDto[]> {
    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: meetingId } });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop.',
        error: {
          code: AI_MINUTES_ERROR_CODES.MEETING_NOT_FOUND,
          details: { meetingId },
        },
      });
    }

    // Thư ký soạn & sửa biên bản nên cũng được xem trạng thái AI draft.
    if (
      meeting.hostId !== authUser.userId &&
      meeting.secretaryId !== authUser.userId
    ) {
      const isAdmin = await this.userHasAdminRole(authUser.userId);
      if (!isAdmin) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong phai Host cua cuoc hop nay va khong phai Admin.',
          error: {
            code: AI_MINUTES_ERROR_CODES.PERMISSION_DENIED,
            details: {},
          },
        });
      }
    }

    const jobs = await this.dataSource
      .getRepository(BackgroundJobEntity)
      .createQueryBuilder('job')
      .where('job.related_entity_type = :type', { type: 'meeting' })
      .andWhere('job.related_entity_id = :meetingId', { meetingId })
      .andWhere('job.job_type = :jobType', {
        jobType: BackgroundJobType.AI_MEETING_SUMMARY,
      })
      .orderBy(
        'COALESCE(job.completed_at, job.started_at, job.scheduled_at)',
        'DESC',
        'NULLS FIRST',
      )
      .getMany();

    return jobs.map(
      (job) =>
        new AiDraftJobSummaryDto({
          jobId: job.id,
          status: job.status,
          scheduledAt: job.scheduledAt ?? null,
          startedAt: job.startedAt ?? null,
          completedAt: job.completedAt ?? null,
          errorMessage: job.errorMessage ?? null,
          result: job.outputJson ?? null,
        }),
    );
  }

  /**
   * MKM-AI-03 (FR-001) — trạng thái khả dụng của tính năng AI draft cho FE
   * (hiện/ẩn nút "Tạo bằng AI" + banner "cần review"). Tập con AN TOÀN của
   * config — không trả provider/modelName/maxInputTokens/... (FR-002).
   * Auth: Host của meeting HOẶC Admin — cùng pattern ownership listAiDraftJobs.
   */
  async getAiDraftAvailability(
    meetingId: string,
    authUser: AiDraftAuthUser,
  ): Promise<AiDraftConfigDto> {
    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: meetingId } });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay cuoc hop.',
        error: {
          code: AI_MINUTES_ERROR_CODES.MEETING_NOT_FOUND,
          details: { meetingId },
        },
      });
    }

    if (
      meeting.hostId !== authUser.userId &&
      meeting.secretaryId !== authUser.userId
    ) {
      const isAdmin = await this.userHasAdminRole(authUser.userId);
      if (!isAdmin) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong phai Host cua cuoc hop nay va khong phai Admin.',
          error: {
            code: AI_MINUTES_ERROR_CODES.PERMISSION_DENIED,
            details: {},
          },
        });
      }
    }

    // Đọc trực tiếp (không transaction — chỉ đọc, không cần lock).
    const config = await this.loadConfig(this.dataSource.manager);
    return new AiDraftConfigDto({
      enabled: config?.enabled ?? false,
      requireHumanReview: config?.requireHumanReview ?? true,
    });
  }

  /**
   * Admin check (SYSTEM_ADMIN hoặc BUSINESS_ADMIN) cho endpoint đọc — nhất quán
   * với authorize của GET /background-jobs/:id (cho phép cả BUSINESS_ADMIN đọc).
   */
  private async userHasAdminRole(userId: string): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ role_code: string }>>(
      `SELECT r.role_code
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
          AND r.is_active = true
          AND r.role_code IN ('SYSTEM_ADMIN', 'BUSINESS_ADMIN')
        LIMIT 1`,
      [userId],
    );
    return rows.length > 0;
  }

  /**
   * SYSTEM_ADMIN check theo role_code thật trong DB — nhất quán pattern
   * BackgroundJobsService.userHasAdminRole (không check permission code).
   * Chỉ SYSTEM_ADMIN được bypass ownership (spec 2.1), khác với endpoint poll
   * background-jobs cho phép cả BUSINESS_ADMIN.
   */
  private async userIsSystemAdmin(
    manager: EntityManager,
    userId: string,
  ): Promise<boolean> {
    const rows = await manager.query<Array<{ role_code: string }>>(
      `SELECT r.role_code
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
          AND r.is_active = true
          AND r.role_code = $2
        LIMIT 1`,
      [userId, 'SYSTEM_ADMIN'],
    );
    return rows.length > 0;
  }

  private async loadConfig(
    manager: EntityManager,
  ): Promise<AiMinutesSummaryConfig | null> {
    const config = await manager.getRepository(SystemConfigEntity).findOne({
      where: { configKey: AI_MINUTES_CONFIG_KEY, isActive: true },
    });
    if (!config?.configJson) {
      return null;
    }
    return config.configJson as unknown as AiMinutesSummaryConfig;
  }
}
