import { BadRequestException } from '@nestjs/common';
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { UserJourneyService } from './user-journey.service.js';

const USER_ID = '39c920cd-bd08-4ab0-8139-8edb746d93ca';

describe('UserJourneyService (UJN-001)', () => {
  let service: UserJourneyService;
  let dsMock: any;
  let captured: Array<{ sql: string; params: any[] }>;

  /** Mock 5 query: users + 3 nguồn + system_configs (ngưỡng gộp phiên V2). */
  const wire = (
    over: {
      user?: any[];
      gate?: any[];
      meeting?: any[];
      zone?: any[];
      config?: any[];
    } = {},
  ): void => {
    captured = [];
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM users'))
        return Promise.resolve(over.user ?? [{ full_name: 'Bui Van Long' }]);
      if (sql.includes('FROM gate_access_logs'))
        return Promise.resolve(over.gate ?? []);
      if (sql.includes('FROM iot_device_events'))
        return Promise.resolve(over.meeting ?? []);
      if (sql.includes('FROM zone_presence_events'))
        return Promise.resolve(over.zone ?? []);
      // Không set `config` ⇒ [] ⇒ rơi về default 600s (V3).
      if (sql.includes('FROM system_configs'))
        return Promise.resolve(over.config ?? []);
      return Promise.resolve([]);
    });
  };

  /** Face event thô ở A102 — helper cho các test gộp phiên. `id` mặc định theo timestamp để mỗi row phân biệt được. */
  const face = (
    time: string,
    direction = 'seen',
    room = 'A102-ID',
    id?: string,
  ) => ({
    id: id ?? `evt-${time}`,
    event_time: time,
    direction,
    room_key: room,
    room_name: 'Phòng A102',
    meeting_id: 'mt1',
  });

  const sqlOf = (frag: string) => captured.find((c) => c.sql.includes(frag))!;

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserJourneyService,
        { provide: DataSource, useValue: dsMock },
      ],
    }).compile();
    service = module.get(UserJourneyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('gộp 3 nguồn và SORT theo thời gian tăng dần', async () => {
    wire({
      // cố tình đưa vào lệch thứ tự để chắc chắn sort thật sự chạy
      zone: [
        {
          event_time: '2026-07-29T05:00:00.000Z',
          event_type: 'appear',
          zone_name: 'Hành lang A',
        },
      ],
      gate: [
        {
          access_time: '2026-07-29T01:00:00.000Z',
          direction: 'enter',
          plate_number: '30G69946',
          zone_name: 'Cổng Test',
        },
      ],
      meeting: [face('2026-07-29T03:00:00.000Z', 'enter')],
    });

    const r = await service.getUserJourney(USER_ID, '2026-07-29');

    expect(r.events.map((e) => e.type)).toEqual(['gate', 'meeting', 'zone']);
    expect(r.events.map((e) => e.time)).toEqual([
      '2026-07-29T01:00:00.000Z',
      '2026-07-29T03:00:00.000Z',
      '2026-07-29T05:00:00.000Z',
    ]);
    expect(r.gateCount).toBe(1);
    expect(r.meetingCount).toBe(1);
    expect(r.zoneCount).toBe(1);
    expect(r.fullName).toBe('Bui Van Long');
    expect(r.date).toBe('2026-07-29');
  });

  it('map đúng field theo từng type (gate có plate, meeting có room+meetingId, zone có zoneName)', async () => {
    wire({
      gate: [
        {
          access_time: '2026-07-29T01:00:00.000Z',
          direction: 'leave',
          plate_number: '30G69946',
          zone_name: 'Cổng Test',
        },
      ],
      meeting: [face('2026-07-29T02:00:00.000Z', 'enter')],
      zone: [
        {
          event_time: '2026-07-29T03:00:00.000Z',
          event_type: 'disappear',
          zone_name: 'Hành lang A',
        },
      ],
    });

    const [gate, meeting, zone] = (
      await service.getUserJourney(USER_ID, '2026-07-29')
    ).events;

    expect(gate).toMatchObject({
      type: 'gate',
      direction: 'leave',
      plateNumber: '30G69946',
      zoneName: 'Cổng Test',
      roomName: null,
      meetingId: null,
    });
    expect(gate.detail).toContain('30G69946');

    expect(meeting).toMatchObject({
      type: 'meeting',
      // V2: phiên gộp ⇒ direction 'session', KHÔNG còn enter/leave lẻ.
      direction: 'session',
      roomName: 'Phòng A102',
      meetingId: 'mt1',
      zoneName: null,
      plateNumber: null,
    });

    expect(zone).toMatchObject({
      type: 'zone',
      direction: 'disappear',
      zoneName: 'Hành lang A',
      plateNumber: null,
      roomName: null,
    });
  });

  it('nguồn 3 rỗng (chưa lắp cam zone) → zoneCount=0, vẫn trả gate+meeting', async () => {
    wire({
      gate: [
        {
          access_time: '2026-07-29T01:00:00.000Z',
          direction: 'enter',
          plate_number: '30G69946',
          zone_name: 'Cổng Test',
        },
      ],
      meeting: [face('2026-07-29T02:00:00.000Z', 'enter')],
      zone: [],
    });
    const r = await service.getUserJourney(USER_ID, '2026-07-29');
    expect(r.zoneCount).toBe(0);
    expect(r.events).toHaveLength(2);
    expect(r.gateCount).toBe(1);
    expect(r.meetingCount).toBe(1);
  });

  it('user không hoạt động → events rỗng, mọi count = 0 (KHÔNG lỗi)', async () => {
    wire({ gate: [], meeting: [], zone: [] });
    const r = await service.getUserJourney(USER_ID, '2026-07-29');
    expect(r.events).toEqual([]);
    expect(r.gateCount).toBe(0);
    expect(r.meetingCount).toBe(0);
    expect(r.zoneCount).toBe(0);
  });

  it('field null (biển/phòng/zone/direction) → không crash, detail vẫn đọc được', async () => {
    wire({
      user: [],
      gate: [
        {
          access_time: '2026-07-29T01:00:00.000Z',
          direction: null,
          plate_number: null,
          zone_name: null,
        },
      ],
      meeting: [
        {
          event_time: '2026-07-29T02:00:00.000Z',
          direction: null,
          room_key: 'room-khong-co-trong-bang-rooms',
          room_name: null,
          meeting_id: null,
        },
      ],
    });
    const r = await service.getUserJourney(USER_ID, '2026-07-29');
    expect(r.fullName).toBeNull();
    expect(r.events[0].detail).toContain('không rõ biển');
    expect(r.events[1].detail).toContain('phòng không rõ');
  });

  // ── Nguyên tắc mở rộng: nguồn 3 KHÔNG hard-code zone ──
  it('nguồn 3 lọc theo user_id, KHÔNG hard-code zone_id (thêm cam zone mới tự vào)', async () => {
    wire();
    await service.getUserJourney(USER_ID, '2026-07-29');
    const q = sqlOf('FROM zone_presence_events');
    expect(q.sql).toContain('p.user_id = $1');
    // Không được có điều kiện khoá cứng zone cụ thể.
    expect(q.sql).not.toMatch(/p\.zone_id\s*=\s*'/);
    expect(q.sql).not.toMatch(/p\.zone_id\s*IN\s*\(/);
  });

  // ── Timezone: biên ngày giờ VN ──
  it('cả 3 nguồn dùng biên ngày giờ VN có ::timestamp cast', async () => {
    wire();
    await service.getUserJourney(USER_ID, '2026-07-29');
    for (const frag of [
      'FROM gate_access_logs',
      'FROM iot_device_events',
      'FROM zone_presence_events',
    ]) {
      const q = sqlOf(frag);
      expect(q.sql).toContain(
        "($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')",
      );
      expect(q.sql).toContain(
        "(($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')",
      );
      // Chặn hồi quy: thiếu ::timestamp thì biên lệch +7h SAI HƯỚNG.
      expect(q.sql).not.toMatch(/\$2::date AT TIME ZONE/);
      expect(q.params[0]).toBe(USER_ID);
      expect(q.params[1]).toBe('2026-07-29');
    }
  });

  it('thiếu date → hôm nay THEO GIỜ VN (19:00 UTC 28/7 = 02:00 VN 29/7 → 2026-07-29)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-28T19:00:00Z'));
    wire();
    const r = await service.getUserJourney(USER_ID);
    expect(r.date).toBe('2026-07-29');
    expect(sqlOf('FROM gate_access_logs').params[1]).toBe('2026-07-29');
  });

  it('chỉ lấy gate log CÓ user_id (hành trình theo NGƯỜI, bỏ xe unmatched)', async () => {
    wire();
    await service.getUserJourney(USER_ID, '2026-07-29');
    expect(sqlOf('FROM gate_access_logs').sql).toContain('g.user_id = $1');
  });

  it('nguồn 2 lọc đúng event_type face + userId trong payload', async () => {
    wire();
    await service.getUserJourney(USER_ID, '2026-07-29');
    const q = sqlOf('FROM iot_device_events');
    expect(q.sql).toContain("e.payload_json->>'userId' = $1");
    expect(q.params[2]).toBe('ivss_face_event');
  });

  // ══ V2 — gộp phiên face + lọc rác ══════════════════════════════════════════
  describe('V2 — nguồn 2 gộp phiên có mặt', () => {
    it('6 event cùng phòng cách nhau <600s → 1 phiên, durationMs = last-first, eventCount=6', async () => {
      wire({
        meeting: [
          face('2026-07-29T10:39:00.000Z', 'enter'),
          face('2026-07-29T10:41:00.000Z'),
          face('2026-07-29T10:43:00.000Z'),
          face('2026-07-29T10:45:00.000Z'),
          face('2026-07-29T10:47:00.000Z'),
          face('2026-07-29T10:48:00.000Z', 'leave'),
        ],
      });

      const r = await service.getUserJourney(USER_ID, '2026-07-29');

      expect(r.events).toHaveLength(1);
      expect(r.meetingCount).toBe(1);
      expect(r.events[0]).toMatchObject({
        type: 'meeting',
        direction: 'session',
        time: '2026-07-29T10:39:00.000Z',
        endTime: '2026-07-29T10:48:00.000Z',
        durationMs: 9 * 60 * 1000,
        eventCount: 6,
        roomName: 'Phòng A102',
      });
      expect(r.events[0].detail).toBe('Có mặt Phòng A102 (9 phút)');
    });

    it('2 cụm cùng phòng cách nhau >600s → 2 phiên riêng', async () => {
      wire({
        meeting: [
          face('2026-07-29T10:00:00.000Z', 'enter'),
          face('2026-07-29T10:02:00.000Z'),
          // gap 11 phút (660s) > 600s ⇒ cắt phiên
          face('2026-07-29T10:13:00.000Z', 'enter'),
          face('2026-07-29T10:15:00.000Z'),
        ],
      });

      const r = await service.getUserJourney(USER_ID, '2026-07-29');

      expect(r.meetingCount).toBe(2);
      expect(r.events.map((e) => [e.time, e.endTime, e.eventCount])).toEqual([
        ['2026-07-29T10:00:00.000Z', '2026-07-29T10:02:00.000Z', 2],
        ['2026-07-29T10:13:00.000Z', '2026-07-29T10:15:00.000Z', 2],
      ]);
    });

    // ── V3: ngưỡng 600s — hồi quy cho lỗi "xé 1 lần có mặt thành 4 phiên" ──
    it('cụm cách nhau 6 phút (360s) < 600s → VẪN CÙNG phiên (V2/120s từng xé nhầm)', async () => {
      wire({
        meeting: [
          face('2026-07-29T10:39:00.000Z', 'enter'),
          face('2026-07-29T10:45:00.000Z'), // +6 phút
          face('2026-07-29T10:48:00.000Z'), // +3 phút
          face('2026-07-29T10:50:00.000Z'), // +2 phút
        ],
      });

      const r = await service.getUserJourney(USER_ID, '2026-07-29');

      expect(r.meetingCount).toBe(1);
      expect(r.events[0]).toMatchObject({
        time: '2026-07-29T10:39:00.000Z',
        endTime: '2026-07-29T10:50:00.000Z',
        eventCount: 4,
      });
      expect(r.events[0].detail).toBe('Có mặt Phòng A102 (11 phút)');
    });

    it('đổi phòng dù sát giờ → 2 phiên (khoá gộp gồm cả roomId)', async () => {
      wire({
        meeting: [
          face('2026-07-29T10:00:00.000Z', 'enter', 'A102-ID'),
          face('2026-07-29T10:01:00.000Z', 'enter', 'B201-ID'),
        ],
      });
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.meetingCount).toBe(2);
    });

    it('LỌC RÁC: SQL bỏ face event không resolve được roomId', async () => {
      wire();
      await service.getUserJourney(USER_ID, '2026-07-29');
      expect(sqlOf('FROM iot_device_events').sql).toContain(
        "COALESCE(e.room_id, NULLIF(e.payload_json->>'roomId','')::uuid) IS NOT NULL",
      );
    });

    it('LỌC RÁC (chặn tầng 2): row room_key null KHÔNG vào timeline, không đẻ phiên giả', async () => {
      wire({
        meeting: [
          {
            event_time: '2026-07-29T10:00:00.000Z',
            direction: 'seen',
            room_key: null,
            room_name: null,
            meeting_id: null,
          },
          face('2026-07-29T10:01:00.000Z', 'enter'),
        ],
      });
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.meetingCount).toBe(1);
      expect(r.events[0].time).toBe('2026-07-29T10:01:00.000Z');
      expect(r.events[0].eventCount).toBe(1);
    });

    it('gate KHÔNG gộp: 2 lượt qua cổng vẫn là 2 dòng riêng', async () => {
      wire({
        gate: [
          {
            access_time: '2026-07-29T10:00:00.000Z',
            direction: 'enter',
            plate_number: '30G69946',
            zone_name: 'Cổng Test',
          },
          {
            access_time: '2026-07-29T10:01:00.000Z',
            direction: 'leave',
            plate_number: '30G69946',
            zone_name: 'Cổng Test',
          },
        ],
      });
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.gateCount).toBe(2);
      expect(r.events).toHaveLength(2);
      // Không có field phiên nào rò sang gate.
      expect(r.events[0].endTime).toBeUndefined();
      expect(r.events[0].durationMs).toBeUndefined();
    });

    it('zone KHÔNG gộp: appear + disappear vẫn 2 dòng', async () => {
      wire({
        zone: [
          {
            event_time: '2026-07-29T10:00:00.000Z',
            event_type: 'appear',
            zone_name: 'Hành lang A',
          },
          {
            event_time: '2026-07-29T10:01:00.000Z',
            event_type: 'disappear',
            zone_name: 'Hành lang A',
          },
        ],
      });
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.zoneCount).toBe(2);
      expect(r.events.map((e) => e.direction)).toEqual(['appear', 'disappear']);
    });

    it('ngưỡng gộp đọc từ config RIÊNG campus.journey.gap_threshold_seconds', async () => {
      // Hạ ngưỡng còn 60s ⇒ 2 event cách 2 phút bị TÁCH (default 600s thì gộp).
      wire({
        config: [{ config_value: '60' }],
        meeting: [
          face('2026-07-29T10:00:00.000Z', 'enter'),
          face('2026-07-29T10:02:00.000Z'),
        ],
      });
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(sqlOf('FROM system_configs').params[0]).toBe(
        'campus.journey.gap_threshold_seconds',
      );
      expect(r.meetingCount).toBe(2);
    });

    // ── V3: hai luồng PHẢI độc lập ──
    it('journey KHÔNG đọc key của ivss (ivss.presence.* giữ nguyên 120s cho báo cáo họp)', async () => {
      wire();
      await service.getUserJourney(USER_ID, '2026-07-29');
      const q = sqlOf('FROM system_configs');
      expect(q.sql).not.toContain('ivss.presence');
      expect(q.params).not.toContain('ivss.presence.gap_threshold_seconds');
      // Key phải bind tham số, không nhúng thẳng vào chuỗi SQL.
      expect(q.sql).toContain('config_key = $1');
    });

    it('đọc config lỗi → rơi về default 600s, KHÔNG hỏng timeline', async () => {
      wire({
        meeting: [
          face('2026-07-29T10:00:00.000Z', 'enter'),
          face('2026-07-29T10:02:00.000Z'),
        ],
      });
      const inner = dsMock.manager.query.getMockImplementation();
      dsMock.manager.query.mockImplementation((sql: string, params: any[]) =>
        sql.includes('FROM system_configs')
          ? Promise.reject(
              new Error('relation "system_configs" does not exist'),
            )
          : inner(sql, params),
      );

      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.meetingCount).toBe(1); // gộp theo default 600s
    });

    it('durationHuman: <60s / phút / giờ+phút / tròn giờ', async () => {
      const cases: Array<[string, string]> = [
        ['2026-07-29T10:00:45.000Z', 'Có mặt Phòng A102 (45 giây)'],
        ['2026-07-29T10:09:00.000Z', 'Có mặt Phòng A102 (9 phút)'],
        ['2026-07-29T11:05:00.000Z', 'Có mặt Phòng A102 (1 giờ 5 phút)'],
        ['2026-07-29T12:00:00.000Z', 'Có mặt Phòng A102 (2 giờ)'],
      ];
      for (const [end, expected] of cases) {
        wire({
          // Ngưỡng đủ lớn để cả 2 event nằm trong 1 phiên bất kể khoảng cách.
          config: [{ config_value: '99999' }],
          meeting: [face('2026-07-29T10:00:00.000Z', 'enter'), face(end)],
        });
        const r = await service.getUserJourney(USER_ID, '2026-07-29');
        expect(r.events[0].detail).toBe(expected);
      }
    });
  });

  // ══ FIX 2026-08-09 — sourceEventId cho gate + meeting (FE hiện ảnh) ══
  // ══ FIX 2026-08-18 — trả nợ kỹ thuật: thêm sourceEventId cho nguồn zone (đọc từ
  //    metadata_json.sourceEventId, đã ghi sẵn bởi writeAppearEvent() từ trước — chỉ
  //    CHƯA từng được SELECT/map ra response). KHÔNG đụng bridge/writeAppearEvent()/
  //    DeviceEventSnapshotService — id trả về CÙNG shape iot_device_events.id mà
  //    DeviceEventSnapshotService.getSnapshot() đã xử lý đúng cho gate/meeting (xem
  //    device-event-snapshot.service.spec.ts:70, test happy-path chung, KHÔNG phân biệt
  //    nguồn — không cần test tích hợp riêng, service đó không đổi).
  describe('sourceEventId (FE dùng để hiện ảnh) — gate + meeting + zone', () => {
    it('gate: map source_event_id (cột g.event_id) vào sourceEventId', async () => {
      wire({
        gate: [
          {
            access_time: '2026-07-29T01:00:00.000Z',
            direction: 'enter',
            plate_number: '30G69946',
            zone_name: 'Cổng Test',
            source_event_id: 'ide-gate-1',
          },
        ],
      });
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.events[0].sourceEventId).toBe('ide-gate-1');
    });

    it('gate: source_event_id NULL (log cũ chưa từng truyền) → sourceEventId null, không crash', async () => {
      wire({
        gate: [
          {
            access_time: '2026-07-29T01:00:00.000Z',
            direction: 'enter',
            plate_number: '30G69946',
            zone_name: 'Cổng Test',
            source_event_id: null,
          },
        ],
      });
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.events[0].sourceEventId).toBeNull();
    });

    it('meeting: phiên gộp nhiều event → sourceEventId = id của event ĐẦU TIÊN, KHÔNG đổi khi gộp thêm', async () => {
      wire({
        meeting: [
          face('2026-07-29T10:39:00.000Z', 'enter', 'A102-ID', 'ide-first'),
          face('2026-07-29T10:41:00.000Z', 'seen', 'A102-ID', 'ide-second'),
          face('2026-07-29T10:43:00.000Z', 'leave', 'A102-ID', 'ide-last'),
        ],
      });
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.meetingCount).toBe(1);
      expect(r.events[0].sourceEventId).toBe('ide-first');
    });

    it('meeting: 2 phiên tách biệt → mỗi phiên lấy đúng sourceEventId của event đầu phiên đó', async () => {
      wire({
        meeting: [
          face('2026-07-29T10:00:00.000Z', 'enter', 'A102-ID', 'ide-session1'),
          face('2026-07-29T10:02:00.000Z', 'seen', 'A102-ID', 'ide-s1-2'),
          // gap 11 phút > 600s ⇒ phiên mới
          face('2026-07-29T10:13:00.000Z', 'enter', 'A102-ID', 'ide-session2'),
        ],
      });
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.meetingCount).toBe(2);
      expect(r.events.map((e) => e.sourceEventId)).toEqual([
        'ide-session1',
        'ide-session2',
      ]);
    });

    // [FIX 2026-08-18] zone giờ CÓ sourceEventId thật — đọc từ metadata_json.sourceEventId
    // (writeAppearEvent() đã ghi sẵn từ trước, chỉ chưa được SELECT/map ra response).
    it('zone: metadata_json.sourceEventId hợp lệ → map đúng vào sourceEventId (KHÔNG còn null)', async () => {
      wire({
        zone: [
          {
            event_time: '2026-07-29T05:00:00.000Z',
            event_type: 'appear',
            zone_name: 'Hành lang A',
            source_event_id: 'ide-zone-1',
          },
        ],
      });
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.events[0].sourceEventId).toBe('ide-zone-1');
    });

    it('zone: KHÔNG có sourceEventId trong metadata (dữ liệu cũ/edge case) → trả null an toàn, KHÔNG throw', async () => {
      wire({
        zone: [
          {
            event_time: '2026-07-29T05:00:00.000Z',
            event_type: 'appear',
            zone_name: 'Hành lang A',
            // source_event_id KHÔNG có trong row — mô phỏng metadata_json thiếu/rỗng
            // (dữ liệu cũ trước khi field này được ghi, hoặc appear event hiếm gặp).
          },
        ],
      });
      await expect(
        service.getUserJourney(USER_ID, '2026-07-29'),
      ).resolves.toBeDefined();
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.events[0].sourceEventId).toBeNull();
    });

    it('zone: source_event_id = null tường minh (metadata_json->>... trả NULL trong Postgres) → trả null an toàn', async () => {
      wire({
        zone: [
          {
            event_time: '2026-07-29T05:00:00.000Z',
            event_type: 'appear',
            zone_name: 'Hành lang A',
            source_event_id: null,
          },
        ],
      });
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.events[0].sourceEventId).toBeNull();
    });

    // Regression: gate/meeting KHÔNG bị ảnh hưởng gì bởi thay đổi ở nguồn zone.
    it('REGRESSION — gate: map source_event_id (cột g.event_id) vào sourceEventId, giữ nguyên 100%', async () => {
      wire({
        gate: [
          {
            access_time: '2026-07-29T01:00:00.000Z',
            direction: 'enter',
            plate_number: '30G69946',
            zone_name: 'Cổng Test',
            source_event_id: 'ide-gate-regress',
          },
        ],
      });
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.events[0].sourceEventId).toBe('ide-gate-regress');
    });

    it('REGRESSION — meeting: sourceEventId = id event đầu phiên, giữ nguyên 100%', async () => {
      wire({
        meeting: [
          face(
            '2026-07-29T10:39:00.000Z',
            'enter',
            'A102-ID',
            'ide-first-regress',
          ),
          face(
            '2026-07-29T10:41:00.000Z',
            'seen',
            'A102-ID',
            'ide-second-regress',
          ),
        ],
      });
      const r = await service.getUserJourney(USER_ID, '2026-07-29');
      expect(r.events[0].sourceEventId).toBe('ide-first-regress');
    });

    it("SQL: nguồn gate SELECT g.event_id AS source_event_id, nguồn meeting SELECT e.id, nguồn zone SELECT metadata_json->>'sourceEventId'", async () => {
      wire();
      await service.getUserJourney(USER_ID, '2026-07-29');
      expect(sqlOf('FROM gate_access_logs').sql).toContain(
        'g.event_id AS source_event_id',
      );
      expect(sqlOf('FROM iot_device_events').sql).toContain('SELECT e.id');
      expect(sqlOf('FROM zone_presence_events').sql).toContain(
        `p.metadata_json->>'sourceEventId' AS source_event_id`,
      );
    });
  });

  describe('getUserJourneyRange — khoảng ngày', () => {
    const day = (date: string, n: number, name: string | null = 'A') => ({
      userId: 'u1',
      fullName: name,
      date,
      events: Array.from({ length: n }, (_, i) => ({
        time: `${date}T0${i}:00:00.000Z`,
      })),
      gateCount: n,
      meetingCount: 1,
      zoneCount: 0,
    });

    it('ghép từng ngày trong [from, to] (tính cả 2 đầu) và cộng dồn số đếm', async () => {
      const spy = jest
        .spyOn(service, 'getUserJourney')
        .mockImplementation(
          async (_u, d) =>
            day(d as string, d === '2026-10-02' ? 2 : 1) as never,
        );
      const r = await service.getUserJourneyRange(
        'u1',
        '2026-10-01',
        '2026-10-03',
      );
      expect(spy.mock.calls.map((c) => c[1])).toEqual([
        '2026-10-01',
        '2026-10-02',
        '2026-10-03',
      ]);
      expect(r.date).toBe('2026-10-01');
      expect(r.to).toBe('2026-10-03');
      expect(r.fullName).toBe('A');
      expect(r.events).toHaveLength(4);
      expect(r.gateCount).toBe(4);
      expect(r.meetingCount).toBe(3);
    });

    it('qua ranh tháng vẫn đúng ngày', async () => {
      const spy = jest
        .spyOn(service, 'getUserJourney')
        .mockImplementation(async (_u, d) => day(d as string, 0) as never);
      await service.getUserJourneyRange('u1', '2026-09-30', '2026-10-01');
      expect(spy.mock.calls.map((c) => c[1])).toEqual([
        '2026-09-30',
        '2026-10-01',
      ]);
    });

    it('to < from → BadRequest', async () => {
      await expect(
        service.getUserJourneyRange('u1', '2026-10-05', '2026-10-01'),
      ).rejects.toThrow(BadRequestException);
    });

    it('quá 31 ngày → BadRequest, không query DB', async () => {
      const spy = jest.spyOn(service, 'getUserJourney');
      await expect(
        service.getUserJourneyRange('u1', '2026-01-01', '2026-02-01'),
      ).rejects.toThrow(BadRequestException);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
