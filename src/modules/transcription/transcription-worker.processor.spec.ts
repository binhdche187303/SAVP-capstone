import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TranscriptionWorkerProcessor } from './transcription-worker.processor.js';
import {
  TranscriptEntity,
  TranscriptStatus,
} from './entities/transcript.entity.js';
import { BackgroundJobsService } from '../administration/services/background-jobs.service.js';
import { TranscriptionService } from './transcription.service.js';
import { WebsocketService } from '../websocket/websocket.service.js';

jest.mock('fs');
jest.mock('child_process', () => ({ execFile: jest.fn() }));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockExecFile = childProcess.execFile as unknown as jest.Mock;

function mockExecFileResolve(stdout: string) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as (
      err: Error | null,
      result?: { stdout: string; stderr: string },
    ) => void;
    callback(null, { stdout, stderr: '' });
  });
}

function mockExecFileReject(error: Error & { stderr?: string }) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as (err: Error) => void;
    callback(error);
  });
}

describe('TranscriptionWorkerProcessor (T008/T009)', () => {
  let processor: TranscriptionWorkerProcessor;
  let transcriptRepo: { findOne: jest.Mock };
  let backgroundJobsService: {
    markRunning: jest.Mock;
    markCompleted: jest.Mock;
    markFailed: jest.Mock;
  };
  let transcriptionService: {
    updateTranscriptResult: jest.Mock;
    failTranscript: jest.Mock;
    notifyTranscriptReady: jest.Mock;
  };

  const validResult = {
    languageCode: 'vi-VN',
    rawText: 'xin chao',
    cleanedText: 'Xin chào',
    confidenceScore: 0.9,
    segments: [],
    detectedSpeakers: [],
    modelVersions: { whisper: 'small', pyannote: null, sepformer: null },
    warnings: [],
  };

  const baseJobData = {
    backgroundJobId: 'bg-1',
    transcriptId: 'tr-1',
    meetingId: 'm-1',
    recordingSessionId: 'rs-1',
    sourceMediaFileId: 'media-1',
    storageBucket: 'recordings',
    storageKey: 'meetings/m-1/audio.wav',
    language: 'vi-VN',
    speakerMappingMode: 'diarization_only',
    userId: 'u-1',
  };

  const makeJob = (
    overrides: Partial<typeof baseJobData> = {},
    jobOverrides: { attemptsMade?: number; opts?: { attempts?: number } } = {},
  ) =>
    ({
      id: 'job-1',
      name: 'transcription:bg-1',
      data: { ...baseJobData, ...overrides },
      // Mặc định mô phỏng lượt thử đầu tiên trong 3 lượt (BULL_DEFAULT_ATTEMPTS)
      // — khớp hành vi gốc (chưa hết lượt retry) cho các test không quan tâm
      // tới bug #3 lớp 1. Test riêng cho "hết lượt retry" override 2 field này.
      attemptsMade: jobOverrides.attemptsMade ?? 0,
      opts: jobOverrides.opts ?? { attempts: 3 },
    }) as unknown as Job;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);

    transcriptRepo = { findOne: jest.fn().mockResolvedValue({ id: 'tr-1' }) };
    backgroundJobsService = {
      markRunning: jest.fn().mockResolvedValue(undefined),
      markCompleted: jest.fn().mockResolvedValue(undefined),
      markRetrying: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    transcriptionService = {
      updateTranscriptResult: jest.fn().mockResolvedValue(undefined),
      failTranscript: jest.fn().mockResolvedValue(undefined),
      notifyTranscriptReady: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscriptionWorkerProcessor,
        {
          provide: getRepositoryToken(TranscriptEntity),
          useValue: transcriptRepo,
        },
        { provide: BackgroundJobsService, useValue: backgroundJobsService },
        { provide: TranscriptionService, useValue: transcriptionService },
        { provide: ConfigService, useValue: { get: jest.fn((_k, d) => d) } },
        { provide: WebsocketService, useValue: { emitToRoom: jest.fn() } },
      ],
    }).compile();

    processor = module.get(TranscriptionWorkerProcessor);
  });

  it('job name lạ (không bắt đầu bằng transcription:) → ACK, không xử lý', async () => {
    const job = makeJob();
    (job as { name: string }).name = 'other-queue:bg-1';

    await processor.process(job);

    expect(backgroundJobsService.markRunning).not.toHaveBeenCalled();
  });

  it('thành công: spawn AI worker, parse JSON, update draft + markCompleted', async () => {
    mockExecFileResolve(JSON.stringify(validResult));

    const result = await processor.process(makeJob());

    expect(backgroundJobsService.markRunning).toHaveBeenCalledWith('bg-1');
    expect(transcriptionService.updateTranscriptResult).toHaveBeenCalledWith(
      'tr-1',
      validResult,
    );
    expect(backgroundJobsService.markCompleted).toHaveBeenCalledWith('bg-1', {
      transcriptId: 'tr-1',
      status: TranscriptStatus.DRAFT,
    });
    // T029: notify Host sau khi completed.
    expect(transcriptionService.notifyTranscriptReady).toHaveBeenCalledWith(
      'tr-1',
    );
    expect(result).toEqual({
      success: true,
      transcriptId: 'tr-1',
      status: TranscriptStatus.DRAFT,
    });
  });

  it('transcript không tồn tại trong DB → failTranscript + markFailed, KHÔNG throw (non-retryable)', async () => {
    transcriptRepo.findOne.mockResolvedValue(null);

    await expect(processor.process(makeJob())).resolves.toBeUndefined();

    expect(transcriptionService.failTranscript).toHaveBeenCalled();
    expect(backgroundJobsService.markFailed).toHaveBeenCalled();
  });

  it('AI worker chưa build (script không tồn tại) → failTranscript ngay, KHÔNG rethrow (bug #3 lớp 2: lỗi cấu hình, retry vô ích)', async () => {
    mockFs.existsSync.mockReturnValue(false);

    await expect(processor.process(makeJob())).resolves.toBeUndefined();
    expect(transcriptionService.failTranscript).toHaveBeenCalledWith(
      'tr-1',
      expect.stringContaining('AI_WORKER_NOT_BUILT'),
    );
    expect(backgroundJobsService.markFailed).toHaveBeenCalled();
  });

  it('AI worker exit code lỗi (IO/MinIO tạm thời) → markFailed + rethrow để BullMQ retry', async () => {
    mockExecFileReject(
      Object.assign(new Error('spawn failed'), {
        stderr: 'MINIO_DOWNLOAD_FAILED: timeout',
      }),
    );

    await expect(processor.process(makeJob())).rejects.toThrow(
      'AI_WORKER_FAILED',
    );
    expect(backgroundJobsService.markRetrying).toHaveBeenCalled();
    expect(transcriptionService.failTranscript).not.toHaveBeenCalled();
  });

  it('BUG #3 lớp 1: lỗi retryable nhưng đã HẾT lượt retry cuối cùng → failTranscript (chốt trạng thái, không để kẹt processing) nhưng vẫn rethrow', async () => {
    mockExecFileReject(
      Object.assign(new Error('spawn failed'), {
        stderr: 'MINIO_DOWNLOAD_FAILED: timeout',
      }),
    );

    // attemptsMade=2 + lần chạy hiện tại = lượt thứ 3/3 (opts.attempts=3) -> hết lượt.
    await expect(
      processor.process(
        makeJob({}, { attemptsMade: 2, opts: { attempts: 3 } }),
      ),
    ).rejects.toThrow('AI_WORKER_FAILED');
    expect(transcriptionService.failTranscript).toHaveBeenCalledWith(
      'tr-1',
      expect.stringContaining('MINIO_DOWNLOAD_FAILED'),
    );
    expect(backgroundJobsService.markFailed).toHaveBeenCalled();
  });

  it('AI worker trả lỗi validation (audio quá dài) → failTranscript, KHÔNG retry', async () => {
    mockExecFileReject(
      Object.assign(new Error('spawn failed'), {
        stderr: JSON.stringify({ message: 'AUDIO_TOO_LONG_FOR_LOCAL_PROFILE' }),
      }),
    );

    await expect(processor.process(makeJob())).resolves.toBeUndefined();
    expect(transcriptionService.failTranscript).toHaveBeenCalledWith(
      'tr-1',
      expect.stringContaining('AUDIO_TOO_LONG_FOR_LOCAL_PROFILE'),
    );
    expect(backgroundJobsService.markFailed).toHaveBeenCalled();
  });

  it('stdout không phải JSON hợp lệ → PIPELINE_RESULT_INVALID_SCHEMA, KHÔNG retry', async () => {
    mockExecFileResolve('not-json-output');

    await expect(processor.process(makeJob())).resolves.toBeUndefined();
    expect(transcriptionService.failTranscript).toHaveBeenCalledWith(
      'tr-1',
      expect.stringContaining('PIPELINE_RESULT_INVALID_SCHEMA'),
    );
  });

  it('thiếu storageKey trong job data → SOURCE_MEDIA_NOT_FOUND, KHÔNG retry', async () => {
    await expect(
      processor.process(makeJob({ storageKey: '' })),
    ).resolves.toBeUndefined();
    expect(transcriptionService.failTranscript).toHaveBeenCalledWith(
      'tr-1',
      expect.stringContaining('SOURCE_MEDIA_NOT_FOUND'),
    );
  });
});
