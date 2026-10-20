import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';

interface RawEvt {
  id: string;
  event_time: Date | string;
  direction: string | null;
  similarity: string | null;
  sz_uid: string | null;
}
interface BoundRow {
  start_time: Date | string;
  end_time: Date | string;
  status: string;
}
interface ParticipantRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  employee_code: string | null;
  department_name: string | null;
}
interface CountRow {
  n: number;
}
interface ConfigRow {
  config_value: string | null;
}

export type PresenceMethod = 'interval' | 'approx';
export interface PresenceSegment {
  start: string;
  end: string;
  state: 'present';
  source: 'interval' | 'cluster';
}
export interface SessionResult {
  segments: PresenceSegment[];
  durationMs: number;
  method: PresenceMethod;
  firstAt: string | null;
  lastAt: string | null;
}

interface Bound {
  startMs: number;
  endMs: number;
  status: string;
}

const DEFAULT_GAP_SECONDS = 120;

/**
 * [FIX 2026-08-13] Scope xem presence — mirror resolveScope() của
 * on-time-rate.service.ts, thêm nhánh EMPLOYEE (không có ở template gốc, vì các
 * route analytics khác chặn hẳn EMPLOYEE — route presence này cho tự xem chính mình).
 * isUnrestricted=true (SYSTEM_ADMIN/BUSINESS_ADMIN) bỏ qua mọi field còn lại.
 *
 * [FIX 2026-08-25] Thêm isHostOfMeeting — Employee là host của ĐÚNG meeting đang xem (không
 * phải toàn hệ thống) được xem đủ mọi participant CỦA MEETING NÀY, giống selfUserId nhưng mở
 * rộng hơn 1 người. CỐ Ý KHÔNG đổi selfUserId (vẫn giữ = callerId) khi là host — IvssPresenceReportService
 * (PDF export) chặn theo `scope.selfUserId !== null`, đổi selfUserId sẽ vô tình mở khoá PDF
 * cho host-employee, NGOÀI PHẠM VI yêu cầu này (cần quyết định sản phẩm riêng, chưa làm).
 */
export interface IvssPresenceScope {
  viewerRole: 'SYSTEM_ADMIN' | 'BUSINESS_ADMIN' | 'MANAGER' | 'EMPLOYEE';
  isUnrestricted: boolean;
  /** Chỉ có giá trị khi viewerRole = MANAGER. */
  scopeDepartmentIds: string[] | null;
  /** Chỉ có giá trị khi viewerRole = EMPLOYEE — phải khớp đúng userId đang xem. */
  selfUserId: string | null;
  /** [FIX 2026-08-25] true khi callerId = meetings.host_id CỦA ĐÚNG meetingId truyền vào
   * resolveScope() — chỉ có ý nghĩa khi viewerRole = EMPLOYEE. Luôn resolve LẠI theo từng
   * meetingId cụ thể (KHÔNG cache/global) nên KHÔNG rò rỉ sang meeting khác mà caller không
   * phải host. */
  isHostOfMeeting: boolean;
}

/**
 * IvssPresenceQueryService (IPD-001 #41+#42) — READ-ONLY: dựng present-segments per (meeting,user)
 * từ iot_device_events (ivss_face_event) → #41 duration + #42 timeline. 1 nguồn (buildSession), không lệch.
 *
 * B1 enter-enter → đóng enter cũ tại min(t, openEnter+gap). B2 leave-không-enter → ném vào cluster.
 * B3 clip segment vào [start,end] trước duration/absentGaps. C5 cluster 1-điểm → +gap.
 * OQ-1 interval ưu tiên (seen trong interval bị nuốt; ngoài → cluster). C1 dedup (event_time,direction).
 * C2 method honesty. C4 unmatchedCount tách location/identity. SEC-03 bind. ARCH-01 KHÔNG mutate.
 */
@Injectable()
export class IvssPresenceQueryService {
  private readonly logger = new Logger(IvssPresenceQueryService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly authzRepo: AuthzReadRepository,
  ) {}

  /**
   * [FIX 2026-08-13] Resolve scope người gọi — public vì
   * IvssPresenceReportService cần gọi trước khi build PDF (chặn EMPLOYEE hẳn,
   * khác JSON endpoint chỉ lọc).
   *
   * [FIX 2026-08-25] Thêm tham số bắt buộc `meetingId` — cần để xác định Employee có phải
   * host CỦA ĐÚNG meeting đang xem hay không (meetings.host_id). Role SYSTEM_ADMIN/
   * BUSINESS_ADMIN/MANAGER KHÔNG đổi gì (không cần biết host, trả về y hệt trước fix).
   */
  async resolveScope(
    callerId: string,
    meetingId: string,
  ): Promise<IvssPresenceScope> {
    const { roles } =
      await this.authzRepo.getEffectiveRolesAndPermissions(callerId);

    if (roles.includes('SYSTEM_ADMIN')) {
      return {
        viewerRole: 'SYSTEM_ADMIN',
        isUnrestricted: true,
        scopeDepartmentIds: null,
        selfUserId: null,
        isHostOfMeeting: false,
      };
    }
    if (roles.includes('BUSINESS_ADMIN')) {
      return {
        viewerRole: 'BUSINESS_ADMIN',
        isUnrestricted: true,
        scopeDepartmentIds: null,
        selfUserId: null,
        isHostOfMeeting: false,
      };
    }
    if (roles.includes('MANAGER')) {
      const scopeDepartmentIds = await this.getManagerDepartmentIds(callerId);
      // Manager chủ trì ĐÚNG meeting này (vd Hiệu trưởng) → xem đủ participant như host Employee.
      const isHostOfMeeting = await this.isCallerHostOfMeeting(
        callerId,
        meetingId,
      );
      return {
        viewerRole: 'MANAGER',
        isUnrestricted: false,
        scopeDepartmentIds,
        selfUserId: null,
        isHostOfMeeting,
      };
    }
    // EMPLOYEE (hoặc role khác lỡ được cấp quyền ngoài dự kiến) → mặc định chỉ tự xem chính
    // mình; MỞ THÊM [FIX 2026-08-25]: nếu là host của ĐÚNG meeting đang xem → xem đủ mọi
    // participant CỦA MEETING NÀY (assertCanViewUser/filterParticipantsByScope bên dưới).
    const isHostOfMeeting = await this.isCallerHostOfMeeting(
      callerId,
      meetingId,
    );
    return {
      viewerRole: 'EMPLOYEE',
      isUnrestricted: false,
      scopeDepartmentIds: null,
      selfUserId: callerId,
      isHostOfMeeting,
    };
  }

  /** [FIX 2026-08-25] Nguồn xác định host đáng tin cậy — đọc thẳng meetings.host_id (DB),
   * KHÔNG tin field client tự gửi lên. */
  private async isCallerHostOfMeeting(
    callerId: string,
    meetingId: string,
  ): Promise<boolean> {
    const rows: Array<{ host_id: string | null }> =
      await this.dataSource.manager.query(
        `SELECT host_id FROM meetings WHERE id = $1 LIMIT 1`,
        [meetingId],
      );
    return rows[0]?.host_id === callerId;
  }

  /** Chặn 403 khi xem 1 người cụ thể (userPresence) không nằm trong scope. */
  private async assertCanViewUser(
    scope: IvssPresenceScope,
    targetUserId: string,
  ): Promise<void> {
    if (scope.isUnrestricted) return;
    // [FIX 2026-08-25] Host của ĐÚNG meeting đang xem → xem đủ mọi participant CỦA MEETING
    // NÀY (scope đã resolve theo đúng meetingId, KHÔNG rò rỉ sang meeting khác).
    if (scope.isHostOfMeeting) return;

    if (scope.selfUserId !== null) {
      if (scope.selfUserId === targetUserId) return;
      throw new ForbiddenException({
        success: false,
        message: 'You can only view your own presence data',
        error: { code: 'SELF_ONLY', details: {} },
      });
    }

    if (scope.scopeDepartmentIds !== null) {
      const departmentId = await this.getUserDepartmentId(targetUserId);
      if (departmentId && scope.scopeDepartmentIds.includes(departmentId)) {
        return;
      }
      throw new ForbiddenException({
        success: false,
        message: 'Department is outside your scope',
        error: { code: 'DEPARTMENT_OUT_OF_SCOPE', details: {} },
      });
    }

    throw new ForbiddenException({
      success: false,
      message: 'You do not have permission to view this presence data',
      error: { code: 'PERMISSION_DENIED', details: {} },
    });
  }

  /** Lọc danh sách participant theo scope — dùng cho getMeetingPresence (im lặng, KHÔNG 403). */
  private async filterParticipantsByScope(
    participants: ParticipantRow[],
    scope: IvssPresenceScope,
  ): Promise<ParticipantRow[]> {
    if (scope.isUnrestricted) return participants;
    // [FIX 2026-08-25] Host của ĐÚNG meeting đang xem → KHÔNG lọc, trả đủ mọi participant.
    if (scope.isHostOfMeeting) return participants;

    if (scope.selfUserId !== null) {
      return participants.filter((p) => p.user_id === scope.selfUserId);
    }

    if (scope.scopeDepartmentIds !== null) {
      if (scope.scopeDepartmentIds.length === 0 || participants.length === 0) {
        return [];
      }
      const rows: Array<{ user_id: string }> =
        await this.dataSource.manager.query(
          `SELECT id AS user_id FROM users
          WHERE id = ANY($1::uuid[]) AND department_id = ANY($2::uuid[])`,
          [participants.map((p) => p.user_id), scope.scopeDepartmentIds],
        );
      const allowed = new Set(rows.map((r) => r.user_id));
      return participants.filter((p) => allowed.has(p.user_id));
    }

    return [];
  }

  private async getManagerDepartmentIds(userId: string): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.dataSource.manager.query(
      // BGH (leadership_title) xem mọi đơn vị — cùng quy ước với analytics/report-scope.
      `SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL)) AND is_active = true`,
      [userId],
    );
    return rows.map((r) => r.id);
  }

  private async getUserDepartmentId(userId: string): Promise<string | null> {
    const rows: Array<{ department_id: string | null }> =
      await this.dataSource.manager.query(
        `SELECT department_id FROM users WHERE id = $1 LIMIT 1`,
        [userId],
      );
    return rows[0]?.department_id ?? null;
  }

  // ── #41 + #42 per-user ──────────────────────────────────────────────────
  async getUserPresence(
    meetingId: string,
    userId: string,
    callerId: string,
  ): Promise<{
    duration: {
      durationMs: number;
      method: PresenceMethod;
      segmentCount: number;
      presentRatio: number;
    };
    timeline: {
      segments: PresenceSegment[];
      absentGaps: Array<{ start: string; end: string }>;
      events: Array<{
        id: string;
        at: string;
        direction: string | null;
        similarity: string | null;
      }>;
      unmatchedCount: number;
    };
  } | null> {
    const scope = await this.resolveScope(callerId, meetingId);
    await this.assertCanViewUser(scope, userId);

    const bound = await this.loadBound(meetingId);
    if (!bound) return null;

    const gapMs = (await this.getGapThresholdSeconds()) * 1000;
    const events = await this.loadEvents(meetingId, userId);
    const unmatchedCount = await this.loadUnmatchedLocationCount(
      meetingId,
      userId,
    );

    const session = this.buildSession(events, bound, gapMs);
    const presentRatio = this.ratio(session.durationMs, bound);

    return {
      duration: {
        durationMs: session.durationMs,
        method: session.method,
        segmentCount: session.segments.length,
        presentRatio,
      },
      timeline: {
        segments: session.segments,
        absentGaps: this.absentGaps(session.segments, bound),
        events: events.map((e) => ({
          id: e.id, // dùng chung GET /ivss/device-events/:eventId/snapshot (Room Access Logs)
          at: new Date(e.event_time).toISOString(),
          direction: e.direction,
          similarity: e.similarity, // SEC-01: metadata-only, KHÔNG ảnh
        })),
        unmatchedCount,
      },
    };
  }

  // ── per-meeting summary ─────────────────────────────────────────────────
  async getMeetingPresence(
    meetingId: string,
    callerId: string,
  ): Promise<{
    participants: Array<{
      userId: string;
      fullName: string | null;
      email: string | null;
      avatarUrl: string | null;
      employeeCode: string | null;
      departmentName: string | null;
      durationMs: number;
      method: PresenceMethod;
      segmentCount: number;
      presentRatio: number;
      unmatchedCount: number;
    }>;
    meetingUnmatchedIdentityCount: number;
  } | null> {
    const bound = await this.loadBound(meetingId);
    if (!bound) return null;

    const scope = await this.resolveScope(callerId, meetingId);
    const gapMs = (await this.getGapThresholdSeconds()) * 1000;
    // [FIX 2026-08-13] Lọc participant theo scope người gọi — im lặng (KHÔNG 403), EMPLOYEE
    // chỉ còn đúng 1 dòng của chính họ, MANAGER chỉ còn participant thuộc phòng ban mình quản
    // lý (lỗ hổng cũ: trước đây KHÔNG có bước lọc này, Manager xem được MỌI meeting).
    const participants = await this.filterParticipantsByScope(
      await this.loadParticipants(meetingId),
      scope,
    );

    const rows: Array<{
      userId: string;
      fullName: string | null;
      email: string | null;
      avatarUrl: string | null;
      employeeCode: string | null;
      departmentName: string | null;
      durationMs: number;
      method: PresenceMethod;
      segmentCount: number;
      presentRatio: number;
      unmatchedCount: number;
    }> = [];
    for (const p of participants) {
      const events = await this.loadEvents(meetingId, p.user_id);
      const unmatchedCount = await this.loadUnmatchedLocationCount(
        meetingId,
        p.user_id,
      );
      const session = this.buildSession(events, bound, gapMs);
      rows.push({
        userId: p.user_id,
        fullName: p.full_name,
        email: p.email,
        avatarUrl: p.avatar_url,
        employeeCode: p.employee_code,
        departmentName: p.department_name,
        durationMs: session.durationMs,
        method: session.method, // C2
        segmentCount: session.segments.length,
        presentRatio: this.ratio(session.durationMs, bound),
        unmatchedCount,
      });
    }

    // C4: unmatched-identity là của meeting (không gắn user).
    const meetingUnmatchedIdentityCount =
      await this.loadMeetingUnmatchedIdentityCount(meetingId);

    return { participants: rows, meetingUnmatchedIdentityCount };
  }

  // ── CORE: buildSession (B1/B2/B3 + interval/cluster/hở + dedup) ──────────
  private buildSession(
    events: RawEvt[],
    bound: Bound,
    gapMs: number,
  ): SessionResult {
    // C1 dedup (event_time, direction).
    const seen = new Set<string>();
    const ev = events
      .filter((e) => {
        const k = `${new Date(e.event_time).getTime()}|${e.direction ?? ''}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort(
        (a, b) =>
          new Date(a.event_time).getTime() - new Date(b.event_time).getTime(),
      );

    if (ev.length === 0) {
      return {
        segments: [],
        durationMs: 0,
        method: 'approx',
        firstAt: null,
        lastAt: null,
      };
    }

    const raw: Array<{
      start: number;
      end: number;
      source: 'interval' | 'cluster';
    }> = [];
    let method: PresenceMethod = 'interval';
    let openEnter: number | null = null;
    let clusterStart: number | null = null;
    let clusterLast: number | null = null;
    let lastActivity = 0;

    const flushCluster = () => {
      if (clusterStart !== null && clusterLast !== null) {
        // C5: cluster 1-điểm → kéo dài 1 nhịp gap (approx "hiện diện ≥1 nhịp").
        const end =
          clusterStart === clusterLast
            ? Math.min(clusterStart + gapMs, bound.endMs)
            : clusterLast;
        raw.push({ start: clusterStart, end, source: 'cluster' });
        method = 'approx';
        clusterStart = null;
        clusterLast = null;
      }
    };
    const addToCluster = (t: number) => {
      if (clusterStart === null) {
        clusterStart = t;
        clusterLast = t;
      } else if (t - (clusterLast as number) <= gapMs) {
        clusterLast = t;
      } else {
        flushCluster();
        clusterStart = t;
        clusterLast = t;
      }
    };

    for (const e of ev) {
      const t = new Date(e.event_time).getTime();
      lastActivity = t;
      const dir = e.direction;
      if (dir === 'enter') {
        flushCluster();
        if (openEnter !== null) {
          // B1: đóng enter cũ tại min(t, openEnter+gap) — KHÔNG kéo tới enter mới.
          const end = Math.max(Math.min(t, openEnter + gapMs), openEnter);
          raw.push({ start: openEnter, end, source: 'interval' });
          method = 'approx';
        }
        openEnter = t;
      } else if (dir === 'leave') {
        if (openEnter !== null) {
          flushCluster();
          raw.push({
            start: openEnter,
            end: Math.max(t, openEnter),
            source: 'interval',
          });
          openEnter = null;
        } else {
          // B2: leave-không-enter → ném vào cluster (giữ bằng chứng), approx.
          addToCluster(t);
          method = 'approx';
        }
      } else {
        // seen | lạ
        if (openEnter !== null) continue; // OQ-1: nuốt trong interval
        addToCluster(t);
      }
    }
    flushCluster();

    if (openEnter !== null) {
      // OQ-3 segment hở.
      const ended = bound.status !== 'in_progress';
      const endOrNow = ended ? bound.endMs : Math.min(Date.now(), bound.endMs);
      const closeAt = Math.max(
        Math.min(endOrNow, lastActivity + gapMs),
        openEnter,
      );
      raw.push({ start: openEnter, end: closeAt, source: 'interval' });
    }

    // B3: clip vào [startMs, endMs].
    const clipped: PresenceSegment[] = [];
    for (const s of raw) {
      const start = Math.max(s.start, bound.startMs);
      const end = Math.min(s.end, bound.endMs);
      if (end > start) {
        clipped.push({
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          state: 'present',
          source: s.source,
        });
      }
    }

    let durationMs = clipped.reduce(
      (sum, s) =>
        sum + (new Date(s.end).getTime() - new Date(s.start).getTime()),
      0,
    );
    if (clipped.length === 0) {
      // mọi segment ngoài bound → approx first→last (clamp bound).
      const f = Math.max(new Date(ev[0].event_time).getTime(), bound.startMs);
      const l = Math.min(lastActivity, bound.endMs);
      durationMs = Math.max(0, l - f);
      method = 'approx';
    }

    return {
      segments: clipped,
      durationMs,
      method,
      firstAt: new Date(ev[0].event_time).toISOString(),
      lastAt: new Date(lastActivity).toISOString(),
    };
  }

  private ratio(durationMs: number, bound: Bound): number {
    const len = bound.endMs - bound.startMs;
    if (len <= 0) return 0;
    return Math.min(1, Math.max(0, durationMs / len)); // OQ-7 clamp ≤ 1
  }

  private absentGaps(
    segments: PresenceSegment[],
    bound: Bound,
  ): Array<{ start: string; end: string }> {
    const gaps: Array<{ start: string; end: string }> = [];
    let cursor = bound.startMs;
    const sorted = [...segments].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
    for (const s of sorted) {
      const sStart = new Date(s.start).getTime();
      const sEnd = new Date(s.end).getTime();
      if (sStart > cursor) {
        gaps.push({
          start: new Date(cursor).toISOString(),
          end: new Date(sStart).toISOString(),
        });
      }
      cursor = Math.max(cursor, sEnd);
    }
    if (cursor < bound.endMs) {
      gaps.push({
        start: new Date(cursor).toISOString(),
        end: new Date(bound.endMs).toISOString(),
      });
    }
    return gaps;
  }

  // ── data access (READ-ONLY, SEC-03 bind) ─────────────────────────────────
  private async loadBound(meetingId: string): Promise<Bound | null> {
    const rows: BoundRow[] = await this.dataSource.manager.query(
      `SELECT COALESCE(actual_start_time, start_time) AS start_time,
              COALESCE(actual_end_time, end_time) AS end_time,
              status
         FROM meetings WHERE id = $1 LIMIT 1`,
      [meetingId],
    );
    const m = rows[0];
    if (!m) return null;
    return {
      startMs: new Date(m.start_time).getTime(),
      endMs: new Date(m.end_time).getTime(),
      status: m.status,
    };
  }

  private async loadEvents(
    meetingId: string,
    userId: string,
  ): Promise<RawEvt[]> {
    return this.dataSource.manager.query(
      `SELECT e.id,
              e.event_time,
              e.payload_json->>'direction'  AS direction,
              e.payload_json->>'similarity' AS similarity,
              e.payload_json->>'szUid'      AS sz_uid
         FROM iot_device_events e
        WHERE e.event_type = 'ivss_face_event'
          AND e.meeting_id = $1
          AND e.payload_json->>'userId' = $2
          AND e.payload_json->>'matchState' = 'matched'
        ORDER BY e.event_time ASC`,
      [meetingId, userId],
    );
  }

  private async loadUnmatchedLocationCount(
    meetingId: string,
    userId: string,
  ): Promise<number> {
    const rows: CountRow[] = await this.dataSource.manager.query(
      `SELECT COUNT(*)::int AS n FROM iot_device_events e
        WHERE e.event_type = 'ivss_face_event'
          AND e.meeting_id = $1
          AND e.payload_json->>'userId' = $2
          AND e.payload_json->>'matchState' = 'unmatched_location'`,
      [meetingId, userId],
    );
    return rows[0]?.n ?? 0;
  }

  private async loadMeetingUnmatchedIdentityCount(
    meetingId: string,
  ): Promise<number> {
    const rows: CountRow[] = await this.dataSource.manager.query(
      `SELECT COUNT(*)::int AS n FROM iot_device_events e
        WHERE e.event_type = 'ivss_face_event'
          AND e.meeting_id = $1
          AND e.payload_json->>'matchState' = 'unmatched_identity'`,
      [meetingId],
    );
    return rows[0]?.n ?? 0;
  }

  private async loadParticipants(meetingId: string): Promise<ParticipantRow[]> {
    return this.dataSource.manager.query(
      `SELECT mp.user_id, u.full_name, u.email, u.avatar_url, u.employee_code,
              d.department_name
         FROM meeting_participants mp
         JOIN users u ON u.id = mp.user_id
         LEFT JOIN departments d ON d.id = u.department_id
        WHERE mp.meeting_id = $1`,
      [meetingId],
    );
  }

  /** OQ-5: system_configs[ivss.presence.gap_threshold_seconds] → default 120. */
  private async getGapThresholdSeconds(): Promise<number> {
    try {
      const rows: ConfigRow[] = await this.dataSource.manager.query(
        `SELECT config_value FROM system_configs
          WHERE config_key = 'ivss.presence.gap_threshold_seconds' AND is_active = true
          LIMIT 1`,
      );
      const raw = rows[0]?.config_value;
      if (raw != null) {
        const n = parseInt(raw, 10);
        if (Number.isInteger(n) && n > 0) return n;
      }
    } catch (e) {
      this.logger.warn(
        `read gap_threshold failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
    return DEFAULT_GAP_SECONDS;
  }
}
