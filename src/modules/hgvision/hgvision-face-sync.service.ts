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
  FaceEnrollmentHook,
  type FaceEnrollmentSyncHandler,
  type FaceImageChecker,
  type FaceImageInspection,
} from '../accounts/services/face-enrollment.hook.js';
import { FaceProfileService } from '../accounts/services/face-profile.service.js';
import { HGVISION_CLIENT } from './hgvision.constants.js';
import { HgvisionClient, HgvisionError } from './hgvision.client.js';

/** Thiết bị "cầu nối" để gắn mapping khuôn mặt HGVision (find-or-create, không migration). */
export const FACE_BRIDGE_DEVICE_CODE = 'HGVISION-FACE';
const FACE_BRIDGE_DEVICE_TYPE = 'hgvision_bridge';
export const FACE_MAPPING_SOURCE = 'hgvision';
const ERROR_MAX = 255;
const FIRST_RUN_DELAY_MS = 60_000;
const RECONCILE_BATCH = 50;

type IdRow = { id: string };
type MappingRow = {
  id: string;
  device_person_id: string | null;
  sync_status: string;
  profile_id: string | null;
};

/**
 * HgvisionFaceSyncService — khuôn mặt SAVP → HGVision (SAVP là gốc).
 *
 * - Kiểm tra ảnh đăng ký (lớp 2+3): `faces/search` trả số mặt + khớp định danh có sẵn.
 * - Đồng bộ: user có hồ sơ FaceID active → HGVision có định danh face_ident = mã NV/SV
 *   (thiếu mã → user id) với TẤT CẢ ảnh của hồ sơ; đổi bộ ảnh → xoá định danh rồi đăng ký lại;
 *   không còn hồ sơ active → xoá định danh (chỉ khi do SAVP tạo, tức có mapping).
 * - Mapping `device_user_mappings` (source 'hgvision', device_person_id = face_ident) để
 *   sự kiện nhận diện của HGVision tìm ra user.
 * - Cờ HGVISION_WRITE_ENABLED=false → không ghi HGVision, mapping 'pending'.
 * - Cron đối soát thử lại mapping pending/failed và user active chưa có mapping.
 * Chỉ bật khi CAMERA_PROVIDER=hgvision.
 */
@Injectable()
export class HgvisionFaceSyncService
  implements
    FaceImageChecker,
    FaceEnrollmentSyncHandler,
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger = new Logger(HgvisionFaceSyncService.name);
  private bridgeDeviceId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(HGVISION_CLIENT) private readonly client: HgvisionClient,
    private readonly hook: FaceEnrollmentHook,
    private readonly faceProfiles: FaceProfileService,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('CAMERA_PROVIDER', 'ivss') !== 'hgvision') {
      return;
    }
    this.hook.registerChecker(this);
    this.hook.registerSync(this);
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
    this.logger.log(
      `Đồng bộ khuôn mặt SAVP → HGVision: ${this.client.writeEnabled ? 'BẬT ghi' : 'cờ ghi TẮT (pending)'}, đối soát ${intervalMs}ms.`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
    this.timer = null;
    this.firstRun = null;
  }

  // ── Kiểm tra ảnh (lớp 2 + 3) ──────────────────────────────────────────────

  async inspect(image: Buffer, mimeType: string): Promise<FaceImageInspection> {
    return this.client.searchFace(
      { data: image, contentType: mimeType, filename: 'enroll.jpg' },
      3,
    );
  }

  async faceIdentOf(userId: string): Promise<string | null> {
    const rows: Array<{ employee_code: string | null }> =
      await this.dataSource.manager.query(
        `SELECT employee_code FROM users WHERE id = $1 LIMIT 1`,
        [userId],
      );
    if (!rows[0]) return null;
    return rows[0].employee_code?.trim() || userId;
  }

  // ── Đồng bộ 1 user ─────────────────────────────────────────────────────────

  async syncUser(userId: string): Promise<void> {
    const deviceId = await this.resolveBridgeDeviceId();
    if (!deviceId) return;

    const users: Array<{
      full_name: string;
      account_status: string;
      deleted_at: Date | null;
    }> = await this.dataSource.manager.query(
      `SELECT full_name, account_status, deleted_at FROM users WHERE id = $1`,
      [userId],
    );
    const user = users[0];
    const ident = await this.faceIdentOf(userId);
    const mapping = await this.findMapping(deviceId, userId);
    const usable =
      !!user && !user.deleted_at && user.account_status === 'active';
    const { profileId, images } = usable
      ? await this.faceProfiles.getActiveEnrollmentImages(userId)
      : { profileId: null, images: [] };

    // Không còn hồ sơ active → gỡ khỏi HGVision (chỉ định danh SAVP đã tạo).
    if (!profileId) {
      if (!mapping) return;
      if (!this.client.writeEnabled) {
        await this.updateMapping(mapping.id, 'pending', null);
        return;
      }
      try {
        await this.client.deleteFace(
          mapping.device_person_id ?? ident ?? userId,
        );
      } catch (e) {
        if (!isNotFound(e)) {
          await this.updateMapping(mapping.id, 'failed', this.msg(e));
          return;
        }
      }
      await this.dataSource.manager.query(
        `UPDATE device_user_mappings
            SET sync_status = 'deleted', deleted_at = now(), last_synced_at = now(), updated_at = now()
          WHERE id = $1`,
        [mapping.id],
      );
      return;
    }

    if (!ident) return;
    if (images.length === 0) {
      await this.upsertMapping(
        deviceId,
        userId,
        ident,
        user?.full_name ?? '',
        profileId,
        'failed',
        'Không tải được ảnh hồ sơ',
      );
      return;
    }
    if (!this.client.writeEnabled) {
      await this.upsertMapping(
        deviceId,
        userId,
        ident,
        user?.full_name ?? '',
        profileId,
        'pending',
        null,
      );
      return;
    }
    // Đã đồng bộ đúng hồ sơ này rồi → không làm gì.
    if (
      mapping &&
      mapping.sync_status === 'synced' &&
      mapping.profile_id === profileId &&
      mapping.device_person_id === ident
    ) {
      return;
    }

    try {
      // Thay bộ ảnh: xoá định danh cũ (cả ident cũ nếu mã NV/SV đã đổi) rồi đăng ký lại.
      const stale = new Set(
        [ident, mapping?.device_person_id].filter(Boolean) as string[],
      );
      for (const s of stale) {
        if (s !== ident && !mapping) continue;
        try {
          await this.client.deleteFace(s);
        } catch (e) {
          if (!isNotFound(e)) throw e;
        }
      }
      await this.client.registerFace({
        faceIdent: ident,
        faceInfor: user?.full_name ?? undefined,
        // Đăng ký lại không được xoá cờ danh sách đen do danh sách người giám sát đặt.
        isBlacklist: await this.isWatchlisted(userId),
        visibleTo: 'admin_only',
        // Ảnh đã qua cổng chất lượng ở máy người dùng + kiểm tra server.
        skipQualityCheck: true,
        images: images.map((img, i) => ({
          data: img.data,
          contentType: img.mimeType,
          filename: `${ident}-${i + 1}.jpg`,
        })),
      });
      await this.upsertMapping(
        deviceId,
        userId,
        ident,
        user?.full_name ?? '',
        profileId,
        'synced',
        null,
      );
    } catch (e) {
      this.logger.warn(
        `Đẩy khuôn mặt ${ident} sang HGVision lỗi: ${this.msg(e)}`,
      );
      await this.upsertMapping(
        deviceId,
        userId,
        ident,
        user?.full_name ?? '',
        profileId,
        'failed',
        this.msg(e),
      );
    }
  }

  // ── Đối soát định kỳ ───────────────────────────────────────────────────────

  /** Chạy từ timer: nuốt lỗi để không làm sập cả tiến trình BE. */
  private async safeReconcile(): Promise<void> {
    try {
      await this.reconcile();
    } catch (e) {
      this.logger.error(`Đối soát khuôn mặt HGVision lỗi: ${this.msg(e)}`);
    }
  }

  async reconcile(): Promise<{ checked: number }> {
    if (this.running) return { checked: 0 };
    this.running = true;
    try {
      const deviceId = await this.resolveBridgeDeviceId();
      if (!deviceId) return { checked: 0 };
      const rows: Array<{ user_id: string }> =
        await this.dataSource.manager.query(
          `SELECT DISTINCT user_id FROM (
           -- mapping chưa xong (pending/failed) hoặc lệch hồ sơ active
           SELECT m.user_id FROM device_user_mappings m
            WHERE m.device_id = $1 AND m.deleted_at IS NULL
              AND m.metadata_json->>'source' = $2
              AND (m.sync_status IN ('pending', 'failed')
                   OR NOT EXISTS (
                     SELECT 1 FROM face_profiles fp
                      WHERE fp.user_id = m.user_id AND fp.status = 'active'
                        AND fp.deleted_at IS NULL
                        AND fp.id::text = m.metadata_json->>'profileId'))
           UNION
           -- user có hồ sơ active (bộ quét nhiều ảnh, hoặc hồ sơ cũ vừa tự duyệt bằng
           -- migration 20261123000003) nhưng chưa có mapping
           SELECT fp.user_id FROM face_profiles fp
            WHERE fp.status = 'active' AND fp.deleted_at IS NULL
              AND (fp.sample_count > 1 OR fp.metadata_json ? 'legacyAutoApprovedAt')
              AND NOT EXISTS (
                SELECT 1 FROM device_user_mappings m
                 WHERE m.device_id = $1 AND m.user_id = fp.user_id
                   AND m.deleted_at IS NULL AND m.metadata_json->>'source' = $2)
         ) q LIMIT $3`,
          [deviceId, FACE_MAPPING_SOURCE, RECONCILE_BATCH],
        );
      for (const r of rows) {
        try {
          await this.syncUser(r.user_id);
        } catch (e) {
          this.logger.warn(
            `Đối soát khuôn mặt user ${r.user_id} lỗi: ${this.msg(e)}`,
          );
        }
      }
      return { checked: rows.length };
    } finally {
      this.running = false;
    }
  }

  // ── Mapping ────────────────────────────────────────────────────────────────

  /** User đang có hồ sơ giám sát active (chưa xoá) → khuôn mặt HGVision mang cờ danh sách đen. */
  private async isWatchlisted(userId: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.manager.query(
      `SELECT 1 FROM person_control_list
        WHERE user_id = $1 AND active = true AND deleted_at IS NULL LIMIT 1`,
      [userId],
    );
    return rows.length > 0;
  }

  private async findMapping(
    deviceId: string,
    userId: string,
  ): Promise<MappingRow | null> {
    const rows: MappingRow[] = await this.dataSource.manager.query(
      `SELECT id, device_person_id, sync_status, metadata_json->>'profileId' AS profile_id
         FROM device_user_mappings
        WHERE device_id = $1 AND user_id = $2 AND deleted_at IS NULL
          AND metadata_json->>'source' = $3
        LIMIT 1`,
      [deviceId, userId, FACE_MAPPING_SOURCE],
    );
    return rows[0] ?? null;
  }

  private async updateMapping(
    id: string,
    status: string,
    error: string | null,
  ): Promise<void> {
    await this.dataSource.manager.query(
      `UPDATE device_user_mappings
          SET sync_status = $2, last_sync_error = $3, last_synced_at = now(), updated_at = now()
        WHERE id = $1`,
      [id, status, error ? error.slice(0, ERROR_MAX) : null],
    );
  }

  private async upsertMapping(
    deviceId: string,
    userId: string,
    ident: string,
    name: string,
    profileId: string,
    status: 'synced' | 'pending' | 'failed',
    error: string | null,
  ): Promise<void> {
    const metadata = JSON.stringify({ source: FACE_MAPPING_SOURCE, profileId });
    const synced = status === 'synced';
    const err = error ? error.slice(0, ERROR_MAX) : null;
    const existing: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM device_user_mappings
        WHERE device_id = $1 AND user_id = $2 AND metadata_json->>'source' = $3
        ORDER BY deleted_at NULLS FIRST LIMIT 1`,
      [deviceId, userId, FACE_MAPPING_SOURCE],
    );
    if (existing[0]) {
      await this.dataSource.manager.query(
        `UPDATE device_user_mappings SET
           device_person_id = $2, device_person_code = $2, device_person_name = $3,
           face_registered = $4, sync_status = $5, last_synced_at = now(),
           last_sync_error = $6, registered_at = CASE WHEN $4 THEN now() ELSE registered_at END,
           metadata_json = $7, deleted_at = NULL, updated_at = now()
         WHERE id = $1`,
        [existing[0].id, ident, name, synced, status, err, metadata],
      );
      return;
    }
    await this.dataSource.manager.query(
      `INSERT INTO device_user_mappings
         (device_id, user_id, device_person_id, device_person_code, device_person_name,
          face_registered, sync_status, last_synced_at, last_sync_error, registered_at, metadata_json)
       VALUES ($1, $2, $3, $3, $4, $5, $6, now(), $7, CASE WHEN $5 THEN now() ELSE NULL END, $8)`,
      [deviceId, userId, ident, name, synced, status, err, metadata],
    );
  }

  private async resolveBridgeDeviceId(): Promise<string | null> {
    if (this.bridgeDeviceId) return this.bridgeDeviceId;
    const found: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM iot_devices WHERE device_code = $1 LIMIT 1`,
      [FACE_BRIDGE_DEVICE_CODE],
    );
    if (found[0]) {
      this.bridgeDeviceId = found[0].id;
      return this.bridgeDeviceId;
    }
    try {
      const ins: IdRow[] = await this.dataSource.manager.query(
        `INSERT INTO iot_devices (device_code, device_name, device_type, status, room_id)
         VALUES ($1, $2, $3, 'online', NULL) RETURNING id`,
        [
          FACE_BRIDGE_DEVICE_CODE,
          'HGVision (kho khuôn mặt)',
          FACE_BRIDGE_DEVICE_TYPE,
        ],
      );
      this.bridgeDeviceId = ins[0]?.id ?? null;
      return this.bridgeDeviceId;
    } catch (e) {
      this.logger.error(
        `Tạo thiết bị cầu nối khuôn mặt HGVision lỗi: ${this.msg(e)}`,
      );
      return null;
    }
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}

function isNotFound(e: unknown): boolean {
  return e instanceof HgvisionError && e.status === 404;
}
