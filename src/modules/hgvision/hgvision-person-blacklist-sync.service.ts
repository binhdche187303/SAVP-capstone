import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  PersonControlSyncHook,
  type PersonControlSyncHandler,
} from '../alerts/services/person-control-sync.hook.js';
import { StorageService } from '../storage/storage.service.js';
import { HGVISION_CLIENT } from './hgvision.constants.js';
import { HgvisionClient, HgvisionError } from './hgvision.client.js';
import { FACE_MAPPING_SOURCE } from './hgvision-face-sync.service.js';

/** Định danh khuôn mặt người ngoài (không tài khoản) do SAVP tạo trên HGVision. */
export const STRANGER_IDENT_PREFIX = 'WL-';
export const NO_FACE_MSG = 'Người này chưa có khuôn mặt trên HGVision';
const ERROR_MAX = 255;
const FIRST_RUN_DELAY_MS = 90_000;
const RECONCILE_BATCH = 50;

type EntryRow = {
  id: string;
  user_id: string | null;
  display_name: string;
  photo_media_file_id: string | null;
  active: boolean;
  deleted_at: Date | null;
  hgvision_face_ident: string | null;
  hgvision_synced_at: Date | null;
};

const isNotFound = (e: unknown) =>
  e instanceof HgvisionError && e.status === 404;

/**
 * HgvisionPersonBlacklistSyncService — danh sách người giám sát (cả watchlist lẫn
 * blocklist) → cờ "Danh sách đen" của HGVision. Mức cảnh báo vẫn ở SAVP.
 *
 * - Có tài khoản: bật/tắt cờ trên khuôn mặt đã đồng bộ (mapping source hgvision).
 *   Chưa có khuôn mặt → failed "chưa có khuôn mặt trên HGVision" (đối soát thử lại).
 *   Chỉ tắt khi KHÔNG còn hồ sơ active nào khác của cùng user.
 * - Người ngoài: đăng ký khuôn mặt mới `WL-<id>` từ ảnh (bật kiểm tra chất lượng),
 *   cờ danh sách đen. Tắt/xoá hồ sơ → xoá khuôn mặt đó.
 * - HGVISION_WRITE_ENABLED=false → pending. Cron đối soát thử lại pending/failed.
 */
@Injectable()
export class HgvisionPersonBlacklistSyncService
  implements PersonControlSyncHandler, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(HgvisionPersonBlacklistSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(HGVISION_CLIENT) private readonly client: HgvisionClient,
    private readonly hook: PersonControlSyncHook,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('CAMERA_PROVIDER', 'ivss') !== 'hgvision') {
      return;
    }
    this.hook.register(this);
    const intervalMs = Number(
      this.config.get('HGVISION_FACE_RECONCILE_INTERVAL_MS', 600_000),
    );
    if (Number.isFinite(intervalMs) && intervalMs > 0) {
      this.firstRun = setTimeout(
        () => void this.safeReconcile(),
        FIRST_RUN_DELAY_MS,
      );
      this.timer = setInterval(() => void this.safeReconcile(), intervalMs);
    }
  }

  onModuleDestroy(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
  }

  async syncPersonControl(entryId: string): Promise<void> {
    const rows: EntryRow[] = await this.dataSource.query(
      `SELECT id, user_id, display_name, photo_media_file_id, active, deleted_at,
              hgvision_face_ident, hgvision_synced_at
         FROM person_control_list WHERE id = $1`,
      [entryId],
    );
    const entry = rows[0];
    if (!entry) return;
    const desired = entry.active && !entry.deleted_at;

    if (!this.client.writeEnabled) {
      await this.mark(entry.id, 'pending', null, entry.hgvision_face_ident);
      return;
    }
    try {
      if (entry.user_id) await this.syncUserEntry(entry, desired);
      else await this.syncStrangerEntry(entry, desired);
    } catch (e) {
      const msg = this.msg(e);
      this.logger.warn(
        `Đẩy danh sách đen ${entry.id} sang HGVision lỗi: ${msg}`,
      );
      await this.mark(entry.id, 'failed', msg, entry.hgvision_face_ident);
    }
  }

  private async syncUserEntry(entry: EntryRow, desired: boolean) {
    const mapped: Array<{ ident: string }> = await this.dataSource.query(
      `SELECT device_person_id AS ident FROM device_user_mappings
        WHERE user_id = $1 AND deleted_at IS NULL AND sync_status = 'synced'
          AND metadata_json->>'source' = $2 AND device_person_id IS NOT NULL
        LIMIT 1`,
      [entry.user_id, FACE_MAPPING_SOURCE],
    );
    const ident = mapped[0]?.ident;
    if (!ident) {
      // Tắt/xoá mà chưa từng có khuôn mặt → không còn gì để gỡ.
      if (!desired) await this.mark(entry.id, null, null, null);
      else await this.mark(entry.id, 'failed', NO_FACE_MSG, null);
      return;
    }
    const others: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM person_control_list
        WHERE user_id = $1 AND id <> $2 AND active = true AND deleted_at IS NULL
        LIMIT 1`,
      [entry.user_id, entry.id],
    );
    await this.client.setFaceBlacklist(ident, desired || others.length > 0);
    await this.mark(entry.id, desired ? 'synced' : null, null, ident, true);
  }

  private async syncStrangerEntry(entry: EntryRow, desired: boolean) {
    const ident = `${STRANGER_IDENT_PREFIX}${entry.id}`;
    if (!desired) {
      if (entry.hgvision_face_ident) {
        try {
          await this.client.deleteFace(ident);
        } catch (e) {
          if (!isNotFound(e)) throw e;
        }
      }
      await this.mark(entry.id, null, null, null);
      return;
    }
    if (entry.hgvision_synced_at && entry.hgvision_face_ident === ident) return;
    if (!entry.photo_media_file_id) {
      await this.mark(
        entry.id,
        'failed',
        'Chưa có ảnh để đẩy sang HGVision',
        null,
      );
      return;
    }
    const files: Array<{ storage_key: string; mime_type: string | null }> =
      await this.dataSource.query(
        `SELECT storage_key, mime_type FROM media_files WHERE id = $1`,
        [entry.photo_media_file_id],
      );
    if (!files[0]) {
      await this.mark(entry.id, 'failed', 'Không tìm thấy ảnh của hồ sơ', null);
      return;
    }
    const data = await this.storage.downloadFile(files[0].storage_key);
    // Xoá bản cũ (lần trước đăng ký dở) rồi đăng ký lại.
    try {
      await this.client.deleteFace(ident);
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    const res = await this.client.registerFace({
      faceIdent: ident,
      faceInfor: entry.display_name,
      isBlacklist: true,
      visibleTo: 'admin_only',
      // Ảnh chụp từ camera — để HGVision kiểm tra chất lượng.
      skipQualityCheck: false,
      images: [
        {
          data,
          contentType: files[0].mime_type ?? 'image/jpeg',
          filename: `${ident}.jpg`,
        },
      ],
    });
    if (!res?.registered) {
      const detail = res?.message ? ` (${res.message})` : '';
      await this.mark(
        entry.id,
        'failed',
        `Chưa đẩy được sang HGVision: ảnh không đạt chất lượng${detail}`,
        null,
      );
      return;
    }
    await this.mark(entry.id, 'synced', null, ident, true);
  }

  private async safeReconcile(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.reconcile();
    } catch (e) {
      this.logger.warn(`Đối soát danh sách đen HGVision lỗi: ${this.msg(e)}`);
    } finally {
      this.running = false;
    }
  }

  /** Thử lại hồ sơ pending/failed (vd user vừa đăng ký khuôn mặt xong). */
  async reconcile(): Promise<{ checked: number }> {
    if (!this.client.writeEnabled) return { checked: 0 };
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM person_control_list
        WHERE hgvision_sync_status IN ('pending','failed')
        ORDER BY updated_at ASC LIMIT $1`,
      [RECONCILE_BATCH],
    );
    for (const r of rows) await this.syncPersonControl(r.id);
    return { checked: rows.length };
  }

  private async mark(
    id: string,
    status: string | null,
    error: string | null,
    ident: string | null,
    synced = false,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE person_control_list
          SET hgvision_sync_status = $2,
              hgvision_sync_error = $3,
              hgvision_face_ident = $4,
              hgvision_synced_at = CASE WHEN $5::boolean THEN now()
                                        WHEN $4::text IS NULL THEN NULL
                                        ELSE hgvision_synced_at END
        WHERE id = $1`,
      [id, status, error ? error.slice(0, ERROR_MAX) : null, ident, synced],
    );
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
