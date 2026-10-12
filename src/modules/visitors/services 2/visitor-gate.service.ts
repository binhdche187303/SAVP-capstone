import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { VisitorFaceEventHook, VisitorFaceGateVerify, VisitorIvssFaceEvent } from '../../../common/ports/visitor-face-event-hook.js';
import { GateAccessLogService } from '../../zones/services/gate-access-log.service.js';
import { VisitorConfigService } from '../config/visitor-config.service.js';
import { evaluateGateAttempt, isOnSite, type VisitLike } from '../domain/visit-state-machine.js';
import type { VisitRow } from '../presenters/visit-view.presenter.js';
import { VisitActionsService } from './visit-actions.service.js';
import { VisitService } from './visit.service.js';
import { VisitorNotifier } from './visitor-notifier.service.js';

const NEG_CACHE_MS = 60_000;
const CACHE_MAX = 5_000;
const THROTTLE_MS = 60_000;

const REASON_NOTES: Record<string, string> = {
  outside_window: 'Ngoài khung giờ được cấp',
  zone_not_allowed: 'Khu vực không được phép',
  access_revoked: 'Quyền ra vào đã bị thu hồi',
  low_score: 'Độ khớp khuôn mặt dưới ngưỡng',
  no_photo: 'Chưa có ảnh khuôn mặt',
};

/**
 * VisitorGateService — biến sự kiện nhận diện của camera/FaceGate thành check-in/out, nhật ký cổng và cảnh báo
 * cho khách (spec §8.2, §8.3). Triển khai VisitorFaceEventHook. KHÔNG BAO GIỜ ném lỗi ra ngoài.
 */
@Injectable()
export class VisitorGateService implements VisitorFaceEventHook {
  private readonly logger = new Logger(VisitorGateService.name);
  /** userId → visitorId | null. Kết quả âm (phần lớn lưu lượng là nhân sự) nhớ 60 giây để không tra DB mỗi sự kiện. */
  private readonly identityCache = new Map<string, { visitorId: string | null; at: number }>();
  private readonly throttle = new Map<string, number>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: VisitorConfigService,
    private readonly appConfig: ConfigService,
    private readonly visits: VisitService,
    private readonly actions: VisitActionsService,
    private readonly notifier: VisitorNotifier,
    private readonly gateLogs: GateAccessLogService,
  ) {}

  async onIvssFaceEvent(evt: VisitorIvssFaceEvent): Promise<void> {
    try {
      if (this.appConfig.get<boolean>('VISITORS_ENABLED', false) !== true) return;
      const visitorId = await this.visitorOf(evt.userId);
      if (!visitorId) return;
      const row = await this.activeVisit(visitorId, evt.eventTime);
      if (!row) return;
      await this.handle(row, evt);
    } catch (e) {
      this.logger.warn(`onIvssFaceEvent lỗi: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  /** FaceGate đã tự kiểm khung giờ/khu vực trên thiết bị; ở đây chỉ ghi nhận vào/ra. */
  async onFaceGateVerify(evt: VisitorFaceGateVerify): Promise<void> {
    try {
      if (this.appConfig.get<boolean>('VISITORS_ENABLED', false) !== true) return;
      const row = await this.visits.loadRow(evt.visitId);
      if (!row) return;
      const userId = row.visitor_user_id;
      if (evt.direction === 'out') {
        if (isOnSite({ status: row.status })) await this.checkOut(row, userId, evt.verifyTime, evt.zoneId, null, evt.deviceId);
        return;
      }
      if (row.status === 'approved') {
        const view = await this.actions.systemCheckIn(row.id, { at: evt.verifyTime, zoneId: evt.zoneId, score: null, deviceEventId: null });
        if (view && evt.zoneId) await this.writeGateLog(evt.zoneId, 'enter', evt.verifyTime, evt.deviceId, null, userId, row.id);
      }
    } catch (e) {
      this.logger.warn(`onFaceGateVerify lỗi: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  // ───────────── Nội bộ ─────────────

  private async handle(row: VisitRow, evt: VisitorIvssFaceEvent): Promise<void> {
    await this.actions.touchLastSeen(row.id, evt.eventTime, evt.zoneId);
    const zoneType = evt.zoneId ? await this.zoneType(evt.zoneId) : null;
    const like = this.like(row);
    const cfg = await this.config.get();

    if (zoneType === 'gate') {
      if (evt.direction === 'leave') {
        if (isOnSite(like)) await this.checkOut(row, row.visitor_user_id, evt.eventTime, evt.zoneId, evt.sourceEventId, evt.deviceId);
        return;
      }
      if (evt.direction === 'seen') return; // camera không phân biệt vào/ra: chỉ cập nhật "lần cuối thấy"
      const score = evt.similarity === null ? null : evt.similarity > 1 ? evt.similarity / 100 : evt.similarity;
      const { outcome, reason } = evaluateGateAttempt(like, { at: evt.eventTime, zoneId: evt.zoneId, score }, cfg.faceMatchThreshold);
      if (outcome === 'checked_in') {
        const view = await this.actions.systemCheckIn(row.id, { at: evt.eventTime, zoneId: evt.zoneId, score, deviceEventId: evt.sourceEventId });
        if (view && evt.zoneId) await this.writeGateLog(evt.zoneId, 'enter', evt.eventTime, evt.deviceId, evt.sourceEventId, row.visitor_user_id, row.id);
        return;
      }
      if (outcome === 'manual_review') {
        if (this.allow(row.id, reason ?? 'manual_review')) await this.actions.recordGateEvent(row.id, 'manual_review', { zoneId: evt.zoneId, score, note: REASON_NOTES[reason ?? ''] ?? null, deviceEventId: evt.sourceEventId, at: evt.eventTime });
        return;
      }
      if (reason === 'invalid_status' || reason === 'already_inside') return;
      await this.deny(row, reason as string, evt, score);
      return;
    }

    // Camera ở khu vực không phải cổng.
    if (row.status === 'must_leave') {
      await this.deny(row, 'access_revoked', evt, null);
      return;
    }
    if (row.status === 'checked_in' && evt.zoneId && !like.access.zoneIds.includes(evt.zoneId)) {
      await this.deny(row, 'zone_not_allowed', evt, null);
    }
  }

  private async deny(row: VisitRow, reason: string, evt: VisitorIvssFaceEvent, score: number | null): Promise<void> {
    if (!this.allow(row.id, reason)) return; // camera thấy khách liên tục: chỉ ghi/báo mỗi 60 giây một lần cho mỗi lý do
    await this.actions.recordGateEvent(row.id, 'access_denied', { zoneId: evt.zoneId, score, note: REASON_NOTES[reason] ?? reason, deviceEventId: evt.sourceEventId, at: evt.eventTime });
    const view = await this.visits.getView(row.id);
    const alertType = reason === 'access_revoked' ? 'visitor_must_leave' : 'visitor_zone_violation';
    await this.notifier.alertSecurity(view, alertType, evt.zoneId, REASON_NOTES[reason] ?? reason);
  }

  private async checkOut(row: VisitRow, userId: string, at: Date, zoneId: string | null, eventId: string | null, deviceId: string | null): Promise<void> {
    const view = await this.actions.systemCheckOut(row.id, { at, zoneId, deviceEventId: eventId });
    if (view && zoneId) await this.writeGateLog(zoneId, 'leave', at, deviceId, eventId, userId, row.id);
  }

  private async writeGateLog(zoneId: string, direction: 'enter' | 'leave', at: Date, deviceId: string | null, eventId: string | null, userId: string, visitId: string) {
    try {
      await this.gateLogs.writeGateLog({ zoneId, direction, accessTime: at, deviceId, eventId, userId, metadata: { source: 'visitor', visitId } });
    } catch (e) {
      this.logger.warn(`writeGateLog lỗi: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  private like(row: VisitRow): VisitLike {
    return {
      status: row.status,
      visitor: { hasPhoto: row.photo_file_id !== null },
      access: { validFrom: new Date(row.valid_from).toISOString(), validTo: new Date(row.valid_to).toISOString(), zoneIds: row.zones.map((z) => z.id) },
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    };
  }

  private allow(visitId: string, key: string): boolean {
    const now = Date.now();
    const k = `${visitId}:${key}`;
    const last = this.throttle.get(k);
    if (last !== undefined && now - last < THROTTLE_MS) return false;
    if (this.throttle.size > CACHE_MAX) for (const [kk, t] of this.throttle) if (now - t >= THROTTLE_MS) this.throttle.delete(kk);
    this.throttle.set(k, now);
    return true;
  }

  private async visitorOf(userId: string): Promise<string | null> {
    const now = Date.now();
    const hit = this.identityCache.get(userId);
    if (hit && (hit.visitorId !== null || now - hit.at < NEG_CACHE_MS)) return hit.visitorId;
    const rows: Array<{ id: string }> = await this.dataSource.query(`SELECT id FROM visitors WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1`, [userId]);
    const visitorId = rows[0]?.id ?? null;
    if (this.identityCache.size > CACHE_MAX) this.identityCache.clear();
    this.identityCache.set(userId, { visitorId, at: now });
    return visitorId;
  }

  /** Lượt đang hoạt động có khung hiệu lực chứa/gần `at` nhất. */
  private async activeVisit(visitorId: string, at: Date): Promise<VisitRow | null> {
    const ids: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM visitor_visits
        WHERE visitor_id = $1 AND deleted_at IS NULL AND status IN ('approved','checked_in','must_leave')
        ORDER BY (valid_from <= $2 AND valid_to >= $2) DESC, ABS(EXTRACT(EPOCH FROM (valid_from - $2::timestamptz))) LIMIT 1`,
      [visitorId, at],
    );
    return ids[0] ? this.visits.loadRow(ids[0].id) : null;
  }

  private async zoneType(zoneId: string): Promise<string | null> {
    const rows: Array<{ zone_type: string }> = await this.dataSource.query(`SELECT zone_type FROM zones WHERE id = $1 AND deleted_at IS NULL`, [zoneId]);
    return rows[0]?.zone_type ?? null;
  }
}
