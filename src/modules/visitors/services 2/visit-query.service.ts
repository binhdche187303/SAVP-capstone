import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { resolveNonStaffDepartmentIds } from '../../../common/utils/non-staff-department.util.js';
import { FaceProfileService } from '../../accounts/services/face-profile.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { VisitorConfigService } from '../config/visitor-config.service.js';
import { CLOSED_STATUSES } from '../constants/visit-status.constant.js';
import { toVisitView, VISIT_VIEW_SELECT, VisitRow, VisitView } from '../presenters/visit-view.presenter.js';
import { err, VisitService } from './visit.service.js';

const VN_DAY = `(v.scheduled_from AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const UUID = /^[0-9a-f-]{36}$/i;

export interface VisitFilter {
  from?: string; to?: string; departmentId?: string; hostId?: string; q?: string;
}
export type AttentionKind = 'must_leave' | 'overstay' | 'exit_unrecorded' | 'manual_review' | 'no_photo';

const round1 = (n: number): number => Math.round(n * 10) / 10;
const pad = (n: number): string => String(n).padStart(2, '0');

/** Đọc dữ liệu phân hệ Khách: danh sách, quầy lễ tân, của tôi, thống kê. Chỉ đọc. */
@Injectable()
export class VisitQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: VisitorConfigService,
    private readonly visits: VisitService,
    private readonly faceProfiles: FaceProfileService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────── Danh sách ─────────────

  private where(filter: VisitFilter, params: unknown[]): string {
    const conds: string[] = [];
    const add = (sql: string, value: unknown) => { params.push(value); conds.push(sql.replace('?', `$${params.length}`)); };
    if (filter.from) add(`${VN_DAY} >= ?::date`, filter.from);
    if (filter.to) add(`${VN_DAY} <= ?::date`, filter.to);
    if (filter.departmentId && UUID.test(filter.departmentId)) add('v.department_id = ?::uuid', filter.departmentId);
    if (filter.hostId && UUID.test(filter.hostId)) add('v.host_user_id = ?::uuid', filter.hostId);
    const q = filter.q?.trim();
    if (q) {
      params.push(`%${escapeLike(q)}%`);
      const p = `$${params.length}`;
      conds.push(`(unaccent(vis.full_name) ILIKE unaccent(${p}) OR vis.id_number ILIKE ${p} OR vis.phone_number ILIKE ${p}
                   OR unaccent(COALESCE(vis.organization,'')) ILIKE unaccent(${p}) OR v.visit_code ILIKE ${p})`);
    }
    return conds.length ? ` AND ${conds.join(' AND ')}` : '';
  }

  async list(
    params: VisitFilter & { status?: string; page?: number; limit?: number },
  ): Promise<{ items: VisitView[]; total: number; counts: Record<string, number> }> {
    const cfg = await this.config.get();
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 10));
    const baseParams: unknown[] = [];
    const baseWhere = this.where(params, baseParams);

    const countRows: Array<{ grp: string; n: string }> = await this.dataSource.query(
      `SELECT CASE WHEN v.status = ANY($${baseParams.length + 1}::text[]) THEN 'closed'
                   WHEN v.status = 'must_leave' THEN 'checked_in' ELSE v.status END AS grp, count(*) AS n
         FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id
        WHERE v.deleted_at IS NULL${baseWhere} GROUP BY 1`,
      [...baseParams, CLOSED_STATUSES],
    );
    const counts = { pending_approval: 0, approved: 0, checked_in: 0, checked_out: 0, closed: 0 } as Record<string, number>;
    for (const r of countRows) counts[r.grp] = Number(r.n);

    const listParams = [...baseParams];
    let statusSql = '';
    const status = params.status;
    if (status === 'closed') { listParams.push(CLOSED_STATUSES); statusSql = ` AND v.status = ANY($${listParams.length}::text[])`; }
    else if (status === 'checked_in') statusSql = ` AND v.status IN ('checked_in','must_leave')`;
    else if (status) { listParams.push(status); statusSql = ` AND v.status = $${listParams.length}`; }

    const total = status
      ? Number((await this.dataSource.query(
        `SELECT count(*) AS n FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id WHERE v.deleted_at IS NULL${baseWhere}${statusSql}`,
        listParams,
      ))[0].n)
      : Object.values(counts).reduce((a, b) => a + b, 0);

    listParams.push(limit, (page - 1) * limit);
    const rows: VisitRow[] = await this.dataSource.query(
      `${VISIT_VIEW_SELECT}${baseWhere}${statusSql} ORDER BY v.scheduled_from DESC, v.id LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );
    const now = new Date();
    return { items: rows.map((r) => toVisitView(r, now, cfg.overstayEscalateMinutes)), total, counts };
  }

  /** Chi tiết một lượt + ảnh đăng ký (data URL — chỉ ở chi tiết, danh sách để null). */
  async detail(id: string): Promise<VisitView> {
    const view = await this.visits.getView(id);
    if (!view.visitor.hasPhoto) return view;
    const photoId = (await this.dataSource.query(`SELECT photo_file_id FROM visitor_visits WHERE id = $1`, [id]))[0]?.photo_file_id;
    const photo = photoId ? await this.faceProfiles.getMediaDataUrl(photoId) : null;
    return { ...view, visitor: { ...view.visitor, photo } };
  }

  async related(id: string): Promise<VisitView[]> {
    if (!UUID.test(id)) throw err(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lượt khách');
    const cfg = await this.config.get();
    const rows: VisitRow[] = await this.dataSource.query(
      `${VISIT_VIEW_SELECT} AND v.visitor_id = (SELECT visitor_id FROM visitor_visits WHERE id = $1) ORDER BY v.scheduled_from DESC`,
      [id],
    );
    if (!rows.length) throw err(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lượt khách');
    const now = new Date();
    return rows.map((r) => toVisitView(r, now, cfg.overstayEscalateMinutes));
  }

  async lookups() {
    const nonStaff = await resolveNonStaffDepartmentIds(this.dataSource);
    const departments: Array<{ id: string; name: string }> = await this.dataSource.query(
      `SELECT id, department_name AS name FROM departments WHERE deleted_at IS NULL AND is_active = true AND NOT (id = ANY($1::uuid[])) ORDER BY department_name`,
      [nonStaff],
    );
    const zones: Array<{ id: string; name: string; type: string; hasFaceGate: boolean }> = await this.dataSource.query(
      `SELECT z.id, z.zone_name AS name, z.zone_type AS type,
              EXISTS (SELECT 1 FROM iot_devices d WHERE d.zone_id = z.id AND d.device_type = 'face_server') AS "hasFaceGate"
         FROM zones z WHERE z.deleted_at IS NULL AND z.status = 'active' ORDER BY z.zone_name`,
    );
    return { departments, zones, purposes: (await this.config.get()).purposes };
  }

  // ───────────── Quầy lễ tân ─────────────

  async deskToday(now: Date = new Date()) {
    const cfg = await this.config.get();
    const toView = (r: VisitRow) => toVisitView(r, now, cfg.overstayEscalateMinutes);
    const today = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

    const items: VisitRow[] = await this.dataSource.query(
      `${VISIT_VIEW_SELECT} AND (${VN_DAY} = $1::date OR v.status IN ('checked_in','must_leave')) ORDER BY v.scheduled_from`,
      [today],
    );
    const kpiRow = (await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE ${VN_DAY} = $1::date AND v.status NOT IN ('rejected','cancelled')) AS expected,
              count(*) FILTER (WHERE (v.check_in_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $1::date) AS arrived,
              count(*) FILTER (WHERE v.status IN ('checked_in','must_leave')) AS on_site,
              count(*) FILTER (WHERE v.status = 'checked_in' AND v.valid_to < $2) AS overstay
         FROM visitor_visits v WHERE v.deleted_at IS NULL`,
      [today, now],
    ))[0];
    const alerts: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT e.event_time AS at, e.event_type AS type, e.note, COALESCE(z.zone_name, '') AS "zoneName",
              v.id AS "visitId", v.visit_code AS code, vis.full_name AS "visitorName"
         FROM visitor_visit_events e JOIN visitor_visits v ON v.id = e.visit_id JOIN visitors vis ON vis.id = v.visitor_id
         LEFT JOIN zones z ON z.id = e.zone_id
        WHERE e.event_type IN ('access_denied','manual_review') AND (e.event_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $1::date
        ORDER BY e.event_time DESC LIMIT 100`,
      [today],
    );
    return {
      kpis: { expected: Number(kpiRow.expected), arrived: Number(kpiRow.arrived), onSite: Number(kpiRow.on_site), overstay: Number(kpiRow.overstay) },
      items: items.map(toView),
      alerts,
      attention: await this.attention(now, today, toView),
    };
  }

  /** Hàng "Cần xử lý": chỉ ngoại lệ. Thứ tự: phải rời → quá giờ → chưa ghi nhận giờ ra → cần xác minh → chưa có ảnh. */
  private async attention(now: Date, today: string, toView: (r: VisitRow) => VisitView) {
    const out: Array<{ kind: AttentionKind; since: string; visit: VisitView }> = [];
    const fetch = async (extra: string, params: unknown[]): Promise<VisitRow[]> =>
      this.dataSource.query(`${VISIT_VIEW_SELECT} ${extra}`, params);

    for (const r of await fetch(`AND v.status = 'must_leave' ORDER BY v.revoked_at`, [])) {
      out.push({ kind: 'must_leave', since: new Date(r.revoked_at ?? r.valid_to).toISOString(), visit: toView(r) });
    }
    for (const r of await fetch(`AND v.status = 'checked_in' AND v.valid_to < $1 ORDER BY v.valid_to`, [now])) {
      out.push({ kind: 'overstay', since: new Date(r.valid_to).toISOString(), visit: toView(r) });
    }
    for (const r of await fetch(`AND v.status = 'exit_unrecorded' AND v.valid_to >= $1 ORDER BY v.valid_to`, [new Date(now.getTime() - 7 * 86_400_000)])) {
      out.push({ kind: 'exit_unrecorded', since: new Date(r.valid_to).toISOString(), visit: toView(r) });
    }
    const approvedToday = await fetch(`AND v.status = 'approved' AND ${VN_DAY} = $1::date ORDER BY v.scheduled_from`, [today]);
    for (const r of approvedToday) {
      const view = toView(r);
      const lastGate = [...view.events].reverse().find((e) => e.type === 'manual_review' || e.type === 'check_in');
      if (lastGate?.type === 'manual_review' && lastGate.at.slice(0, 10) >= today) out.push({ kind: 'manual_review', since: lastGate.at, visit: view });
      else if (!view.visitor.hasPhoto) out.push({ kind: 'no_photo', since: view.scheduledFrom, visit: view });
    }
    return out;
  }

  // ───────────── Của tôi ─────────────

  async myVisits(userId: string) {
    const cfg = await this.config.get();
    const rows: VisitRow[] = await this.dataSource.query(`${VISIT_VIEW_SELECT} AND v.host_user_id = $1 ORDER BY v.scheduled_from`, [userId]);
    const now = new Date();
    const views = rows.map((r) => toVisitView(r, now, cfg.overstayEscalateMinutes));
    return {
      pending: views.filter((v) => v.status === 'pending_approval'),
      upcoming: views.filter((v) => ['approved', 'checked_in', 'must_leave'].includes(v.status)),
      past: views.filter((v) => !['pending_approval', 'approved', 'checked_in', 'must_leave'].includes(v.status)).reverse().slice(0, 50),
    };
  }

  /** Thông báo `visitor_*` của người dùng, mới nhất trước. Trạng thái đã đọc theo hộp thư chung. */
  async myNotifications(userId: string) {
    const { data } = await this.notifications.listMyNotifications(userId, 1, 100);
    return data
      .filter((n) => String(n.notificationType).startsWith('visitor_'))
      .slice(0, 50)
      .map((n) => ({ id: n.id, visitId: n.relatedEntityId, type: n.notificationType, message: n.content, createdAt: n.createdAt, read: n.isRead }));
  }

  /** LƯU Ý: đánh dấu đã đọc theo hộp thư chung nên cũng đánh dấu mọi thông báo khác của người dùng. */
  async markMyNotificationsRead(userId: string): Promise<{ updated: number }> {
    const unread = (await this.myNotifications(userId)).filter((n) => !n.read).length;
    await this.notifications.markAllNotificationsRead(userId);
    return { updated: unread };
  }

  // ───────────── Thống kê ─────────────

  /** Định nghĩa số liệu dùng chung cho màn Thống kê và báo cáo khách. */
  async computeKpis(filter: { from: string; to: string; departmentId?: string }, now: Date = new Date()) {
    const params: unknown[] = [];
    const where = this.where(filter, params);
    params.push(now);
    const r = (await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE v.check_in_at IS NOT NULL) AS total,
              count(DISTINCT v.visitor_id) FILTER (WHERE v.check_in_at IS NOT NULL) AS uniq,
              avg(EXTRACT(EPOCH FROM (v.check_out_at - v.check_in_at)) / 60) FILTER (WHERE v.check_in_at IS NOT NULL AND v.check_out_at IS NOT NULL) AS avg_stay,
              count(*) FILTER (WHERE v.check_in_at IS NOT NULL AND ((v.check_out_at IS NOT NULL AND v.check_out_at > v.valid_to)
                                                                   OR (v.status = 'checked_in' AND v.valid_to < $${params.length}))) AS overstay,
              count(*) FILTER (WHERE v.status = 'expired') AS expired
         FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id WHERE v.deleted_at IS NULL${where}`,
      params,
    ))[0];
    const total = Number(r.total);
    const expired = Number(r.expired);
    return {
      totalVisits: total,
      uniqueVisitors: Number(r.uniq),
      avgStayMinutes: r.avg_stay === null ? 0 : Math.round(Number(r.avg_stay)),
      overstayCount: Number(r.overstay),
      noShowRate: expired + total ? round1((expired / (expired + total)) * 100) : 0,
    };
  }

  async stats(q: { from: string; to: string; departmentId?: string; groupBy?: 'day' | 'week' | 'month' }) {
    if (!q.from || !q.to) throw err(400, 'VALIDATION_ERROR', 'Vui lòng chọn kỳ thống kê');
    if (q.from > q.to) throw err(400, 'VALIDATION_ERROR', 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
    const groupBy = q.groupBy ?? 'day';
    const params: unknown[] = [];
    const where = this.where(q, params);
    const arrived = `v.deleted_at IS NULL AND v.check_in_at IS NOT NULL${where}`;
    const rows = (sql: string) => this.dataSource.query(sql, params);

    const unit = groupBy === 'month' ? 'month' : groupBy === 'week' ? 'week' : 'day';
    const periodRows: Array<{ d: string; n: string }> = await rows(
      `SELECT to_char(date_trunc('${unit}', v.scheduled_from AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS d, count(*) AS n
         FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id WHERE ${arrived} GROUP BY 1 ORDER BY 1`,
    );
    const byDepartment: Array<{ departmentId: string | null; name: string; n: string }> = await rows(
      `SELECT v.department_id AS "departmentId", COALESCE(d.department_name, 'Không rõ') AS name, count(*) AS n
         FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id LEFT JOIN departments d ON d.id = v.department_id
        WHERE ${arrived} GROUP BY 1, 2 ORDER BY n DESC`,
    );
    const byPurpose: Array<{ purpose: string; n: string }> = await rows(
      `SELECT v.purpose, count(*) AS n FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id WHERE ${arrived} GROUP BY 1 ORDER BY n DESC`,
    );
    const byHourRows: Array<{ h: number; n: string }> = await rows(
      `SELECT EXTRACT(HOUR FROM v.check_in_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS h, count(*) AS n
         FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id WHERE ${arrived} GROUP BY 1`,
    );
    const orgs: Array<{ organization: string; n: string }> = await rows(
      `SELECT COALESCE(NULLIF(vis.organization, ''), 'Không rõ') AS organization, count(*) AS n
         FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id WHERE ${arrived} GROUP BY 1 ORDER BY n DESC LIMIT 8`,
    );

    const label = (ymd: string): string => {
      const [y, m, d] = ymd.split('-');
      return groupBy === 'month' ? `${m}/${y}` : groupBy === 'week' ? `Tuần ${d}/${m}` : `${d}/${m}`;
    };
    const byPeriodMap = new Map(periodRows.map((r) => [r.d, Number(r.n)]));
    if (groupBy === 'day') {
      // Điền các ngày không có khách để biểu đồ liên tục.
      for (let t = Date.parse(`${q.from}T00:00:00Z`), end = Date.parse(`${q.to}T00:00:00Z`), i = 0; t <= end && i < 400; t += 86_400_000, i += 1) {
        const key = new Date(t).toISOString().slice(0, 10);
        if (!byPeriodMap.has(key)) byPeriodMap.set(key, 0);
      }
    }
    const byHourMap = new Map(byHourRows.map((r) => [r.h, Number(r.n)]));
    return {
      kpis: await this.computeKpis(q),
      byPeriod: [...byPeriodMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, count]) => ({ bucket: label(d), count })),
      byDepartment: byDepartment.map((r) => ({ departmentId: r.departmentId, name: r.name, count: Number(r.n) })),
      byPurpose: byPurpose.map((r) => ({ purpose: r.purpose, count: Number(r.n) })),
      byHour: Array.from({ length: 12 }, (_, i) => ({ hour: `${pad(i + 7)}h`, count: byHourMap.get(i + 7) ?? 0 })),
      topOrganizations: orgs.map((r) => ({ organization: r.organization, count: Number(r.n) })),
    };
  }
}
