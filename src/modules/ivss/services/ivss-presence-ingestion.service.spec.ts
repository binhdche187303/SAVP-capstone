/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { VISITOR_FACE_EVENT_HOOK } from '../../../common/ports/visitor-face-event-hook.js';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { IvssPresenceIngestionService } from './ivss-presence-ingestion.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { ZonePresenceWriterService } from '../../zones/services/zone-presence-writer.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { RestrictedZoneIntrusionService } from '../../restricted-zone/services/restricted-zone-intrusion.service.js';
import { IvssPresenceConfigService } from './ivss-presence-config.service.js';

const ROOM_UUID = '11111111-1111-1111-1111-111111111111';
const MEETING_UUID = '22222222-2222-2222-2222-222222222222';

const evt = (over: any = {}) => ({
  type: 'face_recognized',
  channelId: 5,
  personUid: 'SZ1',
  utc: '2026-06-23T09:00:00.000Z',
  eventAction: '1',
  ...over,
});

describe('IvssPresenceIngestionService (IPI-001 #38+#39)', () => {
  let service: IvssPresenceIngestionService;
  let dsMock: any;
  let wsMock: { emitToRoom: jest.Mock };
  let writerMock: any;
  let storageMock: any;
  let intrusionMock: any;
  let presenceConfigMock: any;
  let captured: Array<{ sql: string; params: any[] }>;
  const AREA_UUID = '33333333-3333-3333-3333-333333333333';

  const wire = (
    over: {
      bridge?: any[];
      user?: any[];
      channelMap?: Record<string, unknown> | null;
      meeting?: any[];
      participant?: any[];
      insertThrows?: boolean;
      fullName?: any[];
      fullNameThrows?: boolean;
      directionMap?: Record<string, unknown> | null;
      directionMapThrows?: boolean;
      presenceMap?: Record<string, unknown> | null; // ZPW-001 channel_presence_zone_map
      mediaFileId?: string | null; // id RETURNING của INSERT INTO media_files (snapshot)
      mediaFileInsertThrows?: boolean;
      // [FIX 2026-08-17] dedupe precheck: id row trùng "đã có" (mặc định undefined → [] → KHÔNG trùng).
      dedupeHit?: string | null;
    } = {},
  ) => {
    captured = [];
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      // [RACE FIX 2026-08-22] pg_advisory_xact_lock — statement đầu tiên trong
      // transaction bọc SELECT-dedupe+INSERT. Kết quả không được đọc bởi caller,
      // chỉ cần resolve (mirror vehicle-resolve.service.spec.ts).
      if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([{}]);
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve(over.bridge ?? [{ id: 'bridge1' }]);
      // Nợ #3: participant check — default LÀ participant ([{id}]); over.participant=[] → ngoài họp.
      if (sql.includes('FROM meeting_participants'))
        return Promise.resolve(over.participant ?? [{ id: 'p1' }]);
      if (sql.includes('FROM device_user_mappings'))
        return Promise.resolve(over.user ?? [{ user_id: 'u1' }]);
      if (sql.includes("config_key = 'ivss.channel_direction_map'")) {
        if (over.directionMapThrows)
          return Promise.reject(new Error('config boom'));
        return Promise.resolve([{ config_json: over.directionMap ?? null }]);
      }
      if (sql.includes("config_key = 'ivss.channel_room_map'"))
        return Promise.resolve([
          {
            config_json:
              over.channelMap === undefined
                ? { '5': ROOM_UUID }
                : over.channelMap,
          },
        ]);
      // ZPW-001: channel_presence_zone_map (parameterized config_key = $1).
      if (params?.[0] === 'ivss.channel_presence_zone_map')
        return Promise.resolve([{ config_json: over.presenceMap ?? null }]);
      if (sql.includes('FROM meetings'))
        return Promise.resolve(over.meeting ?? [{ id: MEETING_UUID }]);
      if (sql.includes('FROM users WHERE id')) {
        if (over.fullNameThrows)
          return Promise.reject(new Error('users query boom'));
        return Promise.resolve(over.fullName ?? [{ full_name: 'Alice' }]);
      }
      // saveEventSnapshot() INSERT vào media_files (RETURNING id).
      if (sql.includes('INSERT INTO media_files')) {
        if (over.mediaFileInsertThrows)
          return Promise.reject(new Error('media_files boom'));
        return Promise.resolve([{ id: over.mediaFileId ?? 'media1' }]);
      }
      if (sql.includes('INSERT INTO iot_device_events')) {
        if (over.insertThrows) return Promise.reject(new Error('db boom'));
        return Promise.resolve([{ id: 'evt1' }]); // QĐ-4: RETURNING id
      }
      // [FIX 2026-08-17] dedupe precheck (SELECT ... IS NOT DISTINCT FROM ...).
      if (sql.includes('IS NOT DISTINCT FROM'))
        return Promise.resolve(over.dedupeHit ? [{ id: over.dedupeHit }] : []);
      return Promise.resolve(undefined);
    });
  };

  const insert = () =>
    captured.find((c) => c.sql.includes('INSERT INTO iot_device_events'));
  const payloadOf = () => JSON.parse(insert()!.params[4]);
  const snapshotFileIdOf = () => insert()!.params[6];
  // [FIX 2026-08-11, Zone Access Log đường B] zone_id THÊM Ở CUỐI ($8/params[7]).
  const zoneIdOf = () => insert()!.params[7];

  // IRP-001 (#40): build service với gate realtime ON/OFF (B1 — mirror configService.get bool).
  // B2 (Zone realtime): zoneRealtime — tham số MỚI, mặc định false, KHÔNG đổi chữ ký gọi
  // build(true)/build(false) đã có ở mọi test cũ (backward-compatible).
  const build = async (realtime = false, zoneRealtime = false, visitorHook?: unknown) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssPresenceIngestionService,
        ...(visitorHook ? [{ provide: VISITOR_FACE_EVENT_HOOK, useValue: visitorHook }] : []),
        { provide: DataSource, useValue: dsMock },
        { provide: WebsocketService, useValue: wsMock },
        { provide: ZonePresenceWriterService, useValue: writerMock },
        { provide: StorageService, useValue: storageMock },
        {
          provide: RestrictedZoneIntrusionService,
          useValue: intrusionMock,
        },
        {
          provide: IvssPresenceConfigService,
          useValue: presenceConfigMock,
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def: unknown) => {
              if (key === 'IVSS_REALTIME_ENABLED') return realtime;
              if (key === 'ZONE_REALTIME_ENABLED') return zoneRealtime;
              return def;
            },
          },
        },
      ],
    }).compile();
    return module.get(IvssPresenceIngestionService);
  };

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn() } };
    // [RACE FIX 2026-08-22] onFaceEvent() giờ bọc SELECT-dedupe+INSERT trong
    // this.dataSource.transaction(...) — mirror ChannelMapConfigService.spec.ts /
    // vehicle-resolve.service.spec.ts:81-89: dùng LẠI dsMock.manager (cùng jest.fn
    // `.query`) bên trong callback để mọi SQL-sniffing (`captured`/wire()) hiện có
    // tiếp tục hoạt động không đổi, không cần EntityManager mock riêng.
    dsMock.transaction = jest.fn((cb: (m: any) => unknown) => cb(dsMock.manager));
    wsMock = { emitToRoom: jest.fn() };
    writerMock = {
      resolvePresenceZone: jest.fn().mockResolvedValue({ valid: true }),
      writeAppearEvent: jest.fn().mockResolvedValue({ presenceId: 'zpe1' }),
    };
    storageMock = {
      saveFile: jest.fn().mockResolvedValue({
        storageKey: 'stranger-snapshots/x.jpg',
        publicUrl: 'http://localhost:3000/uploads/stranger-snapshots/x.jpg',
        sizeBytes: 123,
      }),
      getDriver: jest.fn().mockReturnValue('local'),
    };
    intrusionMock = {
      evaluateZoneEventNow: jest.fn().mockResolvedValue(false),
    };
    presenceConfigMock = {
      getValues: jest.fn().mockResolvedValue({ minSimilarityThreshold: 0.7 }),
    };
    service = await build(false);
  });

  // ── C5 matchState (4 trạng thái) ──
  it('matched (person + channel OK) → processed + payload userId/roomId/meetingId', async () => {
    wire();
    await service.onFaceEvent(evt());
    const ins = insert();
    expect(ins).toBeDefined();
    expect(ins!.params[5]).toBe('processed'); // processed_status
    const p = payloadOf();
    expect(p.matchState).toBe('matched');
    expect(p.userId).toBe('u1');
    expect(p.roomId).toBe(ROOM_UUID);
    expect(p.meetingId).toBe(MEETING_UUID);
  });

  it('C1: INSERT dùng event_type=ivss_face_event + source_protocol=ivss', async () => {
    wire();
    await service.onFaceEvent(evt());
    expect(insert()!.sql).toContain("'ivss_face_event'");
    expect(insert()!.sql).toContain("'ivss'");
  });

  it('unmatched_identity (szUid lạ + room OK) → unmatched, vẫn persist', async () => {
    wire({ user: [] });
    await service.onFaceEvent(evt());
    expect(insert()!.params[5]).toBe('unmatched');
    expect(payloadOf().matchState).toBe('unmatched_identity');
  });

  it('unmatched_location (user OK + channel lạ) → unmatched, vẫn persist', async () => {
    wire({ channelMap: {} }); // map rỗng → channel 5 không có
    await service.onFaceEvent(evt());
    expect(insert()!.params[5]).toBe('unmatched');
    expect(payloadOf().matchState).toBe('unmatched_location');
  });

  it('unmatched_both (szUid lạ + channel lạ) → unmatched_both', async () => {
    wire({ user: [], channelMap: {} });
    await service.onFaceEvent(evt());
    expect(payloadOf().matchState).toBe('unmatched_both');
  });

  // [FIX 2026-08-15] Zone (roomId null vì camera map qua channel_presence_zone_map, KHÔNG
  // phải channel_room_map) — matchStateOf() không còn áp nhầm yêu cầu roomId/isParticipant
  // của Room. Bug gốc: người quen đi qua Zone luôn ra 'unmatched_location' dù nhận diện đúng.
  describe('[FIX 2026-08-15] isZoneContext — Zone không đòi hỏi roomId/isParticipant', () => {
    it('Zone, userId có (người quen, face_profile active) → matchState=matched (KHÔNG còn unmatched_location)', async () => {
      wire({ channelMap: {}, presenceMap: { '5': AREA_UUID } }); // roomId null, presenceMap có entry → isZoneContext=true
      await service.onFaceEvent(evt());
      const p = payloadOf();
      expect(p.matchState).toBe('matched');
      expect(insert()!.params[5]).toBe('processed');
      expect(p.userId).toBe('u1');
      expect(p.roomId).toBeNull();
    });

    it('Zone, userId=null (người lạ thật) → matchState=unmatched_both (GIỮ NGUYÊN hành vi cũ, KHÔNG phải unmatched_identity)', async () => {
      wire({ channelMap: {}, presenceMap: { '5': AREA_UUID }, user: [] });
      await service.onFaceEvent(evt());
      const p = payloadOf();
      expect(p.matchState).toBe('unmatched_both');
      expect(insert()!.params[5]).toBe('unmatched');
    });

    it('Dual-map (channel có CẢ room_map lẫn presence_zone_map) → isZoneContext=false tự động, ưu tiên hành vi Room (chặt hơn)', async () => {
      // Mặc định wire() đã map channel '5' → ROOM_UUID; thêm presenceMap cho CÙNG channel đó
      // → roomId resolve non-null trước → isZoneContext=false (roomId truthy loại điều kiện
      // đầu tiên) → matched vẫn đòi hỏi isParticipant như Room, KHÔNG đơn giản hoá theo Zone.
      wire({ presenceMap: { '5': AREA_UUID }, participant: [] }); // room OK nhưng KHÔNG phải participant
      await service.onFaceEvent(evt());
      const p = payloadOf();
      expect(p.matchState).toBe('unmatched_identity'); // đúng hành vi Room khi không phải participant, KHÔNG phải 'matched'
      expect(p.roomId).toBe(ROOM_UUID);
    });

    it('Dual-map + LÀ participant → vẫn matched theo đúng đường Room bình thường (không đổi)', async () => {
      wire({ presenceMap: { '5': AREA_UUID } }); // dual-map, mặc định LÀ participant
      await service.onFaceEvent(evt());
      expect(payloadOf().matchState).toBe('matched');
    });
  });

  // ── OQ-3 direction ĐỘC LẬP matchState (C5) ──
  it('direction độc lập: unmatched vẫn giữ direction theo eventAction (KHÔNG bị "unknown")', async () => {
    wire({ user: [] }); // unmatched_identity nhưng eventAction='1'
    await service.onFaceEvent(evt({ eventAction: '1' }));
    const p = payloadOf();
    expect(p.matchState).toBe('unmatched_identity');
    expect(p.direction).toBe('enter'); // KHÔNG ghi đè unknown
  });

  it('direction: eventAction 1→enter, 2→leave, lạ→seen, thiếu→seen', async () => {
    for (const [action, dir] of [
      ['1', 'enter'],
      ['enter', 'enter'],
      ['2', 'leave'],
      ['out', 'leave'],
      ['weird', 'seen'],
      [undefined, 'seen'],
    ] as Array<[string | undefined, string]>) {
      wire();
      await service.onFaceEvent(evt({ eventAction: action }));
      expect(payloadOf().direction).toBe(dir);
    }
  });

  // ── C3 utc fallback ──
  it('utc rác → eventTime fallback now + payload utcFallback:true', async () => {
    wire();
    await service.onFaceEvent(evt({ utc: 'not-a-date' }));
    const p = payloadOf();
    expect(p.utcFallback).toBe(true);
    // event_time (param[3]) là Date now (không NaN).
    expect(insert()!.params[3] instanceof Date).toBe(true);
  });

  it('utc lệch xa (>1h) → fallback', async () => {
    wire();
    await service.onFaceEvent(evt({ utc: '2000-01-01T00:00:00.000Z' }));
    expect(payloadOf().utcFallback).toBe(true);
  });

  // ── SEC-01 ──
  it('SEC-01: payload KHÔNG chứa imageBase64', async () => {
    wire();
    await service.onFaceEvent(
      evt({ imageBase64: 'data:image/jpeg;base64,SECRETBASE64DATA==' }),
    );
    const rawPayload = insert()!.params[4];
    expect(rawPayload).not.toContain('imageBase64');
    expect(rawPayload).not.toContain('SECRETBASE64DATA');
    expect(rawPayload).not.toContain('base64');
  });

  // ── snapshot: lưu ảnh cho MỌI matchState có imageBase64 (quyết định 2026-08-07,
  // thay thế gate cũ F-B unmatched-only + F-C zone-violation-only) ──
  describe('snapshot (mọi matchState có ảnh)', () => {
    const AREA = AREA_UUID;
    const withImage = (over: any = {}) =>
      evt({
        imageBase64: 'data:image/jpeg;base64,SGVsbG8=',
        ...over,
      });

    it('matched + có ảnh → lưu snapshot, snapshot_file_id khác null (đảo ngược hành vi cũ)', async () => {
      wire();
      await service.onFaceEvent(withImage());
      expect(payloadOf().matchState).toBe('matched');
      expect(storageMock.saveFile).toHaveBeenCalledTimes(1);
      expect(storageMock.saveFile.mock.calls[0][0]).toMatchObject({
        folder: 'stranger-snapshots',
      });
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('unmatched_identity (szUid lạ) + có ảnh → lưu snapshot', async () => {
      wire({ user: [] });
      await service.onFaceEvent(withImage());
      expect(payloadOf().matchState).toBe('unmatched_identity');
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('unmatched_both (szUid lạ + channel lạ) + có ảnh → lưu snapshot', async () => {
      wire({ user: [], channelMap: {} });
      await service.onFaceEvent(withImage());
      expect(payloadOf().matchState).toBe('unmatched_both');
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('unmatched_location + có ảnh → GIỜ CŨNG lưu snapshot (trước đây không)', async () => {
      wire({ channelMap: {} }); // user OK, channel lạ → unmatched_location
      await service.onFaceEvent(withImage());
      expect(payloadOf().matchState).toBe('unmatched_location');
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('không có ảnh (mọi matchState) → KHÔNG gọi storage, snapshot null', async () => {
      wire();
      await service.onFaceEvent(evt());
      expect(storageMock.saveFile).not.toHaveBeenCalled();
      expect(snapshotFileIdOf()).toBeNull();
    });

    it('storage.saveFile lỗi → KHÔNG throw, raw event vẫn persist, snapshot_file_id null', async () => {
      wire();
      storageMock.saveFile.mockRejectedValueOnce(new Error('disk full'));
      await expect(service.onFaceEvent(withImage())).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
      expect(snapshotFileIdOf()).toBeNull();
    });

    it('INSERT media_files lỗi → KHÔNG throw, snapshot_file_id null, raw event vẫn persist', async () => {
      wire({ mediaFileInsertThrows: true });
      await expect(service.onFaceEvent(withImage())).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
      expect(snapshotFileIdOf()).toBeNull();
    });

    it('SEC-01 vẫn giữ nguyên: payload_json KHÔNG chứa base64 dù đã lưu snapshot', async () => {
      wire();
      await service.onFaceEvent(withImage());
      const rawPayload = insert()!.params[4];
      expect(rawPayload).not.toContain('base64');
      expect(rawPayload).not.toContain('SGVsbG8');
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('zone appear (presence-map có zone) + có ảnh → chỉ lưu 1 lần, KHÔNG double-save', async () => {
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(withImage({ utc: new Date().toISOString() }));
      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
      expect(storageMock.saveFile).toHaveBeenCalledTimes(1);
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('alert_rules KHÔNG còn được tra khi lưu snapshot (gate zone-violation đã bỏ)', async () => {
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(withImage());
      expect(captured.some((c) => c.sql.includes('FROM alert_rules'))).toBe(
        false,
      );
      expect(snapshotFileIdOf()).toBe('media1');
    });
  });

  // [FIX 2026-08-11, Zone Access Log đường B] INSERT iot_device_events.zone_id — tái dùng
  // presenceZoneId đã tính sẵn (channel_presence_zone_map), KHÔNG query thêm. Cột phục vụ
  // IvssZoneAccessLogService — KHÔNG đụng presenceSkipped/matchState/writeAppearEvent.
  describe('zone_id column (Zone Access Log đường B)', () => {
    const AREA = AREA_UUID;

    it('channel có map presence zone → INSERT zone_id = ĐÚNG presenceZoneId đã resolve', async () => {
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(evt());
      expect(zoneIdOf()).toBe(AREA);
    });

    it('channel KHÔNG map presence zone → INSERT zone_id = null (regression, không phá event không thuộc zone nào)', async () => {
      wire(); // KHÔNG presenceMap
      await service.onFaceEvent(evt());
      expect(zoneIdOf()).toBeNull();
    });

    it('SQL INSERT có cột zone_id ở CUỐI danh sách, KHÔNG đổi vị trí cột/param cũ (payload_json vẫn $5, processed_status vẫn $6)', async () => {
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(evt());
      expect(insert()!.sql).toContain(
        '(device_id, room_id, meeting_id, event_type, event_time, source_protocol, severity, payload_json, processed_status, snapshot_file_id, zone_id)',
      );
      expect(insert()!.sql).toContain(
        "VALUES ($1, $2, $3, 'ivss_face_event', $4, 'ivss', 'info', $5::jsonb, $6, $7, $8)",
      );
    });

    // [FIX 2026-08-19] userId=null KHÔNG còn bị presenceSkipped chặn — writeAppearEvent VẪN
    // được gọi (với userId=null) để restricted-zone-intrusion có input đánh giá người lạ.
    it('zone_id set độc lập với presenceSkipped/writeAppearEvent — userId null vẫn ghi zone_id VÀ vẫn gọi writeAppearEvent(userId=null)', async () => {
      wire({ presenceMap: { '5': AREA }, user: [] }); // userId null
      // utc mặc định của evt() là ngày cố định cũ → lệch >SKEW_MS so với "now" thật lúc test
      // chạy → utcFallback=true → presenceSkipped='bad_utc' che mất đúng nhánh đang test.
      await service.onFaceEvent(evt({ utc: new Date().toISOString() }));
      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
      expect(writerMock.writeAppearEvent.mock.calls[0][0].userId).toBeNull();
      expect(payloadOf().presenceSkipped).toBeNull();
      expect(zoneIdOf()).toBe(AREA); // zone_id KHÔNG phụ thuộc presenceSkipped — luôn theo channel map
    });
  });

  // B2 (Zone realtime) — broadcastZonePresence() gọi SAU writeAppearEvent() thành công,
  // gate ĐỘC LẬP với zoneRealtimeEnabled, KHÔNG đụng zone-presence-writer.service.ts.
  describe('B2 zone realtime — broadcastZonePresence() (zone:{zoneId}, zone.presence.updated)', () => {
    const AREA = AREA_UUID;

    it('flag=true + writeAppearEvent thành công → emitToRoom(zone:{zoneId}, zone.presence.updated, payload)', async () => {
      wire({ channelMap: {}, presenceMap: { '5': AREA } }); // isZoneContext=true (roomId null)
      service = await build(false, true);
      await service.onFaceEvent(evt({ utc: new Date().toISOString() }));

      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
      expect(wsMock.emitToRoom).toHaveBeenCalledWith(
        `zone:${AREA}`,
        'zone.presence.updated',
        expect.objectContaining({ zoneId: AREA, userId: 'u1' }),
      );
    });

    it('flag=false (mặc định) → KHÔNG emit zone broadcast dù writeAppearEvent vẫn chạy', async () => {
      wire({ channelMap: {}, presenceMap: { '5': AREA } });
      service = await build(false, false);
      await service.onFaceEvent(evt({ utc: new Date().toISOString() }));

      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
      expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    });

    it('userId null (người lạ hoàn toàn) + flag=true → vẫn broadcast với userId=null (mirror FIX 2026-08-19, KHÔNG chặn người lạ)', async () => {
      wire({ channelMap: {}, presenceMap: { '5': AREA }, user: [] });
      service = await build(false, true);
      await service.onFaceEvent(evt({ utc: new Date().toISOString() }));

      expect(writerMock.writeAppearEvent.mock.calls[0][0].userId).toBeNull();
      expect(wsMock.emitToRoom).toHaveBeenCalledWith(
        `zone:${AREA}`,
        'zone.presence.updated',
        expect.objectContaining({ zoneId: AREA, userId: null }),
      );
    });

    it('flag=true nhưng emitToRoom ném lỗi → onFaceEvent KHÔNG vỡ, intrusion check vẫn chạy tiếp bình thường (lỗi bị nuốt trong broadcastZonePresence)', async () => {
      wire({ channelMap: {}, presenceMap: { '5': AREA } });
      wsMock.emitToRoom.mockImplementation(() => {
        throw new Error('gateway down');
      });
      service = await build(false, true);
      await expect(
        service.onFaceEvent(evt({ utc: new Date().toISOString() })),
      ).resolves.toBeUndefined();

      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
      expect(intrusionMock.evaluateZoneEventNow).toHaveBeenCalledTimes(1);
    });

    it('presenceSkipped (KHÔNG ghi appear) → broadcastZonePresence KHÔNG được gọi dù flag=true', async () => {
      wire(); // KHÔNG presenceMap → presenceSkipped='zone_unmapped', writeAppearEvent KHÔNG chạy
      service = await build(false, true);
      await service.onFaceEvent(evt({ utc: new Date().toISOString() }));

      expect(writerMock.writeAppearEvent).not.toHaveBeenCalled();
      expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    });
  });

  // ── defensive ──
  it('bridge device không tồn tại → skip (KHÔNG INSERT)', async () => {
    wire({ bridge: [] });
    await service.onFaceEvent(evt());
    expect(insert()).toBeUndefined();
  });

  it('DB lỗi (INSERT throw) → KHÔNG throw (webhook always-ack)', async () => {
    wire({ insertThrows: true });
    await expect(service.onFaceEvent(evt())).resolves.toBeUndefined();
  });

  it('channel-map: entry value KHÔNG phải uuid → bị bỏ (SEC-03 validate)', async () => {
    wire({ channelMap: { '5': 'not-a-uuid' } });
    await service.onFaceEvent(evt());
    // channel 5 map giá trị rác → bỏ → unmatched_location.
    expect(payloadOf().matchState).toBe('unmatched_location');
  });

  it('channel-map null (chưa config) → mọi channel unmatched_location', async () => {
    wire({ channelMap: null });
    await service.onFaceEvent(evt());
    expect(payloadOf().matchState).toBe('unmatched_location');
  });

  // ── Nợ #3: matched YÊU CẦU là participant của meeting đang diễn ra ──
  // Test cũ "room OK + KHÔNG meeting active → vẫn matched" đã VIẾT LẠI: hành vi đó
  // cho phép điểm danh khi không có họp nào — chính là lỗ hổng Nợ #3 cần bịt.
  it('Nợ #3: room OK nhưng KHÔNG có meeting active → meetingId null → unmatched_identity', async () => {
    wire({ meeting: [] });
    await service.onFaceEvent(evt());
    const p = payloadOf();
    expect(p.matchState).toBe('unmatched_identity');
    expect(p.meetingId).toBeNull();
    expect(insert()!.params[5]).toBe('unmatched');
    // Không có meetingId → KHÔNG tốn query participant.
    expect(
      captured.some((c) => c.sql.includes('FROM meeting_participants')),
    ).toBe(false);
  });

  it('Nợ #3: user nhận diện được + có meeting active nhưng KHÔNG phải participant → unmatched_identity + processed_status unmatched', async () => {
    wire({ participant: [] }); // meeting m=MEETING_UUID active, user u1 KHÔNG trong danh sách
    await service.onFaceEvent(evt());
    const p = payloadOf();
    expect(p.matchState).toBe('unmatched_identity');
    expect(insert()!.params[5]).toBe('unmatched'); // KHÔNG được điểm danh
    // Vẫn persist đủ ngữ cảnh để truy vết (OQ-5): biết là ai, ở đâu, họp nào.
    expect(p.userId).toBe('u1');
    expect(p.roomId).toBe(ROOM_UUID);
    expect(p.meetingId).toBe(MEETING_UUID);
    // Query participant bind đúng tham số (SEC-03).
    const pq = captured.find((c) =>
      c.sql.includes('FROM meeting_participants'),
    );
    expect(pq).toBeDefined();
    expect(pq!.params).toEqual([MEETING_UUID, 'u1']);
  });

  it('Nợ #3: user LÀ participant của meeting active → matched + processed', async () => {
    wire({ participant: [{ id: 'p1' }] });
    await service.onFaceEvent(evt());
    const p = payloadOf();
    expect(p.matchState).toBe('matched');
    expect(p.meetingId).toBe(MEETING_UUID);
    expect(insert()!.params[5]).toBe('processed');
  });

  // ── IRP-001 (#40): broadcast realtime presence ──
  describe('IRP-001 broadcast realtime presence', () => {
    const room = `ivss:meeting:${MEETING_UUID}`;

    it('gate ON + matched + meetingId → emitToRoom đúng room + payload (KHÔNG persist-store đổi)', async () => {
      wire();
      service = await build(true);
      await service.onFaceEvent(evt());
      expect(wsMock.emitToRoom).toHaveBeenCalledTimes(1);
      const [r, ev, payload] = wsMock.emitToRoom.mock.calls[0];
      expect(r).toBe(room);
      expect(ev).toBe('ivss.presence');
      expect(payload).toEqual({
        meetingId: MEETING_UUID,
        roomId: ROOM_UUID,
        userId: 'u1',
        fullName: 'Alice',
        direction: 'enter',
        matchState: 'matched',
        at: expect.any(String),
      });
    });

    it('C4/SEC-01: payload KHÔNG szUid/imageBase64/similarity', async () => {
      wire();
      service = await build(true);
      await service.onFaceEvent(
        evt({ similarity: 0.97, imageBase64: 'data:image/jpeg;base64,SECRET' }),
      );
      const raw = JSON.stringify(wsMock.emitToRoom.mock.calls[0][2]);
      expect(raw).not.toContain('szUid');
      expect(raw).not.toContain('SZ1');
      expect(raw).not.toContain('imageBase64');
      expect(raw).not.toContain('similarity');
      expect(raw).not.toContain('0.97');
    });

    it('gate OFF (default) → KHÔNG emit', async () => {
      wire();
      await service.onFaceEvent(evt()); // service = build(false) từ beforeEach
      expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    });

    it('OQ-5: unmatched → KHÔNG emit (dù gate ON)', async () => {
      wire({ user: [] }); // unmatched_identity
      service = await build(true);
      await service.onFaceEvent(evt());
      expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    });

    it('meetingId null (không có họp active) → KHÔNG emit', async () => {
      wire({ meeting: [] });
      service = await build(true);
      await service.onFaceEvent(evt());
      expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    });

    it('OQ-7: INSERT fail → KHÔNG emit (broadcast sau persist)', async () => {
      wire({ insertThrows: true });
      service = await build(true);
      await service.onFaceEvent(evt());
      expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    });

    it('C3: emit throw → KHÔNG vỡ ingest', async () => {
      wire();
      wsMock.emitToRoom.mockImplementation(() => {
        throw new Error('gateway down');
      });
      service = await build(true);
      await expect(service.onFaceEvent(evt())).resolves.toBeUndefined();
    });

    it('B2: query fullName throw → KHÔNG vỡ ingest + KHÔNG emit', async () => {
      wire({ fullNameThrows: true });
      service = await build(true);
      await expect(service.onFaceEvent(evt())).resolves.toBeUndefined();
      expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    });

    it('fullName null (user không có tên) → vẫn emit, fullName:null', async () => {
      wire({ fullName: [{ full_name: null }] });
      service = await build(true);
      await service.onFaceEvent(evt());
      expect(wsMock.emitToRoom).toHaveBeenCalledTimes(1);
      expect(wsMock.emitToRoom.mock.calls[0][2].fullName).toBeNull();
    });
  });

  // ── Task B: direction suy từ channel-direction-map ──
  describe('Task B channel-direction-map', () => {
    it('map {"2":"enter"} + channel 2 + eventAction null → direction enter', async () => {
      wire({ directionMap: { '2': 'enter' } });
      await service.onFaceEvent(evt({ channelId: 2, eventAction: undefined }));
      expect(payloadOf().direction).toBe('enter');
    });

    it('map {"3":"leave"} + channel 3 → direction leave', async () => {
      wire({ directionMap: { '3': 'leave' } });
      await service.onFaceEvent(evt({ channelId: 3, eventAction: undefined }));
      expect(payloadOf().direction).toBe('leave');
    });

    it('number↔string key: channelId=2 (number) khớp key "2" (string)', async () => {
      wire({ directionMap: { '2': 'enter' } });
      await service.onFaceEvent(evt({ channelId: 2, eventAction: undefined }));
      expect(payloadOf().direction).toBe('enter');
    });

    it('KHÔNG map, eventAction "in" → enter (đường cũ nguyên)', async () => {
      wire({ directionMap: null });
      await service.onFaceEvent(evt({ channelId: 9, eventAction: 'in' }));
      expect(payloadOf().direction).toBe('enter');
    });

    it('KHÔNG map, eventAction null → seen', async () => {
      wire({ directionMap: null });
      await service.onFaceEvent(evt({ channelId: 9, eventAction: undefined }));
      expect(payloadOf().direction).toBe('seen');
    });

    it('channel ngoài map → rơi về eventAction/seen', async () => {
      wire({ directionMap: { '2': 'enter' } });
      await service.onFaceEvent(evt({ channelId: 7, eventAction: undefined }));
      expect(payloadOf().direction).toBe('seen');
    });

    it('value lạ trong map → bỏ entry → rơi về eventAction/seen', async () => {
      wire({ directionMap: { '2': 'weird' } });
      await service.onFaceEvent(evt({ channelId: 2, eventAction: undefined }));
      expect(payloadOf().direction).toBe('seen');
    });

    it('channel-map ưu tiên hơn eventAction (camera thắng)', async () => {
      wire({ directionMap: { '2': 'leave' } });
      await service.onFaceEvent(evt({ channelId: 2, eventAction: 'in' }));
      expect(payloadOf().direction).toBe('leave');
    });

    it('đọc config lỗi → fallback eventAction, KHÔNG vỡ ingest (vẫn persist)', async () => {
      wire({ directionMapThrows: true });
      await service.onFaceEvent(evt({ channelId: 2, eventAction: 'in' }));
      expect(insert()).toBeDefined();
      expect(payloadOf().direction).toBe('enter');
    });
  });

  // ── ZPW-001 (UC-109 B4): writer appear ──
  describe('zone presence writer (ZPW-001)', () => {
    const nowIso = () => new Date().toISOString();
    const AREA = AREA_UUID;

    // T4.1 — AC-BACKCOMPAT: presence-map trống = hiện trạng hôm nay.
    it('AC-BACKCOMPAT: presence-map trống → KHÔNG writeAppearEvent, điểm danh giữ nguyên, không ném', async () => {
      wire(); // KHÔNG presenceMap → zone_unmapped
      await expect(service.onFaceEvent(evt())).resolves.toBeUndefined();
      expect(writerMock.writeAppearEvent).not.toHaveBeenCalled();
      expect(payloadOf()).toMatchObject({
        szUid: 'SZ1',
        userId: 'u1',
        channelId: 5,
        roomId: ROOM_UUID,
        matchState: 'matched',
      });
      expect(insert()!.sql).toContain('RETURNING id');
      expect(payloadOf().presenceSkipped).toBe('zone_unmapped');
    });

    // [FIX 2026-08-19] userId NULL không còn là lý do skip — mirror hành vi Room (raw log vẫn
    // ghi cho người lạ), để restricted-zone-intrusion.isViolation() nhận được input userId=null
    // (trước đây luôn NULL = vi phạm nhưng chưa bao giờ có event nào tới được đó để đánh giá).
    it('userId NULL → payload KHÔNG skip, VẪN writeAppearEvent với userId=null', async () => {
      wire({ presenceMap: { '5': AREA }, user: [] });
      await service.onFaceEvent(evt({ utc: nowIso() }));
      expect(payloadOf().presenceSkipped).toBeNull();
      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
      expect(writerMock.writeAppearEvent.mock.calls[0][0].userId).toBeNull();
    });

    it('bad_utc: utcFallback → payload skip, KHÔNG writeAppearEvent (KHÔNG now())', async () => {
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(evt({ utc: 'not-a-date' }));
      expect(payloadOf().presenceSkipped).toBe('bad_utc');
      expect(writerMock.writeAppearEvent).not.toHaveBeenCalled();
    });

    it('zone_wrong_type: resolvePresenceZone {valid:false} → payload skip, KHÔNG writeAppearEvent', async () => {
      writerMock.resolvePresenceZone.mockResolvedValue({
        valid: false,
        reason: 'zone_wrong_type',
      });
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(evt({ utc: nowIso() }));
      expect(payloadOf().presenceSkipped).toBe('zone_wrong_type');
      expect(writerMock.writeAppearEvent).not.toHaveBeenCalled();
    });

    it('ghi appear thành công: writeAppearEvent 1 lần, metadata {channelId,szUid,similarity,sourceEventId} KHÔNG name; payload.presenceSkipped null', async () => {
      const iso = nowIso();
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(evt({ utc: iso, similarity: 88 }));
      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
      const arg = writerMock.writeAppearEvent.mock.calls[0][0];
      expect(arg.zoneId).toBe(AREA);
      expect(arg.userId).toBe('u1');
      expect(arg.eventTime.toISOString()).toBe(iso); // từ utc, KHÔNG now()
      expect(arg.metadata).toEqual({
        channelId: 5,
        szUid: 'SZ1',
        similarity: 88,
        sourceEventId: 'evt1',
      });
      expect(arg.metadata.name).toBeUndefined();
      expect(payloadOf().presenceSkipped).toBeNull();
    });

    it('A.2 WARN: channel có KEY trong CẢ room_map lẫn presence_map → logger.warn', async () => {
      const warnSpy = jest.spyOn((service as any).logger, 'warn');
      wire({ presenceMap: { '5': AREA } }); // room_map mặc định cũng có key '5'
      await service.onFaceEvent(evt({ utc: nowIso() }));
      const warned = warnSpy.mock.calls.some((c) =>
        String(c[0]).includes('CẢ room_map lẫn presence_zone_map'),
      );
      expect(warned).toBe(true);
      // vẫn ghi appear.
      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
    });

    it('writeAppearEvent ném → onFaceEvent KHÔNG ném, raw event vẫn ghi', async () => {
      writerMock.writeAppearEvent.mockRejectedValue(new Error('zpe boom'));
      wire({ presenceMap: { '5': AREA } });
      await expect(
        service.onFaceEvent(evt({ utc: nowIso() })),
      ).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
    });
  });

  // ── Đường intrusion TỨC THỜI (bên cạnh cron 5 phút — KHÔNG thay thế) ──
  describe('restricted-zone intrusion check (immediate)', () => {
    const nowIso = () => new Date().toISOString();
    const AREA = AREA_UUID;

    it('appear ghi thành công → gọi evaluateZoneEventNow đúng zoneId/userId/eventTime/sourceRowId=presenceId', async () => {
      const iso = nowIso();
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(evt({ utc: iso }));
      expect(intrusionMock.evaluateZoneEventNow).toHaveBeenCalledTimes(1);
      const arg = intrusionMock.evaluateZoneEventNow.mock.calls[0][0];
      expect(arg.zoneId).toBe(AREA);
      expect(arg.userId).toBe('u1');
      expect(arg.eventTime.toISOString()).toBe(iso);
      expect(arg.sourceTable).toBe('zone_presence_events');
      expect(arg.sourceRowId).toBe('zpe1'); // presenceId trả về từ writeAppearEvent mock
    });

    it('appear KHÔNG ghi (presenceSkipped) → KHÔNG gọi evaluateZoneEventNow', async () => {
      wire(); // KHÔNG presenceMap → zone_unmapped → không vào nhánh writeAppearEvent
      await service.onFaceEvent(evt());
      expect(intrusionMock.evaluateZoneEventNow).not.toHaveBeenCalled();
    });

    it('writeAppearEvent lỗi → KHÔNG gọi evaluateZoneEventNow (chỉ chạy SAU khi ghi appear thành công)', async () => {
      writerMock.writeAppearEvent.mockRejectedValue(new Error('zpe boom'));
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(evt({ utc: nowIso() }));
      expect(intrusionMock.evaluateZoneEventNow).not.toHaveBeenCalled();
    });

    it('evaluateZoneEventNow ném lỗi → onFaceEvent KHÔNG ném, raw event + appear vẫn đã ghi (try/catch riêng)', async () => {
      intrusionMock.evaluateZoneEventNow.mockRejectedValue(
        new Error('intrusion check boom'),
      );
      wire({ presenceMap: { '5': AREA } });
      await expect(
        service.onFaceEvent(evt({ utc: nowIso() })),
      ).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
    });

    it('evaluateZoneEventNow trả true (vi phạm) → KHÔNG ảnh hưởng kết quả onFaceEvent (best-effort, không đổi payload/insert)', async () => {
      intrusionMock.evaluateZoneEventNow.mockResolvedValue(true);
      wire({ presenceMap: { '5': AREA } });
      await expect(
        service.onFaceEvent(evt({ utc: nowIso() })),
      ).resolves.toBeUndefined();
      expect(payloadOf().matchState).toBe('matched');
    });
  });

  // ── ZPW-001 (UC-109): reader channel_presence_zone_map ──
  describe('getChannelPresenceZoneMap (ZPW-001)', () => {
    const AREA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    it('chỉ giữ entry value là UUID hợp lệ', async () => {
      dsMock.manager.query.mockResolvedValueOnce([
        { config_json: { '7': AREA, '8': 'not-uuid', '9': 42 } },
      ]);
      const map = await (service as any).getChannelPresenceZoneMap();
      expect(map).toEqual({ '7': AREA });
    });

    it('config trống/thiếu → {}', async () => {
      dsMock.manager.query.mockResolvedValueOnce([]);
      expect(await (service as any).getChannelPresenceZoneMap()).toEqual({});
    });

    it('query ném → {} (KHÔNG throw)', async () => {
      dsMock.manager.query.mockRejectedValueOnce(new Error('cfg down'));
      expect(await (service as any).getChannelPresenceZoneMap()).toEqual({});
    });
  });

  // ── F-B (MST-001): resolveMeeting nhận cả scheduled ──────────────────────
  describe('resolveMeeting (F-B)', () => {
    // utc phải nằm trong ±1h (SKEW) nếu không parseUtc rơi vào nhánh fallback.
    const nowIso = () => new Date().toISOString();

    it('nhận CẢ scheduled lẫn in_progress — bịt khe cron chưa kịp lật đầu giờ', async () => {
      wire();
      await service.onFaceEvent(evt({ utc: nowIso() }));
      const q = captured.find((c) => c.sql.includes('FROM meetings'))!;
      expect(q.sql).toContain("status IN ('scheduled', 'in_progress')");
      // Chặn hồi quy: KHÔNG quay lại lọc cứng 1 trạng thái.
      expect(q.sql).not.toMatch(/status\s*=\s*'in_progress'/);
    });

    it('vẫn chốt theo cửa sổ thời gian + loại soft-delete', async () => {
      wire();
      await service.onFaceEvent(evt({ utc: nowIso() }));
      const q = captured.find((c) => c.sql.includes('FROM meetings'))!;
      expect(q.sql).toContain('BETWEEN start_time AND end_time');
      expect(q.sql).toContain('deleted_at IS NULL');
    });

    it('KHÔNG nhận cancelled/completed/draft/pending_approval', async () => {
      wire();
      await service.onFaceEvent(evt({ utc: nowIso() }));
      const q = captured.find((c) => c.sql.includes('FROM meetings'))!;
      for (const s of ['cancelled', 'completed', 'draft', 'pending_approval']) {
        expect(q.sql).not.toContain(s);
      }
    });

    it('họp scheduled trong giờ → trả meetingId (matched, không còn unmatched)', async () => {
      wire({ meeting: [{ id: MEETING_UUID }] });
      await service.onFaceEvent(evt({ utc: nowIso() }));
      expect(payloadOf().meetingId).toBe(MEETING_UUID);
    });

    it('không có họp nào trong giờ → meetingId null (giữ nguyên hành vi cũ)', async () => {
      wire({ meeting: [] });
      await service.onFaceEvent(evt({ utc: nowIso() }));
      expect(payloadOf().meetingId).toBeNull();
    });
  });

  // ── resolveUser đọc CẢ 2 nguồn mapping (group "1" = ivss, group "USERS" = portrait) ──
  describe('resolveUser: ivss + portrait', () => {
    it('user chỉ có mapping source=portrait → vẫn resolve ra userId', async () => {
      wire();
      // Mô phỏng DB: chỉ tồn tại hàng source='portrait' → chỉ trả row nếu SQL nhận 'portrait'.
      const base = dsMock.manager.query.getMockImplementation();
      dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
        if (sql.includes('FROM device_user_mappings')) {
          captured.push({ sql, params });
          return Promise.resolve(
            sql.includes("'portrait'") ? [{ user_id: 'u-portrait' }] : [],
          );
        }
        return base(sql, params);
      });

      await service.onFaceEvent(evt());

      expect(payloadOf().userId).toBe('u-portrait');
      const q = captured.find((c) =>
        c.sql.includes('FROM device_user_mappings'),
      )!;
      expect(q.sql).toContain(
        "metadata_json->>'source' IN ('ivss', 'portrait')",
      );
      // Xác định thứ tự khi 1 user có cả 2 nguồn (không phụ thuộc thứ tự vật lý).
      expect(q.sql).toContain('ORDER BY last_synced_at DESC NULLS LAST');
    });
  });

  // ── [FIX 2026-08-17] personUid absent (0 candidate — người lạ hoàn toàn) ──
  // Bridge (EventListener.java, handleRecognition()) giờ KHÔNG còn return sớm
  // khi nCandidateNum<=0 — vẫn forward type='face_recognition' nhưng personUid
  // để trống. FaceEventDto/IvssFaceEvent.personUid đổi thành optional (trước
  // đây @IsNotEmpty() khiến case này bị 400 ngay từ ValidationPipe, chưa từng
  // tới được onFaceEvent()) — đây là nguyên nhân gốc "người lạ hoàn toàn
  // không có log gì". isStranger=true ở màn RoomAccessLogs/ZoneManagement suy
  // ra TỰ ĐỘNG từ userId=null (ivss-room-access-log.service.ts:88-90,
  // isStranger() KHÔNG đổi, generic cho mọi userId null) — không cần sửa gì
  // thêm ở tầng đọc.
  describe('personUid absent (0 candidate, người lạ hoàn toàn — [FIX 2026-08-17])', () => {
    it('personUid hợp lệ (case cũ, người quen) → hành vi KHÔNG đổi, vẫn matched, vẫn tra DB device_user_mappings', async () => {
      wire();
      await service.onFaceEvent(evt({ personUid: 'SZ1' }));
      const p = payloadOf();
      expect(p.matchState).toBe('matched');
      expect(p.userId).toBe('u1');
      expect(
        captured.some((c) => c.sql.includes('FROM device_user_mappings')),
      ).toBe(true);
    });

    it('personUid=undefined (0 candidate, người lạ hoàn toàn) → userId resolve null, KHÔNG tốn round-trip DB, vẫn persist unmatched_identity (isStranger=true ở tầng đọc)', async () => {
      wire();
      await service.onFaceEvent(evt({ personUid: undefined }));
      const p = payloadOf();
      expect(p.userId).toBeNull();
      expect(p.matchState).toBe('unmatched_identity');
      expect(insert()!.params[5]).toBe('unmatched');
      // resolveUser() early-return TRƯỚC khi query — không round-trip DB vô ích.
      expect(
        captured.some((c) => c.sql.includes('FROM device_user_mappings')),
      ).toBe(false);
    });

    it('personUid=undefined → KHÔNG throw, webhook always-ack giữ nguyên, raw event vẫn persist', async () => {
      wire();
      await expect(
        service.onFaceEvent(evt({ personUid: undefined })),
      ).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
    });
  });

  // ── [FIX 2026-08-17] Dedupe spam TRƯỚC INSERT — channelId+szUid, cửa sổ 8s ──
  describe('dedupe spam (SELECT-precheck trước INSERT, channelId+szUid, 8s — [FIX 2026-08-17])', () => {
    const captureDedupe = () =>
      captured.filter((c) => c.sql.includes('IS NOT DISTINCT FROM'));
    const captureInsert = () =>
      captured.filter((c) => c.sql.includes('INSERT INTO iot_device_events'));

    it('query dedupe đúng tham số: device_id, channelId (string), szUid, mốc cửa sổ = eventTime - 8000ms', async () => {
      wire();
      // utc phải trong ±1h (SKEW_MS) — dùng nowIso() như các test khác trong file, tránh
      // rơi vào nhánh fallback utcFallback (eventTime=now() độc lập với utc truyền vào).
      const iso = new Date().toISOString();
      await service.onFaceEvent(evt({ utc: iso }));
      const dq = captureDedupe()[0];
      expect(dq).toBeDefined();
      expect(dq.params[0]).toBe('bridge1'); // device_id
      expect(dq.params[1]).toBe('5'); // channelId → string, khớp payload_json->>'channelId'
      expect(dq.params[2]).toBe('SZ1'); // szUid raw (KHÔNG phải userId đã resolve)
      const windowStartMs = (dq.params[3] as Date).getTime();
      const expectedMs = new Date(iso).getTime() - 8000;
      // Sai số nhỏ cho phép do thời gian thực thi test, KHÔNG so exact (tránh flaky).
      expect(Math.abs(windowStartMs - expectedMs)).toBeLessThan(500);
    });

    it('2 event giống hệt nhau (cùng channelId+szUid) trong cửa sổ 8s → CHỈ 1 row được ghi', async () => {
      wire();
      let calls = 0;
      const base = dsMock.manager.query.getMockImplementation();
      dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
        if (sql.includes('IS NOT DISTINCT FROM')) {
          calls++;
          captured.push({ sql, params });
          // Lần 1: chưa có gì trong DB → []. Lần 2: đã có row lần 1 vừa ghi (id='evt1') → trùng.
          return Promise.resolve(calls === 1 ? [] : [{ id: 'evt1' }]);
        }
        return base(sql, params);
      });

      await service.onFaceEvent(evt());
      await service.onFaceEvent(evt());

      expect(captureInsert().length).toBe(1);
    });

    it('2 event cách nhau NGOÀI cửa sổ (DB không còn thấy trùng) → CẢ 2 đều được ghi', async () => {
      wire(); // dedupeHit mặc định undefined → SELECT luôn trả [] → không bao giờ coi là trùng
      await service.onFaceEvent(evt());
      await service.onFaceEvent(evt());
      expect(captureInsert().length).toBe(2);
    });

    it('người lạ (szUid null/undefined) — 2 event liên tiếp CÙNG channelId trong 8s → dedupe đúng (gộp lại, CHỈ 1 row)', async () => {
      wire();
      let calls = 0;
      const base = dsMock.manager.query.getMockImplementation();
      dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
        if (sql.includes('IS NOT DISTINCT FROM')) {
          calls++;
          captured.push({ sql, params });
          expect(params[2]).toBeNull(); // szUid null → NULL-safe key, KHÔNG sentinel string
          return Promise.resolve(calls === 1 ? [] : [{ id: 'evt1' }]);
        }
        return base(sql, params);
      });

      await service.onFaceEvent(evt({ personUid: undefined }));
      await service.onFaceEvent(evt({ personUid: undefined }));

      expect(captureInsert().length).toBe(1);
    });

    it('người lạ ở 2 channelId KHÁC nhau trong cùng 8s → KHÔNG bị dedupe nhầm (channelId là 1 phần khóa, CẢ 2 đều ghi)', async () => {
      wire(); // mặc định KHÔNG dedupeHit → mọi SELECT trả [] (đúng vì channelId khác nhau, DB thật cũng sẽ không match)
      await service.onFaceEvent(evt({ personUid: undefined, channelId: 5 }));
      await service.onFaceEvent(evt({ personUid: undefined, channelId: 6 }));

      expect(captureInsert().length).toBe(2);
      const dqs = captureDedupe();
      expect(dqs[0].params[1]).toBe('5');
      expect(dqs[1].params[1]).toBe('6');
    });

    it('có event trùng bị dedupe → return SỚM, KHÔNG chạm broadcast/zone-presence/intrusion (chỉ 1 lần cho event gốc)', async () => {
      const AREA = AREA_UUID;
      wire({ presenceMap: { '5': AREA } });
      service = await build(true); // realtime ON để chắc chắn broadcastPresence có cơ hội chạy nếu không bị chặn đúng
      let calls = 0;
      const base = dsMock.manager.query.getMockImplementation();
      dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
        if (sql.includes('IS NOT DISTINCT FROM')) {
          calls++;
          captured.push({ sql, params });
          return Promise.resolve(calls === 1 ? [] : [{ id: 'evt1' }]);
        }
        return base(sql, params);
      });

      await service.onFaceEvent(evt({ utc: new Date().toISOString() }));
      await service.onFaceEvent(evt({ utc: new Date().toISOString() }));

      expect(captureInsert().length).toBe(1);
      expect(wsMock.emitToRoom).toHaveBeenCalledTimes(1);
      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
      expect(intrusionMock.evaluateZoneEventNow).toHaveBeenCalledTimes(1);
    });

    it('KHÔNG trùng (case bình thường, mọi test cũ) → broadcast/zone-presence vẫn chạy y hệt trước, KHÔNG bị ảnh hưởng bởi lớp dedupe mới', async () => {
      const AREA = AREA_UUID;
      wire({ presenceMap: { '5': AREA } });
      service = await build(true);
      await service.onFaceEvent(evt({ utc: new Date().toISOString() }));
      expect(captureInsert().length).toBe(1);
      expect(wsMock.emitToRoom).toHaveBeenCalledTimes(1);
      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
    });

    it('dedupe TRƯỚC INSERT KHÔNG đụng logic phân loại: bị dedupe rồi thì matchStateOf() vốn dĩ không còn được gọi lại, nhưng lần ĐẦU (không trùng) matchState vẫn đúng như cũ', async () => {
      wire();
      await service.onFaceEvent(evt());
      expect(payloadOf().matchState).toBe('matched');
    });
  });

  // ── [RACE FIX 2026-08-22] pg_advisory_xact_lock chống 2 request đồng thời ──
  // Bằng chứng thật production: 60 nhóm event trùng TUYỆT ĐỐI cùng giây (channel+szUid+
  // event_time) trong 7 ngày — SELECT-precheck rời rạc (KHÔNG transaction) không chặn được
  // 2 request gần như đồng thời cùng SELECT "không thấy trùng" trước khi request nào kịp
  // INSERT. Mirror ĐÚNG kỹ thuật test đã dùng ở vehicle-resolve.service.spec.ts:1143-1242.
  describe('[RACE FIX 2026-08-22] pg_advisory_xact_lock chống 2 request đồng thời cùng channel+szUid', () => {
    /**
     * Mutex thủ công mô phỏng pg_advisory_xact_lock: request 2 PHẢI đợi transaction
     * của request 1 chạy XONG HẲN (kể cả INSERT) rồi mới được bắt đầu callback của nó —
     * đúng hành vi cần chứng minh. KHÔNG có mutex này (`dsMock.transaction` mặc định ở
     * beforeEach gọi `cb` ngay lập tức) thì 2 lệnh gọi sẽ interleave theo microtask,
     * đúng race đã xác nhận bằng dữ liệu thật.
     */
    const wireSerializedTransaction = () => {
      let lockChain: Promise<unknown> = Promise.resolve();
      dsMock.transaction = jest.fn((cb: (m: any) => Promise<unknown>) => {
        const run = lockChain.then(() => cb(dsMock.manager));
        lockChain = run.catch(() => undefined);
        return run;
      });
    };

    it('#1 — Promise.all 2 event giống hệt nhau (cùng channelId+szUid) → CHỈ 1 INSERT, lần 2 log dedupe-skip', async () => {
      wire();
      wireSerializedTransaction();
      let dedupeCalls = 0;
      const base = dsMock.manager.query.getMockImplementation();
      dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
        if (sql.includes('IS NOT DISTINCT FROM')) {
          dedupeCalls++;
          captured.push({ sql, params });
          // Nhờ lockChain, request 2 chỉ SELECT SAU KHI request 1 đã INSERT xong
          // (thật sự khớp hành vi transaction serialize) → thấy được row vừa tạo.
          return Promise.resolve(dedupeCalls === 1 ? [] : [{ id: 'evt1' }]);
        }
        return base(sql, params);
      });
      const debugSpy = jest.spyOn((service as any).logger, 'debug');

      await Promise.all([
        service.onFaceEvent(evt()),
        service.onFaceEvent(evt()),
      ]);

      expect(
        captured.filter((c) => c.sql.includes('INSERT INTO iot_device_events'))
          .length,
      ).toBe(1);
      const debugged = debugSpy.mock.calls.some((c) =>
        String(c[0]).includes('dedupe: bỏ qua'),
      );
      expect(debugged).toBe(true);
    });

    it('#2 — szUid=null (người lạ hoàn toàn) → lock key KHÔNG null, KHÔNG throw, vẫn dedupe đúng', async () => {
      wire();
      wireSerializedTransaction();
      let dedupeCalls = 0;
      const base = dsMock.manager.query.getMockImplementation();
      dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          captured.push({ sql, params });
          // lockKey = `ivss_face_dedup_${channelId}_${szUid ?? '__stranger__'}` —
          // phải là string cụ thể, KHÔNG bao giờ null/undefined (mới tránh được
          // 'x' || NULL = NULL ⇒ hashtext/advisory_lock lỗi).
          expect(params[0]).toBe('ivss_face_dedup_5___stranger__');
          expect(params[0]).not.toBeNull();
          return Promise.resolve([{}]);
        }
        if (sql.includes('IS NOT DISTINCT FROM')) {
          dedupeCalls++;
          captured.push({ sql, params });
          expect(params[2]).toBeNull(); // szUid null → NULL-safe key trong SELECT, KHÔNG sentinel
          return Promise.resolve(dedupeCalls === 1 ? [] : [{ id: 'evt1' }]);
        }
        return base(sql, params);
      });

      await expect(
        Promise.all([
          service.onFaceEvent(evt({ personUid: undefined })),
          service.onFaceEvent(evt({ personUid: undefined })),
        ]),
      ).resolves.toBeDefined();

      expect(
        captured.filter((c) => c.sql.includes('INSERT INTO iot_device_events'))
          .length,
      ).toBe(1);
    });

    it('#3 — transaction() gọi ĐÚNG 1 lần/sự kiện, pg_advisory_xact_lock là statement ĐẦU TIÊN trong transaction', async () => {
      wire();
      await service.onFaceEvent(evt());

      expect(dsMock.transaction).toHaveBeenCalledTimes(1);
      // Statement đầu tiên SAU khi transaction() bắt đầu chạy callback phải là lock —
      // TRƯỚC CẢ SELECT dedupe lẫn INSERT (captured ghi theo đúng thứ tự gọi thật).
      const txSqls = captured
        .map((c) => c.sql)
        .filter(
          (sql) =>
            sql.includes('pg_advisory_xact_lock') ||
            sql.includes('IS NOT DISTINCT FROM') ||
            sql.includes('INSERT INTO iot_device_events'),
        );
      expect(txSqls[0]).toContain('pg_advisory_xact_lock');
      expect(txSqls[1]).toContain('IS NOT DISTINCT FROM');
      expect(txSqls[2]).toContain('INSERT INTO iot_device_events');
    });

    it('SQL text của SELECT-dedupe/INSERT KHÔNG đổi so với trước fix (chỉ đổi đường gọi qua transaction)', async () => {
      wire();
      await service.onFaceEvent(evt());
      const dq = captured.find((c) => c.sql.includes('IS NOT DISTINCT FROM'))!;
      expect(dq.sql).toContain(
        "payload_json->>'szUid' IS NOT DISTINCT FROM $3",
      );
      const ins = captured.find((c) =>
        c.sql.includes('INSERT INTO iot_device_events'),
      )!;
      expect(ins.sql).toContain(
        '(device_id, room_id, meeting_id, event_type, event_time, source_protocol, severity, payload_json, processed_status, snapshot_file_id, zone_id)',
      );
    });
  });

  // ══ Phần B (Case 5) — ngưỡng similarity tối thiểu ═══════════════════════════
  describe('Phần B: ngưỡng similarity tối thiểu (minSimilarityThreshold)', () => {
    const AREA = AREA_UUID;
    const nowIso = () => new Date().toISOString();

    it('similarity >= ngưỡng → hành vi KHÔNG đổi (vẫn matched, userId giữ nguyên)', async () => {
      presenceConfigMock.getValues.mockResolvedValue({
        minSimilarityThreshold: 0.7,
      });
      wire();
      await service.onFaceEvent(evt({ similarity: 0.7 }));
      const p = payloadOf();
      expect(p.matchState).toBe('matched');
      expect(p.userId).toBe('u1');
    });

    // [FIX 2026-08-19] userId null-hoá (similarity thấp) không còn chặn writeAppearEvent/
    // evaluateZoneEventNow cho Zone — mirror đúng chỗ userId=null do "người lạ hoàn toàn"
    // (resolveUser trả null thẳng). broadcastPresence vẫn KHÔNG chạy — độc lập, gate riêng
    // theo matchState==='matched' (không đổi bởi fix này).
    it('similarity < ngưỡng → userId null-hoá TRƯỚC khi lan xuống: matchState=unmatched_identity, payload.userId=null, VẪN writeAppearEvent/evaluateZoneEventNow(userId=null), KHÔNG broadcastPresence', async () => {
      presenceConfigMock.getValues.mockResolvedValue({
        minSimilarityThreshold: 0.7,
      });
      wire({ presenceMap: { '5': AREA } });
      service = await build(true); // realtime ON để xác nhận broadcastPresence vẫn KHÔNG chạy
      await service.onFaceEvent(evt({ similarity: 0.5, utc: nowIso() }));
      const p = payloadOf();
      expect(p.matchState).toBe('unmatched_identity');
      expect(p.userId).toBeNull();
      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
      expect(writerMock.writeAppearEvent.mock.calls[0][0].userId).toBeNull();
      expect(intrusionMock.evaluateZoneEventNow).toHaveBeenCalledTimes(1);
      expect(intrusionMock.evaluateZoneEventNow.mock.calls[0][0].userId).toBeNull();
      expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    });

    it('similarity=null (bridge không trả) → GIỮ NGUYÊN hành vi cũ, không áp ngưỡng', async () => {
      presenceConfigMock.getValues.mockResolvedValue({
        minSimilarityThreshold: 0.7,
      });
      wire();
      await service.onFaceEvent(evt({ similarity: undefined }));
      const p = payloadOf();
      expect(p.matchState).toBe('matched');
      expect(p.userId).toBe('u1');
      expect(presenceConfigMock.getValues).not.toHaveBeenCalled();
    });

    it('ngưỡng đọc qua IvssPresenceConfigService.getValues(), KHÔNG hard-code: đổi ngưỡng → đổi kết quả', async () => {
      presenceConfigMock.getValues.mockResolvedValue({
        minSimilarityThreshold: 0.95, // nâng ngưỡng cao hơn similarity gửi lên
      });
      wire();
      await service.onFaceEvent(evt({ similarity: 0.9 }));
      expect(presenceConfigMock.getValues).toHaveBeenCalledTimes(1);
      const p = payloadOf();
      expect(p.matchState).toBe('unmatched_identity');
      expect(p.userId).toBeNull();
    });
  });

  // ── VIS-BE-001: hook phân hệ Khách ──
  describe('hook khách đến làm việc', () => {
    const ZONE = '11111111-1111-4111-8111-111111111111';
    const withHook = async (hook: unknown) => build(false, false, hook);

    it('gọi hook với userId, khu vực camera, hướng, sourceEventId và deviceId', async () => {
      const hook = { onIvssFaceEvent: jest.fn().mockResolvedValue(undefined) };
      const svc = await withHook(hook);
      wire({ presenceMap: { '5': ZONE }, directionMap: { '5': 'enter' } });
      await svc.onFaceEvent(evt());
      expect(hook.onIvssFaceEvent).toHaveBeenCalledTimes(1);
      expect(hook.onIvssFaceEvent).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'u1', zoneId: ZONE, direction: 'enter', sourceEventId: 'evt1', deviceId: 'bridge1',
      }));
    });

    it('không gọi hook khi không nhận ra người (similarity dưới ngưỡng → userId null)', async () => {
      const hook = { onIvssFaceEvent: jest.fn() };
      const svc = await withHook(hook);
      presenceConfigMock.getValues.mockResolvedValue({ minSimilarityThreshold: 0.95 });
      wire();
      await svc.onFaceEvent(evt({ similarity: 0.9 }));
      expect(hook.onIvssFaceEvent).not.toHaveBeenCalled();
    });

    it('không gọi hook khi sự kiện trùng (dedupe)', async () => {
      const hook = { onIvssFaceEvent: jest.fn() };
      const svc = await withHook(hook);
      wire({ dedupeHit: 'old-event' });
      await svc.onFaceEvent(evt());
      expect(hook.onIvssFaceEvent).not.toHaveBeenCalled();
    });

    it('hook từ chối (reject) → sự kiện vẫn được lưu, onFaceEvent không ném', async () => {
      const hook = { onIvssFaceEvent: jest.fn().mockRejectedValue(new Error('visitor boom')) };
      const svc = await withHook(hook);
      wire();
      await expect(svc.onFaceEvent(evt())).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
      await new Promise((r) => setImmediate(r)); // để .catch() của fire-and-forget chạy xong
    });

    it('không có hook (module Khách không nạp) → hành vi cũ không đổi', async () => {
      wire();
      await expect(service.onFaceEvent(evt())).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
    });
  });
});
