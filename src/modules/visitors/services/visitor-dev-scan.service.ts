import { Injectable } from '@nestjs/common';
import { VisitorConfigService } from '../config/visitor-config.service.js';
import { evaluateGateAttempt, isOnSite } from '../domain/visit-state-machine.js';
import type { VisitView } from '../presenters/visit-view.presenter.js';
import { err, VisitService } from './visit.service.js';
import { VisitorGateService } from './visitor-gate.service.js';

export type DevScanScenario = 'normal' | 'low_score' | 'outside_window';
export interface DevScanInput { code: string; zoneId?: string | null; direction: 'in' | 'out'; scenario?: DevScanScenario }
export interface DevScanResult { outcome: string; reason: string | null; score: number | null; at: string; visit: VisitView }

const SCORES: Record<DevScanScenario, number> = { normal: 0.93, low_score: 0.71, outside_window: 0.93 };

/**
 * Giả lập camera cổng cho màn hình "Cổng" của FE (chỉ dev). Dựng đúng một `VisitorIvssFaceEvent` rồi đưa vào
 * `VisitorGateService` — cùng đường với sự kiện camera thật. Kết quả (`outcome`/`reason`) được tính bằng đúng
 * hàm domain mà service cổng dùng, nên khớp với những gì đã ghi vào lượt.
 */
@Injectable()
export class VisitorDevScanService {
  constructor(
    private readonly visits: VisitService,
    private readonly gate: VisitorGateService,
    private readonly config: VisitorConfigService,
  ) {}

  async scan(input: DevScanInput): Promise<DevScanResult> {
    if (process.env['NODE_ENV'] === 'production') throw err(404, 'NOT_FOUND', 'Không tìm thấy');
    const row = await this.visits.loadRowByCode(String(input.code ?? ''));
    if (!row) throw err(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lượt khách với mã này');

    const scenario: DevScanScenario = input.scenario ?? 'normal';
    const zoneId = input.zoneId ?? row.zones.find((z) => z.id)?.id ?? null;
    const now = new Date();

    if (input.direction === 'out') {
      if (!isOnSite({ status: row.status })) {
        return { outcome: 'access_denied', reason: 'not_on_site', score: null, at: now.toISOString(), visit: await this.visits.getView(row.id) };
      }
      await this.gate.onIvssFaceEvent({ userId: row.visitor_user_id, zoneId, direction: 'leave', eventTime: now, similarity: SCORES.normal, sourceEventId: null, deviceId: null });
      const view = await this.visits.getView(row.id);
      return { outcome: view.status === 'checked_out' ? 'checked_out' : 'access_denied', reason: view.status === 'checked_out' ? null : 'not_on_site', score: SCORES.normal, at: now.toISOString(), visit: view };
    }

    const score = SCORES[scenario] ?? SCORES.normal;
    const at = scenario === 'outside_window' ? new Date(new Date(row.valid_to).getTime() + 2 * 3_600_000) : now;
    const like = {
      status: row.status,
      visitor: { hasPhoto: row.photo_file_id !== null },
      access: { validFrom: new Date(row.valid_from).toISOString(), validTo: new Date(row.valid_to).toISOString(), zoneIds: row.zones.map((z) => z.id) },
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    };
    const { outcome, reason } = evaluateGateAttempt(like, { at, zoneId, score }, (await this.config.get()).faceMatchThreshold);
    await this.gate.onIvssFaceEvent({ userId: row.visitor_user_id, zoneId, direction: 'enter', eventTime: at, similarity: score, sourceEventId: null, deviceId: null });
    return { outcome, reason, score, at: now.toISOString(), visit: await this.visits.getView(row.id) };
  }
}
