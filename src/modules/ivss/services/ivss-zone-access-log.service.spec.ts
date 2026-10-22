/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { IvssZoneAccessLogService } from './ivss-zone-access-log.service.js';

const ZONE_ID = '097cf988-8976-42d9-a83d-e5a0013022d9';

/**
 * Mirror ivss-room-access-log.service.spec.ts (RAL-001), điều chỉnh: KHÔNG có
 * "toàn hệ thống" (zoneId luôn bắt buộc — chỉ 1 endpoint), KHÔNG có meetingId.
 */
describe('IvssZoneAccessLogService (Zone Access Log — đường B, FIX 2026-08-11)', () => {
  let service: IvssZoneAccessLogService;
  let dsMock: any;
  let captured: Array<{ sql: string; params: any[] }>;

  const isCountQuery = (sql: string) => sql.includes('COUNT(*)');
  const isEventQuery = (sql: string) =>
    sql.includes('FROM iot_device_events') && !isCountQuery(sql);

  const wire = (
    over: { zone?: any[]; events?: any[]; counts?: any } = {},
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
      if (sql.includes('FROM zones') && !sql.includes('iot_device_events'))
        return Promise.resolve(
          over.zone ?? [{ zone_name: 'Hành lang tầng 2' }],
        );
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
    direction: 'enter',
    match_state: 'matched',
    similarity: '0.98',
    ...over,
  });

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssZoneAccessLogService,
        { provide: DataSource, useValue: dsMock },
      ],
    }).compile();
    service = module.get(IvssZoneAccessLogService);
  });

  afterEach(() => jest.clearAllMocks());

  it('zone không tồn tại / đã soft-delete → 404 ZONE_NOT_FOUND', async () => {
    wire({ zone: [] });
    await expect(
      service.getZoneAccessLog(ZONE_ID, { date: '2026-07-28' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('map đúng field camelCase + zoneName + date', async () => {
    wire({ events: [evt()] });
    const r = await service.getZoneAccessLog(ZONE_ID, { date: '2026-07-28' });
    expect(r.zoneId).toBe(ZONE_ID);
    expect(r.zoneName).toBe('Hành lang tầng 2');
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
      zoneId: ZONE_ID,
      zoneName: 'Hành lang tầng 2',
      direction: 'enter',
      matchState: 'matched',
      similarity: 0.98, // string từ jsonb → number
      // Họp 20/10: log camera luôn mang thông tin camera/nhóm (null/[] khi thiết bị không xác định).
      deviceId: null,
      deviceCode: null,
      deviceName: null,
      groupNames: [],
      isStranger: false,
      isUnmatched: false,
    });
  });

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
    const r = await service.getZoneAccessLog(ZONE_ID, { date: '2026-07-28' });
    expect(r.events[0].user).toBeNull();
  });

  it('SQL: LEFT JOIN departments d ON d.id = u.department_id + SELECT avatar_url/email/department_name', async () => {
    wire();
    await service.getZoneAccessLog(ZONE_ID, { date: '2026-07-28' });
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
    const r = await service.getZoneAccessLog(ZONE_ID, { date: '2026-07-28' });
    expect(r.totalEvents).toBe(4);
    expect(r.matchedCount).toBe(2);
    expect(r.unmatchedCount).toBe(2);
  });

  // [FIX 2026-08-15] Trước fix ivss-presence-ingestion.service.ts (matchStateOf() luôn ra
  // 'unmatched_location' cho Zone bất kể danh tính) — matchedCount ở đây LUÔN = 0 dù có bao
  // nhiêu người quen đi qua, vì DB không bao giờ có dòng match_state='matched' cho Zone. Bản
  // thân service này KHÔNG đổi code (chỉ đọc match_state đã lưu) — test này khoá lại đúng
  // hành vi mong đợi SAU khi ingestion ghi đúng 'matched', tránh regression ở tầng đếm.
  it('người quen đi qua Zone (sau fix, ingestion ghi matchState=matched) → matchedCount > 0, KHÔNG còn luôn = 0', async () => {
    wire({
      events: [
        evt({ id: 'e1', match_state: 'matched', user_id: 'u1' }),
        evt({
          id: 'e2',
          match_state: 'matched',
          user_id: 'u2',
          direction: 'leave',
        }),
      ],
    });
    const r = await service.getZoneAccessLog(ZONE_ID, { date: '2026-07-28' });
    expect(r.matchedCount).toBeGreaterThan(0);
    expect(r.matchedCount).toBe(2);
    expect(r.unmatchedCount).toBe(0);
  });

  // ── isStranger (userId==null) vs isUnmatched (matchState unmatched*) — mirror RAL-001 ──
  describe('isStranger (userId==null) vs isUnmatched (matchState unmatched*)', () => {
    it('matched → isStranger=false, isUnmatched=false', async () => {
      wire({ events: [evt({ match_state: 'matched', user_id: 'u1' })] });
      const r = await service.getZoneAccessLog(ZONE_ID, { date: '2026-07-28' });
      expect(r.events[0].isStranger).toBe(false);
      expect(r.events[0].isUnmatched).toBe(false);
    });

    it('unmatched_identity + userId=null → CÓ trong kết quả, isStranger=true, fullName=null, isUnmatched=true (người lạ hiển thị đúng như đã confirm ở RoomAccessLogs)', async () => {
      wire({
        events: [
          evt({
            match_state: 'unmatched_identity',
            user_id: null,
            full_name: null,
          }),
        ],
      });
      const r = await service.getZoneAccessLog(ZONE_ID, { date: '2026-07-28' });
      expect(r.events).toHaveLength(1); // KHÔNG bị lọc bỏ
      expect(r.events[0].isStranger).toBe(true);
      expect(r.events[0].fullName).toBeNull();
      expect(r.events[0].isUnmatched).toBe(true);
    });

    it('unmatched_location + userId có giá trị → isStranger=false, fullName=tên thật, isUnmatched=true', async () => {
      wire({
        events: [
          evt({
            match_state: 'unmatched_location',
            user_id: 'u1',
            full_name: 'Bui Van Long',
          }),
        ],
      });
      const r = await service.getZoneAccessLog(ZONE_ID, { date: '2026-07-28' });
      expect(r.events[0].isStranger).toBe(false);
      expect(r.events[0].fullName).toBe('Bui Van Long');
      expect(r.events[0].isUnmatched).toBe(true);
    });

    it('1 event matched + 1 stranger (userId null) → isStranger đúng từng dòng (CẢ người quen lẫn người lạ cùng xuất hiện)', async () => {
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
      const r = await service.getZoneAccessLog(ZONE_ID, { date: '2026-07-28' });
      expect(r.events.map((e) => e.isStranger)).toEqual([false, true]);
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
    const r = await service.getZoneAccessLog(ZONE_ID, { date: '2026-07-28' });
    expect(r.totalEvents).toBe(1);
    expect(r.events[0].userId).toBeNull();
    expect(r.events[0].fullName).toBeNull();
    expect(r.events[0].similarity).toBeNull();
    expect(r.events[0].isStranger).toBe(true);
  });

  it('SQL: lọc đúng event_type/zone_id + biên ngày [date, date+1) THEO GIỜ VN', async () => {
    wire();
    await service.getZoneAccessLog(ZONE_ID, { date: '2026-07-28' });
    const q = captured.find((c) => isEventQuery(c.sql))!;
    expect(q.sql).toContain(
      "e.event_time >= ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')",
    );
    expect(q.sql).toContain(
      "(($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')",
    );
    // Chặn hồi quy (mirror RAL-001): KHÔNG $2::date trần, KHÔNG thiếu ::timestamp.
    expect(q.sql).not.toMatch(/event_time\s*>=\s*\$2::date\s/);
    expect(q.sql).not.toMatch(/\$2::date AT TIME ZONE/);
    expect(q.sql).toContain('e.zone_id = $3::uuid');
    expect(q.sql).toContain('LEFT JOIN users u');
    expect(q.params.slice(0, 4)).toEqual([
      'ivss_face_event',
      '2026-07-28',
      ZONE_ID,
      null,
    ]);
  });

  it('thiếu date → tự dùng hôm nay (YYYY-MM-DD)', async () => {
    wire();
    const r = await service.getZoneAccessLog(ZONE_ID);
    expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const q = captured.find((c) => isEventQuery(c.sql))!;
    expect(q.params[1]).toBe(r.date);
  });

  // ── phân trang — mirror RAL-001 (LIMIT/OFFSET giờ ở $5/$6, không $6/$7, vì KHÔNG meetingId) ──
  describe('phân trang', () => {
    it('mặc định page=1 limit=20 → LIMIT/OFFSET đúng', async () => {
      wire();
      const r = await service.getZoneAccessLog(ZONE_ID, { date: '2026-07-28' });
      const q = captured.find((c) => isEventQuery(c.sql))!;
      expect(q.sql).toContain('LIMIT $5 OFFSET $6');
      expect(q.params[4]).toBe(20);
      expect(q.params[5]).toBe(0);
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
      const r = await service.getZoneAccessLog(ZONE_ID, {
        date: '2026-07-28',
        page: 3,
        limit: 10,
      });
      const q = captured.find((c) => isEventQuery(c.sql))!;
      expect(q.params[4]).toBe(10);
      expect(q.params[5]).toBe(20);
      expect(r.pagination).toEqual({
        page: 3,
        limit: 10,
        total: 45,
        totalPages: 5,
      });
      expect(r.totalEvents).toBe(45);
      expect(r.events).toHaveLength(1);
    });
  });

  // ── search theo users.full_name — mirror RAL-001 ──────────────────────────
  describe('search theo users.full_name', () => {
    it('có search → truyền vào param $4, SQL dùng ILIKE', async () => {
      wire();
      await service.getZoneAccessLog(ZONE_ID, {
        date: '2026-07-28',
        search: 'Long',
      });
      const q = captured.find((c) => isEventQuery(c.sql))!;
      expect(q.params[3]).toBe('Long');
      expect(q.sql).toContain("u.full_name ILIKE '%' || $4::text || '%'");
    });

    it('search rỗng/chỉ khoảng trắng → coi như không lọc (param null)', async () => {
      wire();
      await service.getZoneAccessLog(ZONE_ID, {
        date: '2026-07-28',
        search: '   ',
      });
      const q = captured.find((c) => isEventQuery(c.sql))!;
      expect(q.params[3]).toBeNull();
    });
  });

  // ── Timezone của mặc định "hôm nay" (EC2 chạy UTC) — mirror RAL-001 ────────
  describe('todayStr() theo giờ VN', () => {
    afterEach(() => jest.useRealTimers());

    it('02:00 giờ VN (=19:00 UTC hôm trước) → trả NGÀY HÔM NAY theo VN, KHÔNG phải hôm qua', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-28T19:00:00Z'));
      wire();
      const r = await service.getZoneAccessLog(ZONE_ID);
      expect(r.date).toBe('2026-07-29');
    });

    it('chặn hồi quy: KHÔNG dùng getFullYear/getMonth/getDate theo giờ process', () => {
      const src = readFileSync(
        join(__dirname, 'ivss-zone-access-log.service.ts'),
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
    const r = await service.getZoneAccessLog(ZONE_ID, { date: '2026-01-01' });
    expect(r.events).toEqual([]);
    expect(r.totalEvents).toBe(0);
    expect(r.matchedCount).toBe(0);
    expect(r.unmatchedCount).toBe(0);
  });
});
