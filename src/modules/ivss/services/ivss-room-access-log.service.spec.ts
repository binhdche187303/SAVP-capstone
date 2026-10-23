/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { IvssRoomAccessLogService } from './ivss-room-access-log.service.js';

const ROOM_ID = '097cf988-8976-42d9-a83d-e5a0013022d9';

describe('IvssRoomAccessLogService (RAL-001 / Màn 2 + ALS-002)', () => {
  let service: IvssRoomAccessLogService;
  let dsMock: any;
  let captured: Array<{ sql: string; params: any[] }>;

  const isCountQuery = (sql: string) => sql.includes('COUNT(*)');
  const isEventQuery = (sql: string) =>
    sql.includes('FROM iot_device_events') && !isCountQuery(sql);

  /**
   * Mock 3 query: rooms (kiểm tồn tại) + COUNT (tổng/matched/unmatched) +
   * SELECT event (trang hiện tại). `counts` mặc định suy ra từ `events` cho gọn —
   * test phân trang truyền `counts` riêng để giả lập total > số dòng trong trang.
   */
  const wire = (
    over: { room?: any[]; events?: any[]; counts?: any } = {},
  ): void => {
    captured = [];
    const events = over.events ?? [];
    const counts = over.counts ?? {
      total: String(events.length),
      matched: String(
        events.filter((e: any) => e.match_state === 'matched').length,
      ),
      unmatched: String(
        events.filter((e: any) => String(e.match_state).startsWith('unmatched'))
          .length,
      ),
    };
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM rooms') && !sql.includes('iot_device_events'))
        return Promise.resolve(over.room ?? [{ room_name: 'Phòng A102' }]);
      if (isCountQuery(sql)) return Promise.resolve([counts]);
      if (isEventQuery(sql)) return Promise.resolve(events);
      return Promise.resolve([]);
    });
  };

  const evt = (over: any = {}) => ({
    id: 'e1',
    event_time: '2026-07-28T10:45:21.000Z',
    user_id: 'u1',
    full_name: 'Bui Van Long',
    avatar_url: 'https://cdn.example.com/avatars/u1.png',
    email: 'long.bui@example.com',
    department_name: 'IT',
    room_id: ROOM_ID,
    room_name: 'Phòng A102',
    direction: 'enter',
    match_state: 'matched',
    similarity: '0.98',
    meeting_id: 'mt1',
    ...over,
  });

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssRoomAccessLogService,
        { provide: DataSource, useValue: dsMock },
      ],
    }).compile();
    service = module.get(IvssRoomAccessLogService);
  });

  afterEach(() => jest.clearAllMocks());

  it('phòng không tồn tại / đã soft-delete → 404 ROOM_NOT_FOUND', async () => {
    wire({ room: [] });
    await expect(
      service.getRoomAccessLog(ROOM_ID, { date: '2026-07-28' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('map đúng field camelCase + roomName + date', async () => {
    wire({ events: [evt()] });
    const r = await service.getRoomAccessLog(ROOM_ID, { date: '2026-07-28' });
    expect(r.roomId).toBe(ROOM_ID);
    expect(r.roomName).toBe('Phòng A102');
    expect(r.date).toBe('2026-07-28');
    expect(r.events[0]).toEqual({
      id: 'e1',
      eventTime: '2026-07-28T10:45:21.000Z',
      userId: 'u1',
      fullName: 'Bui Van Long',
      user: {
        avatarUrl: 'https://cdn.example.com/avatars/u1.png',
        email: 'long.bui@example.com',
        department: 'IT',
      },
      roomId: ROOM_ID,
      roomName: 'Phòng A102',
      direction: 'enter',
      matchState: 'matched',
      similarity: 0.98, // string từ jsonb → number
      meetingId: 'mt1',
      // Họp 20/10: log camera luôn mang thông tin camera/khu vực/nhóm.
      deviceId: null,
      deviceCode: null,
      deviceName: null,
      zoneName: null,
      groupNames: [],
      isStranger: false,
      isUnmatched: false,
    });
  });

  // [FE-2026-08-09] user{avatarUrl,email,department} — KHÔNG có phone/role (xem DTO comment).
  it('userId=null (chưa khớp danh tính) → user object=null, KHÔNG có avatarUrl/email/department rò rỉ', async () => {
    wire({
      events: [
        evt({
          user_id: null,
          full_name: null,
          avatar_url: null,
          email: null,
          department_name: null,
          match_state: 'unmatched_identity',
        }),
      ],
    });
    const r = await service.getRoomAccessLog(ROOM_ID, { date: '2026-07-28' });
    expect(r.events[0].user).toBeNull();
  });

  it('SQL: LEFT JOIN departments d ON d.id = u.department_id + SELECT avatar_url/email/department_name', async () => {
    wire();
    await service.getRoomAccessLog(ROOM_ID, { date: '2026-07-28' });
    const q = captured.find((c) => isEventQuery(c.sql))!;
    expect(q.sql).toContain(
      'LEFT JOIN departments d ON d.id = u.department_id',
    );
    expect(q.sql).toContain('u.avatar_url');
    expect(q.sql).toContain('u.email');
    expect(q.sql).toContain('d.department_name');
  });

  it('đếm matched/unmatched lấy từ COUNT query (toàn bộ kết quả lọc)', async () => {
    wire({
      events: [
        evt({ id: 'e1', match_state: 'matched' }),
        evt({ id: 'e2', match_state: 'matched', direction: 'leave' }),
        evt({ id: 'e3', match_state: 'unmatched_location' }),
        evt({ id: 'e4', match_state: 'unmatched_identity', user_id: null }),
      ],
    });
    const r = await service.getRoomAccessLog(ROOM_ID, { date: '2026-07-28' });
    expect(r.totalEvents).toBe(4);
    expect(r.matchedCount).toBe(2);
    expect(r.unmatchedCount).toBe(2);
  });

  // ── ALS-002: isStranger ĐỔI NGHĨA (userId==null), isUnmatched giữ nghĩa cũ ──
  describe('isStranger (userId==null) vs isUnmatched (matchState unmatched*)', () => {
    it('matched → isStranger=false, isUnmatched=false', async () => {
      wire({ events: [evt({ match_state: 'matched', user_id: 'u1' })] });
      const r = await service.getRoomAccessLog(ROOM_ID, {
        date: '2026-07-28',
      });
      expect(r.events[0].isStranger).toBe(false);
      expect(r.events[0].isUnmatched).toBe(false);
    });

    it('unmatched_identity + userId=null → CÓ trong kết quả, isStranger=true, fullName=null, isUnmatched=true', async () => {
      wire({
        events: [
          evt({
            match_state: 'unmatched_identity',
            user_id: null,
            full_name: null,
          }),
        ],
      });
      const r = await service.getRoomAccessLog(ROOM_ID, {
        date: '2026-07-28',
      });
      expect(r.events).toHaveLength(1); // KHÔNG bị lọc bỏ
      expect(r.events[0].isStranger).toBe(true);
      expect(r.events[0].fullName).toBeNull();
      expect(r.events[0].isUnmatched).toBe(true);
    });

    it('unmatched_location + userId có giá trị → CÓ trong kết quả, isStranger=false, fullName=tên thật, isUnmatched=true', async () => {
      wire({
        events: [
          evt({
            match_state: 'unmatched_location',
            user_id: 'u1',
            full_name: 'Bui Van Long',
          }),
        ],
      });
      const r = await service.getRoomAccessLog(ROOM_ID, {
        date: '2026-07-28',
      });
      expect(r.events).toHaveLength(1);
      // Đây chính là điểm ĐỔI so với bản cũ (cũ: startsWith('unmatched') → true).
      expect(r.events[0].isStranger).toBe(false);
      expect(r.events[0].fullName).toBe('Bui Van Long');
      // Ngữ nghĩa cũ vẫn giữ nguyên ở isUnmatched cho FE đang dùng.
      expect(r.events[0].isUnmatched).toBe(true);
    });

    it('unmatched_both + userId=null → CÓ trong kết quả, isStranger=true, isUnmatched=true', async () => {
      wire({
        events: [
          evt({
            match_state: 'unmatched_both',
            user_id: null,
            full_name: null,
          }),
        ],
      });
      const r = await service.getRoomAccessLog(ROOM_ID, {
        date: '2026-07-28',
      });
      expect(r.events).toHaveLength(1);
      expect(r.events[0].isStranger).toBe(true);
      expect(r.events[0].fullName).toBeNull();
      expect(r.events[0].isUnmatched).toBe(true);
    });

    it('1 event matched + 1 stranger (userId null) → isStranger đúng từng dòng', async () => {
      wire({
        events: [
          evt({ id: 'ok', match_state: 'matched', user_id: 'u1' }),
          evt({
            id: 'stranger',
            match_state: 'unmatched_identity',
            user_id: null,
            full_name: null,
          }),
        ],
      });
      const r = await service.getRoomAccessLog(ROOM_ID, {
        date: '2026-07-28',
      });
      expect(r.events.map((e) => e.isStranger)).toEqual([false, true]);
    });

    it('4 matchState trộn lẫn → tổng số dòng TRƯỚC/SAU fix bằng nhau (không lọc bớt/thêm)', async () => {
      const mixed = [
        evt({ id: 'e1', match_state: 'matched', user_id: 'u1' }),
        evt({
          id: 'e2',
          match_state: 'unmatched_identity',
          user_id: null,
          full_name: null,
        }),
        evt({ id: 'e3', match_state: 'unmatched_location', user_id: 'u2' }),
        evt({
          id: 'e4',
          match_state: 'unmatched_both',
          user_id: null,
          full_name: null,
        }),
      ];
      wire({ events: mixed });
      const r = await service.getRoomAccessLog(ROOM_ID, {
        date: '2026-07-28',
      });
      // WHERE clause KHÔNG đổi → số dòng SQL trả về = số dòng events truyền vào.
      expect(r.events).toHaveLength(mixed.length);
      expect(r.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    });
  });

  it('event chưa khớp danh tính (userId/full_name null) VẪN được trả, không loại', async () => {
    wire({
      events: [
        evt({
          id: 'e9',
          user_id: null,
          full_name: null,
          match_state: 'unmatched_identity',
          similarity: null,
        }),
      ],
    });
    const r = await service.getRoomAccessLog(ROOM_ID, { date: '2026-07-28' });
    expect(r.totalEvents).toBe(1);
    expect(r.events[0].userId).toBeNull();
    expect(r.events[0].fullName).toBeNull();
    expect(r.events[0].similarity).toBeNull();
    expect(r.events[0].isStranger).toBe(true);
  });

  it('SQL: lọc đúng event_type/room_id + biên ngày [date, date+1) THEO GIỜ VN', async () => {
    wire();
    await service.getRoomAccessLog(ROOM_ID, { date: '2026-07-28' });
    const q = captured.find((c) => isEventQuery(c.sql))!;
    // ⚠ RDS chạy UTC — biên ngày PHẢI ép Asia/Ho_Chi_Minh, nếu không event buổi tối
    // giờ VN rơi nhầm sang ngày hôm sau.
    expect(q.sql).toContain(
      "e.event_time >= ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')",
    );
    expect(q.sql).toContain(
      "(($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')",
    );
    // Chặn hồi quy 1: KHÔNG quay lại $2::date trần (phụ thuộc TZ phiên DB).
    expect(q.sql).not.toMatch(/event_time\s*>=\s*\$2::date\s/);
    // Chặn hồi quy 2: KHÔNG bỏ ::timestamp. Thiếu nó, Postgres ép date→timestamptz
    // rồi AT TIME ZONE chạy ngược chiều → biên lệch +7h SAI HƯỚNG (đã kiểm bằng psql).
    expect(q.sql).not.toMatch(/\$2::date AT TIME ZONE/);
    expect(q.sql).toContain('LEFT JOIN users u');
    expect(q.params.slice(0, 5)).toEqual([
      'ivss_face_event',
      '2026-07-28',
      ROOM_ID,
      null,
      null,
    ]);
  });

  it('thiếu date → tự dùng hôm nay (YYYY-MM-DD)', async () => {
    wire();
    const r = await service.getRoomAccessLog(ROOM_ID);
    expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const q = captured.find((c) => isEventQuery(c.sql))!;
    expect(q.params[1]).toBe(r.date);
  });

  // ── ALS-002: route toàn hệ thống (roomId = null) ──────────────────────────
  describe('toàn hệ thống (roomId null)', () => {
    it('KHÔNG kiểm tồn tại phòng, KHÔNG lọc room_id (param $3 = null)', async () => {
      wire({ events: [evt()] });
      const r = await service.getRoomAccessLog(null, { date: '2026-07-28' });
      expect(r.roomId).toBeNull();
      expect(r.roomName).toBeNull();
      // Không có query kiểm phòng.
      expect(
        captured.some(
          (c) =>
            c.sql.includes('FROM rooms') && c.sql.includes('room_name FROM'),
        ),
      ).toBe(false);
      const q = captured.find((c) => isEventQuery(c.sql))!;
      expect(q.params[2]).toBeNull();
      // Điều kiện lọc phòng phải là dạng bỏ qua được khi null.
      expect(q.sql).toContain('$3::uuid IS NULL OR e.room_id = $3::uuid');
    });

    it('trả roomId/roomName của TỪNG event (nhiều phòng lẫn nhau)', async () => {
      wire({
        events: [
          evt({ id: 'a', room_id: 'r1', room_name: 'A101' }),
          evt({ id: 'b', room_id: 'r2', room_name: 'B202' }),
        ],
      });
      const r = await service.getRoomAccessLog(null, { date: '2026-07-28' });
      expect(r.events.map((e) => e.roomName)).toEqual(['A101', 'B202']);
    });
  });

  // ── ALS-002: phân trang ───────────────────────────────────────────────────
  describe('phân trang', () => {
    it('mặc định page=1 limit=20 → LIMIT/OFFSET đúng', async () => {
      wire();
      const r = await service.getRoomAccessLog(ROOM_ID, {
        date: '2026-07-28',
      });
      const q = captured.find((c) => isEventQuery(c.sql))!;
      expect(q.sql).toContain('LIMIT $6 OFFSET $7');
      expect(q.params[5]).toBe(20);
      expect(q.params[6]).toBe(0);
      expect(r.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });

    it('page=3 limit=10 → OFFSET 20, totalPages tính từ total của COUNT', async () => {
      wire({
        events: [evt()],
        counts: { total: '45', matched: '40', unmatched: '5' },
      });
      const r = await service.getRoomAccessLog(ROOM_ID, {
        date: '2026-07-28',
        page: 3,
        limit: 10,
      });
      const q = captured.find((c) => isEventQuery(c.sql))!;
      expect(q.params[5]).toBe(10);
      expect(q.params[6]).toBe(20);
      expect(r.pagination).toEqual({
        page: 3,
        limit: 10,
        total: 45,
        totalPages: 5,
      });
      // totalEvents = tổng toàn bộ, KHÔNG phải số dòng trong trang.
      expect(r.totalEvents).toBe(45);
      expect(r.events).toHaveLength(1);
    });
  });

  // ── ALS-002: search theo tên ──────────────────────────────────────────────
  describe('search theo users.full_name', () => {
    it('có search → truyền vào param $4, SQL dùng ILIKE', async () => {
      wire();
      await service.getRoomAccessLog(ROOM_ID, {
        date: '2026-07-28',
        search: 'Long',
      });
      const q = captured.find((c) => isEventQuery(c.sql))!;
      expect(q.params[3]).toBe('Long');
      expect(q.sql).toContain("u.full_name ILIKE '%' || $4::text || '%'");
    });

    it('search rỗng/chỉ khoảng trắng → coi như không lọc (param null)', async () => {
      wire();
      await service.getRoomAccessLog(ROOM_ID, {
        date: '2026-07-28',
        search: '   ',
      });
      const q = captured.find((c) => isEventQuery(c.sql))!;
      expect(q.params[3]).toBeNull();
    });
  });

  // ── meetingId: lọc theo ca họp cụ thể (AND với date, không thay biên ngày) ─
  describe('meetingId', () => {
    const MEETING_ID = '11111111-1111-4111-8111-111111111111';

    it('truyền meetingId đúng → SQL nhận param $5 + clause AND với date, không OR', async () => {
      wire({ events: [evt({ meeting_id: MEETING_ID })] });
      const r = await service.getRoomAccessLog(ROOM_ID, {
        date: '2026-07-28',
        meetingId: MEETING_ID,
      });
      const q = captured.find((c) => isEventQuery(c.sql))!;
      expect(q.sql).toContain(
        'AND ($5::uuid IS NULL OR e.meeting_id = $5::uuid)',
      );
      expect(q.params[4]).toBe(MEETING_ID);
      expect(r.events[0].meetingId).toBe(MEETING_ID);
    });

    it('meetingId không tồn tại → mảng rỗng, không lỗi (mock giả lập COUNT/SELECT rỗng)', async () => {
      wire({
        events: [],
        counts: { total: '0', matched: '0', unmatched: '0' },
      });
      const r = await service.getRoomAccessLog(ROOM_ID, {
        date: '2026-07-28',
        meetingId: MEETING_ID,
      });
      expect(r.events).toEqual([]);
      expect(r.totalEvents).toBe(0);
    });

    it('không truyền meetingId → param $5 = null, giữ hành vi cũ (mọi event trong ngày)', async () => {
      wire({ events: [evt()] });
      const r = await service.getRoomAccessLog(ROOM_ID, { date: '2026-07-28' });
      const q = captured.find((c) => isEventQuery(c.sql))!;
      expect(q.params[4]).toBeNull();
      expect(r.events).toHaveLength(1);
    });
  });

  // ── Timezone của mặc định "hôm nay" (EC2 chạy UTC) ────────────────────────
  describe('todayStr() theo giờ VN', () => {
    afterEach(() => jest.useRealTimers());

    it('02:00 giờ VN (=19:00 UTC hôm trước) → trả NGÀY HÔM NAY theo VN, KHÔNG phải hôm qua', async () => {
      // 2026-07-28 19:00 UTC === 2026-07-29 02:00 giờ VN.
      jest.useFakeTimers().setSystemTime(new Date('2026-07-28T19:00:00Z'));
      wire();
      const r = await service.getRoomAccessLog(ROOM_ID);
      expect(r.date).toBe('2026-07-29'); // bản cũ (theo UTC) sẽ trả '2026-07-28'
    });

    it('23:00 giờ VN (=16:00 UTC cùng ngày) → vẫn đúng ngày VN', async () => {
      // 2026-07-29 16:00 UTC === 2026-07-29 23:00 giờ VN.
      jest.useFakeTimers().setSystemTime(new Date('2026-07-29T16:00:00Z'));
      wire();
      const r = await service.getRoomAccessLog(ROOM_ID);
      expect(r.date).toBe('2026-07-29');
    });

    it('chặn hồi quy: KHÔNG dùng getFullYear/getMonth/getDate theo giờ process', () => {
      // Đọc thẳng source: 3 hàm này lấy theo timezone TIẾN TRÌNH → sai trên EC2 UTC.
      const src = readFileSync(
        join(__dirname, 'ivss-room-access-log.service.ts'),
        'utf8',
      );
      expect(src).not.toMatch(/getFullYear\(\)/);
      expect(src).not.toMatch(/getMonth\(\)/);
      expect(src).not.toMatch(/getDate\(\)/);
      expect(src).toContain("Intl.DateTimeFormat('en-CA'");
      expect(src).toContain('timeZone: BUSINESS_TIMEZONE');
    });
  });

  it('ngày không có dữ liệu → mảng rỗng, các count = 0 (KHÔNG lỗi)', async () => {
    wire({ events: [] });
    const r = await service.getRoomAccessLog(ROOM_ID, { date: '2026-01-01' });
    expect(r.events).toEqual([]);
    expect(r.totalEvents).toBe(0);
    expect(r.matchedCount).toBe(0);
    expect(r.unmatchedCount).toBe(0);
  });
});
