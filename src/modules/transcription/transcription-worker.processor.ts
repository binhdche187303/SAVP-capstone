import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

import {
  TranscriptEntity,
  TranscriptStatus,
} from './entities/transcript.entity.js';
import { BackgroundJobsService } from '../administration/services/background-jobs.service.js';
import { TranscriptionService } from './transcription.service.js';
import { TRANSCRIPTION_QUEUE_NAME } from './constants/transcription-job.constants.js';
import { TranscriptionResult } from './types/transcript-segment.type.js';
import { WebsocketService } from '../websocket/websocket.service.js';

const execFileAsync = promisify(execFile);

interface TranscriptionJobData {
  backgroundJobId: string;
  transcriptId: string;
  meetingId: string;
  recordingSessionId: string;
  sourceMediaFileId: string;
  storageBucket?: string | null;
  storageKey: string;
  language: string;
  speakerMappingMode: string;
  initialPrompt?: string;
  userId: string;
  /** Phase 2 — multi-channel audio tracks (1 per user). */
  channels?: Array<{
    storageKey: string;
    storageBucket?: string;
    channelUserId: string;
  }>;
}

/**
 * Lỗi nghiệp vụ/validation (không phải lỗi tạm thời) — không retry,
 * chuyển thẳng sang failed (đúng acceptance criteria T008).
 */
function isNonRetryableError(message: string): boolean {
  return (
    message.includes('not found') ||
    message.includes('NOT_FOUND') ||
    message.includes('UNSUPPORTED') ||
    message.includes('AUDIO_TOO_LONG_FOR_LOCAL_PROFILE') ||
    message.includes('PIPELINE_RESULT_INVALID_SCHEMA') ||
    message.includes('CUDA_NOT_AVAILABLE_FOR_PROFILE') ||
    message.includes('TRANSCRIPTION_PROVIDER_NOT_SUPPORTED') ||
    // T026: thiếu model preload là lỗi cấu hình, retry cũng không tự khỏi.
    message.includes('NOT_PRELOADED') ||
    // Bug #3 lớp 2 (2026-07-29): lỗi cấu hình/hạ tầng AI Worker — retry
    // không tự khỏi, cố ý KHÔNG đưa "AI_WORKER_FAILED" chung chung vào đây
    // vì chuỗi đó bọc cả lỗi tạm thời (hết RAM, timeout) mà retry có ích.
    message.includes('AI_WORKER_NOT_BUILT') ||
    message.includes('MINIO_NOT_CONFIGURED') ||
    message.includes('SOURCE_AUDIO_INVALID_PATH') ||
    message.includes('Invalid endPoint')
  );
}

@Processor(TRANSCRIPTION_QUEUE_NAME)
export class TranscriptionWorkerProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscriptionWorkerProcessor.name);

  constructor(
    @InjectRepository(TranscriptEntity)
    private readonly transcriptRepo: Repository<TranscriptEntity>,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly transcriptionService: TranscriptionService,
    private readonly configService: ConfigService,
    private readonly websocketService: WebsocketService,
  ) {
    super();
  }

  async process(job: Job<TranscriptionJobData>): Promise<any> {
    const { backgroundJobId, transcriptId } = job.data;

    if (!job.name.startsWith('transcription:')) {
      this.logger.warn('Unknown job name ' + job.name + ' — ACK');
      return;
    }

    this.logger.log(
      'Processing job ' +
        job.id +
        ' bgJob=' +
        backgroundJobId +
        ' transcript=' +
        transcriptId,
    );

    try {
      await this.backgroundJobsService.markRunning(backgroundJobId);

      const transcript = await this.transcriptRepo.findOne({
        where: { id: transcriptId },
      });
      if (!transcript) {
        throw new Error('Transcript ' + transcriptId + ' not found');
      }

      const result = await this.runAiWorker(job.data);

      await this.transcriptionService.updateTranscriptResult(
        transcriptId,
        result,
      );
      await this.backgroundJobsService.markCompleted(backgroundJobId, {
        transcriptId,
        status: TranscriptStatus.DRAFT,
      });

      await this.transcriptionService.notifyTranscriptReady(transcriptId);

      try {
        this.websocketService.emitToRoom(
          `meeting:${job.data.meetingId}`,
          'transcript.ready',
          {
            transcriptId,
            meetingId: job.data.meetingId,
            status: 'draft',
          },
        );
      } catch (wsErr) {
        this.logger.warn(
          'WebSocket emit transcript.ready failed — ' +
            (wsErr instanceof Error ? wsErr.message : String(wsErr)),
        );
      }

      this.logger.log(
        'Job ' +
          job.id +
          ' completed — transcript ' +
          transcriptId +
          ' is draft',
      );
      return { success: true, transcriptId, status: TranscriptStatus.DRAFT };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Job ' + job.id + ' failed — ' + errMsg);

      // Bug #3 lớp 1 (2026-07-29): trước đây chỉ chốt transcript sang
      // 'failed' khi lỗi non-retryable — lỗi retryable (VD hạ tầng tạm
      // thời) hết cả 3 lượt retry của BullMQ thì KHÔNG ai set transcript
      // sang failed nữa, transcript kẹt 'processing' vĩnh viễn trong khi
      // FE (được hướng dẫn poll tới khi status != processing) quay vô hạn.
      const attemptsMade = job.attemptsMade + 1;
      const maxAttempts = job.opts?.attempts ?? 1;
      const isLastAttempt = attemptsMade >= maxAttempts;

      if (isNonRetryableError(errMsg) || isLastAttempt) {
        await this.transcriptionService.failTranscript(transcriptId, errMsg);
        await this.backgroundJobsService.markFailed(backgroundJobId, errMsg);
        if (isNonRetryableError(errMsg)) return;
      } else {
        await this.backgroundJobsService.markRetrying(backgroundJobId);
      }

      throw error;
    }
  }

  /**
   * Spawn AI Worker (Node wrapper + Python subprocess, workers/ai-transcription)
   * như 1 child process riêng, đọc kết quả JSON từ stdout. Tách process khỏi
   * NestJS để lỗi/crash của pipeline AI không làm crash backend chính.
   */
  private async runAiWorker(
    data: TranscriptionJobData,
  ): Promise<TranscriptionResult> {
    const runnerPath = path.resolve(
      process.cwd(),
      this.configService.get<string>(
        'AI_WORKER_JOB_RUNNER_PATH',
        './workers/ai-transcription/dist/transcription-job-runner.js',
      ),
    );
    if (!fs.existsSync(runnerPath)) {
      throw new Error(
        `AI_WORKER_NOT_BUILT: ${runnerPath} không tồn tại — chạy "npm run build" trong workers/ai-transcription trước.`,
      );
    }
    if (!data.storageKey) {
      throw new Error(
        'SOURCE_MEDIA_NOT_FOUND: thiếu storageKey trong job data',
      );
    }

    const jobInput: Record<string, unknown> = {
      jobId: data.backgroundJobId,
      transcriptId: data.transcriptId,
      meetingId: data.meetingId,
      recordingSessionId: data.recordingSessionId,
      storageBucket: data.storageBucket || undefined,
      storageKey: data.storageKey,
      language: data.language,
      initialPrompt: data.initialPrompt || undefined,
    };
    // Phase 2: truyền channels array cho multi-channel mode.
    if (data.channels && data.channels.length > 0) {
      jobInput.channels = data.channels;
    }

    const timeoutMs = this.configService.get<number>(
      'AI_WORKER_JOB_TIMEOUT_MS',
      15 * 60 * 1000,
    );

    let stdout: string;
    try {
      const execResult = await execFileAsync(
        'node',
        [runnerPath, JSON.stringify(jobInput)],
        { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 20 },
      );
      stdout = execResult.stdout;
    } catch (error: unknown) {
      const stderr =
        error && typeof error === 'object' && 'stderr' in error
          ? String(error.stderr).trim()
          : '';
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new Error(`AI_WORKER_FAILED: ${stderr || message}`);
    }

    let result: TranscriptionResult;
    try {
      result = JSON.parse(stdout.trim());
    } catch {
      throw new Error(
        'PIPELINE_RESULT_INVALID_SCHEMA: stdout không phải JSON hợp lệ',
      );
    }
    return result;
  }
}
