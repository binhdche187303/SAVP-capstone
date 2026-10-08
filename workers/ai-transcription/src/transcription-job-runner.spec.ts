import * as fs from 'fs';
import * as childProcess from 'child_process';
import {
  cleanupStaleTempDirs,
  runTranscriptionJob,
} from './transcription-job-runner';
import { fetchAudio } from './audio-source-loader';

jest.mock('fs');
jest.mock('./minio-audio-loader', () => ({
  loadMinioConfigFromEnv: jest.fn().mockReturnValue({
    endpoint: 'localhost',
    port: 9000,
    useSSL: false,
    accessKey: 'ak',
    secretKey: 'sk',
    bucket: 'recordings',
  }),
  createMinioClient: jest.fn().mockReturnValue({}),
}));
// Bug #2 fix: transcription-job-runner giờ gọi fetchAudio() (điều phối
// local/s3) thay vì gọi thẳng downloadAudioFromMinio().
jest.mock('./audio-source-loader', () => ({
  fetchAudio: jest.fn(),
}));
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockDownload = fetchAudio as jest.Mock;
const mockExecFile = childProcess.execFile as unknown as jest.Mock;

/** Cấu hình mock execFile theo callback convention của Node (promisify-compatible). */
function mockExecFileImpl(
  handler: (file: string, args: string[]) => { stdout: string; stderr: string },
) {
  mockExecFile.mockImplementation((...callArgs: unknown[]) => {
    const file = callArgs[0] as string;
    const args = callArgs[1] as string[];
    const callback = callArgs[callArgs.length - 1] as (
      err: Error | null,
      result?: { stdout: string; stderr: string },
    ) => void;
    try {
      const result = handler(file, args);
      callback(null, result);
    } catch (err) {
      callback(err as Error);
    }
  });
}

describe('transcription-job-runner (T011)', () => {
  const baseInput = {
    jobId: 'job-1',
    transcriptId: 'tr-1',
    meetingId: 'm-1',
    recordingSessionId: 'rs-1',
    storageKey: 'meetings/m-1/audio.wav',
    language: 'vi-VN',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env['AI_PROFILE'];
    delete process.env['MAX_AUDIO_DURATION_LOCAL_SECONDS'];
    delete process.env['PYANNOTE_MODEL_PATH'];
    delete process.env['AI_WORKER_FFPROBE_BIN'];
    delete process.env['AI_WORKER_FFMPEG_BIN'];
    delete process.env['FFPROBE_PATH'];
    delete process.env['FFMPEG_PATH'];
    mockFs.mkdirSync.mockReturnValue(undefined as never);
    mockFs.rmSync.mockReturnValue(undefined);
    mockDownload.mockResolvedValue({ path: '/tmp/job-1/source-audio', sizeBytes: 1000 });
  });

  it('thành công: trả về kết quả hợp lệ và cleanup temp dir', async () => {
    mockExecFileImpl((file) => {
      if (file.includes('ffprobe')) return { stdout: '120.5\n', stderr: '' };
      return { stdout: '', stderr: '' }; // python pipeline call
    });
    mockFs.existsSync.mockReturnValue(true);
    const fakeResult = {
      languageCode: 'vi-VN',
      rawText: 'xin chao',
      cleanedText: 'Xin chào',
      confidenceScore: 0.9,
      segments: [],
      detectedSpeakers: [],
      modelVersions: { whisper: 'small', pyannote: null, sepformer: null },
      warnings: [],
    };
    mockFs.readFileSync.mockReturnValue(JSON.stringify(fakeResult) as never);

    const result = await runTranscriptionJob(baseInput);

    expect(result).toEqual(fakeResult);
    expect(mockFs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining('job-1'),
      { recursive: true, force: true },
    );
  });

  it('REGRESSION: initialPrompt trong job input → truyền --initial-prompt cho python CLI', async () => {
    mockExecFileImpl((file) => {
      if (file.includes('ffprobe')) return { stdout: '60\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        languageCode: 'vi-VN',
        rawText: 'a',
        cleanedText: 'a',
        confidenceScore: 0.9,
        segments: [],
        detectedSpeakers: [],
        modelVersions: { whisper: 'medium', pyannote: null, sepformer: null },
        warnings: [],
      }) as never,
    );

    await runTranscriptionJob({
      ...baseInput,
      initialPrompt: 'Vietcetera, podcast, marketing, design',
    });

    const pythonCall = mockExecFile.mock.calls.find(
      (call) => !String(call[0]).includes('ffprobe'),
    );
    expect(pythonCall?.[1]).toEqual(
      expect.arrayContaining([
        '--initial-prompt',
        'Vietcetera, podcast, marketing, design',
      ]),
    );
  });

  it('REGRESSION: truyền ffprobe/ffmpeg đã resolve tuyệt đối xuống python env', async () => {
    process.env['FFPROBE_PATH'] = 'ffprobe';
    process.env['FFMPEG_PATH'] = 'ffmpeg';
    mockExecFileImpl((file) => {
      if (file.includes('ffprobe')) return { stdout: '60\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        languageCode: 'vi-VN',
        rawText: 'a',
        cleanedText: 'a',
        confidenceScore: 0.9,
        segments: [],
        detectedSpeakers: [],
        modelVersions: { whisper: 'medium', pyannote: null, sepformer: null },
        warnings: [],
      }) as never,
    );

    await runTranscriptionJob(baseInput);

    expect(mockExecFile.mock.calls[0][0]).toBe('/usr/bin/ffprobe');
    const pythonCall = mockExecFile.mock.calls.find(
      (call) => !String(call[0]).includes('ffprobe'),
    );
    expect(pythonCall?.[2]).toMatchObject({
      env: expect.objectContaining({
        AI_WORKER_FFPROBE_BIN: '/usr/bin/ffprobe',
        AI_WORKER_FFMPEG_BIN: '/usr/bin/ffmpeg',
      }),
    });
  });

  it('không có initialPrompt → KHÔNG truyền --initial-prompt (python tự fallback env)', async () => {
    mockExecFileImpl((file) => {
      if (file.includes('ffprobe')) return { stdout: '60\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        languageCode: 'vi-VN',
        rawText: 'a',
        cleanedText: 'a',
        confidenceScore: 0.9,
        segments: [],
        detectedSpeakers: [],
        modelVersions: { whisper: 'medium', pyannote: null, sepformer: null },
        warnings: [],
      }) as never,
    );

    await runTranscriptionJob(baseInput);

    const pythonCall = mockExecFile.mock.calls.find(
      (call) => !String(call[0]).includes('ffprobe'),
    );
    expect(pythonCall?.[1]).not.toEqual(
      expect.arrayContaining(['--initial-prompt']),
    );
  });

  it('REGRESSION (M2): truyền --diarization-enabled/--overlap-detection-enabled theo profile hiện tại', async () => {
    process.env['AI_PROFILE'] = 'production-cpu-fallback'; // diarization/overlap mặc định true, separation false
    // T026: diarization bật -> validateModelsAvailable yêu cầu PYANNOTE_MODEL_PATH
    // (fs mocked existsSync=true nên config.yaml check pass).
    process.env['PYANNOTE_MODEL_PATH'] = '/fake/pyannote';
    mockExecFileImpl((file) => {
      if (file.includes('ffprobe')) return { stdout: '60\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        languageCode: 'vi-VN',
        rawText: 'a',
        cleanedText: 'a',
        confidenceScore: 0.9,
        segments: [],
        detectedSpeakers: [],
        modelVersions: { whisper: 'medium', pyannote: null, sepformer: null },
        warnings: [],
      }) as never,
    );

    await runTranscriptionJob(baseInput);

    const pythonCall = mockExecFile.mock.calls.find(
      (call) => !String(call[0]).includes('ffprobe'),
    );
    expect(pythonCall?.[1]).toEqual(
      expect.arrayContaining([
        '--diarization-enabled',
        'true',
        '--overlap-detection-enabled',
        'true',
      ]),
    );
  });

  it('audio quá dài cho profile local → reject TRƯỚC KHI gọi python pipeline, vẫn cleanup', async () => {
    process.env['AI_PROFILE'] = 'local';
    process.env['MAX_AUDIO_DURATION_LOCAL_SECONDS'] = '300';
    mockExecFileImpl((file) => {
      if (file.includes('ffprobe')) return { stdout: '600\n', stderr: '' };
      throw new Error('KHÔNG được gọi python pipeline khi duration vượt ngưỡng');
    });

    await expect(runTranscriptionJob(baseInput)).rejects.toThrow(
      'AUDIO_TOO_LONG_FOR_LOCAL_PROFILE',
    );
    expect(mockFs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining('job-1'),
      { recursive: true, force: true },
    );
  });

  it('download audio lỗi → vẫn cleanup temp dir (nhánh failure)', async () => {
    mockDownload.mockRejectedValue(new Error('SOURCE_AUDIO_NOT_FOUND: x'));

    await expect(runTranscriptionJob(baseInput)).rejects.toThrow(
      'SOURCE_AUDIO_NOT_FOUND',
    );
    expect(mockFs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining('job-1'),
      { recursive: true, force: true },
    );
  });

  it('kết quả pipeline thiếu field bắt buộc → throw PIPELINE_RESULT_INVALID_SCHEMA', async () => {
    mockExecFileImpl((file) => {
      if (file.includes('ffprobe')) return { stdout: '60\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ rawText: 'thiếu các field khác' }) as never,
    );

    await expect(runTranscriptionJob(baseInput)).rejects.toThrow(
      'PIPELINE_RESULT_INVALID_SCHEMA',
    );
  });
});

describe('cleanupStaleTempDirs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('xoá thư mục job cũ hơn TTL, giữ lại thư mục còn mới', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(['old-job', 'fresh-job'] as never);
    mockFs.statSync.mockImplementation((p: unknown) => {
      const isOld = String(p).includes('old-job');
      return {
        isDirectory: () => true,
        mtimeMs: isOld ? Date.now() - 48 * 60 * 60 * 1000 : Date.now(),
      } as fs.Stats;
    });

    const removed = cleanupStaleTempDirs();

    expect(removed.some((p) => p.includes('old-job'))).toBe(true);
    expect(removed.some((p) => p.includes('fresh-job'))).toBe(false);
  });

  it('không có temp root → trả về [] không lỗi', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(cleanupStaleTempDirs()).toEqual([]);
  });
});
