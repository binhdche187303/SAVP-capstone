import { createHash } from 'crypto';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { IVSS_BRIDGE } from '../ports/ivss-bridge.port.js';
import type { IvssBridgePort } from '../ports/ivss-bridge.port.js';
import { FaceProfileService } from '../../accounts/services/face-profile.service.js';

interface IdRow {
  id: string;
}
interface UserIdRow {
  user_id: string;
}
interface PortraitMappingRow {
  id: string;
  user_id: string;
  device_person_id: string | null;
  device_person_code: string | null;
}

export type PortraitEnrollResult = 'enrolled' | 'noop' | 'skipped' | 'failed';
export type PortraitRemoveResult = 'removed' | 'noop' | 'failed';

/**
 * ⚠ F2 — bridge device row RIÊNG cho portrait, KHÔNG dùng chung 'IVSS-BRIDGE' của
 * IvssPersonSyncService. Lý do: index `UQ_device_user_mappings_active`
 * (migration 20260721000007) = UNIQUE(device_id, user_id) WHERE deleted_at IS NULL.
 * Dùng chung device ⇒ user đang họp (mapping source='ivss') + được duyệt ảnh
 * (mapping source='portrait') sẽ vi phạm unique → INSERT 23505. Tách device row là
 * cách duy nhất giữ được "KHÔNG migration".
 */
const BRIDGE_DEVICE_CODE = 'IVSS-BRIDGE-PORTRAIT';
const BRIDGE_DEVICE_TYPE = 'ivss_bridge';
/** Phân biệt mapping portrait với 'ivss' (họp) và FMP (cửa) — mọi query PHẢI lọc theo cột này. */
const MAPPING_SOURCE = 'portrait';
const BATCH_LIMIT = 500;

/**
 * IvssPortraitSyncService (PORTRAIT-001 / UC-109+110) — kho mặt THƯỜNG TRỰC cho camera
 * hành lang/sân, enroll vào `IVSS_PORTRAIT_GROUP`. Đường SONG SONG, độc lập hoàn toàn
 * với IvssPersonSyncService (group `IVSS_DEFAULT_GROUP`, mặt bị xóa sau họp).
 *
 * Vòng đời: ảnh được DUYỆT (face_profiles.status='active') → enroll; account nghỉ/khoá
 * hoặc ảnh hết active → remove. Không gắn meeting.
 *
 * Điều khiển: CHỈ qua cron `reconcilePortraits()` (F1 — móc trực tiếp vào accounts sẽ
 * tạo vòng accounts→ivss→accounts vì IvssModule đã import AccountsModule; repo cấm
 * forwardRef). Trễ tối đa 1 chu kỳ cron, nghiệp vụ vẫn đúng.
 *
 * Isolation: MỌI query lọc `device_id=<portrait bridge>` AND `metadata_json->>'source'='portrait'`.
 * Best-effort toàn bộ: bridge fail → mapping 'failed' + last_sync_error, KHÔNG throw.
 * ARCH-01 qua port IVSS_BRIDGE. SEC-01 KHÔNG log base64. SEC-03 bind tham số.
 */
@Injectable()
export class IvssPortraitSyncService {
  private readonly logger = new Logger(IvssPortraitSyncService.name);
  private bridgeDeviceId: string | null = null;

  constructor(
    @Inject(IVSS_BRIDGE) private readonly bridge: IvssBridgePort,
    private readonly faceProfileService: FaceProfileService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  private get groupId(): string {
    return this.configService.get<string>('IVSS_PORTRAIT_GROUP', '');
  }

  /**
   * Lưới an toàn nền (phương án c, phần 1): mapping 'synced' quá cũ có thể đã
   * lệch szUID trên thiết bị (xóa/enroll lại tay ngoài BE — không track được).
   * TTL dài vì đây chỉ là fallback cuối, không phải cơ chế chính.
   */
  private get ttlDays(): number {
    return this.configService.get<number>('IVSS_PORTRAIT_TTL_DAYS', 21);
  }

  /**
   * personUid stable per-user. Clone hàm của IvssPersonSyncService (KHÔNG import private).
   * Trùng giá trị với group họp là VÔ HẠI: deleteFace/enrollFace đều scope theo groupId.
   */
  private personUidOf(userId: string): string {
    return createHash('sha256').update(userId).digest('hex').slice(0, 32);
  }

  /** find-or-create bridge device row cho portrait (data seed, no-migration). */
  private async resolveBridgeDeviceId(): Promise<string | null> {
    if (this.bridgeDeviceId) return this.bridgeDeviceId;
    const found: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM iot_devices WHERE device_code = $1 AND device_type = $2 LIMIT 1`,
      [BRIDGE_DEVICE_CODE, BRIDGE_DEVICE_TYPE],
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
          BRIDGE_DEVICE_CODE,
          'IVSS Bridge (portrait store)',
          BRIDGE_DEVICE_TYPE,
        ],
      );
      this.bridgeDeviceId = ins[0]?.id ?? null;
      return this.bridgeDeviceId;
    } catch (e) {
      this.logger.error(
        `resolve portrait bridge device failed: ${this.msg(e)}`,
      );
      return null;
    }
  }

  // ── ENROLL ────────────────────────────────────────────────────────────────
  /** Đẩy chân dung 1 user vào portrait group. Best-effort, KHÔNG throw. */
  async enrollPortrait(userId: string): Promise<PortraitEnrollResult> {
    if (!this.groupId) {
      this.logger.warn('IVSS_PORTRAIT_GROUP rỗng — skip enroll portrait.');
      return 'skipped';
    }
    const deviceId = await this.resolveBridgeDeviceId();
    if (!deviceId) return 'failed';

    // Dedupe: mapping portrait đã synced-sạch → noop.
    const live: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM device_user_mappings
       WHERE device_id = $1 AND user_id = $2 AND deleted_at IS NULL
         AND sync_status = 'synced' AND metadata_json->>'source' = $3
       LIMIT 1`,
      [deviceId, userId, MAPPING_SOURCE],
    );
    if (live[0]) return 'noop';

    const bytes = await this.faceProfileService.getPortraitBytes(userId);
    if (!bytes) {
      // Thiếu ảnh duyệt → skip + log, KHÔNG chặn gì.
      this.logger.warn(
        `No approved portrait for user ${userId} — skip portrait enroll.`,
      );
      return 'skipped';
    }

    const personUid = this.personUidOf(userId);

    // Idempotent (clone "Nợ #2" của person-sync): xóa person cũ trên portrait group
    // trước khi enroll, tránh 1 user nhiều szUID khi mapping cũ 'failed' hoặc DB lệch IVSS.
    // deleteFace theo device_person_id (UID thiết bị tự sinh) — đối chiếu
    // sep490_ams_be delFaceRecognitionDB (dòng 613-639, production). KHÔNG
    // đổi thành device_person_code.
    const stale: Array<{ device_person_id: string }> =
      await this.dataSource.manager.query(
        `SELECT device_person_id FROM device_user_mappings
         WHERE device_id = $1 AND user_id = $2
           AND metadata_json->>'source' = $3
           AND device_person_id IS NOT NULL AND deleted_at IS NULL`,
        [deviceId, userId, MAPPING_SOURCE],
      );
    for (const s of stale) {
      try {
        await this.bridge.deleteFace({
          groupId: this.groupId,
          personUid: s.device_person_id,
        });
      } catch (e) {
        this.logger.warn(
          `Portrait cleanup stale person ${s.device_person_id} failed: ${this.msg(e)} — tiếp tục enroll.`,
        );
      }
    }

    const r = await this.bridge.enrollFace({
      groupId: this.groupId,
      personUid,
      imageBase64: bytes.toString('base64'),
    });
    if (!r.ok) {
      await this.upsertMapping({
        deviceId,
        userId,
        szUid: null,
        personUid,
        status: 'failed',
        error: r.error.code,
      });
      this.logger.warn(
        `Portrait enrollFace failed (${r.error.code}) user ${userId} — mapping failed (cron retry).`,
      );
      return 'failed';
    }
    const szUid = this.extractSzUid(r.data) ?? personUid;
    await this.upsertMapping({
      deviceId,
      userId,
      szUid,
      personUid,
      status: 'synced',
      error: null,
    });
    return 'enrolled';
  }

  // ── FORCE RE-SYNC (phương án c, phần 2) ────────────────────────────────────
  /**
   * Admin force re-sync 1 user: hạ mapping portrait về 'pending' — KHÔNG tự
   * enroll ngay (tránh block HTTP response chờ SDK call). reconcilePortraits()
   * (cron) sẽ tự nhặt ở lượt tick kế tiếp, đi qua đúng enrollPortrait() đã có
   * (tự xóa device_person_id cũ trước khi enroll mới). Trả false nếu user
   * KHÔNG có mapping portrait nào (chưa từng enroll) — caller trả 404.
   */
  async resyncMapping(userId: string): Promise<boolean> {
    const deviceId = await this.resolveBridgeDeviceId();
    if (!deviceId) return false;

    const updated: IdRow[] = await this.dataSource.manager.query(
      `UPDATE device_user_mappings
          SET sync_status = 'pending',
              face_registered = false,
              last_sync_error = NULL,
              updated_at = now()
        WHERE device_id = $1
          AND user_id = $2
          AND deleted_at IS NULL
          AND metadata_json->>'source' = $3
        RETURNING id`,
      [deviceId, userId, MAPPING_SOURCE],
    );
    return updated.length > 0;
  }

  // ── REMOVE ────────────────────────────────────────────────────────────────
  /** Gỡ chân dung 1 user khỏi portrait group. Best-effort, KHÔNG throw. */
  async removePortrait(userId: string): Promise<PortraitRemoveResult> {
    const deviceId = await this.resolveBridgeDeviceId();
    if (!deviceId) return 'failed';

    const maps: PortraitMappingRow[] = await this.dataSource.manager.query(
      `SELECT id, user_id, device_person_id, device_person_code
       FROM device_user_mappings
       WHERE device_id = $1 AND user_id = $2 AND deleted_at IS NULL
         AND metadata_json->>'source' = $3
       LIMIT 1`,
      [deviceId, userId, MAPPING_SOURCE],
    );
    const mp = maps[0];
    if (!mp) return 'noop';
    return this.removeMapping(mp);
  }

  /** Dùng chung cho removePortrait + reconcile: xóa trên IVSS rồi soft-delete mapping. */
  private async removeMapping(
    mp: PortraitMappingRow,
  ): Promise<PortraitRemoveResult> {
    try {
      // deleteFace theo device_person_id (UID thiết bị tự sinh) — đối chiếu
      // sep490_ams_be delFaceRecognitionDB (dòng 613-639, production). Fallback
      // device_person_code chỉ dùng nếu mapping cũ chưa từng có device_person_id.
      const personUid = mp.device_person_id ?? mp.device_person_code;
      if (personUid && this.groupId) {
        const r = await this.bridge.deleteFace({
          groupId: this.groupId,
          personUid,
        });
        if (!r.ok) {
          // Giữ mapping để cron tick sau retry. KHÔNG throw.
          this.logger.warn(
            `Portrait deleteFace failed (${r.error.code}) mapping ${mp.id} — giữ lại retry.`,
          );
          return 'failed';
        }
      }
      await this.dataSource.manager.query(
        `UPDATE device_user_mappings
         SET sync_status = 'deleted', deleted_at = now(), last_synced_at = now()
         WHERE id = $1`,
        [mp.id],
      );
      return 'removed';
    } catch (e) {
      this.logger.error(
        `Portrait remove mapping ${mp.id} failed: ${this.msg(e)}`,
      );
      return 'failed';
    }
  }

  // ── RECONCILE (nguồn điều khiển duy nhất — F1) ────────────────────────────
  /**
   * Quét 2 chiều:
   *  - user có ảnh ACTIVE + account active mà chưa có mapping portrait synced → enroll
   *    (bao gồm luôn retry mapping đang 'failed', vì chúng không phải 'synced').
   *  - mapping portrait còn sống mà ảnh hết active / account inactive|locked|deleted → remove.
   */
  async reconcilePortraits(): Promise<{
    scanned: number;
    enrolled: number;
    removed: number;
    failed: number;
  }> {
    const deviceId = await this.resolveBridgeDeviceId();
    if (!deviceId) {
      this.logger.warn('Portrait bridge device chưa sẵn — skip reconcile.');
      return { scanned: 0, enrolled: 0, removed: 0, failed: 0 };
    }
    if (!this.groupId) {
      this.logger.warn('IVSS_PORTRAIT_GROUP rỗng — skip reconcile.');
      return { scanned: 0, enrolled: 0, removed: 0, failed: 0 };
    }

    let enrolled = 0;
    let removed = 0;
    let failed = 0;

    // (0) Lưới an toàn TTL (phương án c, phần 1): mapping 'synced' đã quá
    // ttlDays kể từ lần sync gần nhất → hạ về 'pending' để bước (1) bên dưới
    // tự nhặt lại (NOT EXISTS ... sync_status='synced' không còn khớp nữa).
    // Tái dùng ĐÚNG cơ chế đã có (xem admin-biometric-review.service.ts) —
    // KHÔNG tự enroll/xóa gì ở đây, chỉ đánh dấu để (1) xử lý.
    await this.dataSource.manager.query(
      `UPDATE device_user_mappings
          SET sync_status = 'pending',
              face_registered = false,
              last_sync_error = NULL,
              updated_at = now()
        WHERE device_id = $1
          AND deleted_at IS NULL
          AND sync_status = 'synced'
          AND metadata_json->>'source' = $2
          AND last_synced_at < now() - ($3::int * interval '1 day')`,
      [deviceId, MAPPING_SOURCE, this.ttlDays],
    );

    // (1) Cần enroll: ảnh đã duyệt + account active, chưa có mapping portrait synced.
    const toEnroll: UserIdRow[] = await this.dataSource.manager.query(
      `SELECT DISTINCT fp.user_id
       FROM face_profiles fp
       JOIN users u ON u.id = fp.user_id
       WHERE fp.status = 'active' AND fp.deleted_at IS NULL
         AND u.account_status = 'active' AND u.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM device_user_mappings mp
           WHERE mp.device_id = $1 AND mp.user_id = fp.user_id
             AND mp.deleted_at IS NULL AND mp.sync_status = 'synced'
             AND mp.metadata_json->>'source' = $2
         )
       LIMIT ${BATCH_LIMIT}`,
      [deviceId, MAPPING_SOURCE],
    );
    for (const row of toEnroll) {
      try {
        const r = await this.enrollPortrait(row.user_id);
        if (r === 'enrolled') enrolled++;
        else if (r === 'failed') failed++;
      } catch (e) {
        failed++;
        this.logger.error(
          `Portrait enroll user ${row.user_id} failed: ${this.msg(e)}`,
        );
      }
    }

    // (2) Cần remove: mapping portrait sống mà user không còn đủ điều kiện.
    const toRemove: PortraitMappingRow[] = await this.dataSource.manager.query(
      `SELECT mp.id, mp.user_id, mp.device_person_id, mp.device_person_code
       FROM device_user_mappings mp
       LEFT JOIN users u ON u.id = mp.user_id
       WHERE mp.device_id = $1 AND mp.deleted_at IS NULL
         AND mp.metadata_json->>'source' = $2
         AND (
           u.id IS NULL
           OR u.deleted_at IS NOT NULL
           OR u.account_status <> 'active'
           OR NOT EXISTS (
             SELECT 1 FROM face_profiles fp
             WHERE fp.user_id = mp.user_id
               AND fp.status = 'active' AND fp.deleted_at IS NULL
           )
         )
       LIMIT ${BATCH_LIMIT}`,
      [deviceId, MAPPING_SOURCE],
    );
    for (const mp of toRemove) {
      const r = await this.removeMapping(mp);
      if (r === 'removed') removed++;
      else if (r === 'failed') failed++;
    }

    return {
      scanned: toEnroll.length + toRemove.length,
      enrolled,
      removed,
      failed,
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  /** Clone extractSzUid của person-sync: quét top-level rồi nested `.data` (1 cấp). */
  private extractSzUid(data: unknown): string | null {
    const KEYS = ['szUid', 'personUid', 'uid', 'id'];
    const pick = (obj: Record<string, unknown>): string | null => {
      for (const k of KEYS) {
        const v = obj[k];
        if (typeof v === 'string' && v) return v;
      }
      return null;
    };
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const d = data as Record<string, unknown>;
      const top = pick(d);
      if (top) return top;
      const nested = d['data'];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return pick(nested as Record<string, unknown>);
      }
    }
    return null;
  }

  /** Mirror upsertMapping của person-sync; source='portrait', KHÔNG có lastMeetingId. */
  private async upsertMapping(params: {
    deviceId: string;
    userId: string;
    szUid: string | null;
    personUid: string;
    status: string;
    error: string | null;
  }): Promise<void> {
    const metadata = { source: MAPPING_SOURCE, groupId: this.groupId };
    const existing: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM device_user_mappings
       WHERE device_id = $1 AND user_id = $2 AND metadata_json->>'source' = $3
       LIMIT 1`,
      [params.deviceId, params.userId, MAPPING_SOURCE],
    );
    const synced = params.status === 'synced';
    if (existing[0]) {
      await this.dataSource.manager.query(
        `UPDATE device_user_mappings SET
           device_person_id = $2, device_person_code = $3, device_person_name = $3,
           face_registered = $4, sync_status = $5, last_synced_at = now(),
           last_sync_error = $6, registered_at = COALESCE(registered_at, $7),
           metadata_json = $8, deleted_at = NULL
         WHERE id = $1`,
        [
          existing[0].id,
          params.szUid,
          params.personUid,
          synced,
          params.status,
          params.error,
          synced ? new Date() : null,
          JSON.stringify(metadata),
        ],
      );
    } else {
      await this.dataSource.manager.query(
        `INSERT INTO device_user_mappings
           (device_id, user_id, device_person_id, device_person_code, device_person_name,
            face_registered, sync_status, last_synced_at, last_sync_error, registered_at, metadata_json)
         VALUES ($1,$2,$3,$4,$4,$5,$6,now(),$7,$8,$9)`,
        [
          params.deviceId,
          params.userId,
          params.szUid,
          params.personUid,
          synced,
          params.status,
          params.error,
          synced ? new Date() : null,
          JSON.stringify(metadata),
        ],
      );
    }
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : 'unknown';
  }
}
