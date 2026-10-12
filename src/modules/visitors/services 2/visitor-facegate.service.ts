import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { FaceProfileService } from '../../accounts/services/face-profile.service.js';
import { FaceDeviceProviderFactory } from '../../face-access/face-device-provider.factory.js';
import { VisitorDeviceSync } from './visitor-device-sync.js';

export type FaceGateProvisionResult = 'disabled' | 'ineligible' | 'no_device' | 'no_portrait' | 'slot_busy' | 'failed' | 'provisioned' | 'noop';

interface VisitRow { id: string; user_id: string; status: string; valid_from: Date; valid_to: Date }
interface DeviceRow { id: string; ip_address: string | null; metadata_json: Record<string, unknown> | null }
interface MappingRow { id: string; device_id: string; device_person_id: string | null; sync_status: string; metadata_json: Record<string, unknown> | null }

/** Khách được đẩy xuống thiết bị trước giờ bắt đầu hiệu lực tối đa chừng này phút. */
const LOOKAHEAD_MINUTES = 60;
const LIVE_STATUSES = ['approved', 'checked_in'];

/**
 * Khuôn mặt khách theo khu vực trên FaceGate (spec §8.2). Bật bằng `VISITOR_FACEGATE_ENABLED`.
 * Thiết bị = `iot_devices` kiểu `face_server` có `zone_id` thuộc các khu vực của lượt. Mapping dùng
 * `metadata_json.source='visitor'` (không có `bookingId`) nên cron họp không đụng tới. Không ném lỗi ra ngoài `syncVisit`.
 */
@Injectable()
export class VisitorFaceGateService extends VisitorDeviceSync {
  private readonly logger = new Logger(VisitorFaceGateService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly factory: FaceDeviceProviderFactory,
    private readonly faceProfiles: FaceProfileService,
  ) {
    super();
  }

  private get enabled(): boolean {
    const v = this.config.get<boolean | string>('VISITOR_FACEGATE_ENABLED', false);
    return v === true || v === 'true';
  }

  private unameOf(visitId: string): string {
    return createHash('sha256').update(`visitor:${visitId}`).digest('hex').slice(0, 32);
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : 'unknown';
  }

  private async loadVisit(visitId: string): Promise<VisitRow | null> {
    const rows: VisitRow[] = await this.dataSource.query(
      `SELECT v.id, vis.user_id, v.status, v.valid_from, v.valid_to
         FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id
        WHERE v.id = $1 AND v.deleted_at IS NULL`,
      [visitId],
    );
    return rows[0] ?? null;
  }

  private findDevices(visitId: string): Promise<DeviceRow[]> {
    return this.dataSource.query(
      `SELECT d.id, d.ip_address, d.metadata_json FROM iot_devices d
        WHERE d.device_type = 'face_server'
          AND d.zone_id IN (SELECT zone_id FROM visitor_visit_zones WHERE visit_id = $1)`,
      [visitId],
    );
  }

  async provision(visitId: string): Promise<FaceGateProvisionResult> {
    if (!this.enabled) return 'disabled';
    const visit = await this.loadVisit(visitId);
    if (!visit || !LIVE_STATUSES.includes(visit.status)) return 'ineligible';
    const devices = await this.findDevices(visitId);
    if (devices.length === 0) return 'no_device';

    const results: FaceGateProvisionResult[] = [];
    for (const device of devices) {
      try {
        results.push(await this.provisionOnDevice(visit, device));
      } catch (e) {
        this.logger.error(`FaceGate: đẩy khách lượt ${visitId} lên thiết bị ${device.id} lỗi: ${this.msg(e)}`);
        results.push('failed');
      }
    }
    for (const r of ['failed', 'no_portrait', 'slot_busy', 'provisioned'] as const) {
      if (results.includes(r)) return r;
    }
    return 'noop';
  }

  private async provisionOnDevice(visit: VisitRow, device: DeviceRow): Promise<FaceGateProvisionResult> {
    const uname = this.unameOf(visit.id);
    const slot: Array<{ id: string; sync_status: string; visit_id: string | null }> = await this.dataSource.query(
      `SELECT id, sync_status, metadata_json->>'visitId' AS visit_id FROM device_user_mappings
        WHERE device_id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [device.id, visit.user_id],
    );
    const live = slot[0];
    if (live && live.visit_id !== visit.id) {
      this.logger.warn(`FaceGate: slot thiết bị ${device.id} / khách ${visit.user_id} đang bận bởi lượt ${live.visit_id} — hoãn.`);
      return 'slot_busy';
    }
    if (live && live.sync_status === 'synced') return 'noop';

    const bytes = await this.faceProfiles.getPortraitBytes(visit.user_id);
    if (!bytes) {
      await this.upsertMapping(visit, device.id, uname, null, 'pending', 'no_portrait');
      return 'no_portrait';
    }
    try {
      const provider = this.factory.create({ ipAddress: device.ip_address, metadataJson: device.metadata_json });
      const ref = await provider.uploadFace(bytes);
      await provider.addPerson({ uname, faceRef: ref, validFrom: new Date(visit.valid_from), validTo: new Date(visit.valid_to) });
      const uid = await provider.findUidByName(uname);
      await this.upsertMapping(visit, device.id, uname, uid, uid ? 'synced' : 'failed', uid ? null : 'uid not found after addPerson');
      return uid ? 'provisioned' : 'failed';
    } catch (e) {
      await this.upsertMapping(visit, device.id, uname, null, 'failed', this.msg(e));
      return 'failed';
    }
  }

  async deprovision(visitId: string): Promise<void> {
    const maps: MappingRow[] = await this.dataSource.query(
      `SELECT id, device_id, device_person_id, sync_status, metadata_json FROM device_user_mappings
        WHERE metadata_json->>'source' = 'visitor' AND metadata_json->>'visitId' = $1 AND deleted_at IS NULL`,
      [visitId],
    );
    for (const mp of maps) {
      try {
        await this.removeMapping(mp);
      } catch (e) {
        this.logger.error(`FaceGate: gỡ mapping ${mp.id} (lượt ${visitId}) lỗi: ${this.msg(e)}`);
      }
    }
  }

  async reprovision(visitId: string): Promise<FaceGateProvisionResult> {
    await this.deprovision(visitId);
    return this.provision(visitId);
  }

  /** Sau mỗi thao tác đổi quyền ra vào. Không bao giờ ném lỗi. */
  async syncVisit(visitId: string): Promise<void> {
    try {
      if (!this.enabled || !/^[0-9a-f-]{36}$/i.test(visitId)) return;
      const visit = await this.loadVisit(visitId);
      if (!visit || !LIVE_STATUSES.includes(visit.status)) {
        await this.deprovision(visitId);
        return;
      }
      const maps: Array<{ metadata_json: { validFrom?: string; validTo?: string } | null }> = await this.dataSource.query(
        `SELECT metadata_json FROM device_user_mappings
          WHERE metadata_json->>'source' = 'visitor' AND metadata_json->>'visitId' = $1 AND deleted_at IS NULL`,
        [visitId],
      );
      const changed = maps.some((m) =>
        new Date(m.metadata_json?.validFrom ?? 0).getTime() !== new Date(visit.valid_from).getTime()
        || new Date(m.metadata_json?.validTo ?? 0).getTime() !== new Date(visit.valid_to).getTime());
      if (changed) {
        await this.reprovision(visitId);
      } else if (new Date(visit.valid_from).getTime() <= Date.now() + LOOKAHEAD_MINUTES * 60_000) {
        await this.provision(visitId);
      }
    } catch (e) {
      this.logger.warn(`Đồng bộ FaceGate lượt ${visitId} thất bại: ${this.msg(e)}`);
    }
  }

  /** Cron: gỡ mapping của lượt đã đóng, đẩy (lại) lượt sắp tới / đang hiệu lực. */
  async reconcile(): Promise<{ provisioned: number; removed: number }> {
    if (!this.enabled) return { provisioned: 0, removed: 0 };
    let removed = 0;
    let provisioned = 0;

    const stale: MappingRow[] = await this.dataSource.query(
      `SELECT mp.id, mp.device_id, mp.device_person_id, mp.sync_status, mp.metadata_json
         FROM device_user_mappings mp
         LEFT JOIN visitor_visits v ON v.id::text = mp.metadata_json->>'visitId' AND v.deleted_at IS NULL
        WHERE mp.deleted_at IS NULL AND mp.metadata_json->>'source' = 'visitor'
          AND (v.id IS NULL OR v.status NOT IN ('approved','checked_in'))
        LIMIT 500`,
    );
    for (const mp of stale) {
      try {
        await this.removeMapping(mp);
        removed++;
      } catch (e) {
        this.logger.error(`FaceGate reconcile: gỡ ${mp.id} lỗi: ${this.msg(e)}`);
      }
    }

    const due: Array<{ id: string }> = await this.dataSource.query(
      `SELECT v.id FROM visitor_visits v
        WHERE v.deleted_at IS NULL AND v.status IN ('approved','checked_in')
          AND v.valid_from <= now() + ($1 * interval '1 minute') AND v.valid_to > now()
          AND EXISTS (SELECT 1 FROM visitor_visit_zones z JOIN iot_devices d ON d.zone_id = z.zone_id AND d.device_type = 'face_server'
                       WHERE z.visit_id = v.id)
          AND NOT EXISTS (SELECT 1 FROM device_user_mappings mp
                           WHERE mp.deleted_at IS NULL AND mp.sync_status = 'synced'
                             AND mp.metadata_json->>'source' = 'visitor' AND mp.metadata_json->>'visitId' = v.id::text)
        ORDER BY v.valid_from LIMIT 200`,
      [LOOKAHEAD_MINUTES],
    );
    for (const v of due) {
      if ((await this.provision(v.id)) === 'provisioned') provisioned++;
    }
    return { provisioned, removed };
  }

  private async removeMapping(mp: MappingRow): Promise<void> {
    if (mp.device_person_id) {
      const rows: DeviceRow[] = await this.dataSource.query(
        `SELECT id, ip_address, metadata_json FROM iot_devices WHERE id = $1 LIMIT 1`,
        [mp.device_id],
      );
      if (rows[0]) {
        const provider = this.factory.create({ ipAddress: rows[0].ip_address, metadataJson: rows[0].metadata_json });
        await provider.deletePerson(mp.device_person_id);
      }
    }
    await this.dataSource.query(
      `UPDATE device_user_mappings SET sync_status = 'deleted', deleted_at = now(), last_synced_at = now() WHERE id = $1`,
      [mp.id],
    );
  }

  private async upsertMapping(visit: VisitRow, deviceId: string, uname: string, uid: string | null, status: string, error: string | null): Promise<void> {
    const metadata = JSON.stringify({ source: 'visitor', visitId: visit.id, validFrom: visit.valid_from, validTo: visit.valid_to });
    const synced = status === 'synced';
    const existing: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM device_user_mappings
        WHERE user_id = $1 AND device_id = $2 AND metadata_json->>'visitId' = $3 LIMIT 1`,
      [visit.user_id, deviceId, visit.id],
    );
    if (existing[0]) {
      await this.dataSource.query(
        `UPDATE device_user_mappings SET device_person_id = $2, device_person_code = $3, device_person_name = $3,
                face_registered = $4, sync_status = $5, last_synced_at = now(), last_sync_error = $6,
                registered_at = COALESCE(registered_at, $7), metadata_json = $8, deleted_at = NULL
          WHERE id = $1`,
        [existing[0].id, uid, uname, synced, status, error, synced ? new Date() : null, metadata],
      );
      return;
    }
    await this.dataSource.query(
      `INSERT INTO device_user_mappings (device_id, user_id, device_person_id, device_person_code, device_person_name,
              face_registered, sync_status, last_synced_at, last_sync_error, registered_at, metadata_json)
       VALUES ($1,$2,$3,$4,$4,$5,$6,now(),$7,$8,$9)`,
      [deviceId, visit.user_id, uid, uname, synced, status, error, synced ? new Date() : null, metadata],
    );
  }
}
