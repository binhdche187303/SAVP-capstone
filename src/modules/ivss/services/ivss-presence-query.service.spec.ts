/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';
import { IvssPresenceQueryService } from './ivss-presence-query.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';

const T = (hhmm: string) => `2026-06-23T${hhmm}:00.000Z`;
const MIN = 60 * 1000;
const GAP_MS = 120 * 1000; // default 120s

// [FIX 2026-08-13] id thêm vào RawEvt (dùng chung route snapshot) — mỗi event 1 id
// riêng biệt, suy ra từ hhmm+direction để dễ đối chiếu trong assertion.
const ev = (hhmm: string, direction: string) => ({
  id: `evt-${hhmm.replace(':', '')}-${direction}`,
  event_time: T(hhmm),
  direction,
  similarity: null,
  sz_uid: 'SZ1',
});

// [FIX 2026-08-13] getUserPresence()/getMeetingPresence() giờ bắt buộc callerId (scope-check).
// Caller mặc định cho toàn bộ test thuật toán streak/duration (không liên quan scope) — luôn
// SYSTEM_ADMIN (unrestricted) để hành vi các test này giữ nguyên như trước fix.
const ADMIN_CALLER = 'admin-1';

describe('IvssPresenceQueryService (IPD-001 #41+#42)', () => {
  let service: IvssPresenceQueryService;
  let dsMock: any;
  let authzMock: any;

  const wire = (
    o: {
      events?: any[];
      status?: string;
      unmatchedLocation?: number;
      unmatchedIdentity?: number;
      gap?: number;
      participants?: any[];
      noMeeting?: boolean;
      // [FIX 2026-08-25] Giả lập kết quả SELECT ĐÃ QUA COALESCE(actual_*, reserved_*)
      // của loadBound() — mock trả thẳng giá trị hậu-COALESCE (Postgres thật mới là nơi
      // chạy COALESCE, mock không tự tính). Không truyền → actual_*_time=null, start_time/
      // end_time giữ nguyên mốc lịch mặc định (hành vi cũ, regression-safe).
      actualStart?: string;
      actualEnd?: string;
      // [FIX 2026-08-25] host_id CỦA MEETING đang test — dùng bởi resolveScope()'s
      // isCallerHostOfMeeting(). Không truyền → null (không ai là host), regression-safe.
      hostId?: string | null;
    } = {},
  ) => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      // QUAN TRỌNG: kiểm tra nhánh 'SELECT host_id' TRƯỚC nhánh loadBound() bên dưới — cả 2
      // query đều chứa substring 'FROM meetings WHERE id', nhánh cụ thể hơn phải đứng trước.
      if (sql.includes('SELECT host_id FROM meetings WHERE id'))
        return Promise.resolve(
          o.noMeeting ? [] : [{ host_id: o.hostId ?? null }],
        );
      if (sql.includes('FROM meetings WHERE id'))
        return Promise.resolve(
          o.noMeeting
            ? []
            : [
                {
                  start_time: o.actualStart ?? T('09:00'),
                  end_time: o.actualEnd ?? T('10:00'),
                  status: o.status ?? 'completed',
                  actual_start_time: o.actualStart ?? null,
                  actual_end_time: o.actualEnd ?? null,
                },
              ],
        );
      if (sql.includes('config_value FROM system_configs'))
        return Promise.resolve(
          o.gap != null ? [{ config_value: String(o.gap) }] : [],
        );
      if (sql.includes("'matched'")) return Promise.resolve(o.events ?? []);
      if (sql.includes("'unmatched_location'"))
        return Promise.resolve([{ n: o.unmatchedLocation ?? 0 }]);
      if (sql.includes("'unmatched_identity'"))
        return Promise.resolve([{ n: o.unmatchedIdentity ?? 0 }]);
      if (sql.includes('meeting_participants'))
        return Promise.resolve(o.participants ?? []);
      return Promise.resolve([]);
    });
  };

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn() } };
    authzMock = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: ['SYSTEM_ADMIN'], permissions: [] }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssPresenceQueryService,
        { provide: DataSource, useValue: dsMock },
        { provide: AuthzReadRepository, useValue: authzMock },
      ],
    }).compile();
    service = module.get(IvssPresenceQueryService);
  });

  const dur = async () =>
    (await service.getUserPresence('m1', 'u1', ADMIN_CALLER))!;

  it('enter/leave sạch → 2 segment interval, duration = Σ', async () => {
    wire({
      events: [
        ev('09:00', 'enter'),
        ev('09:10', 'leave'),
        ev('09:20', 'enter'),
        ev('09:30', 'leave'),
      ],
    });
    const r = await dur();
    expect(r.duration.method).toBe('interval');
    expect(r.duration.segmentCount).toBe(2);
    expect(r.duration.durationMs).toBe(20 * MIN);
  });

  it('chỉ-seen (gap≤th) → 1 cluster, method approx', async () => {
    wire({
      events: [ev('09:00', 'seen'), ev('09:01', 'seen'), ev('09:02', 'seen')],
    });
    const r = await dur();
    expect(r.duration.method).toBe('approx');
    expect(r.duration.segmentCount).toBe(1);
    expect(r.duration.durationMs).toBe(2 * MIN);
  });

  it('gap>threshold giữa seen → 2 cluster (mỗi cluster 1-điểm +gap, C5)', async () => {
    wire({ events: [ev('09:00', 'seen'), ev('09:05', 'seen')] });
    const r = await dur();
    expect(r.duration.segmentCount).toBe(2);
    expect(r.duration.durationMs).toBe(2 * GAP_MS); // C5: mỗi điểm +gap
    expect(r.duration.method).toBe('approx');
  });

  it('B1 enter-enter → đóng enter cũ tại min(t, openEnter+gap), KHÔNG kéo tới enter mới', async () => {
    wire({ events: [ev('09:00', 'enter'), ev('09:30', 'enter')] });
    const r = await dur();
    // seg1 [09:00, 09:02] (gap), seg2 hở [09:30, 09:32] → 2*gap, KHÔNG phải 30min.
    expect(r.duration.durationMs).toBe(2 * GAP_MS);
    expect(r.duration.method).toBe('approx');
  });

  it('B2 leave-only → ném vào cluster, duration > 0 (giữ bằng chứng)', async () => {
    wire({ events: [ev('09:10', 'leave')] });
    const r = await dur();
    expect(r.duration.durationMs).toBe(GAP_MS); // C5 1-điểm
    expect(r.duration.method).toBe('approx');
  });

  it('OQ-3 hở (enter không leave, ended) → đóng lastActivity+gap', async () => {
    wire({ events: [ev('09:00', 'enter')], status: 'completed' });
    const r = await dur();
    expect(r.duration.durationMs).toBe(GAP_MS); // [09:00, 09:02]
  });

  it('OQ-3 hở (in_progress, window quá khứ) → nhánh min(now,end)=end, đóng lastActivity+gap', async () => {
    // window 2020 < now → endOrNow = min(now, end) = end → close min(end, 09:00+gap) = 09:02.
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM meetings WHERE id'))
        return Promise.resolve([
          {
            start_time: '2020-01-01T09:00:00.000Z',
            end_time: '2020-01-01T10:00:00.000Z',
            status: 'in_progress',
            actual_start_time: null,
            actual_end_time: null,
          },
        ]);
      if (sql.includes("'matched'"))
        return Promise.resolve([
          {
            event_time: '2020-01-01T09:00:00.000Z',
            direction: 'enter',
            similarity: null,
            sz_uid: 'SZ1',
          },
        ]);
      if (sql.includes('unmatched')) return Promise.resolve([{ n: 0 }]);
      return Promise.resolve([]);
    });
    const r = (await service.getUserPresence('m1', 'u1', ADMIN_CALLER))!;
    expect(r.duration.durationMs).toBe(GAP_MS);
  });

  it('B3 segment thò bound → clip vào [start,end]', async () => {
    wire({ events: [ev('08:50', 'enter'), ev('10:30', 'leave')] });
    const r = await dur();
    // [08:50,10:30] clip → [09:00,10:00] = 60min.
    expect(r.duration.durationMs).toBe(60 * MIN);
    expect(r.duration.presentRatio).toBe(1);
  });

  it('C1 trùng (event_time,direction) → duration KHÔNG đổi', async () => {
    wire({
      events: [
        ev('09:00', 'enter'),
        ev('09:00', 'enter'), // dup
        ev('09:10', 'leave'),
        ev('09:10', 'leave'), // dup
      ],
    });
    const r = await dur();
    expect(r.duration.durationMs).toBe(10 * MIN);
    expect(r.duration.segmentCount).toBe(1);
  });

  it('0-event → duration 0, segments rỗng, approx', async () => {
    wire({ events: [] });
    const r = await dur();
    expect(r.duration.durationMs).toBe(0);
    expect(r.duration.segmentCount).toBe(0);
    expect(r.duration.method).toBe('approx');
  });

  it('C5 cluster 1-điểm (1 seen) → KHÔNG ra 0 (kéo +gap)', async () => {
    wire({ events: [ev('09:00', 'seen')] });
    const r = await dur();
    expect(r.duration.durationMs).toBe(GAP_MS);
  });

  it('C4 unmatchedCount per-user = chỉ unmatched_location', async () => {
    wire({
      events: [ev('09:00', 'enter'), ev('09:10', 'leave')],
      unmatchedLocation: 3,
    });
    const r = await dur();
    expect(r.timeline.unmatchedCount).toBe(3);
  });

  it('OQ-7 presentRatio clamp ≤ 1', async () => {
    wire({ events: [ev('09:00', 'enter'), ev('09:30', 'leave')] });
    const r = await dur();
    expect(r.duration.presentRatio).toBeCloseTo((30 * MIN) / (60 * MIN), 5);
    expect(r.duration.presentRatio).toBeLessThanOrEqual(1);
  });

  it('SEC-01: eventLog metadata-only (KHÔNG ảnh)', async () => {
    wire({ events: [ev('09:00', 'enter')] });
    const r = await dur();
    const log = JSON.stringify(r.timeline.events);
    expect(log).not.toContain('imageBase64');
    expect(log).not.toContain('base64');
    expect(r.timeline.events[0]).toHaveProperty('direction');
  });

  // [FIX 2026-08-13] timeline.events[].id — dùng chung route
  // GET /ivss/device-events/:eventId/snapshot (Room Access Logs) cho cột ảnh vào/ra.
  it('timeline.events[].id đúng giá trị iot_device_events.id thật, đủ cho CẢ 2 event', async () => {
    wire({ events: [ev('09:00', 'enter'), ev('09:10', 'leave')] });
    const r = await dur();
    expect(r.timeline.events).toHaveLength(2);
    expect(r.timeline.events[0].id).toBe('evt-0900-enter');
    expect(r.timeline.events[1].id).toBe('evt-0910-leave');
  });

  it('absentGaps = complement trong bound', async () => {
    wire({ events: [ev('09:10', 'enter'), ev('09:20', 'leave')] });
    const r = await dur();
    // present [09:10,09:20] → absent [09:00,09:10] + [09:20,10:00].
    expect(r.timeline.absentGaps.length).toBe(2);
    expect(r.timeline.absentGaps[0].start).toBe(T('09:00'));
    expect(r.timeline.absentGaps[0].end).toBe(T('09:10'));
  });

  it('gap-threshold từ system_configs (override default)', async () => {
    wire({ events: [ev('09:00', 'seen')], gap: 300 }); // 300s
    const r = await dur();
    expect(r.duration.durationMs).toBe(300 * 1000); // C5 dùng gap=300s
  });

  it('meeting không tồn tại → null', async () => {
    wire({ noMeeting: true });
    expect(await service.getUserPresence('m1', 'u1', ADMIN_CALLER)).toBeNull();
  });

  // [FIX 2026-08-25] loadBound() đổi từ SELECT start_time/end_time (giờ ĐẶT LỊCH) sang
  // SELECT COALESCE(actual_start_time, start_time)/COALESCE(actual_end_time, end_time) —
  // bug cũ: họp bắt đầu/kết thúc lệch giờ đặt lịch vẫn tính presentRatio/timeline theo giờ
  // lịch, KHÔNG theo giờ thật. Mirror pattern COALESCE(m.actual_start_time, m.start_time)
  // đã có sẵn ở checkin-alert.service.ts + meeting.actualStartTime ?? meeting.startTime ở
  // minutes.service.ts — KHÔNG tự phát minh công thức mới.
  describe('COALESCE actual_start_time/actual_end_time (FIX 2026-08-25)', () => {
    it('SQL: query meetings dùng COALESCE(actual_start_time, start_time) và COALESCE(actual_end_time, end_time)', async () => {
      wire({ events: [] });
      await dur();
      const call = dsMock.manager.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('FROM meetings WHERE id'),
      );
      expect(call[0]).toContain(
        'COALESCE(actual_start_time, start_time) AS start_time',
      );
      expect(call[0]).toContain(
        'COALESCE(actual_end_time, end_time) AS end_time',
      );
    });

    it('actual_start_time/actual_end_time CÓ giá trị (họp bắt đầu/kết thúc lệch giờ đặt lịch) → presentRatio tính theo giờ THẬT, không phải giờ lịch', async () => {
      // Đặt lịch 09:00–10:00 (60 phút) nhưng họp THẬT SỰ diễn ra 09:30–09:50 (20 phút,
      // trễ + kết thúc sớm). actualStart/actualEnd mô phỏng đúng giá trị Postgres COALESCE
      // trả về khi actual_*_time đã có — mirror cách wire() giả lập DB thật.
      wire({
        events: [ev('09:30', 'enter'), ev('09:50', 'leave')],
        actualStart: T('09:30'),
        actualEnd: T('09:50'),
      });
      const r = await dur();
      // Có mặt trọn vẹn khung giờ THẬT (09:30–09:50 = 20 phút) → present hết → ratio = 1,
      // KHÔNG phải 20/60 nếu (sai) vẫn lấy mẫu số là khung giờ ĐẶT LỊCH 60 phút.
      expect(r.duration.durationMs).toBe(20 * MIN);
      expect(r.duration.presentRatio).toBe(1);
    });

    it('actual_start_time=NULL (họp CHƯA thực sự bắt đầu, hoặc dữ liệu cũ trước khi có cột này) → COALESCE fallback đúng về start_time/end_time gốc theo giờ ĐẶT LỊCH, KHÔNG vỡ/NaN', async () => {
      // Không truyền actualStart/actualEnd → wire() mô phỏng actual_start_time=null,
      // actual_end_time=null, start_time/end_time = mốc lịch mặc định T('09:00')/T('10:00').
      wire({ events: [ev('09:00', 'enter'), ev('09:30', 'leave')] });
      const r = await dur();
      expect(Number.isNaN(r.duration.durationMs)).toBe(false);
      expect(Number.isNaN(r.duration.presentRatio)).toBe(false);
      expect(r.duration.durationMs).toBe(30 * MIN);
      // Mẫu số vẫn là khung giờ lịch 60 phút (09:00–10:00) vì actual_*_time null.
      expect(r.duration.presentRatio).toBeCloseTo((30 * MIN) / (60 * MIN), 5);
    });
  });

  // ── per-meeting summary ──
  it('getMeetingPresence: summary mỗi participant có method (C2) + identity count (C4)', async () => {
    wire({
      events: [ev('09:00', 'enter'), ev('09:10', 'leave')],
      participants: [
        { user_id: 'u1', full_name: 'Alice' },
        { user_id: 'u2', full_name: 'Bob' },
      ],
      unmatchedIdentity: 7,
    });
    const r = (await service.getMeetingPresence('m1', ADMIN_CALLER))!;
    expect(r.participants.length).toBe(2);
    expect(r.participants[0]).toHaveProperty('method'); // C2
    expect(r.participants[0].fullName).toBe('Alice');
    expect(r.meetingUnmatchedIdentityCount).toBe(7); // C4
  });

  // [FIX 2026-08-13] participants[] thêm email/avatarUrl/employeeCode/departmentName —
  // cho modal thông tin cá nhân FE. JOIN users đã có sẵn (email/avatarUrl/employeeCode
  // KHÔNG tốn JOIN mới), departmentName qua LEFT JOIN departments mới thêm.
  it('getMeetingPresence: participants[] có đủ email/avatarUrl/employeeCode/departmentName đúng giá trị thật', async () => {
    wire({
      events: [ev('09:00', 'enter'), ev('09:10', 'leave')],
      participants: [
        {
          user_id: 'u1',
          full_name: 'Trần Đức Hải',
          email: 'hai.tran@smartracking.io.vn',
          avatar_url: 'https://cdn.example.com/avatars/u1.jpg',
          employee_code: 'NV-0042',
          department_name: 'Phòng Công nghệ thông tin',
        },
      ],
    });
    const r = (await service.getMeetingPresence('m1', ADMIN_CALLER))!;
    expect(r.participants[0]).toMatchObject({
      userId: 'u1',
      fullName: 'Trần Đức Hải',
      email: 'hai.tran@smartracking.io.vn',
      avatarUrl: 'https://cdn.example.com/avatars/u1.jpg',
      employeeCode: 'NV-0042',
      departmentName: 'Phòng Công nghệ thông tin',
    });
  });

  it('getMeetingPresence: loadParticipants() query có LEFT JOIN departments (không N+1, vẫn 1 query)', async () => {
    wire({ events: [], participants: [] });
    await service.getMeetingPresence('m1', ADMIN_CALLER);
    const call = dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('meeting_participants'),
    );
    expect(call[0]).toContain('LEFT JOIN departments');
    expect(call[0]).toContain('u.email');
    expect(call[0]).toContain('u.avatar_url');
    expect(call[0]).toContain('u.employee_code');
    expect(call[0]).toContain('d.department_name');
  });

  it('getMeetingPresence: meeting không tồn tại → null', async () => {
    wire({ noMeeting: true });
    expect(await service.getMeetingPresence('m1', ADMIN_CALLER)).toBeNull();
  });

  // ══════════════════════════════════════════════════════════════════════
  // [FIX 2026-08-13] Scope-check — lỗ hổng đang tồn tại thật (Manager xem được
  // MỌI meeting không giới hạn phòng ban), đã xác nhận qua recon, vá tại đây.
  // ══════════════════════════════════════════════════════════════════════
  describe('resolveScope() + scope-check (FIX 2026-08-13)', () => {
    const targetUserId = 'target-u1';

    const roleOf = (role: string): void => {
      authzMock.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: [role],
        permissions: [],
      });
    };

    beforeEach(() => {
      // Mọi test scope KHÔNG cần thuật toán streak đúng — chỉ cần loadBound() +
      // loadEvents() không throw. Wire tối thiểu.
      wire({ events: [] });
    });

    it('EMPLOYEE gọi getUserPresence cho CHÍNH MÌNH → thành công', async () => {
      roleOf('EMPLOYEE');
      const r = await service.getUserPresence('m1', 'self-1', 'self-1');
      expect(r).not.toBeNull();
    });

    it('EMPLOYEE gọi getUserPresence cho NGƯỜI KHÁC → 403 SELF_ONLY', async () => {
      roleOf('EMPLOYEE');
      let caught: unknown;
      try {
        await service.getUserPresence('m1', targetUserId, 'self-1');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as ForbiddenException).getResponse()).toMatchObject({
        error: { code: 'SELF_ONLY' },
      });
    });

    it('EMPLOYEE gọi getMeetingPresence → lọc CHỈ còn đúng 1 dòng của chính họ (im lặng, KHÔNG 403)', async () => {
      roleOf('EMPLOYEE');
      wire({
        events: [],
        participants: [
          { user_id: 'self-1', full_name: 'Chính họ' },
          { user_id: 'other-1', full_name: 'Người khác' },
        ],
      });
      const r = (await service.getMeetingPresence('m1', 'self-1'))!;
      expect(r.participants).toHaveLength(1);
      expect(r.participants[0].userId).toBe('self-1');
    });

    it('MANAGER gọi cho participant TRONG phòng ban mình quản lý → thành công', async () => {
      roleOf('MANAGER');
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM meetings WHERE id'))
          return Promise.resolve([
            {
              start_time: T('09:00'),
              end_time: T('10:00'),
              status: 'completed',
              actual_start_time: null,
              actual_end_time: null,
            },
          ]);
        if (sql.includes('FROM departments WHERE (manager_user_id'))
          return Promise.resolve([{ id: 'dept-1' }]);
        if (sql.includes('SELECT department_id FROM users'))
          return Promise.resolve([{ department_id: 'dept-1' }]);
        if (sql.includes("'matched'")) return Promise.resolve([]);
        if (sql.includes('unmatched')) return Promise.resolve([{ n: 0 }]);
        return Promise.resolve([]);
      });
      const r = await service.getUserPresence('m1', targetUserId, 'mgr-1');
      expect(r).not.toBeNull();
    });

    // [FIX 2026-08-13] TEST QUAN TRỌNG NHẤT — xác nhận lỗ hổng đang tồn tại thật
    // (Manager xem được presence của MỌI meeting, không giới hạn phòng ban) đã được vá.
    it('MANAGER gọi cho participant NGOÀI phòng ban mình quản lý → 403 DEPARTMENT_OUT_OF_SCOPE', async () => {
      roleOf('MANAGER');
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM departments WHERE (manager_user_id'))
          return Promise.resolve([{ id: 'dept-1' }]); // Manager quản lý dept-1
        if (sql.includes('SELECT department_id FROM users'))
          return Promise.resolve([{ department_id: 'dept-2' }]); // target thuộc dept-2
        return Promise.resolve([]);
      });
      let caught: unknown;
      try {
        await service.getUserPresence('m1', targetUserId, 'mgr-1');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as ForbiddenException).getResponse()).toMatchObject({
        error: { code: 'DEPARTMENT_OUT_OF_SCOPE' },
      });
    });

    it('MANAGER gọi getMeetingPresence cho họp liên phòng ban → CHỈ còn participant thuộc phòng ban mình', async () => {
      roleOf('MANAGER');
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM meetings WHERE id'))
          return Promise.resolve([
            {
              start_time: T('09:00'),
              end_time: T('10:00'),
              status: 'completed',
              actual_start_time: null,
              actual_end_time: null,
            },
          ]);
        if (sql.includes('FROM departments WHERE (manager_user_id'))
          return Promise.resolve([{ id: 'dept-1' }]);
        if (sql.includes('meeting_participants'))
          return Promise.resolve([
            { user_id: 'in-scope-1', full_name: 'Trong phòng ban' },
            { user_id: 'out-scope-1', full_name: 'Khác phòng ban' },
          ]);
        // filterParticipantsByScope: chỉ in-scope-1 thuộc dept-1.
        if (sql.includes('WHERE id = ANY($1::uuid[])'))
          return Promise.resolve([{ user_id: 'in-scope-1' }]);
        if (sql.includes("'matched'")) return Promise.resolve([]);
        if (sql.includes('unmatched')) return Promise.resolve([{ n: 0 }]);
        return Promise.resolve([]);
      });
      const r = (await service.getMeetingPresence('m1', 'mgr-1'))!;
      expect(r.participants).toHaveLength(1);
      expect(r.participants[0].userId).toBe('in-scope-1');
    });

    it('BUSINESS_ADMIN → không giới hạn (trước đây 403 do thiếu permission)', async () => {
      roleOf('BUSINESS_ADMIN');
      const r = await service.getUserPresence('m1', targetUserId, 'ba-1');
      expect(r).not.toBeNull();
    });

    it('SYSTEM_ADMIN → không giới hạn (regression)', async () => {
      roleOf('SYSTEM_ADMIN');
      const r = await service.getUserPresence('m1', targetUserId, 'sa-1');
      expect(r).not.toBeNull();
    });

    // ════════════════════════════════════════════════════════════════════
    // [FIX 2026-08-25] Host-của-CHÍNH-meeting-đang-xem (Employee) — cho phép Host xem đủ
    // thời lượng tham dự của TẤT CẢ participant trong cuộc họp họ chủ trì, KHÔNG mở rộng
    // ra toàn hệ thống (khác BUSINESS_ADMIN/SYSTEM_ADMIN — vẫn phải đúng ĐÚNG meetingId).
    // ════════════════════════════════════════════════════════════════════
    describe('isHostOfMeeting bypass (FIX 2026-08-25)', () => {
      it('(a) Employee là HOST của ĐÚNG meeting đang xem → getUserPresence xem được người KHÁC', async () => {
        roleOf('EMPLOYEE');
        wire({ events: [], hostId: 'host-1' });
        const r = await service.getUserPresence('m1', targetUserId, 'host-1');
        expect(r).not.toBeNull();
      });

      it('(a) Employee là HOST của ĐÚNG meeting đang xem → getMeetingPresence trả ĐỦ mọi participant, KHÔNG bị lọc', async () => {
        roleOf('EMPLOYEE');
        wire({
          events: [],
          hostId: 'host-1',
          participants: [
            { user_id: 'host-1', full_name: 'Host' },
            { user_id: 'other-1', full_name: 'Người khác' },
          ],
        });
        const r = (await service.getMeetingPresence('m1', 'host-1'))!;
        expect(r.participants).toHaveLength(2);
        expect(r.participants.map((p) => p.userId).sort()).toEqual([
          'host-1',
          'other-1',
        ]);
      });

      it('(b) Employee là participant THƯỜNG (không phải host — meeting có host là người khác) → VẪN chỉ xem được chính mình, 403 SELF_ONLY khi xem người khác', async () => {
        roleOf('EMPLOYEE');
        // host_id của meeting 'm1' là 'host-1' — 'self-1' KHÔNG phải host.
        wire({ events: [], hostId: 'host-1' });
        let caught: unknown;
        try {
          await service.getUserPresence('m1', targetUserId, 'self-1');
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(ForbiddenException);
        expect((caught as ForbiddenException).getResponse()).toMatchObject({
          error: { code: 'SELF_ONLY' },
        });
      });

      it('(c) QUAN TRỌNG NHẤT — Employee là host của MEETING KHÁC (m2), KHÔNG phải host của meeting ĐANG XEM (m1) → KHÔNG được mở khoá, vẫn 403 SELF_ONLY (chống lộ dữ liệu chéo)', async () => {
        roleOf('EMPLOYEE');
        // Đang xem meeting 'm1', nhưng host_id thật của 'm1' là 'someone-else' —
        // 'host-of-m2' (dù có thể là host của 1 meeting KHÁC ngoài phạm vi test này)
        // KHÔNG được xem đủ participant của 'm1'.
        wire({ events: [], hostId: 'someone-else' });
        let caught: unknown;
        try {
          await service.getUserPresence('m1', targetUserId, 'host-of-m2');
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(ForbiddenException);
        expect((caught as ForbiddenException).getResponse()).toMatchObject({
          error: { code: 'SELF_ONLY' },
        });
      });

      it('(c) QUAN TRỌNG NHẤT — getMeetingPresence cùng kịch bản → participant list vẫn bị lọc còn đúng 1 dòng của caller (KHÔNG lộ participant khác)', async () => {
        roleOf('EMPLOYEE');
        wire({
          events: [],
          hostId: 'someone-else',
          participants: [
            { user_id: 'host-of-m2', full_name: 'Không phải host ở đây' },
            { user_id: 'other-1', full_name: 'Người khác' },
          ],
        });
        const r = (await service.getMeetingPresence('m1', 'host-of-m2'))!;
        expect(r.participants).toHaveLength(1);
        expect(r.participants[0].userId).toBe('host-of-m2');
      });

      it('(d) BUSINESS_ADMIN → hành vi KHÔNG đổi (regression) — KHÔNG cần/KHÔNG gọi query host_id', async () => {
        roleOf('BUSINESS_ADMIN');
        wire({ events: [] });
        const r = await service.getUserPresence('m1', targetUserId, 'ba-1');
        expect(r).not.toBeNull();
        const hostIdCall = dsMock.manager.query.mock.calls.find((c: any[]) =>
          String(c[0]).includes('SELECT host_id'),
        );
        expect(hostIdCall).toBeUndefined();
      });
    });
  });
});
