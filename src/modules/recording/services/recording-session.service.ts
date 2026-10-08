import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  RecordingSessionEntity,
  RecordingSessionType,
  RecordingSourceType,
  RecordingSessionStatus,
} from '../entities/recording-session.entity.js';
import { StartVideoDto } from '../dto/start-video.dto.js';
import { CreateAudioSessionDto } from '../dto/create-audio-session.dto.js';
import { RecordingProcessManager } from './recording-process-manager.js';
import { decryptSecret } from '../../../common/utils/secret-crypto.util.js';
import { probeMedia, probeAudioDuration } from '../utils/ffprobe.util.js';
import { spawnFfmpegConcat, spawnFfmpegRemux } from '../utils/ffmpeg.util.js';
import { StorageService } from '../../storage/storage.service.js';

interface RtspConfig {
  rtsp_protocol?: string;
  rtsp_host?: string;
  rtsp_port?: number;
  rtsp_path?: string;
  rtsp_username?: string | null;
  rtsp_password_encrypted?: string;
}

@Injectable()
export class RecordingSessionService {
  private readonly logger = new Logger(RecordingSessionService.name);
  // REC-007: cửa sổ phát hiện no-data khi start (poll file>0).
  private static readonly START_PROBE_MS = 5000;
  private static readonly POLL_MS = 250;
  // UC-114/115: timeout concat N segment → 1 file khi stop (ffmpeg -c copy, nhanh).
  private static readonly CONCAT_TIMEOUT_MS = 120000;
  // REC audio-upload: timeout remux .webm nối thô từ MediaRecorder (ffmpeg -c copy, nhanh).
  private static readonly FFMPEG_REMUX_TIMEOUT_MS = 15000;

  private static readonly SUPPORTED_AUDIO_EXTENSIONS = [
    '.wav',
    '.mp3',
    '.m4a',
    '.mp4',
    '.aac',
    '.flac',
    '.ogg',
    '.webm',
  ];
  private static readonly SUPPORTED_VIDEO_EXTENSIONS = [
    '.webm',
    '.mp4',
    '.mov',
    '.mkv',
  ];

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly processManager: RecordingProcessManager,
    private readonly storageService: StorageService,
  ) {}

  async startVideo(
    meetingId: string,
    dto: StartVideoDto,
    userId: string | null,
  ): Promise<{
    recordingSessionId: string;
    sessionType: string;
    status: string;
    startedAt: Date;
    cameraDeviceId: string;
  }> {
    // 1. Meeting tồn tại
    const meetingRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        'SELECT id FROM meetings WHERE id = $1',
        [meetingId],
      );
    if (!meetingRows || meetingRows.length === 0) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }

    // [FIX 2026-08-11, R10] Ownership: permission 'recording.video.start' được cấp rộng
    // (kể cả EMPLOYEE) — lớp thứ 2 này đảm bảo chỉ Host/Organizer của CHÍNH meeting này
    // hoặc Admin mới được bắt đầu ghi hình, không phải bất kỳ ai có permission chung.
    if (userId) {
      await this.assertHostOrAdmin(meetingId, userId, 'bắt đầu ghi hình');
    }

    // 2. Camera (body.cameraDeviceId)
    const deviceRows: Array<{
      id: string;
      device_type: string;
      metadata_json: Record<string, unknown> | null;
    }> = await this.dataSource.manager.query(
      'SELECT id, device_type, metadata_json FROM iot_devices WHERE id = $1',
      [dto.cameraDeviceId],
    );
    if (!deviceRows || deviceRows.length === 0) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'Camera device not found.',
      });
    }
    const device = deviceRows[0];
    if (!['ip_camera', 'room_camera'].includes(device.device_type)) {
      throw new BadRequestException({
        code: 'INVALID_VIDEO_SOURCE_DEVICE',
        message: 'cameraDeviceId must reference an RTSP-capable room camera.',
      });
    }

    // 3. rtsp_config
    const mockRecordingEnabled = this.configService.get<boolean>(
      'MOCK_RECORDING_ENABLED',
      false,
    );
    const isMockCamera =
      mockRecordingEnabled && device.metadata_json?.['mock_camera'] === true;
    const metaCfg = device.metadata_json?.['rtsp_config'];
    const cfg = metaCfg ? (metaCfg as RtspConfig) : null;
    if (!isMockCamera && (!cfg || !cfg.rtsp_host || !cfg.rtsp_path)) {
      throw new BadRequestException({
        code: 'RTSP_NOT_CONFIGURED',
        message: 'Camera RTSP is not configured.',
      });
    }

    // [FIX 2026-08-11, R1] Bọc bước 4 (check active) + bước 8 (tạo session) trong 1
    // transaction, khoá pg_advisory_xact_lock theo meetingId NGAY ĐẦU — 2 request start
    // đồng thời cùng meeting giờ xếp hàng (transaction sau đợi transaction trước COMMIT rồi
    // mới SELECT bước 4, luôn thấy session vừa tạo) — mirror vehicle-resolve.service.ts.
    // Bước 9 (spawn/probe, side-effect ngoài DB) CHỦ Ý nằm NGOÀI transaction — không giữ
    // connection/lock trong lúc chờ process ngoài.
    const { sessionId, outPath, startedAt } = await this.dataSource.transaction(
      async (manager) => {
        await manager.query(
          `SELECT pg_advisory_xact_lock(hashtext('recording_start_' || $1::text))`,
          [meetingId],
        );

        // 4. Active session? (FRESH read SAU KHI có lock — KHÔNG dùng giá trị đọc trước lock).
        const activeRows: Array<{ id: string }> = await manager.query(
          `SELECT id FROM recording_sessions
           WHERE meeting_id = $1
             AND status IN ('starting','recording','paused')
             AND stopped_at IS NULL
           LIMIT 1`,
          [meetingId],
        );
        if (activeRows && activeRows.length > 0) {
          throw new ConflictException({
            code: 'RECORDING_ALREADY_ACTIVE',
            message: 'A recording session is already active for this meeting.',
          });
        }

        // 5. Link recording_config (best-effort)
        const cfgRows: Array<{ id: string }> = await manager.query(
          'SELECT id FROM recording_configs WHERE meeting_id = $1 LIMIT 1',
          [meetingId],
        );
        const recordingConfigId = cfgRows?.[0]?.id ?? null;

        // 7. storage path
        const baseDir = this.configService.get<string>(
          'RECORDING_STORAGE_PATH',
          './storage/recordings',
        );
        const sessionId = randomUUID();
        const outPath = path.join(path.resolve(baseDir), `${sessionId}.mp4`);
        fs.mkdirSync(path.resolve(baseDir), { recursive: true });

        // 8. Tạo recording_session (status=recording)
        const startedAt = new Date();
        const session = manager.create(RecordingSessionEntity, {
          id: sessionId,
          meetingId,
          recordingConfigId,
          sessionType: RecordingSessionType.VIDEO,
          sourceType: RecordingSourceType.IP_CAMERA,
          deviceId: device.id,
          startedAt,
          status: RecordingSessionStatus.RECORDING,
          startedBy: userId,
          storageProvider: 'local',
          storagePath: outPath,
          metadataJson: isMockCamera
            ? { mock_camera: true, source: 'ffmpeg-testsrc' }
            : null,
        });
        await manager.save(RecordingSessionEntity, session);

        return { sessionId, outPath, startedAt };
      },
    );

    // 6. Dựng URL (in-memory; KHÔNG log/lưu). Decrypt password nếu có. KHÔNG cần nằm trong
    // transaction (không đụng DB), giữ ngoài để lock giải phóng sớm nhất có thể.
    const url = isMockCamera ? 'mock://testsrc' : this.buildRtspUrl(cfg!);

    // 9. Spawn ffmpeg + probe no-data (REC-007): exit→failed; file>0→recording; hết cửa sổ & file 0→no_data.
    this.processManager.start(sessionId, url, outPath);
    const probe = await this.probeStart(sessionId, outPath);
    if (probe === 'exited') {
      // manager exit-handler đã markFailed; báo lỗi chung (không lộ url/password).
      throw new InternalServerErrorException({
        code: 'RECORDING_START_FAILED',
        message: 'Failed to start recording (ffmpeg exited).',
      });
    }
    if (probe === 'no_data') {
      // Camera tắt/không tới được: ffmpeg sống nhưng 0 byte → kill + failed + 502.
      await this.processManager.stop(sessionId);
      await this.dataSource.manager.query(
        `UPDATE recording_sessions
         SET status = $1, error_message = $2, stopped_at = $3
         WHERE id = $4`,
        [
          RecordingSessionStatus.FAILED,
          'no video data received from camera',
          new Date(),
          sessionId,
        ],
      );
      throw new BadGatewayException({
        code: 'RECORDING_NO_VIDEO',
        message:
          'Camera không gửi dữ liệu video (kiểm tra camera đã bật và tới được).',
      });
    }

    return {
      recordingSessionId: sessionId,
      sessionType: RecordingSessionType.VIDEO,
      status: RecordingSessionStatus.RECORDING,
      startedAt,
      cameraDeviceId: device.id,
    };
  }

  /**
   * REC-007 no-data probe: poll trong cửa sổ START_PROBE_MS.
   * - process exit → 'exited'; file output > 0 → 'capturing'; hết cửa sổ → 'no_data'.
   * Cửa sổ có giới hạn ⇒ request không treo.
   */
  private async probeStart(
    sessionId: string,
    outPath: string,
  ): Promise<'capturing' | 'exited' | 'no_data'> {
    const deadline = Date.now() + RecordingSessionService.START_PROBE_MS;
    for (;;) {
      const proc = this.processManager.get(sessionId);
      if (
        !this.processManager.has(sessionId) ||
        (proc && proc.exitCode !== null)
      ) {
        return 'exited';
      }
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        return 'capturing';
      }
      if (Date.now() >= deadline) {
        return 'no_data';
      }
      await this.sleep(RecordingSessionService.POLL_MS);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async stopVideo(
    meetingId: string,
    sessionId: string,
    userId: string | null,
  ): Promise<{
    recordingSessionId: string;
    status: string;
    stoppedAt: Date;
    durationSeconds: number;
    fileSizeBytes: string;
    mediaFileId: string | null;
    captured: boolean;
  }> {
    // [FIX 2026-08-11, R10] Ownership: check TRƯỚC transaction/lock (không cần lock cho 1
    // permission check) — chỉ Host/Organizer của meeting hoặc Admin được dừng ghi hình.
    if (userId) {
      await this.assertHostOrAdmin(meetingId, userId, 'dừng ghi hình');
    }

    // [FIX 2026-08-11, R8 — CRUX] Khoá + đọc-kiểm-ghi TOÀN BỘ trong 1 transaction, GIỮ lock
    // xuyên suốt tới UPDATE cuối cùng (kể cả nhánh finalizeFileToStopped) — KHÔNG chỉ khoá
    // phần quyết định rồi thả sớm. Lý do: nếu thả lock sau bước đọc, 1 pauseVideo() xen vào
    // ngay sau đó (trước khi UPDATE cuối của stopVideo chạy) vẫn có thể ghi đè
    // status='paused' + segment mới, rồi bị UPDATE cuối của stopVideo (dùng snapshot CŨ) ghi
    // đè ngược lại → mất đúng segment vừa pause xong. Giữ lock tới hết đảm bảo pauseVideo()
    // (cùng khoá sessionId) HOẶC chạy xong TRƯỚC (stopVideo thấy state mới nhất) HOẶC bị chặn
    // chờ tới khi stopVideo COMMIT xong (không còn cửa sổ xen giữa).
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('recording_session_' || $1::text))`,
        [sessionId],
      );

      // 1. Load session (FRESH read SAU KHI có lock — KHÔNG dùng snapshot đọc trước lock).
      const rows: Array<{
        id: string;
        meeting_id: string;
        status: string;
        storage_path: string | null;
        started_at: string | Date;
        paused_duration_seconds: number | null;
        metadata_json: Record<string, unknown> | null;
      }> = await manager.query(
        `SELECT id, meeting_id, status, storage_path, started_at,
                paused_duration_seconds, metadata_json
         FROM recording_sessions WHERE id = $1`,
        [sessionId],
      );
      const session = rows?.[0];
      if (!session || session.meeting_id !== meetingId) {
        throw new NotFoundException({
          code: 'RECORDING_SESSION_NOT_FOUND',
          message: 'Recording session not found.',
        });
      }

      // 2. Active?
      const activeStatuses = [
        RecordingSessionStatus.STARTING,
        RecordingSessionStatus.RECORDING,
        RecordingSessionStatus.PAUSED,
      ];
      if (!activeStatuses.includes(session.status as RecordingSessionStatus)) {
        throw new ConflictException({
          code: 'RECORDING_NOT_ACTIVE',
          message: 'Recording session is not active.',
        });
      }

      // 3. Dừng tiến trình. UC-114/115: paused → process đã dừng lúc pause (KHÔNG stop lại,
      //    KHÔNG coi là orphan). recording/starting → stop graceful; không handle → orphan.
      let stopResult: 'exited' | 'killed' | 'orphan' | 'skipped_paused';
      if (
        (session.status as RecordingSessionStatus) ===
        RecordingSessionStatus.PAUSED
      ) {
        stopResult = 'skipped_paused';
      } else {
        stopResult = this.processManager.has(sessionId)
          ? await this.processManager.stop(sessionId)
          : 'orphan';
      }
      const isOrphan = stopResult === 'orphan';

      // 4. Chốt file (đợi exit ở bước 3 xong mới đọc).
      const stoppedAt = new Date();
      const startedAt = new Date(session.started_at);
      const paused = session.paused_duration_seconds ?? 0;
      const durationSeconds = Math.max(
        0,
        Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000) - paused,
      );

      const baseMeta = session.metadata_json ?? {};
      const metadata = isOrphan ? { ...baseMeta, orphan_stop: true } : baseMeta;

      // UC-114/115: session có segment (đã pause/resume) → concat N segment → 1 file cuối.
      //   Session 0-pause (segments rỗng) → resolveStopFile trả storage_path cũ (LUỒNG CŨ Y HỆT — BR-06).
      //   `session` ở đây là snapshot FRESH (đọc SAU lock ở bước 1) — segments luôn đầy đủ.
      const { storagePath, cleanup: cleanupSegments } =
        await this.resolveStopFile(sessionId, session);
      const exists = !!storagePath && fs.existsSync(storagePath);
      const size = exists ? fs.statSync(storagePath).size : 0;

      // 5a. File thiếu / rỗng → stopped nhưng KHÔNG tạo media_files.
      if (!exists || size === 0) {
        await manager.query(
          `UPDATE recording_sessions
           SET status = $1, stopped_at = $2, stopped_by = $3,
               duration_seconds = $4, error_message = $5, metadata_json = $6
           WHERE id = $7`,
          [
            RecordingSessionStatus.STOPPED,
            stoppedAt,
            userId,
            durationSeconds,
            'empty file',
            JSON.stringify(metadata),
            sessionId,
          ],
        );
        return {
          recordingSessionId: sessionId,
          status: RecordingSessionStatus.STOPPED,
          stoppedAt,
          durationSeconds,
          fileSizeBytes: '0',
          mediaFileId: null,
          captured: false,
        };
      }

      // 5b. Có file → finalize (size/checksum/duration + transaction RIÊNG, queryRunner của
      // chính helper — kết nối KHÁC connection đang giữ lock ở đây, nhưng vẫn nằm TRONG thời
      // gian sống của lock vì được await TRƯỚC KHI transaction ngoài này commit). Dùng chung helper.
      const result = await this.finalizeFileToStopped({
        sessionId,
        meetingId,
        storagePath,
        startedAt,
        paused,
        userId,
        baseMetadata: metadata,
      });

      // UC-114/115 (C4): concat OK + finalize xong → xoá segment files + list.txt. (0-pause: noop.)
      cleanupSegments();

      return {
        recordingSessionId: sessionId,
        status: RecordingSessionStatus.STOPPED,
        stoppedAt: result.stoppedAt,
        durationSeconds: result.durationSeconds,
        fileSizeBytes: result.fileSizeBytes,
        mediaFileId: result.mediaFileId,
        captured: true,
      };
    });
  }

  /**
   * [FIX 2026-08-12, R9 — Lớp 1] Tự động dừng TẤT CẢ session ghi hình đang active của 1
   * meeting (vd khi meeting kết thúc). 1 meeting có thể có nhiều session active cùng lúc
   * (video + audio, hoặc nhiều lượt do lỗi/start lại) — dừng từng cái, 1 cái lỗi KHÔNG
   * chặn các cái còn lại (mirror RecordingReconcileService's orphan loop). `userId=null`:
   * caller hệ thống (endMeeting/cron) — assertHostOrAdmin() trong stopVideo() tự bỏ qua
   * (if (userId) ...), KHÔNG throw ForbiddenException cho luồng tự động.
   */
  async stopAllActiveForMeeting(
    meetingId: string,
    userId: string | null,
    reason?: string,
  ): Promise<{ scanned: number; stopped: number; failed: number }> {
    const rows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM recording_sessions
       WHERE meeting_id = $1 AND status IN ('starting','recording','paused')`,
      [meetingId],
    );

    let stopped = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.stopVideo(meetingId, row.id, userId);
        if (reason) {
          await this.dataSource.manager.query(
            `UPDATE recording_sessions
                SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $1::jsonb
              WHERE id = $2`,
            [
              JSON.stringify({
                auto_stop_reason: reason,
                auto_stopped_at: new Date().toISOString(),
              }),
              row.id,
            ],
          );
        }
        stopped++;
      } catch (e: unknown) {
        failed++;
        this.logger.error(
          `[stopAllActiveForMeeting] session ${row.id} (meeting ${meetingId}) failed: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    }

    return { scanned: rows.length, stopped, failed };
  }

  /**
   * UC-114 — Tạm dừng ghi hình (SEGMENT). BR-05: markStopping + stop ffmpeg → đóng file
   * segment hiện tại; từ đây KHÔNG process nào ghi cho tới resume ⇒ đoạn pause không tồn
   * tại trong bất kỳ file nào. KHÔNG audit (nhất quán start/stop).
   */
  async pauseVideo(
    meetingId: string,
    sessionId: string,
    userId: string | null = null,
  ): Promise<{
    recordingSessionId: string;
    status: string;
    pauseCount: number;
  }> {
    // [FIX 2026-08-11, R10] Ownership: check TRƯỚC transaction/lock — chỉ Host/Organizer
    // của meeting hoặc Admin được tạm dừng ghi hình.
    if (userId) {
      await this.assertHostOrAdmin(meetingId, userId, 'tạm dừng ghi hình');
    }

    // [FIX 2026-08-11, R3/R4/R8] Khoá + đọc-kiểm-ghi TOÀN BỘ trong 1 transaction — cùng
    // khoá 'recording_session_'||sessionId với stopVideo()/resumeVideo() → 2 request cùng
    // sessionId (vd Pause+Stop gần như đồng thời) xếp hàng, KHÔNG còn xen kẽ đọc/ghi.
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('recording_session_' || $1::text))`,
        [sessionId],
      );

      // A. Load session (FRESH read SAU KHI có lock).
      const rows: Array<{
        id: string;
        meeting_id: string;
        status: string;
        storage_path: string | null;
        metadata_json: Record<string, unknown> | null;
      }> = await manager.query(
        `SELECT id, meeting_id, status, storage_path, metadata_json
         FROM recording_sessions WHERE id = $1`,
        [sessionId],
      );
      const session = rows?.[0];
      if (!session || session.meeting_id !== meetingId) {
        throw new NotFoundException({
          code: 'RECORDING_SESSION_NOT_FOUND',
          message: 'Recording session not found.',
        });
      }

      // B. Guard: chỉ pause khi đang recording
      if (
        (session.status as RecordingSessionStatus) !==
        RecordingSessionStatus.RECORDING
      ) {
        throw new ConflictException({
          code: 'RECORDING_NOT_RECORDING',
          message: 'Recording session is not recording.',
        });
      }

      // C. markStopping TRƯỚC stop (BR-05: tránh bị đánh failed; đóng file segment sạch).
      this.processManager.markStopping(sessionId);
      await this.processManager.stop(sessionId);

      // D. Ghi segment hiện tại vào metadata + set paused (merge KHÔNG đè orphan_stop/recovered).
      const meta = session.metadata_json ?? {};
      const segments = Array.isArray(meta.segments)
        ? (meta.segments as unknown[]).filter(
            (p): p is string => typeof p === 'string',
          )
        : [];
      if (session.storage_path && !segments.includes(session.storage_path)) {
        segments.push(session.storage_path);
      }
      const pauseCount =
        (typeof meta.pause_count === 'number' ? meta.pause_count : 0) + 1;
      const merged = {
        ...meta,
        segments,
        paused_at: new Date().toISOString(),
        pause_count: pauseCount,
      };
      await manager.query(
        `UPDATE recording_sessions SET status = $1, metadata_json = $2 WHERE id = $3`,
        [RecordingSessionStatus.PAUSED, JSON.stringify(merged), sessionId],
      );

      return {
        recordingSessionId: sessionId,
        status: RecordingSessionStatus.PAUSED,
        pauseCount,
      };
    });
  }

  /**
   * UC-115 — Tiếp tục ghi hình (SEGMENT): start ffmpeg ghi segment MỚI. Dựng lại RTSP url
   * in-memory (không log). Segment mới no-data/fail → GIỮ paused + 502 (C5): không mất
   * segment cũ, không cộng pausedDuration. KHÔNG audit.
   */
  async resumeVideo(
    meetingId: string,
    sessionId: string,
    userId: string | null = null,
  ): Promise<{
    recordingSessionId: string;
    status: string;
    pausedDurationSeconds: number;
  }> {
    // [FIX 2026-08-11, R10] Ownership: check TRƯỚC transaction/lock — chỉ Host/Organizer
    // của meeting hoặc Admin được tiếp tục ghi hình.
    if (userId) {
      await this.assertHostOrAdmin(meetingId, userId, 'tiếp tục ghi hình');
    }

    // [FIX 2026-08-11, R3/R4/R8] Khoá + đọc-kiểm-ghi TOÀN BỘ trong 1 transaction — cùng
    // namespace khoá 'recording_session_'||sessionId với pauseVideo()/stopVideo().
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('recording_session_' || $1::text))`,
        [sessionId],
      );

      // A. Load session (FRESH read SAU KHI có lock).
      const rows: Array<{
        id: string;
        meeting_id: string;
        status: string;
        device_id: string | null;
        paused_duration_seconds: number | null;
        metadata_json: Record<string, unknown> | null;
      }> = await manager.query(
        `SELECT id, meeting_id, status, device_id, paused_duration_seconds, metadata_json
         FROM recording_sessions WHERE id = $1`,
        [sessionId],
      );
      const session = rows?.[0];
      if (!session || session.meeting_id !== meetingId) {
        throw new NotFoundException({
          code: 'RECORDING_SESSION_NOT_FOUND',
          message: 'Recording session not found.',
        });
      }

      // B. Guard: chỉ resume khi đang paused
      if (
        (session.status as RecordingSessionStatus) !==
        RecordingSessionStatus.PAUSED
      ) {
        throw new ConflictException({
          code: 'RECORDING_NOT_PAUSED',
          message: 'Recording session is not paused.',
        });
      }

      // C. Dựng lại RTSP url (in-memory, KHÔNG log) từ device.rtsp_config — như startVideo.
      const deviceRows: Array<{
        metadata_json: Record<string, unknown> | null;
      }> = await manager.query(
        'SELECT metadata_json FROM iot_devices WHERE id = $1',
        [session.device_id],
      );
      const metaCfg = deviceRows?.[0]?.metadata_json?.['rtsp_config'];
      const cfg = metaCfg ? (metaCfg as RtspConfig) : null;
      if (!cfg || !cfg.rtsp_host || !cfg.rtsp_path) {
        throw new BadRequestException({
          code: 'RTSP_NOT_CONFIGURED',
          message: 'Camera RTSP is not configured.',
        });
      }
      const url = this.buildRtspUrl(cfg);

      // D. Segment mới {sessionId}_seg{n}.mp4 (n = số segment hiện có) → start + probe no-data.
      const meta = session.metadata_json ?? {};
      const segments = Array.isArray(meta.segments)
        ? (meta.segments as unknown[]).filter(
            (p): p is string => typeof p === 'string',
          )
        : [];
      const baseDir = this.configService.get<string>(
        'RECORDING_STORAGE_PATH',
        './storage/recordings',
      );
      fs.mkdirSync(path.resolve(baseDir), { recursive: true });
      const segNew = path.join(
        path.resolve(baseDir),
        `${sessionId}_seg${segments.length}.mp4`,
      );

      this.processManager.start(sessionId, url, segNew);
      const probe = await this.probeStart(sessionId, segNew);
      if (probe === 'exited' || probe === 'no_data') {
        // C5: GIỮ status=paused (KHÔNG update DB), không cộng pausedDuration, không mất
        // segment cũ — throw ở đây tự động ROLLBACK transaction (chưa UPDATE gì), giữ đúng
        // ngữ nghĩa cũ.
        if (this.processManager.has(sessionId)) {
          await this.processManager.stop(sessionId);
        }
        throw new BadGatewayException({
          code: 'RECORDING_NO_VIDEO',
          message: 'Camera không gửi dữ liệu video khi tiếp tục ghi.',
        });
      }

      // E. capturing → cộng khoảng pause vào pausedDurationSeconds + xoá paused_at + recording.
      const pausedAt =
        typeof meta.paused_at === 'string' ? new Date(meta.paused_at) : null;
      const pausedInc = pausedAt
        ? Math.max(0, Math.floor((Date.now() - pausedAt.getTime()) / 1000))
        : 0;
      const newPausedDuration =
        (session.paused_duration_seconds ?? 0) + pausedInc;
      const { paused_at: _removed, ...restMeta } = meta;
      void _removed;
      const merged = { ...restMeta, segments: [...segments, segNew] };
      await manager.query(
        `UPDATE recording_sessions
         SET status = $1, paused_duration_seconds = $2, storage_path = $3, metadata_json = $4
         WHERE id = $5`,
        [
          RecordingSessionStatus.RECORDING,
          newPausedDuration,
          segNew,
          JSON.stringify(merged),
          sessionId,
        ],
      );

      return {
        recordingSessionId: sessionId,
        status: RecordingSessionStatus.RECORDING,
        pausedDurationSeconds: newPausedDuration,
      };
    });
  }

  /**
   * UC-114/115 — Quyết định file dùng để finalize khi stop:
   * - 0-pause (segments rỗng) → storage_path cũ (LUỒNG CŨ Y HỆT — BR-06), cleanup noop.
   * - 1 segment hợp lệ → chính segment đó (không concat).
   * - >1 segment → concat demuxer → {sessionId}_final.mp4; concat lỗi → 500 (GIỮ segment).
   * Lọc segment 0-byte/không tồn tại trước khi concat.
   */
  private async resolveStopFile(
    sessionId: string,
    session: {
      storage_path: string | null;
      metadata_json: Record<string, unknown> | null;
    },
  ): Promise<{ storagePath: string | null; cleanup: () => void }> {
    const noop = () => {};
    const meta = session.metadata_json ?? {};
    const segList = Array.isArray(meta.segments)
      ? (meta.segments as unknown[]).filter(
          (p): p is string => typeof p === 'string',
        )
      : [];
    if (segList.length === 0) {
      return { storagePath: session.storage_path, cleanup: noop };
    }
    const validSegs = segList.filter(
      (p) => fs.existsSync(p) && fs.statSync(p).size > 0,
    );
    if (validSegs.length === 0) {
      return { storagePath: session.storage_path, cleanup: noop };
    }
    if (validSegs.length === 1) {
      return { storagePath: validSegs[0], cleanup: noop };
    }

    // >1 segment → concat
    const baseDir = this.configService.get<string>(
      'RECORDING_STORAGE_PATH',
      './storage/recordings',
    );
    const outConcat = path.join(
      path.resolve(baseDir),
      `${sessionId}_final.mp4`,
    );
    const listPath = path.join(
      os.tmpdir(),
      `concat-${sessionId}-${randomUUID()}.txt`,
    );
    const listBody = validSegs
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(listPath, listBody);

    const code = await this.runFfmpegConcat(listPath, outConcat);
    if (code !== 0) {
      // C4: concat lỗi → 500, GIỮ segment + list (không xoá, không finalize).
      throw new InternalServerErrorException({
        code: 'RECORDING_STOP_FAILED',
        message: 'Failed to concat recording segments.',
      });
    }
    const cleanup = () => {
      for (const seg of validSegs) {
        try {
          fs.unlinkSync(seg);
        } catch {
          // best-effort
        }
      }
      try {
        fs.unlinkSync(listPath);
      } catch {
        // best-effort
      }
    };
    return { storagePath: outConcat, cleanup };
  }

  /** Chạy ffmpeg concat, chờ exit; trả exit code (−1 nếu error/timeout+kill). */
  private runFfmpegConcat(listPath: string, outPath: string): Promise<number> {
    return new Promise((resolve) => {
      const proc = spawnFfmpegConcat(listPath, outPath);
      let settled = false;
      const done = (code: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(code);
      };
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // process có thể đã thoát
        }
        done(-1);
      }, RecordingSessionService.CONCAT_TIMEOUT_MS);
      proc.on('exit', (c) => done(c ?? -1));
      proc.on('error', () => done(-1));
    });
  }

  /**
   * Tạo 1 audio recording_session "rỗng" (chưa có media_file nào) — điểm neo
   * (sessionId) để nhiều participant lần lượt upload audio track riêng của mình
   * qua uploadAudioTrack() (channel_zone mode). Khác uploadAudioForTranscription
   * (luôn kèm sẵn 1 file) — session ở đây chỉ có metadata, KHÔNG có file/process.
   * status=starting là placeholder trung tính (không có ffmpeg/process đứng sau,
   * không bị bất kỳ logic nào ở createTranscriptionJob kiểm tra) — session được
   * coi là "sẵn sàng nhận track" ngay từ khi tạo, không cần bước "start" riêng.
   * Chỉ Host/Organizer của meeting hoặc Business/System Admin được tạo.
   */
  async createAudioSession(
    meetingId: string,
    userId: string | null,
    dto: CreateAudioSessionDto,
  ): Promise<{
    recordingSessionId: string;
    sessionType: string;
    status: string;
    startedAt: Date;
  }> {
    const meetingRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        'SELECT id FROM meetings WHERE id = $1',
        [meetingId],
      );
    if (!meetingRows || meetingRows.length === 0) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }

    if (userId) {
      await this.assertHostOrAdmin(meetingId, userId);
    }

    const sessionId = randomUUID();
    const startedAt = new Date();
    const metadataJson = dto?.notes ? { notes: dto.notes } : null;

    const session = this.dataSource.manager.create(RecordingSessionEntity, {
      id: sessionId,
      meetingId,
      sessionType: RecordingSessionType.AUDIO,
      sourceType: RecordingSourceType.MANUAL_UPLOAD,
      status: RecordingSessionStatus.STARTING,
      startedAt,
      startedBy: userId,
      metadataJson,
    });
    await this.dataSource.manager.save(RecordingSessionEntity, session);

    return {
      recordingSessionId: sessionId,
      sessionType: RecordingSessionType.AUDIO,
      status: RecordingSessionStatus.STARTING,
      startedAt,
    };
  }

  /**
   * Gap fix (Nhóm A) — participant không có cách nào tự tìm recordingSessionId
   * để upload track ngoài việc Host relay tay. Trả danh sách recording_sessions
   * của meeting (mọi loại, mới nhất trước) cho participant/Admin xem — dùng để
   * chọn đúng sessionId trước khi gọi uploadAudioTrack().
   */
  async listRecordingSessions(
    meetingId: string,
    userId: string,
  ): Promise<
    Array<{
      recordingSessionId: string;
      sessionType: string;
      sourceType: string;
      status: string;
      startedAt: Date;
      stoppedAt: Date | null;
      mediaFiles: Array<{
        id: string;
        fileName: string;
        title: string;
        mimeType: string;
        fileType: string;
        fileSizeBytes: string | null;
        durationSeconds: number | null;
        uploadedAt: Date | null;
      }>;
    }>
  > {
    const meetingRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        'SELECT id FROM meetings WHERE id = $1',
        [meetingId],
      );
    if (!meetingRows || meetingRows.length === 0) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }

    await this.assertParticipantOrAdmin(meetingId, userId);

    const rows: Array<{
      id: string;
      session_type: string;
      source_type: string;
      status: string;
      started_at: Date;
      stopped_at: Date | null;
      media_files: unknown;
    }> = await this.dataSource.manager.query(
      `SELECT rs.id, rs.session_type, rs.source_type, rs.status, rs.started_at, rs.stopped_at,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'id', mf.id,
                    'fileName', mf.file_name,
                    'title', mf.file_name,
                    'mimeType', mf.mime_type,
                    'fileType', mf.file_type,
                    'fileSizeBytes', mf.file_size_bytes,
                    'durationSeconds', mf.duration_seconds,
                    'uploadedAt', mf.uploaded_at
                  )
                  ORDER BY mf.uploaded_at DESC
                ) FILTER (WHERE mf.id IS NOT NULL),
                '[]'::jsonb
              ) AS media_files
       FROM recording_sessions rs
       LEFT JOIN media_files mf
         ON mf.recording_session_id = rs.id
        AND mf.is_active = true
        AND mf.deleted_at IS NULL
       WHERE rs.meeting_id = $1
       GROUP BY rs.id, rs.session_type, rs.source_type, rs.status, rs.started_at, rs.stopped_at
       ORDER BY rs.started_at DESC`,
      [meetingId],
    );

    return rows.map((r) => ({
      recordingSessionId: r.id,
      sessionType: r.session_type,
      sourceType: r.source_type,
      status: r.status,
      startedAt: r.started_at,
      stoppedAt: r.stopped_at,
      mediaFiles: Array.isArray(r.media_files) ? r.media_files : [],
    }));
  }

  /**
   * Upload video đã ghi bằng MediaRecorder trên trình duyệt (mock webcam).
   * Dữ liệu vẫn đi qua recording_sessions + media_files để xem lại giống camera thật.
   */
  async uploadVideoFromBrowser(
    meetingId: string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    userId: string | null,
  ): Promise<{
    recordingSessionId: string;
    mediaFileId: string;
    storageKey: string;
    durationSeconds: number | null;
  }> {
    const meetingRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        'SELECT id FROM meetings WHERE id = $1',
        [meetingId],
      );
    if (!meetingRows || meetingRows.length === 0) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }

    if (userId) {
      await this.assertHostOrAdmin(meetingId, userId, 'upload ghi hình');
    }

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_VIDEO_FILE',
        message: 'File video rỗng hoặc không hợp lệ.',
      });
    }
    const ext = path.extname(file.originalname).toLowerCase() || '.webm';
    if (!RecordingSessionService.SUPPORTED_VIDEO_EXTENSIONS.includes(ext)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MEDIA_FORMAT',
        message: `Định dạng "${ext}" không được hỗ trợ. Chấp nhận: ${RecordingSessionService.SUPPORTED_VIDEO_EXTENSIONS.join(', ')}`,
      });
    }

    const videoBuffer = await this.remuxWebmBufferIfNeeded(file.buffer, ext);
    const checksum = createHash('sha256').update(videoBuffer).digest('hex');
    const durationSeconds = await this.probeUploadedVideoDuration(
      videoBuffer,
      ext,
    );

    const safeOriginalName =
      file.originalname && path.extname(file.originalname)
        ? file.originalname
        : `webcam-recording-${Date.now()}${ext}`;
    const saved = await this.storageService.saveFile({
      buffer: videoBuffer,
      originalName: safeOriginalName,
      folder: `recordings/${meetingId}`,
    });
    const driver = this.storageService.getDriver();
    const bucket = this.storageService.getBucketName();

    const sessionId = randomUUID();
    const now = new Date();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let mediaFileId: string;
    try {
      const session = queryRunner.manager.create(RecordingSessionEntity, {
        id: sessionId,
        meetingId,
        sessionType: RecordingSessionType.VIDEO,
        sourceType: RecordingSourceType.MANUAL_UPLOAD,
        status: RecordingSessionStatus.STOPPED,
        startedAt: now,
        stoppedAt: now,
        startedBy: userId,
        stoppedBy: userId,
        storageProvider: driver,
        storagePath: saved.storageKey,
        fileSizeBytes: String(videoBuffer.length),
        durationSeconds,
        checksum,
        metadataJson: { source: 'browser_webcam' },
      });
      await queryRunner.manager.save(RecordingSessionEntity, session);

      const insert = (await queryRunner.query(
        `INSERT INTO media_files
           (file_name, file_type, mime_type, storage_provider, storage_bucket, storage_key,
            recording_session_id, meeting_id, uploaded_by,
            file_size_bytes, checksum, duration_seconds, metadata_json, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
         RETURNING id`,
        [
          safeOriginalName,
          'video',
          file.mimetype || (ext === '.webm' ? 'video/webm' : 'video/mp4'),
          driver,
          bucket,
          saved.storageKey,
          sessionId,
          meetingId,
          userId,
          String(videoBuffer.length),
          checksum,
          durationSeconds,
          JSON.stringify({ source: 'browser_webcam' }),
        ],
      )) as Array<{ id: string }>;
      mediaFileId = insert[0].id;

      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `uploadVideoFromBrowser failed for meeting ${meetingId}: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      throw new InternalServerErrorException({
        code: 'VIDEO_UPLOAD_FAILED',
        message: 'Failed to save uploaded video.',
      });
    } finally {
      await queryRunner.release();
    }

    return {
      recordingSessionId: sessionId,
      mediaFileId,
      storageKey: saved.storageKey,
      durationSeconds,
    };
  }

  /**
   * Upload audio đã ghi sẵn (ví dụ .m4a) cho 1 meeting, dùng để test/feed pipeline
   * transcription (TRANS-OFFLINE-001) khi không có camera/capture agent thật.
   * Tạo 1 recording_session (sessionType=audio, sourceType=manual_upload, status
   * stopped ngay vì file đã hoàn chỉnh) + 1 media_files (file_type=audio).
   * Chỉ Host/Organizer của meeting hoặc Business/System Admin được upload.
   */
  async uploadAudioForTranscription(
    meetingId: string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    userId: string | null,
  ): Promise<{
    recordingSessionId: string;
    mediaFileId: string;
    storageKey: string;
    durationSeconds: number | null;
  }> {
    const meetingRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        'SELECT id FROM meetings WHERE id = $1',
        [meetingId],
      );
    if (!meetingRows || meetingRows.length === 0) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }

    if (userId) {
      await this.assertHostOrAdmin(meetingId, userId);
    }

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_AUDIO_FILE',
        message: 'File audio rỗng hoặc không hợp lệ.',
      });
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!RecordingSessionService.SUPPORTED_AUDIO_EXTENSIONS.includes(ext)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MEDIA_FORMAT',
        message: `Định dạng "${ext}" không được hỗ trợ. Chấp nhận: ${RecordingSessionService.SUPPORTED_AUDIO_EXTENSIONS.join(', ')}`,
      });
    }

    const sessionId = randomUUID();
    const audioBuffer = await this.remuxWebmBufferIfNeeded(file.buffer, ext);
    const checksum = createHash('sha256').update(audioBuffer).digest('hex');
    const durationSeconds = await this.probeUploadedAudioDuration(
      audioBuffer,
      ext,
    );

    const saved = await this.storageService.saveFile({
      buffer: audioBuffer,
      originalName: file.originalname,
      folder: `recordings/${meetingId}`,
    });
    const driver = this.storageService.getDriver();
    const bucket = this.storageService.getBucketName();

    const startedAt = new Date();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let mediaFileId: string;
    try {
      const session = queryRunner.manager.create(RecordingSessionEntity, {
        id: sessionId,
        meetingId,
        sessionType: RecordingSessionType.AUDIO,
        sourceType: RecordingSourceType.MANUAL_UPLOAD,
        status: RecordingSessionStatus.STOPPED,
        startedAt,
        stoppedAt: startedAt,
        startedBy: userId,
        stoppedBy: userId,
        storageProvider: driver,
        storagePath: saved.storageKey,
        fileSizeBytes: String(audioBuffer.length),
        durationSeconds,
        checksum,
      });
      await queryRunner.manager.save(RecordingSessionEntity, session);

      const insert = (await queryRunner.query(
        `INSERT INTO media_files
           (file_name, file_type, mime_type, storage_provider, storage_bucket, storage_key,
            recording_session_id, meeting_id, uploaded_by,
            file_size_bytes, checksum, duration_seconds, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
         RETURNING id`,
        [
          file.originalname,
          'audio',
          file.mimetype || 'application/octet-stream',
          driver,
          bucket,
          saved.storageKey,
          sessionId,
          meetingId,
          userId,
          String(audioBuffer.length),
          checksum,
          durationSeconds,
        ],
      )) as Array<{ id: string }>;
      mediaFileId = insert[0].id;

      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `uploadAudioForTranscription failed for meeting ${meetingId}: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      throw new InternalServerErrorException({
        code: 'AUDIO_UPLOAD_FAILED',
        message: 'Failed to save uploaded audio.',
      });
    } finally {
      await queryRunner.release();
    }

    return {
      recordingSessionId: sessionId,
      mediaFileId,
      storageKey: saved.storageKey,
      durationSeconds,
    };
  }

  /**
   * Giai đoạn 1 — PLAN-transcription-completion: Participant upload audio track
   * riêng của mình sau khi meeting kết thúc (status=completed). userId lấy từ JWT.
   * Tạo MediaFile với channelUserId = userId để pipeline channel_zone biết ai nói.
   */
  async uploadAudioTrack(
    meetingId: string,
    sessionId: string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    userId: string,
  ): Promise<{
    mediaFileId: string;
    storageKey: string;
    channelUserId: string;
    durationSeconds: number | null;
  }> {
    const meetingRows: Array<{ id: string; status: string }> =
      await this.dataSource.manager.query(
        'SELECT id, status FROM meetings WHERE id = $1',
        [meetingId],
      );
    if (!meetingRows || meetingRows.length === 0) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }
    if (meetingRows[0].status !== 'completed') {
      throw new BadRequestException({
        code: 'MEETING_NOT_ENDED',
        message: 'Chi duoc upload audio track sau khi cuoc hop da ket thuc.',
      });
    }

    const participantRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        'SELECT id FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2',
        [meetingId, userId],
      );
    if (!participantRows || participantRows.length === 0) {
      throw new ForbiddenException({
        code: 'NOT_A_PARTICIPANT',
        message: 'Ban khong phai la thanh vien cua cuoc hop nay.',
      });
    }

    const sessionRows: Array<{ id: string; meeting_id: string }> =
      await this.dataSource.manager.query(
        'SELECT id, meeting_id FROM recording_sessions WHERE id = $1',
        [sessionId],
      );
    if (
      !sessionRows ||
      sessionRows.length === 0 ||
      sessionRows[0].meeting_id !== meetingId
    ) {
      throw new NotFoundException({
        code: 'RECORDING_SESSION_NOT_FOUND',
        message:
          'Recording session not found or does not belong to this meeting.',
      });
    }

    const existingRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        `SELECT id FROM media_files
         WHERE recording_session_id = $1
           AND channel_user_id = $2
           AND file_type = 'audio'
           AND is_active = true
           AND deleted_at IS NULL`,
        [sessionId, userId],
      );
    if (existingRows && existingRows.length > 0) {
      throw new ConflictException({
        code: 'AUDIO_TRACK_ALREADY_EXISTS',
        message: 'Ban da upload audio track cho session nay roi.',
      });
    }

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_AUDIO_FILE',
        message: 'File audio rong hoac khong hop le.',
      });
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!RecordingSessionService.SUPPORTED_AUDIO_EXTENSIONS.includes(ext)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MEDIA_FORMAT',
        message: `Dinh dang "${ext}" khong duoc ho tro. Chap nhan: ${RecordingSessionService.SUPPORTED_AUDIO_EXTENSIONS.join(', ')}`,
      });
    }

    const audioBuffer = await this.remuxWebmBufferIfNeeded(file.buffer, ext);
    const checksum = createHash('sha256').update(audioBuffer).digest('hex');
    const durationSeconds = await this.probeUploadedAudioDuration(
      audioBuffer,
      ext,
    );

    const saved = await this.storageService.saveFile({
      buffer: audioBuffer,
      originalName: file.originalname,
      folder: `meetings/${meetingId}/sessions/${sessionId}/${userId}`,
    });
    const driver = this.storageService.getDriver();
    const bucket = this.storageService.getBucketName();

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let mediaFileId: string;
    try {
      const insert = (await queryRunner.query(
        `INSERT INTO media_files
           (file_name, file_type, mime_type, storage_provider, storage_bucket, storage_key,
            recording_session_id, meeting_id, uploaded_by, channel_user_id,
            file_size_bytes, checksum, duration_seconds, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
         RETURNING id`,
        [
          file.originalname,
          'audio',
          file.mimetype || 'application/octet-stream',
          driver,
          bucket,
          saved.storageKey,
          sessionId,
          meetingId,
          userId,
          userId,
          String(audioBuffer.length),
          checksum,
          durationSeconds,
        ],
      )) as Array<{ id: string }>;
      mediaFileId = insert[0].id;

      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `uploadAudioTrack failed for meeting ${meetingId} user ${userId}: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      throw new InternalServerErrorException({
        code: 'AUDIO_TRACK_UPLOAD_FAILED',
        message: 'Failed to save uploaded audio track.',
      });
    } finally {
      await queryRunner.release();
    }

    return {
      mediaFileId,
      storageKey: saved.storageKey,
      channelUserId: userId,
      durationSeconds,
    };
  }

  /**
   * Host/Organizer của meeting hoặc Business/System Admin — ngoài ra từ chối.
   *
   * [FIX 2026-08-11, R10] `action` (mặc định 'upload audio', giữ NGUYÊN message cũ cho 2
   * caller gốc — uploadAudioForTranscription/createAudioSession — KHÔNG đổi hành vi) để
   * dùng chung cho startVideo/pauseVideo/resumeVideo/stopVideo với message đúng ngữ cảnh,
   * KHÔNG viết lại logic kiểm tra (mirror đúng 1 nguồn, tránh 2 nơi định nghĩa "ai được
   * thao tác recording của meeting này").
   */
  private async assertHostOrAdmin(
    meetingId: string,
    userId: string,
    action: string = 'upload audio',
  ): Promise<void> {
    const hostRows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2 AND participant_role = 'host'`,
      [meetingId, userId],
    );
    if (hostRows && hostRows.length > 0) return;

    const roleRows: Array<{ role_code: string }> =
      await this.dataSource.manager.query(
        `SELECT r.role_code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.is_active = true`,
        [userId],
      );
    const isAdmin = roleRows.some((r) =>
      ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'].includes(r.role_code),
    );
    if (!isAdmin) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: `Chỉ Host/Organizer hoặc Admin được ${action} cho meeting này.`,
      });
    }
  }

  /** Bất kỳ participant nào của meeting, hoặc Business/System Admin — ngoài ra từ chối. */
  private async assertParticipantOrAdmin(
    meetingId: string,
    userId: string,
  ): Promise<void> {
    const participantRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        'SELECT id FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2',
        [meetingId, userId],
      );
    if (participantRows && participantRows.length > 0) return;

    const roleRows: Array<{ role_code: string }> =
      await this.dataSource.manager.query(
        `SELECT r.role_code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.is_active = true`,
        [userId],
      );
    const isAdmin = roleRows.some((r) =>
      ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'].includes(r.role_code),
    );
    if (!isAdmin) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message:
          'Chỉ participant của meeting hoặc Admin được xem danh sách recording session.',
      });
    }
  }

  /** Ghi buffer ra temp file để ffprobe đo duration (audio-only, best-effort), rồi xoá. */
  private async probeUploadedAudioDuration(
    buffer: Buffer,
    ext: string,
  ): Promise<number | null> {
    const tmpPath = path.join(os.tmpdir(), `audio-probe-${randomUUID()}${ext}`);
    try {
      fs.writeFileSync(tmpPath, buffer);
      return await probeAudioDuration(tmpPath);
    } catch {
      return null;
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // best-effort cleanup
      }
    }
  }

  /** Ghi buffer video ra temp file để ffprobe đo duration (best-effort), rồi xoá. */
  private async probeUploadedVideoDuration(
    buffer: Buffer,
    ext: string,
  ): Promise<number | null> {
    const tmpPath = path.join(os.tmpdir(), `video-probe-${randomUUID()}${ext}`);
    try {
      fs.writeFileSync(tmpPath, buffer);
      const probe = await probeMedia(tmpPath);
      return probe?.durationSeconds ?? null;
    } catch {
      return null;
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // best-effort cleanup
      }
    }
  }

  /**
   * REC audio-upload — remux buffer `.webm` trước khi lưu/probe (best-effort,
   * KHÔNG transcode, `-c copy`). FE (StationRecorder) tạo file bằng cách nối
   * thô nhiều Blob chunk `MediaRecorder` (`new Blob([chunk1, chunk2, ...])`) —
   * chỉ chunk đầu có EBML header/Segment info đầy đủ, file gộp thiếu Cues
   * (bảng chỉ mục seek) và Duration đúng cho toàn bộ nội dung. Hệ quả: trình
   * duyệt tua audio sai vị trí khi phát lại, và `probeAudioDuration()` phía
   * dưới thường trả `null`. Remux ở đây viết lại đúng container 1 lần, sửa
   * tận gốc cho MỌI nơi dùng lại file (web player, tải xuống, probe duration)
   * — cùng kỹ thuật đã dùng ở worker `transcription-job-runner.ts` cho
   * `AUDIO_DURATION_PROBE_FAILED`, nhưng áp dụng cho đúng file lưu trữ thật
   * thay vì chỉ 1 bản tạm để đo. Lỗi/timeout → trả buffer gốc, KHÔNG chặn
   * upload. Chỉ remux `.webm` vì đây là định dạng duy nhất tạo ra theo cách
   * nối chunk này; `.wav/.mp3/.m4a/...` do người dùng tự thu không có vấn đề
   * này nên bỏ qua để tránh tốn thời gian xử lý không cần thiết.
   */
  private async remuxWebmBufferIfNeeded(
    buffer: Buffer,
    ext: string,
  ): Promise<Buffer> {
    if (ext !== '.webm') return buffer;

    const inPath = path.join(
      os.tmpdir(),
      `audio-remux-in-${randomUUID()}.webm`,
    );
    const outPath = path.join(
      os.tmpdir(),
      `audio-remux-out-${randomUUID()}.webm`,
    );
    try {
      fs.writeFileSync(inPath, buffer);

      const ok = await new Promise<boolean>((resolve) => {
        const proc = spawnFfmpegRemux(inPath, outPath);
        const timer = setTimeout(() => {
          try {
            proc.kill();
          } catch {
            // process có thể đã thoát
          }
          resolve(false);
        }, RecordingSessionService.FFMPEG_REMUX_TIMEOUT_MS);
        proc.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve(code === 0);
        });
      });

      if (!ok || !fs.existsSync(outPath)) return buffer;
      const remuxed = fs.readFileSync(outPath);
      return remuxed.length > 0 ? remuxed : buffer;
    } catch {
      return buffer;
    } finally {
      try {
        fs.unlinkSync(inPath);
      } catch {
        // best-effort cleanup
      }
      try {
        fs.unlinkSync(outPath);
      } catch {
        // best-effort cleanup
      }
    }
  }

  /**
   * Chốt file recording → stopped: size + sha256 + duration + transaction
   * (INSERT media_files + UPDATE recording_session). Dùng chung bởi REC-003 (stopVideo)
   * và REC-004 reconcile. `recovered=true` thêm metadata recovered. Ném
   * InternalServerErrorException (RECORDING_STOP_FAILED) nếu transaction lỗi.
   */
  async finalizeFileToStopped(params: {
    sessionId: string;
    meetingId: string;
    storagePath: string;
    startedAt: Date;
    paused: number;
    userId: string | null;
    baseMetadata: Record<string, unknown>;
    recovered?: boolean;
  }): Promise<{
    stoppedAt: Date;
    durationSeconds: number;
    fileSizeBytes: string;
    mediaFileId: string;
  }> {
    const { sessionId, meetingId, storagePath, startedAt, paused, userId } =
      params;
    const stoppedAt = new Date();
    const wallClock = Math.max(
      0,
      Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000) - paused,
    );
    const fileSizeBytes = String(fs.statSync(storagePath).size);
    const checksum = await this.sha256Stream(storagePath);

    // REC-005: ffprobe best-effort → duration thật + metadata kỹ thuật; null → fallback wall-clock.
    const probe = await probeMedia(storagePath);
    const durationSeconds =
      probe?.durationSeconds && probe.durationSeconds > 0
        ? probe.durationSeconds
        : wallClock;

    // session metadata: giữ logic cũ (orphan_stop/recovered) — KHÔNG nhồi probe.
    const metadata = {
      ...params.baseMetadata,
      ...(params.recovered ? { recovered: true } : {}),
    };
    // media_files metadata: thêm probe (kỹ thuật) nếu ffprobe OK.
    const mediaMetadata = probe
      ? { ...metadata, probe: { ...probe, source: 'ffprobe' } }
      : metadata;
    const fileName = `${sessionId}.mp4`;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let mediaFileId: string;
    try {
      const insert = (await queryRunner.query(
        `INSERT INTO media_files
           (file_name, file_type, mime_type, storage_provider, storage_key,
            recording_session_id, meeting_id, uploaded_by,
            file_size_bytes, checksum, duration_seconds, metadata_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          fileName,
          'video',
          'video/mp4',
          'local',
          storagePath,
          sessionId,
          meetingId,
          userId,
          fileSizeBytes,
          checksum,
          durationSeconds,
          JSON.stringify(mediaMetadata),
        ],
      )) as Array<{ id: string }>;
      mediaFileId = insert[0].id;

      await queryRunner.query(
        `UPDATE recording_sessions
         SET status = $1, stopped_at = $2, stopped_by = $3,
             file_size_bytes = $4, duration_seconds = $5, checksum = $6,
             metadata_json = $7
         WHERE id = $8`,
        [
          RecordingSessionStatus.STOPPED,
          stoppedAt,
          userId,
          fileSizeBytes,
          durationSeconds,
          checksum,
          JSON.stringify(metadata),
          sessionId,
        ],
      );

      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `finalize failed for session ${sessionId}: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      throw new InternalServerErrorException({
        code: 'RECORDING_STOP_FAILED',
        message: 'Failed to finalize recording.',
      });
    } finally {
      await queryRunner.release();
    }

    return { stoppedAt, durationSeconds, fileSizeBytes, mediaFileId };
  }

  /**
   * REC-004 Phần A — đọc trạng thái phiên ghi (READ-ONLY, không đụng tiến trình/DB).
   * Live (recording & stopped_at null) → duration wall-clock + fs.stat size hiện tại.
   */
  async getStatus(
    meetingId: string,
    sessionId: string,
  ): Promise<{
    recordingSessionId: string;
    meetingId: string;
    sessionType: string;
    status: string;
    startedAt: string | Date;
    stoppedAt: string | Date | null;
    live: boolean;
    durationSeconds: number | null;
    fileSizeBytes: string | null;
    hasProcessHandle: boolean;
    errorMessage: string | null;
    captured: boolean;
  }> {
    const rows: Array<{
      id: string;
      meeting_id: string;
      session_type: string;
      status: string;
      started_at: string | Date;
      stopped_at: string | Date | null;
      paused_duration_seconds: number | null;
      storage_path: string | null;
      file_size_bytes: string | null;
      duration_seconds: number | null;
      error_message: string | null;
    }> = await this.dataSource.manager.query(
      `SELECT id, meeting_id, session_type, status, started_at, stopped_at,
              paused_duration_seconds, storage_path, file_size_bytes, duration_seconds,
              error_message
       FROM recording_sessions WHERE id = $1`,
      [sessionId],
    );
    const s = rows?.[0];
    if (!s || s.meeting_id !== meetingId) {
      throw new NotFoundException({
        code: 'RECORDING_SESSION_NOT_FOUND',
        message: 'Recording session not found.',
      });
    }

    const live =
      (s.status as RecordingSessionStatus) ===
        RecordingSessionStatus.RECORDING && s.stopped_at == null;

    let durationSeconds: number | null;
    let fileSizeBytes: string | null;
    if (live) {
      const startedAt = new Date(s.started_at);
      const paused = s.paused_duration_seconds ?? 0;
      durationSeconds = Math.max(
        0,
        Math.floor((Date.now() - startedAt.getTime()) / 1000) - paused,
      );
      fileSizeBytes =
        s.storage_path && fs.existsSync(s.storage_path)
          ? String(fs.statSync(s.storage_path).size)
          : null;
    } else {
      durationSeconds = s.duration_seconds ?? null;
      fileSizeBytes = s.file_size_bytes ?? null;
    }

    // REC-007: captured = đã ghi được byte? (live: file hiện>0; else: file_size_bytes>0).
    const captured = Number(fileSizeBytes ?? 0) > 0;

    return {
      recordingSessionId: s.id,
      meetingId: s.meeting_id,
      sessionType: s.session_type,
      status: s.status,
      startedAt: s.started_at,
      stoppedAt: s.stopped_at ?? null,
      live,
      durationSeconds,
      fileSizeBytes,
      hasProcessHandle: this.processManager.has(sessionId),
      errorMessage: s.error_message ?? null,
      captured,
    };
  }

  /** sha256 hex của file qua stream (không nạp toàn file vào RAM). */
  private sha256Stream(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
  }

  /** rtsp://[user[:pass]@]host:port/path — chỉ dùng nội bộ, không log. */
  private buildRtspUrl(cfg: RtspConfig): string {
    const protocol = cfg.rtsp_protocol || 'rtsp';
    const port = cfg.rtsp_port || 554;
    let auth = '';
    if (cfg.rtsp_username) {
      let pass = '';
      if (cfg.rtsp_password_encrypted) {
        try {
          pass = `:${encodeURIComponent(decryptSecret(cfg.rtsp_password_encrypted))}`;
        } catch {
          // KHÔNG lộ chi tiết giải mã; coi như cấu hình lỗi.
          throw new InternalServerErrorException({
            code: 'RECORDING_START_FAILED',
            message: 'Failed to prepare camera credential.',
          });
        }
      }
      auth = `${encodeURIComponent(cfg.rtsp_username)}${pass}@`;
    }
    return `${protocol}://${auth}${cfg.rtsp_host as string}:${port}${cfg.rtsp_path as string}`;
  }
}
