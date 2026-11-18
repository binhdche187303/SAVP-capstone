import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';

import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import {
  TranscriptEntity,
  TranscriptSecurityStatus,
  TranscriptStatus,
} from '../../transcription/entities/transcript.entity.js';
import {
  BackgroundJobEntity,
  BackgroundJobStatus,
} from '../../administration/entities/background-job.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
  MeetingMinutesVisibilityLevel,
  MeetingMinutesSource,
} from '../entities/meeting-minutes.entity.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { LlmProviderFactory } from '../ai/llm-provider.factory.js';
import { NonRetryableAiJobError } from '../ai/llm-provider.port.js';
import { CONTEXT_RETRIEVER } from '../ai/context-retriever.port.js';
import type { ContextRetrieverPort } from '../ai/context-retriever.port.js';
import {
  buildAiMinutesPrompt,
  buildRepairPrompt,
  AI_MINUTES_OUTPUT_JSON_SCHEMA,
} from '../ai/prompt-builder.js';
import {
  AiMinutesOutput,
  validateAiOutput,
} from '../ai/ai-output-validator.js';
import type { AiMinutesSummaryConfig } from '../services/minutes-ai-draft.service.js';
import type { AiDraftJobPayload } from '../services/minutes-ai-draft.service.js';
import {
  AI_MINUTES_AUDIT_ACTION,
  AI_MINUTES_CONFIG_KEY,
  AI_MINUTES_ERROR_CODES,
  AI_MINUTES_JOB_NAME,
  AI_MINUTES_PROMPT_VERSION,
  AI_MINUTES_QUEUE_NAME,
} from '../constants/ai-minutes-draft.constants.js';
import { Inject } from '@nestjs/common';

const TRANSCRIPT_READY_STATUSES = [
  TranscriptStatus.DRAFT,
  TranscriptStatus.REVIEWED,
  TranscriptStatus.APPROVED,
];

const TRANSCRIPT_BLOCKED_SECURITY = [
  TranscriptSecurityStatus.RESTRICTED,
  TranscriptSecurityStatus.BLOCKED,
];

/**
 * MKM-AI-01 — AI Worker Summary (plan 7.2): BullMQ processor trong NestJS
 * (pattern TranscriptionWorkerProcessor), concurrency=1 (NFR-002 — tuần tự,
 * không tranh tài nguyên với STT trên máy local).
 *
 * Phân loại lỗi (plan 9.2):
 * - NonRetryableAiJobError -> markFailed + return (KHÔNG throw, tránh retry).
 * - Lỗi khác (LLM timeout/network) -> retryable: markRetrying + throw nếu còn
 *   attempts; hết attempts -> markFailed LLM_UNAVAILABLE.
 *
 * FR-025: log CHỈ chứa jobId/meetingId/transcriptId/status/duration/errorCode
 * — không bao giờ log transcript/prompt/summary.
 */
@Processor(AI_MINUTES_QUEUE_NAME, { concurrency: 1 })
export class MinutesAiDraftProcessor extends WorkerHost {
  private readonly logger = new Logger(MinutesAiDraftProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly configService: ConfigService,
    private readonly llmProviderFactory: LlmProviderFactory,
    @Inject(CONTEXT_RETRIEVER)
    private readonly contextRetriever: ContextRetrieverPort,
  ) {
    super();
  }

  async process(job: Job<AiDraftJobPayload>): Promise<unknown> {
    if (!job.name.startsWith(AI_MINUTES_JOB_NAME)) {
      this.logger.warn(`Unknown job name ${job.name} — ACK`);
      return;
    }

    const { backgroundJobId, meetingId, transcriptId } = job.data;
    const startedAtMs = Date.now();
    this.logger.log(
      `Processing AI draft job — jobId=${backgroundJobId} meetingId=${meetingId} transcriptId=${transcriptId}`,
    );

    try {
      await this.backgroundJobsService.markRunning(backgroundJobId);

      const output = await this.generateValidatedOutput(job.data);
      const minutesId = await this.persistDraft(job.data, output);

      const durationMs = Date.now() - startedAtMs;
      this.logger.log(
        `AI draft job completed — jobId=${backgroundJobId} meetingId=${meetingId} minutesId=${minutesId} durationMs=${durationMs}`,
      );
      return { success: true, minutesId };
    } catch (error: unknown) {
      return this.handleError(job, error, startedAtMs);
    }
  }

  /** Bước 2-8 của plan 7.2: re-validate, token guard, prompt, LLM, repair. */
  private async generateValidatedOutput(
    payload: AiDraftJobPayload,
  ): Promise<AiMinutesOutput> {
    const { meetingId, transcriptId } = payload;

    // Step 2: re-check config (TOCTOU fail-safe — flag có thể tắt sau khi queue)
    const config = await this.loadConfig();
    if (!config?.enabled) {
      throw new NonRetryableAiJobError(
        AI_MINUTES_ERROR_CODES.AI_SUMMARY_DISABLED,
        'Feature flag da tat sau khi job duoc queue',
      );
    }

    // Step 3: re-validate transcript (trạng thái có thể đổi giữa lúc chờ queue)
    const transcript = await this.dataSource
      .getRepository(TranscriptEntity)
      .findOne({ where: { id: transcriptId } });
    if (!transcript || transcript.meetingId !== meetingId) {
      throw new NonRetryableAiJobError(
        AI_MINUTES_ERROR_CODES.TRANSCRIPT_NOT_FOUND,
        'Transcript không tồn tại hoặc không thuộc cuộc họp',
      );
    }
    if (!TRANSCRIPT_READY_STATUSES.includes(transcript.status)) {
      throw new NonRetryableAiJobError(
        AI_MINUTES_ERROR_CODES.TRANSCRIPT_NOT_READY,
        `Trạng thái transcript ${transcript.status} không hợp lệ`,
      );
    }
    if (TRANSCRIPT_BLOCKED_SECURITY.includes(transcript.securityStatus)) {
      throw new NonRetryableAiJobError(
        AI_MINUTES_ERROR_CODES.TRANSCRIPT_RESTRICTED,
        'Transcript bị hạn chế sau khi tác vụ được đưa vào hàng đợi',
      );
    }

    // Step 4: token guard — heuristic chars/3 (tiếng Việt), tinh chỉnh sau
    // benchmark T018 (ERR-010).
    const sourceText = transcript.cleanedText || transcript.rawText || '';
    const estimatedTokens = Math.ceil(sourceText.length / 3);
    if (estimatedTokens > config.maxInputTokens) {
      throw new NonRetryableAiJobError(
        AI_MINUTES_ERROR_CODES.TRANSCRIPT_TOO_LONG_FOR_MVP,
        `estimatedTokens=${estimatedTokens} > maxInputTokens=${config.maxInputTokens}`,
      );
    }

    // Step 5-6: context (MVP rỗng) + prompt
    const context = await this.contextRetriever.retrieve(meetingId);
    const prompt = buildAiMinutesPrompt({
      transcriptText: sourceText,
      context,
    });

    // Step 7: gọi LLM — lỗi từ provider throw thẳng ra (retryable)
    const provider = this.llmProviderFactory.resolve(config.provider);
    const generateOpts = {
      timeoutMs: this.configService.get<number>(
        'AI_SUMMARY_LLM_TIMEOUT_MS',
        300000,
      ),
      temperature: config.temperature ?? 0.2,
      modelName: config.modelName,
      // Grammar-constrained decoding (Ollama >=0.5) — loai bo lop loi model
      // tra sai cau truc decisions/actionItems (van de #3, phat hien 2026-07-08).
      responseJsonSchema: AI_MINUTES_OUTPUT_JSON_SCHEMA,
    };
    let raw = await provider.generate(prompt, generateOpts);

    // Step 8: validate + repair tối đa 1 lần (FR-019)
    let validated = validateAiOutput(raw);
    if (!validated.ok) {
      const repairPrompt = buildRepairPrompt({
        invalidOutput: raw,
        errorMessage: validated.error,
      });
      raw = await provider.generate(repairPrompt, generateOpts);
      validated = validateAiOutput(raw);
      if (!validated.ok) {
        throw new NonRetryableAiJobError(
          AI_MINUTES_ERROR_CODES.AI_OUTPUT_INVALID_SCHEMA,
          `Sai schema sau 1 lan repair: ${validated.error}`,
        );
      }
    }

    // Đọc lại provider/model để ghi meta — dùng config đã load
    this.lastRunConfig = config;
    return validated.data;
  }

  /** Config của lần chạy hiện tại — dùng cho meta khi persist (concurrency=1). */
  private lastRunConfig: AiMinutesSummaryConfig | null = null;

  /** Step 9 plan 7.2: transaction ghi minutes + job completed + audit. */
  private async persistDraft(
    payload: AiDraftJobPayload,
    output: AiMinutesOutput,
  ): Promise<string> {
    const { backgroundJobId, meetingId, transcriptId, forceRerun, userId } =
      payload;
    const config = this.lastRunConfig;

    return this.dataSource.transaction(async (manager) => {
      // Lock meeting FOR UPDATE — chống race với UC-MKM-01 tạo minutes tay
      const meeting = await manager
        .getRepository(MeetingEntity)
        .createQueryBuilder('meeting')
        .setLock('pessimistic_write')
        .where('meeting.id = :meetingId', { meetingId })
        .getOne();
      if (!meeting || meeting.deletedAt) {
        throw new NonRetryableAiJobError(
          AI_MINUTES_ERROR_CODES.MEETING_NOT_FOUND,
          'Cuộc họp đã bị xóa sau khi tác vụ được đưa vào hàng đợi',
        );
      }

      const minutesRepo = manager.getRepository(MeetingMinutesEntity);
      const existing = await minutesRepo.findOne({
        where: {
          meetingId,
          source: MeetingMinutesSource.AI,
          deletedAt: IsNull(),
        },
      });

      const aiSummaryJson = {
        keyPoints: output.keyPoints,
        risks: output.risks,
        openQuestions: output.openQuestions,
        uncertainParts: output.uncertainParts,
        meta: {
          provider: config?.provider ?? 'unknown',
          modelName: config?.modelName ?? 'unknown',
          promptVersion: AI_MINUTES_PROMPT_VERSION,
          generatedByJobId: backgroundJobId,
          generatedAt: new Date().toISOString(),
        },
      } as unknown as Record<string, unknown>;

      let minutesId: string;
      if (existing) {
        // TOCTOU: minutes có thể được publish trong lúc job chạy —
        // chỉ được UPDATE khi là AI-draft + forceRerun (FR-016/FR-020)
        const overwritable =
          forceRerun &&
          existing.source === MeetingMinutesSource.AI &&
          existing.status === MeetingMinutesStatus.DRAFT;
        if (!overwritable) {
          throw new NonRetryableAiJobError(
            AI_MINUTES_ERROR_CODES.MINUTES_ALREADY_EXISTS,
            'Biên bản đã tồn tại (được tạo tay hoặc ban hành trong lúc tác vụ chạy), không ghi đè',
          );
        }
        existing.minutesContent = output.summary;
        existing.decisionsJson = output.decisions as unknown as Record<
          string,
          unknown
        >;
        existing.actionItemsJson = output.actionItems as unknown as Record<
          string,
          unknown
        >;
        existing.aiSummaryJson = aiSummaryJson;
        existing.linkedTranscriptId = transcriptId;
        existing.preparedBy = userId;
        existing.versionNo = existing.versionNo + 1;
        const saved = await minutesRepo.save(existing);
        minutesId = saved.id;
      } else {
        const created = await minutesRepo.save(
          minutesRepo.create({
            meetingId,
            title: `Biên bản họp: ${meeting.title}`,
            status: MeetingMinutesStatus.DRAFT,
            visibilityLevel: MeetingMinutesVisibilityLevel.PRIVATE,
            minutesContent: output.summary,
            decisionsJson: output.decisions as unknown as Record<
              string,
              unknown
            >,
            actionItemsJson: output.actionItems as unknown as Record<
              string,
              unknown
            >,
            aiSummaryJson,
            linkedTranscriptId: transcriptId,
            preparedBy: userId,
            source: MeetingMinutesSource.AI,
          }),
        );
        minutesId = created.id;
      }

      // Cùng transaction: job completed + output_json chứa minutesId (FR-008)
      await manager.getRepository(BackgroundJobEntity).update(
        { id: backgroundJobId },
        {
          status: BackgroundJobStatus.COMPLETED,
          completedAt: new Date(),
          outputJson: { minutesId, meetingId, status: 'draft' },
        },
      );

      // Audit trong cùng transaction (FR-009)
      await manager.getRepository(AuditLogEntity).save(
        manager.getRepository(AuditLogEntity).create({
          userId,
          actionType: AI_MINUTES_AUDIT_ACTION,
          entityType: 'meeting_minutes',
          entityId: minutesId,
          metadataJson: { meetingId, transcriptId, jobId: backgroundJobId },
        }),
      );

      return minutesId;
    });
  }

  private async handleError(
    job: Job<AiDraftJobPayload>,
    error: unknown,
    startedAtMs: number,
  ): Promise<unknown> {
    const { backgroundJobId, meetingId } = job.data;
    const durationMs = Date.now() - startedAtMs;

    if (error instanceof NonRetryableAiJobError) {
      this.logger.error(
        `AI draft job failed (non-retryable) — jobId=${backgroundJobId} meetingId=${meetingId} errorCode=${error.code} durationMs=${durationMs}`,
      );
      await this.backgroundJobsService.markFailed(
        backgroundJobId,
        error.message,
      );
      return; // KHÔNG throw — tránh BullMQ retry vô ích (plan 9.2)
    }

    // Retryable (LLM timeout/network/unexpected)
    const attemptsAllowed = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= attemptsAllowed;
    this.logger.error(
      `AI draft job error (retryable) — jobId=${backgroundJobId} meetingId=${meetingId} attempt=${job.attemptsMade + 1}/${attemptsAllowed} errorCode=${AI_MINUTES_ERROR_CODES.LLM_UNAVAILABLE} durationMs=${durationMs}`,
    );

    if (isLastAttempt) {
      await this.backgroundJobsService.markFailed(
        backgroundJobId,
        `${AI_MINUTES_ERROR_CODES.LLM_UNAVAILABLE}: LLM runtime khong phan hoi sau ${attemptsAllowed} lan thu`,
      );
      return;
    }

    await this.backgroundJobsService.markRetrying(backgroundJobId);
    throw error; // BullMQ retry theo attempts=2 (FR-018)
  }

  private async loadConfig(): Promise<AiMinutesSummaryConfig | null> {
    const config = await this.dataSource
      .getRepository(SystemConfigEntity)
      .findOne({ where: { configKey: AI_MINUTES_CONFIG_KEY, isActive: true } });
    if (!config?.configJson) {
      return null;
    }
    return config.configJson as unknown as AiMinutesSummaryConfig;
  }
}
