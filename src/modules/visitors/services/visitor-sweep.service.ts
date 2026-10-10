import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { returnedRows } from '../../../common/utils/pg-result.util.js';
import { FaceProfileService } from '../../accounts/services/face-profile.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { VisitorConfigService } from '../config/visitor-config.service.js';
import { shouldMarkExitUnrecorded } from '../domain/visit-state-machine.js';
import { VisitorDeviceSync } from './visitor-device-sync.js';
import { VisitorNotifier } from './visitor-notifier.service.js';

export interface SweepResult {
  skipped: boolean;
  expired: number;
  overstayNotified: number;
  overstayEscalated: number;
  exitUnrecorded: number;
}

interface OnSiteRow { id: string; status: 'checked_in' | 'must_leave'; valid_to: Date; revoked_at: Date | null }
interface NotifyRow { id: string; visit_code: string; host_user_id: string; full_name: string }

const LOCK_SECONDS = 55;

/**
 * Quét định kỳ của phân hệ Khách (VIS-BE-001 §9). Mỗi hàm lấy khóa Redis `visitor:cron:<tên>` (SET NX EX 55) để
 * nhiều tiến trình chỉ có một chạy; xong thì nhả khóa. Lỗi ở một lượt chỉ ghi nhật ký, không chặn lượt sau.
 * Mọi chuyển trạng thái dùng UPDATE có điều kiện `WHERE status = …` nên chạy lặp là an toàn.
 */
@Injectable()
export class VisitorSweepService {
  private readonly logger = new Logger(VisitorSweepService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly config: VisitorConfigService,
    private readonly notifier: VisitorNotifier,
    private readonly deviceSync: VisitorDeviceSync,
    private readonly faceProfiles: FaceProfileService,
  ) {}

  private async withLock<T>(name: string, run: () => Promise<T>): Promise<T | null> {
    const key = `visitor:cron:${name}`;
    const client = this.redis.getClient();
    const got = await client.set(key, '1', 'EX', LOCK_SECONDS, 'NX');
    if (got !== 'OK') return null;
    try {
      return await run();
    } finally {
      await client.del(key).catch(() => undefined);
    }
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : 'unknown';
  }

  private async sync(visitId: string): Promise<void> {
    try {
      await this.deviceSync.syncVisit(visitId);
    } catch (e) {
      this.logger.warn(`Đồng bộ thiết bị lượt ${visitId} thất bại: ${this.msg(e)}`);
    }
  }

  async runSweep(now: Date = new Date()): Promise<SweepResult> {
    const result = await this.withLock('sweep', async () => {
      const cfg = await this.config.get();
      const r: SweepResult = { skipped: false, expired: 0, overstayNotified: 0, overstayEscalated: 0, exitUnrecorded: 0 };
      r.expired = await this.expireApproved(now);
      r.exitUnrecorded = await this.markExitUnrecorded(now);
      const o = await this.overstay(now, cfg.overstayEscalateMinutes);
      r.overstayNotified = o.notified;
      r.overstayEscalated = o.escalated;
      return r;
    });
    return result ?? { skipped: true, expired: 0, overstayNotified: 0, overstayEscalated: 0, exitUnrecorded: 0 };
  }

  private async expireApproved(now: Date): Promise<number> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM visitor_visits WHERE status = 'approved' AND valid_to < $1 AND deleted_at IS NULL ORDER BY valid_to LIMIT 500`,
      [now],
    );
    let n = 0;
    for (const { id } of rows) {
      try {
        const done = await this.dataSource.transaction(async (m) => {
          const u = returnedRows(await m.query(
            `UPDATE visitor_visits SET status = 'expired', updated_at = now() WHERE id = $1 AND status = 'approved' RETURNING id`,
            [id],
          ));
          if (u.length === 0) return false;
          await m.query(`INSERT INTO visitor_visit_events (visit_id, event_type, event_time, note) VALUES ($1,'expired',$2,'Quá hạn hiệu lực, khách không đến')`, [id, now]);
          return true;
        });
        if (done) {
          n++;
          await this.sync(id);
        }
      } catch (e) {
        this.logger.error(`Hết hạn lượt ${id} lỗi: ${this.msg(e)}`);
      }
    }
    return n;
  }

  /** BR-V15: qua ngày mới (giờ VN) sau ngày hết hiệu lực — hoặc sau ngày bị thu hồi — mà chưa có giờ ra. */
  private async markExitUnrecorded(now: Date): Promise<number> {
    const rows: OnSiteRow[] = await this.dataSource.query(
      `SELECT id, status, valid_to, revoked_at FROM visitor_visits
        WHERE status IN ('checked_in','must_leave') AND deleted_at IS NULL
          AND COALESCE(CASE WHEN status = 'must_leave' THEN revoked_at END, valid_to) < $1
        ORDER BY valid_to LIMIT 500`,
      [now],
    );
    let n = 0;
    for (const row of rows) {
      const like = {
        status: row.status,
        visitor: { hasPhoto: false },
        access: { validFrom: '', validTo: new Date(row.valid_to).toISOString(), zoneIds: [] },
        revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
      };
      if (!shouldMarkExitUnrecorded(like, now)) continue;
      try {
        const done = await this.dataSource.transaction(async (m) => {
          const u = returnedRows(await m.query(
            `UPDATE visitor_visits SET status = 'exit_unrecorded', updated_at = now() WHERE id = $1 AND status = $2 RETURNING id`,
            [row.id, row.status],
          ));
          if (u.length === 0) return false;
          await m.query(`INSERT INTO visitor_visit_events (visit_id, event_type, event_time, note) VALUES ($1,'exit_unrecorded',$2,'Sang ngày mới vẫn chưa ghi nhận giờ ra')`, [row.id, now]);
          return true;
        });
        if (done) {
          n++;
          await this.sync(row.id);
        }
      } catch (e) {
        this.logger.error(`exit_unrecorded lượt ${row.id} lỗi: ${this.msg(e)}`);
      }
    }
    return n;
  }

  /** BR-V13: mức 1 (vừa quá giờ) báo người được gặp; mức 2 (quá `escalateMinutes`) báo bảo vệ. Mỗi mức đúng một lần. */
  private async overstay(now: Date, escalateMinutes: number): Promise<{ notified: number; escalated: number }> {
    const cols = `v.id, v.visit_code, v.host_user_id, vis.full_name`;
    const claim = async (id: string, column: 'overstay_notified_at' | 'overstay_escalated_at'): Promise<boolean> =>
      returnedRows(await this.dataSource.query(
        `UPDATE visitor_visits SET ${column} = $2, updated_at = now() WHERE id = $1 AND status = 'checked_in' AND ${column} IS NULL RETURNING id`,
        [id, now],
      )).length > 0;
    const asView = (r: NotifyRow) => ({ id: r.id, code: r.visit_code, hostId: r.host_user_id, visitor: { fullName: r.full_name } }) as never;

    let notified = 0;
    let escalated = 0;
    const level1: NotifyRow[] = await this.dataSource.query(
      `SELECT ${cols} FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id
        WHERE v.status = 'checked_in' AND v.deleted_at IS NULL AND v.valid_to < $1 AND v.overstay_notified_at IS NULL LIMIT 500`,
      [now],
    );
    for (const r of level1) {
      try {
        if (!(await claim(r.id, 'overstay_notified_at'))) continue;
        notified++;
        await this.notifier.notifyHost(asView(r), 'visitor_overstay', `${r.full_name} đã quá giờ được phép ở lại`);
        await this.dataSource.query(`INSERT INTO visitor_visit_events (visit_id, event_type, event_time, note) VALUES ($1,'host_notified',$2,'Báo quá giờ')`, [r.id, now]);
      } catch (e) {
        this.logger.error(`Quá giờ mức 1 lượt ${r.id} lỗi: ${this.msg(e)}`);
      }
    }
    const level2: NotifyRow[] = await this.dataSource.query(
      `SELECT ${cols} FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id
        WHERE v.status = 'checked_in' AND v.deleted_at IS NULL AND v.valid_to <= $1::timestamptz - ($2 * interval '1 minute')
          AND v.overstay_escalated_at IS NULL LIMIT 500`,
      [now, escalateMinutes],
    );
    for (const r of level2) {
      try {
        if (!(await claim(r.id, 'overstay_escalated_at'))) continue;
        escalated++;
        await this.notifier.alertSecurity(asView(r), 'visitor_overstay', null, `${r.full_name} quá giờ trên ${escalateMinutes} phút`);
        await this.dataSource.query(`INSERT INTO visitor_visit_events (visit_id, event_type, event_time, note) VALUES ($1,'security_notified',$2,'Báo bảo vệ khách quá giờ')`, [r.id, now]);
      } catch (e) {
        this.logger.error(`Quá giờ mức 2 lượt ${r.id} lỗi: ${this.msg(e)}`);
      }
    }
    return { notified, escalated };
  }

  /** Cron: đẩy lại / gỡ khuôn mặt theo trạng thái (IVSS: bật-tắt hồ sơ; FaceGate: mapping). */
  async runFaceReconcile(): Promise<{ skipped: boolean; synced: number }> {
    const r = await this.withLock('face-reconcile', async () => {
      const rows: Array<{ id: string }> = await this.dataSource.query(
        `SELECT v.id FROM visitor_visits v
          WHERE v.deleted_at IS NULL AND (
                v.status IN ('approved','checked_in','must_leave')
             OR (v.status IN ('checked_out','expired','cancelled','revoked','exit_unrecorded','rejected') AND v.updated_at > now() - interval '1 day'))
          ORDER BY v.updated_at DESC LIMIT 500`,
      );
      for (const { id } of rows) await this.sync(id);
      return rows.length;
    });
    return r === null ? { skipped: true, synced: 0 } : { skipped: false, synced: r };
  }

  /** BR-V19: sau `photoRetentionDays` kể từ lượt cuối kết thúc, xóa ảnh và hồ sơ khuôn mặt; lịch sử lượt vẫn giữ. */
  async runPhotoRetention(now: Date = new Date()): Promise<{ skipped: boolean; purged: number }> {
    const r = await this.withLock('photo-retention', async () => {
      const days = (await this.config.get()).photoRetentionDays;
      const cutoff = new Date(now.getTime() - days * 86_400_000);
      const rows: Array<{ visitor_id: string; user_id: string; photos: string[] | null }> = await this.dataSource.query(
        `SELECT vis.id AS visitor_id, vis.user_id,
                array_remove(array_agg(DISTINCT v.photo_file_id), NULL) AS photos
           FROM visitors vis
           JOIN visitor_visits v ON v.visitor_id = vis.id AND v.deleted_at IS NULL
          WHERE vis.deleted_at IS NULL
          GROUP BY vis.id, vis.user_id
         HAVING bool_and(v.status IN ('checked_out','rejected','cancelled','revoked','expired','exit_unrecorded'))
            AND max(COALESCE(v.check_out_at, v.revoked_at, v.valid_to)) < $1
            AND (count(v.photo_file_id) > 0
                 OR EXISTS (SELECT 1 FROM face_profiles fp WHERE fp.user_id = vis.user_id AND fp.deleted_at IS NULL))
          LIMIT 200`,
        [cutoff],
      );
      let purged = 0;
      for (const row of rows) {
        try {
          const photos = row.photos ?? [];
          await this.faceProfiles.deletePortrait(row.user_id, photos);
          await this.dataSource.query(`UPDATE visitor_visits SET photo_file_id = NULL, updated_at = now() WHERE visitor_id = $1 AND photo_file_id IS NOT NULL`, [row.visitor_id]);
          purged++;
        } catch (e) {
          this.logger.error(`Dọn ảnh khách ${row.visitor_id} lỗi: ${this.msg(e)}`);
        }
      }
      return purged;
    });
    return r === null ? { skipped: true, purged: 0 } : { skipped: false, purged: r };
  }
}
