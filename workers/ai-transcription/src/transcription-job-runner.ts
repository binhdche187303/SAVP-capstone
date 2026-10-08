import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

import { createMinioClient, loadMinioConfigFromEnv } from './minio-audio-loader';
import { fetchAudio } from './audio-source-loader';
import { assertLocalProviderOnly, loadProfile } from './profile-config';
import { validateModelsAvailable } from './model-validation';
import { checkResources } from './resource-guard';

const execFileAsync = promisify(execFile);

export interface TranscriptionChannelInput {
  storageKey: string;
  storageBucket?: string;
  channelUserId: string;
}

export interface TranscriptionJobInput {
  jobId: string;
  transcriptId: string;
  meetingId: string;
  recordingSessionId: string;
  storageBucket?: string;
  storageKey: string;
  language?: string;
  /** Custom vocabulary (tên riêng, thuật ngữ ngành) — override WHISPER_INITIAL_PROMPT của profile/env nếu có. */
  initialPrompt?: string;
  /**
   * Phase 2 — multi-channel audio: mỗi phần tử = 1 file audio riêng của 1 user.
   * Nếu undefined/rỗng → fallback mode cũ (1 file, diarization_only).
   * Nếu có ≥2 phần tử → channel_zone mode (Whisper riêng từng channel, merge theo timestamp).
   */
  channels?: TranscriptionChannelInput[];
}

export interface TranscriptSegmentOutput {
  segmentId: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel: string;
  speakerSource: 'pyannote' | 'channel_zone' | 'sepformer' | 'unknown';
  userId: string | null;
  channelId: string | null;
  roomZoneLabel: string | null;
  sttConfidence: number | null;
  diarizationConfidence: number | null;
  separationConfidence: number | null;
  finalConfidence: number;
  overlap: boolean;
  lowConfidence: boolean;
  manualReviewRequired: boolean;
  notes: string[];
}

export interface TranscriptionJobOutput {
  languageCode: string;
  rawText: string;
  cleanedText: string;
  confidenceScore: number;
  segments: TranscriptSegmentOutput[];
  detectedSpeakers: unknown[];
  modelVersions: {
    whisper: string;
    pyannote: string | null;
    sepformer: string | null;
  };
  warnings: string[];
}

function getTempRoot(): string {
  return process.env['AI_WORKER_TEMP_DIR'] || path.join(os.tmpdir(), 'ai-transcription-jobs');
}

function getStaleTtlMs(): number {
  return Number(process.env['AI_WORKER_TEMP_TTL_MS'] || 24 * 60 * 60 * 1000);
}

function getJobTempDir(jobId: string): string {
  return path.join(getTempRoot(), jobId);
}

/**
 * Dọn các thư mục temp job cũ quá TTL còn sót lại nếu worker crash trước đó (T011).
 * Best-effort — lỗi đọc/xoá 1 thư mục không làm fail toàn bộ cleanup.
 */
export function cleanupStaleTempDirs(now = Date.now()): string[] {
  const tempRoot = getTempRoot();
  if (!fs.existsSync(tempRoot)) return [];
  const removed: string[] = [];
  for (const entry of fs.readdirSync(tempRoot)) {
    const dirPath = path.join(tempRoot, entry);
    try {
      const stat = fs.statSync(dirPath);
      if (stat.isDirectory() && now - stat.mtimeMs > getStaleTtlMs()) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        removed.push(dirPath);
      }
    } catch {
      // best-effort — bỏ qua entry lỗi, tiếp tục cleanup phần còn lại
    }
  }
  return removed;
}

async function probeContainerDurationSeconds(filePath: string): Promise<number> {
  const ffprobeBin = resolveBinary(
    process.env['AI_WORKER_FFPROBE_BIN'] ||
      process.env['FFPROBE_PATH'] ||
      'ffprobe',
  );
  const { stdout } = await execFileAsync(ffprobeBin, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return parseFloat(stdout.trim());
}

/**
 * Bug #4 (2026-08-05): file webm ghép từ nhiều chunk MediaRecorder phía
 * client (StationRecorder.jsx/useStationRecording.js — chunk đầu có header
 * EBML/Segment/Info hợp lệ nhưng Info.Duration không được ghi vì trình duyệt
 * không biết trước tổng thời lượng lúc bắt đầu ghi; các chunk sau chỉ là
 * Cluster nối thô qua `new Blob(chunks)`, không re-mux) khiến ffprobe đọc
 * container-level duration ra "N/A" dù luồng audio bên trong vẫn nguyên vẹn.
 * Trước đây điều này làm MỌI job STT từ trạm ghi âm cố định fail cứng với
 * AUDIO_DURATION_PROBE_FAILED (non-retryable) — xác nhận bằng cách probe
 * trực tiếp 1 file thật lấy từ MinIO: format=duration=N/A dù stream Opus vẫn
 * decode được. Remux qua `ffmpeg -c copy` buộc decode lại toàn bộ stream và
 * ghi đúng Duration vào output rồi probe lại — đã verify thủ công (N/A →
 * 130.379s) trước khi đưa vào đây. Fallback này không tốn thêm chi phí cho
 * file bình thường (upload thủ công qua AudioUploader.jsx) vì chỉ chạy khi
 * probe lần đầu thất bại.
 */
async function getAudioDurationSeconds(filePath: string): Promise<number> {
  const seconds = await probeContainerDurationSeconds(filePath);
  if (Number.isFinite(seconds)) {
    return seconds;
  }

  const ffmpegBin = resolveBinary(
    process.env['AI_WORKER_FFMPEG_BIN'] || process.env['FFMPEG_PATH'] || 'ffmpeg',
  );
  const remuxedPath = `${filePath}.duration-fix.webm`;
  try {
    await execFileAsync(ffmpegBin, [
      '-y',
      '-v',
      'error',
      '-i',
      filePath,
      '-c',
      'copy',
      '-f',
      'webm',
      remuxedPath,
    ]);
    const remuxedSeconds = await probeContainerDurationSeconds(remuxedPath);
    if (Number.isFinite(remuxedSeconds)) {
      return remuxedSeconds;
    }
  } catch {
    // remux thất bại — rơi xuống throw bên dưới, báo lỗi gốc cho job.
  } finally {
    try {
      fs.unlinkSync(remuxedPath);
    } catch {
      // best-effort cleanup — file remux tạm có thể chưa từng được tạo ra.
    }
  }

  throw new Error('AUDIO_DURATION_PROBE_FAILED');
}

function resolveBinary(command: string): string {
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return command;
  }

  const candidates = [
    path.join('/usr/bin', command),
    path.join('/usr/local/bin', command),
    path.join('/opt/homebrew/bin', command),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Ignore fs errors and fall back to PATH lookup below.
    }
  }

  return command;
}

function resolvePythonBinary(): string {
  if (process.env['AI_WORKER_PYTHON_BIN']) {
    return process.env['AI_WORKER_PYTHON_BIN'];
  }

  const localVenvPython = path.join(__dirname, '..', '.venv', 'bin', 'python');
  try {
    if (fs.existsSync(localVenvPython)) return localVenvPython;
  } catch {
    // Fall back to PATH lookup below.
  }

  return 'python';
}

function validateResultShape(
  result: Partial<TranscriptionJobOutput>,
): asserts result is TranscriptionJobOutput {
  const requiredKeys: Array<keyof TranscriptionJobOutput> = [
    'languageCode',
    'rawText',
    'cleanedText',
    'confidenceScore',
    'segments',
    'detectedSpeakers',
    'modelVersions',
    'warnings',
  ];
  for (const key of requiredKeys) {
    if (!(key in result)) {
      throw new Error(`PIPELINE_RESULT_INVALID_SCHEMA: missing "${key}"`);
    }
  }
  if (
    !Array.isArray(result.segments) ||
    !Array.isArray(result.detectedSpeakers) ||
    !Array.isArray(result.warnings)
  ) {
    throw new Error(
      'PIPELINE_RESULT_INVALID_SCHEMA: segments/detectedSpeakers/warnings phải là array',
    );
  }
}

/**
 * Orchestrator chính của AI Worker (T011): tải audio từ MinIO → resource guard
 * (duration trước khi load model) → spawn Python pipeline → đọc + validate kết
 * quả. Mỗi job có thư mục temp riêng, luôn cleanup ở finally (success/failure).
 */
export async function runTranscriptionJob(
  input: TranscriptionJobInput,
): Promise<TranscriptionJobOutput> {
  assertLocalProviderOnly();
  const profile = loadProfile();
  validateModelsAvailable(profile);
  const jobDir = getJobTempDir(input.jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const resultPath = path.join(jobDir, 'result.json');

  try {
    // Bug #1.2 (2026-07-29): chỉ dựng MinIO client khi thật sự dùng S3.
    // Trước đây tạo vô điều kiện nên deploy dùng STORAGE_DRIVER=local vẫn
    // chết ở đây với "Invalid endPoint" dù không định dùng MinIO.
    const storageDriver = (process.env['STORAGE_DRIVER'] || 'local').toLowerCase();
    const minioConfig = storageDriver === 's3' ? loadMinioConfigFromEnv() : null;
    const client = minioConfig ? createMinioClient(minioConfig) : null;

    const isMultiChannel =
      Array.isArray(input.channels) && input.channels.length >= 2;

    let sourcePath: string;
    let normalizedPath: string;
    let durationSeconds: number;
    let channelsJsonArg: string | undefined;

    if (isMultiChannel) {
      // Phase 3 — channel_zone: download & normalize each channel separately
      const channelsMeta: Array<{
        inputPath: string;
        normalizedPath: string;
        userId: string;
      }> = [];
      let maxDuration = 0;

      for (const ch of input.channels!) {
        const chDir = path.join(jobDir, `channel-${ch.channelUserId}`);
        fs.mkdirSync(chDir, { recursive: true });
        const chSourcePath = path.join(chDir, 'source-audio');
        const chNormalizedPath = path.join(chDir, 'normalized.wav');

        await fetchAudio(client, minioConfig, {
          storageBucket: ch.storageBucket,
          storageKey: ch.storageKey,
          destPath: chSourcePath,
        });

        const chDuration = await getAudioDurationSeconds(chSourcePath);
        if (chDuration > maxDuration) maxDuration = chDuration;

        channelsMeta.push({
          inputPath: chSourcePath,
          normalizedPath: chNormalizedPath,
          userId: ch.channelUserId,
        });
      }

      durationSeconds = maxDuration;
      // --input / --normalized-output still point to first channel for backward compat
      sourcePath = channelsMeta[0].inputPath;
      normalizedPath = channelsMeta[0].normalizedPath;
      channelsJsonArg = JSON.stringify(channelsMeta);
    } else {
      // Legacy single-file mode
      sourcePath = path.join(jobDir, 'source-audio');
      normalizedPath = path.join(jobDir, 'normalized.wav');

      await fetchAudio(client, minioConfig, {
        storageBucket: input.storageBucket,
        storageKey: input.storageKey,
        destPath: sourcePath,
      });

      durationSeconds = await getAudioDurationSeconds(sourcePath);
    }

    const guard = checkResources(durationSeconds);
    if (!guard.allowed) {
      throw new Error(guard.warnings[0] || 'AUDIO_TOO_LONG_FOR_LOCAL_PROFILE');
    }

    console.error(
      JSON.stringify({
        event: 'job_start',
        jobId: input.jobId,
        aiProfile: profile.profile,
        whisperModel: profile.whisperModel,
        device: profile.whisperDevice,
        computeType: profile.whisperComputeType,
        diarizationEnabled: profile.diarizationEnabled,
        separationEnabled: profile.separationEnabled && !guard.skipSepformer,
        durationSeconds,
        channelCount: isMultiChannel ? input.channels!.length : 1,
      }),
    );

    const pythonDir = path.join(__dirname, '..', 'python');
    const pythonBin = resolvePythonBinary();
    const ffprobeBin = resolveBinary(
      process.env['AI_WORKER_FFPROBE_BIN'] ||
        process.env['FFPROBE_PATH'] ||
        'ffprobe',
    );
    const ffmpegBin = resolveBinary(
      process.env['AI_WORKER_FFMPEG_BIN'] ||
        process.env['FFMPEG_PATH'] ||
        'ffmpeg',
    );
    const pythonArgs = [
      path.join(pythonDir, 'transcribe_pipeline.py'),
      '--input',
      sourcePath,
      '--normalized-output',
      normalizedPath,
      '--result-output',
      resultPath,
      '--model',
      profile.whisperModel,
      '--device',
      profile.whisperDevice,
      '--compute-type',
      profile.whisperComputeType,
      '--language',
      input.language || 'vi-VN',
      '--diarization-enabled',
      String(profile.diarizationEnabled),
      '--overlap-detection-enabled',
      String(profile.overlapDetectionEnabled),
    ];
    if (input.initialPrompt) {
      pythonArgs.push('--initial-prompt', input.initialPrompt);
    }
    if (channelsJsonArg) {
      pythonArgs.push('--channels-json', channelsJsonArg);
    }
    await execFileAsync(pythonBin, pythonArgs, {
      maxBuffer: 1024 * 1024 * 20,
      env: {
        ...process.env,
        AI_WORKER_FFPROBE_BIN: ffprobeBin,
        AI_WORKER_FFMPEG_BIN: ffmpegBin,
      },
    });

    if (!fs.existsSync(resultPath)) {
      throw new Error('PIPELINE_RESULT_MISSING');
    }
    const parsed: Partial<TranscriptionJobOutput> = JSON.parse(
      fs.readFileSync(resultPath, 'utf8'),
    );
    validateResultShape(parsed);

    console.error(JSON.stringify({ event: 'job_done', jobId: input.jobId }));
    return parsed;
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  cleanupStaleTempDirs();
  const rawArg = process.argv[2];
  if (!rawArg) {
    console.error('Usage: transcription-job-runner <job-json>');
    process.exit(1);
  }
  const input: TranscriptionJobInput = JSON.parse(rawArg);
  runTranscriptionJob(input)
    .then((result) => {
      process.stdout.write(JSON.stringify(result));
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          event: 'job_error',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      process.exit(1);
    });
}
