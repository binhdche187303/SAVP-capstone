import { spawn } from 'node:child_process';
import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { StorageService } from '../storage/storage.service.js';
import { HgvisionCameraService } from './hgvision-camera.service.js';

/** related_entity_type của ảnh chụp camera trong media_files. */
export const SNAPSHOT_ENTITY = 'hgvision_camera_snapshot';
const SNAPSHOT_FOLDER = 'camera-snapshots';
const FFMPEG_TIMEOUT_MS = 15_000;
const MAX_LIST = 100;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Chạy ffmpeg lấy 1 khung hình PNG từ URL HLS; tách ra để test thay được. */
export type FrameGrabber = (url: string, timeoutMs: number) => Promise<Buffer>;
export const FRAME_GRABBER = Symbol('HGVISION_FRAME_GRABBER');

export interface CameraSnapshot {
  id: string;
  cameraName: string;
  zoneId: string | null;
  zoneName: string | null;
  capturedAt: string;
  capturedBy: string | null;
  capturedByName: string | null;
  fileName: string;
  sizeBytes: number;
  /** Path trên BE (đã gồm /api/v1) để tải ảnh, cần Bearer token. */
  fileUrl: string;
}

export const ffmpegFrameGrabber: FrameGrabber = (url, timeoutMs) =>
  new Promise((resolve, reject) => {
    const bin = process.env.FFMPEG_PATH || 'ffmpeg';
    const proc = spawn(
      bin,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-rw_timeout',
        String(timeoutMs * 1000),
        '-live_start_index',
        '-1',
        '-i',
        url,
        '-frames:v',
        '1',
        '-f',
        'image2pipe',
        '-c:v',
        'png',
        'pipe:1',
      ],
      { windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('FFMPEG_TIMEOUT'));
    }, timeoutMs);
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-500);
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
      else reject(new Error(`FFMPEG_EXIT_${code}: ${stderr.trim()}`));
    });
  });

const pad = (n: number) => String(n).padStart(2, '0');

/** <ten-camera-khong-dau>_<YYYYMMDD-HHmmss>.png — dùng cho tên file khi tải. */
export function snapshotFileName(cameraName: string, at: Date): string {
  const slug =
    String(cameraName || 'camera')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'camera';
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${slug}_${stamp}.png`;
}

interface SnapshotRow {
  id: string;
  file_name: string;
  file_size_bytes: string | null;
  storage_key: string;
  uploaded_by: string | null;
  uploaded_at: Date;
  metadata_json: {
    cameraName?: string;
    zoneId?: string | null;
    zoneName?: string | null;
  } | null;
  captured_by_name: string | null;
}

/**
 * Chụp ảnh màn hình camera ở BE: ffmpeg đọc playlist live của HGVision (cùng nguồn với proxy
 * xem trực tiếp), lấy 1 khung hình PNG, lưu vào storage + media_files để tra lại lịch sử.
 */
@Injectable()
export class HgvisionSnapshotService {
  private readonly logger = new Logger(HgvisionSnapshotService.name);

  constructor(
    private readonly cameras: HgvisionCameraService,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @Optional()
    @Inject(FRAME_GRABBER)
    private readonly grab: FrameGrabber = ffmpegFrameGrabber,
  ) {}

  async capture(
    cameraName: string,
    userId: string | null,
  ): Promise<CameraSnapshot> {
    const { upstream, online, zone } =
      await this.cameras.liveSource(cameraName);
    if (!online)
      throw new ConflictException({
        code: 'CAMERA_OFFLINE',
        message: 'Camera đang mất kết nối, không chụp được ảnh.',
      });

    const base = this.config
      .get<string>('HGVISION_BASE_URL', '')
      .replace(/\/+$/, '');
    let png: Buffer;
    try {
      png = await this.grab(`${base}${upstream}`, FFMPEG_TIMEOUT_MS);
    } catch (e) {
      this.logger.warn(
        `Chụp ảnh camera "${cameraName}" lỗi: ${String(e).replace(/\/\/[^@/\s]+@/g, '//***@')}`,
      );
      throw new BadGatewayException({
        code: 'SNAPSHOT_FAILED',
        message: 'Không lấy được khung hình từ camera. Thử lại sau vài giây.',
      });
    }
    if (
      png.length < PNG_SIGNATURE.length ||
      !png.subarray(0, 8).equals(PNG_SIGNATURE)
    ) {
      throw new BadGatewayException({
        code: 'SNAPSHOT_FAILED',
        message: 'Khung hình nhận được không hợp lệ.',
      });
    }

    const at = new Date();
    const fileName = snapshotFileName(cameraName, at);
    const saved = await this.storage.saveFile({
      buffer: png,
      originalName: fileName,
      folder: SNAPSHOT_FOLDER,
    });
    const metadata = {
      cameraName,
      zoneId: zone?.id ?? null,
      zoneName: zone?.name ?? null,
      capturedAt: at.toISOString(),
    };
    const [row]: { id: string }[] = await this.dataSource.query(
      `INSERT INTO media_files
         (file_name, file_type, mime_type, storage_provider, storage_key, file_size_bytes,
          related_entity_type, uploaded_by, visibility_level, is_active, uploaded_at, metadata_json)
       VALUES ($1, 'image', 'image/png', $2, $3, $4, $5, $6, 'internal', true, $7, $8::jsonb)
       RETURNING id`,
      [
        fileName,
        this.storage.getDriver() === 's3' ? 's3' : 'local',
        saved.storageKey,
        saved.sizeBytes,
        SNAPSHOT_ENTITY,
        userId,
        at,
        JSON.stringify(metadata),
      ],
    );
    const [snap] = await this.find({ id: row.id, limit: 1 });
    return snap;
  }

  list(q: { camera?: string; limit?: number }): Promise<CameraSnapshot[]> {
    return this.find({ camera: q.camera?.trim() || undefined, limit: q.limit });
  }

  async file(id: string): Promise<{
    stream: NodeJS.ReadableStream;
    fileName: string;
    sizeBytes: number;
  }> {
    const rows: SnapshotRow[] = await this.dataSource.query(
      `SELECT id, file_name, file_size_bytes, storage_key FROM media_files
        WHERE id = $1 AND related_entity_type = $2 AND is_active = true AND deleted_at IS NULL`,
      [id, SNAPSHOT_ENTITY],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('Không tìm thấy ảnh chụp.');
    return {
      stream: await this.storage.getObjectStream(r.storage_key),
      fileName: r.file_name,
      sizeBytes: Number(r.file_size_bytes ?? 0),
    };
  }

  private async find(q: {
    id?: string;
    camera?: string;
    limit?: number;
  }): Promise<CameraSnapshot[]> {
    const limit = Math.min(Math.max(Number(q.limit) || 20, 1), MAX_LIST);
    const rows: SnapshotRow[] = await this.dataSource.query(
      `SELECT m.id, m.file_name, m.file_size_bytes, m.storage_key, m.uploaded_by, m.uploaded_at,
              m.metadata_json, u.full_name AS captured_by_name
         FROM media_files m
         LEFT JOIN users u ON u.id = m.uploaded_by
        WHERE m.related_entity_type = $1 AND m.is_active = true AND m.deleted_at IS NULL
          AND ($2::uuid IS NULL OR m.id = $2::uuid)
          AND ($3::text IS NULL OR m.metadata_json->>'cameraName' = $3::text)
        ORDER BY m.uploaded_at DESC
        LIMIT $4`,
      [SNAPSHOT_ENTITY, q.id ?? null, q.camera ?? null, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      cameraName: r.metadata_json?.cameraName ?? '',
      zoneId: r.metadata_json?.zoneId ?? null,
      zoneName: r.metadata_json?.zoneName ?? null,
      capturedAt: new Date(r.uploaded_at).toISOString(),
      capturedBy: r.uploaded_by,
      capturedByName: r.captured_by_name,
      fileName: r.file_name,
      sizeBytes: Number(r.file_size_bytes ?? 0),
      fileUrl: `/api/v1/hgvision/snapshots/${r.id}/file`,
    }));
  }
}
