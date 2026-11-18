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
interface MeetingRow {
  id: string;
}
interface ParticipantRow {
  user_id: string;
}
interface IvssMappingRow {
  id: string;
  user_id: string;
  device_person_id: string | null;
  device_person_code: string | null;
}

type EnrollResult = 'enrolled' | 'noop' | 'skipped' | 'failed';

const BRIDGE_DEVICE_CODE = 'IVSS-BRIDGE';
const BRIDGE_DEVICE_TYPE = 'ivss_bridge';

/**
 * IvssPersonSyncService (IPS-001 #37) — enroll attendee per-meeting vào IVSS group qua bridge,
 * lưu mapping (device_user_mappings, source='ivss'), gỡ sau họp. Enroll-once-while-active (OQ-6).
 *
 * C1 isolation: MỌI query lọc device_id=<bridge> AND metadata.source='ivss' (FMP đã patch loại trừ ivss).
 * C3: personUid = sha256(userId)[:32] stable; szUid IVSS trả lưu device_person_id; deleteFace theo personUid (device_person_code).
 * OQ-5 best-effort: bridge ok:false → mapping 'failed' + last_sync_error, KHÔNG throw, KHÔNG fail họp.
 * ARCH-01 qua port IVSS_BRIDGE. SEC-01 KHÔNG log base64/token. SEC-03 bind tham số (mirror FMP).
 */
@Injectable()
export class IvssPersonSyncService {
  private readonly logger = new Logger(IvssPersonSyncService.name);
  private bridgeDeviceId: string | null = null;
  private groupEnsured = false;

  constructor(
    @Inject(IVSS_BRIDGE) private readonly bridge: IvssBridgePort,
    private readonly faceProfileService: FaceProfileService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  private get groupId(): string {
    return this.configService.get<string>('IVSS_DEFAULT_GROUP', '');
  }

  /** C3: personUid stable per-user (KHÔNG gắn meeting). */
  private personUidOf(userId: string): string {
    return createHash('sha256').update(userId).digest('hex').slice(0, 32);
  }

  /** find-or-create bridge iot_devices row (data seed, no-migration). */
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
        [BRIDGE_DEVICE_CODE, 'IVSS Bridge (person sync)', BRIDGE_DEVICE_TYPE],
      );
      this.bridgeDeviceId = ins[0]?.id ?? null;
      return this.bridgeDeviceId;
    } catch (e) {
      this.logger.error(`resolve IVSS bridge device failed: ${this.msg(e)}`);
      return null;
    }
  }

  /**
   * Nợ #1: KHÔNG gọi bridge.createGroup. Group đích được tạo THỦ CÔNG sẵn trong IVSS.
   * Bridge createGroup KHÔNG idempotent → gọi lại mỗi lần service khởi động sẽ đẻ
   * group trùng tên. enrollAttendee enroll thẳng vào `groupId`, không phụ thuộc bước này.
   */
  private ensureGroup(): Promise<void> {
    // KHÔNG `async`: thân hàm không còn await nào sau khi bỏ createGroup
    // (eslint require-await). Vẫn trả Promise để nơi gọi giữ nguyên `await`.
    if (this.groupEnsured) return Promise.resolve();
    this.groupEnsured = true;
    return Promise.resolve();
  }

  // ── PROVISION ──────────────────────────────────────────────────────────
  async provisionUpcoming(): Promise<{
    scanned: number;
    enrolled: number;
    skipped: number;
    failed: number;
  }> {
    const deviceId = await this.resolveBridgeDeviceId();
    if (!deviceId) {
      this.logger.warn('IVSS bridge device chưa sẵn — skip provision.');
      return { scanned: 0, enrolled: 0, skipped: 0, failed: 0 };
    }
    if (!this.groupId) {
      this.logger.warn('IVSS_DEFAULT_GROUP rỗng — skip provision.');
      return { scanned: 0, enrolled: 0, skipped: 0, failed: 0 };
    }
    await this.ensureGroup();

    const lead = this.configService.get<number>('IVSS_SYNC_LEAD_MINUTES', 5);
    const meetings: MeetingRow[] = await this.dataSource.manager.query(
      `SELECT id FROM meetings
       WHERE room_id IS NOT NULL AND status IN ('scheduled','in_progress')
         AND start_time <= now() + ($1 * interval '1 minute')
         AND end_time > now()`,
      [lead],
    );

    let enrolled = 0;
    let skipped = 0;
    let failed = 0;
    for (const m of meetings) {
      const participants: ParticipantRow[] =
        await this.dataSource.manager.query(
          `SELECT user_id FROM meeting_participants WHERE meeting_id = $1`,
          [m.id],
        );
      for (const p of participants) {
        try {
          const r = await this.enrollAttendee(deviceId, p.user_id, m.id);
          if (r === 'enrolled') enrolled++;
          else if (r === 'failed') failed++;
          else skipped++; // noop | skipped
        } catch (e) {
          failed++;
          this.logger.error(
            `IVSS enroll user ${p.user_id} (meeting ${m.id}) failed: ${this.msg(e)}`,
          );
        }
      }
    }
    return { scanned: meetings.length, enrolled, skipped, failed };
  }

  private async enrollAttendee(
    deviceId: string,
    userId: string,
    meetingId: string,
  ): Promise<EnrollResult> {
    // Dedupe OQ-6: live synced mapping (bridge, user, source=ivss) → noop.
    const live: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM device_user_mappings
       WHERE device_id = $1 AND user_id = $2 AND deleted_at IS NULL
         AND sync_status = 'synced' AND metadata_json->>'source' = 'ivss'
       LIMIT 1`,
      [deviceId, userId],
    );
    if (live[0]) return 'noop';

    const bytes = await this.faceProfileService.getPortraitBytes(userId);
    if (!bytes) {
      // OQ-7: thiếu ảnh → skip + log, KHÔNG chặn họp.
      this.logger.warn(`No portrait for user ${userId} — skip IVSS enroll.`);
      return 'skipped';
    }

    const personUid = this.personUidOf(userId);

    // Nợ #2: enroll idempotent — xóa person cũ trên IVSS trước khi enroll mới,
    // tránh 1 user nhiều szUID khi mapping cũ ở trạng thái failed hoặc DB lệch IVSS.
    // Chỉ chạy khi đã qua dedupe ở trên (mapping KHÔNG phải synced-sạch).
    // deleteFace theo device_person_id (UID thiết bị tự sinh) — đối chiếu
    // sep490_ams_be delFaceRecognitionDB (dòng 613-639, production). KHÔNG
    // đổi thành device_person_code.
    const stale: { device_person_id: string }[] =
      await this.dataSource.manager.query(
        `SELECT device_person_id FROM device_user_mappings
         WHERE device_id = $1 AND user_id = $2
           AND metadata_json->>'source' = 'ivss'
           AND device_person_id IS NOT NULL AND deleted_at IS NULL`,
        [deviceId, userId],
      );
    for (const s of stale) {
      try {
        await this.bridge.deleteFace({
          groupId: this.groupId,
          personUid: s.device_person_id,
        });
      } catch (e) {
        this.logger.warn(
          `IVSS cleanup stale person ${s.device_person_id} failed: ${this.msg(e)} — tiếp tục enroll.`,
        );
      }
    }

    const r = await this.bridge.enrollFace({
      groupId: this.groupId,
      personUid,
      imageBase64: bytes.toString('base64'),
    });
    if (!r.ok) {
      // OQ-5: best-effort — mapping failed, để cron tick sau retry. KHÔNG throw.
      await this.upsertMapping({
        deviceId,
        userId,
        szUid: null,
        personUid,
        meetingId,
        status: 'failed',
        error: r.error.code,
      });
      this.logger.warn(
        `IVSS enrollFace failed (${r.error.code}) user ${userId} — mapping failed (retry).`,
      );
      return 'failed';
    }
    // C3: szUid IVSS trả → device_person_id (event #38–40 mang szUid này).
    const szUid = this.extractSzUid(r.data) ?? personUid;
    await this.upsertMapping({
      deviceId,
      userId,
      szUid,
      personUid,
      meetingId,
      status: 'synced',
      error: null,
    });
    return 'enrolled';
  }

  // ── CLEANUP (enroll-once-while-active, OQ-6) ─────────────────────────────
  async cleanupEnded(): Promise<{
    scanned: number;
    removed: number;
    failed: number;
  }> {
    const deviceId = await this.resolveBridgeDeviceId();
    if (!deviceId) return { scanned: 0, removed: 0, failed: 0 };
    const grace = this.configService.get<number>('IVSS_SYNC_GRACE_MINUTES', 5);

    // IVSS mapping sống mà user KHÔNG còn họp active/upcoming.
    const maps: IvssMappingRow[] = await this.dataSource.manager.query(
      `SELECT mp.id, mp.user_id, mp.device_person_id, mp.device_person_code
       FROM device_user_mappings mp
       WHERE mp.device_id = $1 AND mp.deleted_at IS NULL
         AND mp.metadata_json->>'source' = 'ivss'
         AND NOT EXISTS (
           SELECT 1 FROM meeting_participants jp
           JOIN meetings me ON me.id = jp.meeting_id
           WHERE jp.user_id = mp.user_id
             AND me.status IN ('scheduled','in_progress')
             AND me.end_time > now() - ($2 * interval '1 minute')
         )
       LIMIT 500`,
      [deviceId, grace],
    );

    let removed = 0;
    let failed = 0;
    for (const mp of maps) {
      try {
        // C3 (đính chính): deleteFace phải theo device_person_id (UID do THIẾT
        // BỊ tự sinh lúc enroll) — KHÔNG phải device_person_code (sha256 BE tự
        // tạo). Đối chiếu code THẬT sep490_ams_be, delFaceRecognitionDB dòng
        // 613-639 (đã chạy production). KHÔNG đổi lại thành device_person_code.
        const personUid = mp.device_person_id;
        if (personUid) {
          const r = await this.bridge.deleteFace({
            groupId: this.groupId,
            personUid,
          });
          if (!r.ok) {
            this.logger.warn(
              `IVSS deleteFace failed (${r.error.code}) mapping ${mp.id} — giữ lại retry.`,
            );
            failed++;
            continue;
          }
        }
        await this.dataSource.manager.query(
          `UPDATE device_user_mappings
           SET sync_status = 'deleted', deleted_at = now(), last_synced_at = now()
           WHERE id = $1`,
          [mp.id],
        );
        removed++;
      } catch (e) {
        failed++;
        this.logger.error(
          `IVSS cleanup mapping ${mp.id} failed: ${this.msg(e)}`,
        );
      }
    }
    return { scanned: maps.length, removed, failed };
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  /**
   * szUid field theo README bridge (owed). Quét top-level trước, rồi nested `.data`
   * (lồng MỘT cấp — bridge thật trả `{success, message, data:{szUid}}`).
   * Guard: chỉ nhận `.data` khi là object thật (null/string/array → bỏ qua).
   */
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

  /** Mirror FMP upsertMapping; source='ivss'; szUid→device_person_id, personUid→device_person_code. */
  private async upsertMapping(params: {
    deviceId: string;
    userId: string;
    szUid: string | null;
    personUid: string;
    meetingId: string;
    status: string;
    error: string | null;
  }): Promise<void> {
    const metadata = {
      source: 'ivss',
      groupId: this.groupId,
      lastMeetingId: params.meetingId,
    };
    const existing: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM device_user_mappings
       WHERE device_id = $1 AND user_id = $2 AND metadata_json->>'source' = 'ivss'
       LIMIT 1`,
      [params.deviceId, params.userId],
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
