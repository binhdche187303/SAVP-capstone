import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { TranscriptionService } from '../src/modules/transcription/transcription.service.js';
import { TranscriptionWorkerProcessor } from '../src/modules/transcription/transcription-worker.processor.js';
import { TranscriptionResult } from '../src/modules/transcription/types/transcript-segment.type.js';
import { StorageService } from '../src/modules/storage/storage.service.js';

/**
 * T032 — Integration test BullMQ job lifecycle (Wave 1.2).
 *
 * Chạy THẬT qua hạ tầng live (Postgres + Redis), KHÔNG mock DB/queue:
 *   seed meeting/recording-session/media-file/host  →
 *   TranscriptionService.createTranscriptionJob() (enqueue BullMQ thật)  →
 *   TranscriptionWorkerProcessor consume từ Redis thật  →
 *   (mock DUY NHẤT `runAiWorker` — phần spawn Python + tải MinIO — trả canned
 *    result, để không phụ thuộc model/audio thật trong test)  →
 *   ghi transcript + mark background_job completed  →
 *   assert lifecycle trong DB.
 *
 * GATE: chỉ chạy khi `RUN_INTEGRATION=1` (cần Postgres 5432 + Redis up). Mặc
 * định SKIP để `npm test`/`npm run test:e2e` không vỡ khi thiếu hạ tầng.
 *
 *   RUN_INTEGRATION=1 npx jest --config ./test/jest-e2e.json transcription-job-lifecycle
 */
const RUN = process.env.RUN_INTEGRATION === '1';
const suite = RUN ? describe : describe.skip;

suite('Transcription job lifecycle (integration, BullMQ + DB)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let service: TranscriptionService;
  let processor: TranscriptionWorkerProcessor;

  // id seed — cleanup theo đúng thứ tự FK ở afterAll.
  const ids = {
    user: randomUUID(),
    meeting: randomUUID(),
    session: randomUUID(),
    media: randomUUID(),
    participant: randomUUID(),
  };
  const tag = Date.now();

  const cannedResult: TranscriptionResult = {
    languageCode: 'vi-VN',
    rawText: 'xin chao day la transcript gia lap cho integration test',
    cleanedText: 'xin chao day la transcript gia lap cho integration test',
    confidenceScore: 0.9,
    segments: [
      {
        segmentId: 'seg-0000',
        startMs: 0,
        endMs: 2000,
        text: 'xin chao day la transcript gia lap',
        speakerLabel: 'unknown',
        speakerSource: 'unknown',
        userId: null,
        channelId: null,
        roomZoneLabel: null,
        sttConfidence: 0.9,
        diarizationConfidence: null,
        separationConfidence: null,
        finalConfidence: 0.9,
        overlap: false,
        lowConfidence: false,
        manualReviewRequired: false,
        notes: [],
      },
    ],
    detectedSpeakers: [],
    modelVersions: { whisper: 'small', pyannote: null, sepformer: null },
    warnings: [],
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // StorageService.onModuleInit() gọi dynamic `import('minio')` — ts-jest
      // (CommonJS) không chạy được nếu thiếu --experimental-vm-modules, làm
      // app.init() crash. Override no-op: test này KHÔNG đụng storage thật
      // (phần tải MinIO nằm trong runAiWorker — đã mock), nên bỏ qua an toàn.
      // Không service nào khác gọi storage lúc boot (đã verify: chỉ
      // StorageService.onModuleInit tự gọi).
      .overrideProvider(StorageService)
      .useValue({ onModuleInit: async () => undefined })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    ds = app.get(DataSource);
    service = app.get(TranscriptionService);
    processor = app.get(TranscriptionWorkerProcessor);

    // Mock DUY NHẤT phần spawn Python + MinIO. Phần còn lại (DB, queue,
    // service lifecycle) chạy thật.
    jest
      .spyOn(
        processor as unknown as {
          runAiWorker: () => Promise<TranscriptionResult>;
        },
        'runAiWorker',
      )
      .mockResolvedValue(cannedResult);

    // Seed FK-valid bằng raw SQL (kiểm soát chính xác cột NOT NULL).
    await ds.query(
      `INSERT INTO users (id, username, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        ids.user,
        `it_user_${tag}`,
        `it_user_${tag}@test.local`,
        'x',
        'Integration Host',
      ],
    );
    await ds.query(
      `INSERT INTO meetings (id, meeting_code, title, organizer_id, start_time, end_time)
       VALUES ($1, $2, $3, $4, now(), now() + interval '1 hour')`,
      [ids.meeting, `IT_MTG_${tag}`, 'Integration Meeting', ids.user],
    );
    await ds.query(
      `INSERT INTO recording_sessions (id, meeting_id, session_type, source_type, started_at)
       VALUES ($1, $2, 'audio', 'upload', now())`,
      [ids.session, ids.meeting],
    );
    await ds.query(
      `INSERT INTO media_files
         (id, recording_session_id, meeting_id, file_name, file_type, mime_type,
          storage_provider, storage_bucket, storage_key, is_active)
       VALUES ($1, $2, $3, 'it.wav', 'audio', 'audio/wav', 'minio', 'capstone-media', $4, true)`,
      [ids.media, ids.session, ids.meeting, `it/${tag}.wav`],
    );
    await ds.query(
      `INSERT INTO meeting_participants (id, meeting_id, user_id, participant_role)
       VALUES ($1, $2, $3, 'host')`,
      [ids.participant, ids.meeting, ids.user],
    );
  }, 60000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      // Xóa theo đúng thứ tự FK.
      // T029: notifyTranscriptReady tạo notification cho Host — dọn luôn.
      await ds.query(
        `DELETE FROM notifications WHERE related_entity_type = 'meeting' AND related_entity_id = $1`,
        [ids.meeting],
      );
      await ds.query(`DELETE FROM transcripts WHERE meeting_id = $1`, [
        ids.meeting,
      ]);
      await ds.query(
        `DELETE FROM background_jobs WHERE related_entity_id = $1 AND related_entity_type = 'meeting'`,
        [ids.meeting],
      );
      await ds.query(`DELETE FROM media_files WHERE id = $1`, [ids.media]);
      await ds.query(`DELETE FROM meeting_participants WHERE id = $1`, [
        ids.participant,
      ]);
      await ds.query(`DELETE FROM recording_sessions WHERE id = $1`, [
        ids.session,
      ]);
      await ds.query(`DELETE FROM meetings WHERE id = $1`, [ids.meeting]);
      await ds.query(`DELETE FROM users WHERE id = $1`, [ids.user]);
    }
    await app?.close();
  });

  it('tạo job → BullMQ consume → transcript draft + background_job completed', async () => {
    const res = await service.createTranscriptionJob(
      ids.meeting,
      { recordingSessionId: ids.session, language: 'vi-VN' },
      ids.user,
    );
    expect(res.status).toBe('queued');
    expect(res.jobId).toBeDefined();

    // Poll DB cho worker thật xử lý xong (mock runAiWorker -> nhanh).
    const deadline = Date.now() + 30000;
    let bgStatus = '';
    let txStatus = '';
    while (Date.now() < deadline) {
      const bg = await ds.query(
        `SELECT status FROM background_jobs WHERE id = $1`,
        [res.jobId],
      );
      bgStatus = bg[0]?.status ?? '';
      if (bgStatus === 'completed' || bgStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(bgStatus).toBe('completed');

    const tx = await ds.query(
      `SELECT status, raw_text, speaker_segments_json
         FROM transcripts WHERE meeting_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [ids.meeting],
    );
    txStatus = tx[0]?.status ?? '';
    expect(txStatus).toBe('draft');
    expect(tx[0].raw_text).toContain('transcript gia lap');
    const segJson = tx[0].speaker_segments_json;
    const parsed = typeof segJson === 'string' ? JSON.parse(segJson) : segJson;
    expect(parsed.segments).toHaveLength(1);
    expect(parsed.segments[0].segmentId).toBe('seg-0000');
  }, 60000);
});
