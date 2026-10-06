/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { DataSource } from 'typeorm';
import { VehicleResolveService } from './vehicle-resolve.service.js';

const evt = (over: any = {}) => ({
  plateRaw: '30A-123.45',
  plateNumber: '30A12345',
  channelId: 5,
  utc: '2026-06-24T09:00:00.000Z',
  eventAction: 'in',
  ...over,
});

describe('VehicleResolveService (VRE-001 / UC5)', () => {
  let service: VehicleResolveService;
  let dsMock: any;
  let alertMock: any;
  let gateMock: any;
  let pairMock: any;
  let storageMock: any;
  let captured: Array<{ sql: string; params: any[] }>;

  const wire = (
    over: {
      bridge?: any[];
      user?: any[];
      insertThrows?: boolean;
      zoneMap?: Record<string, string>; // channel → zone_uuid (config_json)
      dirMap?: Record<string, string>; // channel → enter/leave/seen
      mediaFileId?: string | null; // F-D: id RETURNING của INSERT INTO media_files
      mediaFileInsertThrows?: boolean;
    } = {},
  ) => {
    captured = [];
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve(over.bridge ?? [{ id: 'bridge1' }]);
      if (sql.includes('FROM vehicle_registrations'))
        return Promise.resolve(over.user ?? [{ id: 'reg1', user_id: 'u1' }]);
      if (sql.includes('FROM system_configs')) {
        const key = params?.[0];
        if (key === 'ivss.channel_zone_map')
          return Promise.resolve(
            over.zoneMap ? [{ config_json: over.zoneMap }] : [],
          );
        if (key === 'ivss.channel_direction_map')
          return Promise.resolve(
            over.dirMap ? [{ config_json: over.dirMap }] : [],
          );
        return Promise.resolve([]);
      }
      // F-D: saveEventSnapshot() INSERT vào media_files (RETURNING id).
      if (sql.includes('INSERT INTO media_files')) {
        if (over.mediaFileInsertThrows)
          return Promise.reject(new Error('media_files boom'));
        return Promise.resolve([{ id: over.mediaFileId ?? 'media1' }]);
      }
      if (sql.includes('INSERT INTO iot_device_events')) {
        if (over.insertThrows) return Promise.reject(new Error('db boom'));
        return Promise.resolve([{ id: 'evt1' }]); // QĐ-6: RETURNING id
      }
      if (sql.includes('UPDATE iot_device_events'))
        return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
  };

  const insert = () =>
    captured.find((c) => c.sql.includes('INSERT INTO iot_device_events'));
  const update = () =>
    captured.find((c) => c.sql.includes('UPDATE iot_device_events'));
  const payloadOf = () => JSON.parse(insert()!.params[2]);
  const snapshotFileIdOf = () => insert()!.params[4];
  // channel mặc định 5 map sang zone gate + direction (dùng cho test có ghi gate log).
  const GATE = {
    zoneMap: { '5': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    dirMap: { '5': 'enter' },
  };

  beforeEach(() => {
    dsMock = { manager: { query: jest.fn() } };
    // RACE FIX: onVehicleEvent() bọc merge-hoặc-insert trong this.dataSource.transaction(...)
    // (mirror ChannelMapConfigService.spec.ts) — callback nhận `manager`, ở đây dùng LẠI
    // dsMock.manager (cùng jest.fn `.query`) để mọi SQL-sniffing (`captured`/wire()/wireMerge())
    // của test hiện có tiếp tục hoạt động không đổi, không cần EntityManager mock riêng.
    dsMock.transaction = jest.fn((cb: (m: any) => unknown) =>
      cb(dsMock.manager),
    );
    alertMock = { evaluate: jest.fn().mockResolvedValue(undefined) };
    gateMock = {
      writeGateLog: jest
        .fn()
        .mockResolvedValue({ written: true, logId: 'gl1' }),
    };
    pairMock = {
      pairForLeaveLog: jest.fn().mockResolvedValue('skipped'),
    };
    storageMock = {
      saveFile: jest.fn().mockResolvedValue({
        storageKey: 'anpr-snapshots/x.jpg',
        publicUrl: 'http://localhost:3000/uploads/anpr-snapshots/x.jpg',
        sizeBytes: 123,
      }),
      getDriver: jest.fn().mockReturnValue('local'),
    };
    service = new VehicleResolveService(
      dsMock as DataSource,
      alertMock,
      gateMock,
      pairMock,
      storageMock,
    );
  });

  it('matched: biển active → INSERT processed + payload.userId set', async () => {
    wire();
    await service.onVehicleEvent(evt());
    const ins = insert();
    expect(ins).toBeDefined();
    expect(ins!.params[3]).toBe('processed'); // processed_status
    const p = payloadOf();
    expect(p.matchState).toBe('matched');
    expect(p.userId).toBe('u1');
    expect(p.plateNumber).toBe('30A12345');
    expect(p.plateRaw).toBe('30A-123.45');
  });

  it('unmatched: biển không có/disabled/đã-xóa (resolve null) → INSERT unmatched + userId null', async () => {
    wire({ user: [] });
    await service.onVehicleEvent(evt());
    expect(insert()!.params[3]).toBe('unmatched');
    const p = payloadOf();
    expect(p.matchState).toBe('unmatched');
    expect(p.userId).toBeNull();
  });

  it('C1-isolation: INSERT event_type=ivss_vehicle_event (KHÔNG ivss_face_event)', async () => {
    wire();
    await service.onVehicleEvent(evt());
    expect(insert()!.sql).toContain("'ivss_vehicle_event'");
    expect(insert()!.sql).not.toContain('ivss_face_event');
  });

  it('room/meeting NULL: INSERT literal NULL cho room_id/meeting_id', async () => {
    wire();
    await service.onVehicleEvent(evt());
    // VALUES ($1, NULL, NULL, 'ivss_vehicle_event', ...) — 5 bind params (KHÔNG có
    // room/meeting; F-D thêm $5=snapshot_file_id ở CUỐI, KHÔNG đổi 4 param đầu).
    expect(insert()!.sql).toMatch(/VALUES \(\$1, NULL, NULL,/);
    expect(insert()!.params).toHaveLength(5);
  });

  it('resolve query: plate_number + status active + deleted_at IS NULL + JOIN users (VPT-001)', async () => {
    wire();
    await service.onVehicleEvent(evt());
    const q = captured.find((c) =>
      c.sql.includes('FROM vehicle_registrations'),
    );
    expect(String(q?.sql)).toContain("vr.status = 'active'");
    expect(String(q?.sql)).toContain('vr.deleted_at IS NULL');
    expect(String(q?.sql)).toContain('JOIN users u ON u.id = vr.user_id');
    expect(String(q?.sql)).toContain('u.deleted_at IS NULL');
    expect(String(q?.sql)).toContain(
      'u.account_expires_at IS NULL OR u.account_expires_at >= NOW()',
    );
    expect(q?.params).toEqual(['30A12345']); // DATA-03: dùng plateNumber đã chuẩn
  });

  // ── VPT-001: hết hạn / xoá tài khoản → unmatched ──

  it('VPT-001: hết hạn/xoá tài khoản → unmatched (userId null, matchState unmatched, processed_status unmatched)', async () => {
    // Biển active nhưng user đã hết hạn/xoá → query JOIN không trả row → resolve null.
    // Mock: user: [] = không có row nào khớp điều kiện JOIN (hết hạn hoặc deleted_at IS NOT NULL).
    wire({ user: [] });
    await service.onVehicleEvent(evt());
    expect(insert()!.params[3]).toBe('unmatched');
    const p = payloadOf();
    expect(p.matchState).toBe('unmatched');
    expect(p.userId).toBeNull();
  });

  it('VPT-001: account_expires_at = null (nhân viên thường, không giới hạn) → matched như cũ', async () => {
    // account_expires_at IS NULL → điều kiện OR thoả → JOIN trả row → matched bình thường.
    // Default wire() mock user: [{ id: 'reg1', user_id: 'u1' }] — biểu thị row có trong JOIN.
    wire();
    await service.onVehicleEvent(evt());
    const p = payloadOf();
    expect(p.userId).toBe('u1');
    expect(p.matchState).toBe('matched');
  });

  it('VPT-001: account_expires_at tương lai (đã gia hạn) → matched như cũ', async () => {
    // account_expires_at >= NOW() → điều kiện OR thoả → JOIN trả row → matched.
    // Lưu ý: mock raw-SQL không phân biệt được lý do "vì sao có/không có row" ở tầng unit test;
    // chỉ assert hành vi 2 nhánh: có row (matched) / không có row (unmatched) — giới hạn đã
    // ghi ở plan §2.3, không phải thiếu sót. Wire trả row → matched.
    wire();
    await service.onVehicleEvent(evt());
    const p = payloadOf();
    expect(p.userId).toBe('u1');
    expect(p.matchState).toBe('matched');
  });

  it('direction: in→enter, out→leave, absent/lạ→seen', async () => {
    for (const [action, dir] of [
      ['in', 'enter'],
      ['entry', 'enter'],
      ['out', 'leave'],
      ['exit', 'leave'],
      ['weird', 'seen'],
      [undefined, 'seen'],
    ] as Array<[string | undefined, string]>) {
      wire();
      await service.onVehicleEvent(evt({ eventAction: action }));
      expect(payloadOf().direction).toBe(dir);
    }
  });

  it('parseUtc: utc rác → eventTime = Date now (không NaN)', async () => {
    wire();
    await service.onVehicleEvent(evt({ utc: 'not-a-date' }));
    expect(insert()!.params[1] instanceof Date).toBe(true);
    expect(Number.isNaN((insert()!.params[1] as Date).getTime())).toBe(false);
  });

  it('parseUtc: utc lệch xa (>1h) → fallback now', async () => {
    wire();
    await service.onVehicleEvent(evt({ utc: '2000-01-01T00:00:00.000Z' }));
    const t = insert()!.params[1] as Date;
    expect(Math.abs(Date.now() - t.getTime())).toBeLessThan(60_000);
  });

  it('NotThrow: INSERT ném lỗi → onVehicleEvent KHÔNG ném', async () => {
    wire({ insertThrows: true });
    await expect(service.onVehicleEvent(evt())).resolves.toBeUndefined();
  });

  it('device chưa seed: resolveBridgeDeviceId [] → KHÔNG INSERT, log+return', async () => {
    wire({ bridge: [] });
    await service.onVehicleEvent(evt());
    expect(insert()).toBeUndefined();
  });

  it('SEC-01: payload (param) KHÔNG chứa imageBase64 dù evt có', async () => {
    wire();
    await service.onVehicleEvent(
      evt({ imageBase64: 'data:image/jpeg;base64,SECRETB64DATA' }),
    );
    const raw = insert()!.params[2];
    expect(raw).not.toContain('imageBase64');
    expect(raw).not.toContain('SECRETB64DATA');
  });

  it('optional fields (plateColor/vehicleType) vào payload khi có', async () => {
    wire();
    await service.onVehicleEvent(
      evt({ plateColor: 'white', vehicleType: 'car' }),
    );
    const p = payloadOf();
    expect(p.plateColor).toBe('white');
    expect(p.vehicleType).toBe('car');
  });

  // ── F-D: snapshot ANPR ──
  describe('F-D snapshot', () => {
    const withImage = (over: any = {}) =>
      evt({ imageBase64: 'data:image/jpeg;base64,SGVsbG8=', ...over });

    it('có ảnh + matched → lưu snapshot, snapshot_file_id khác null', async () => {
      wire();
      await service.onVehicleEvent(withImage());
      expect(storageMock.saveFile).toHaveBeenCalledTimes(1);
      expect(storageMock.saveFile.mock.calls[0][0]).toMatchObject({
        folder: 'anpr-snapshots',
      });
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('có ảnh + unmatched (biển lạ) → VẪN lưu snapshot (không điều kiện matchState)', async () => {
      wire({ user: [] });
      await service.onVehicleEvent(withImage());
      expect(payloadOf().matchState).toBe('unmatched');
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('KHÔNG có ảnh (bridge chưa gửi, R7) → KHÔNG gọi storage, snapshot_file_id null, KHÔNG lỗi', async () => {
      wire();
      await expect(service.onVehicleEvent(evt())).resolves.toBeUndefined();
      expect(storageMock.saveFile).not.toHaveBeenCalled();
      expect(snapshotFileIdOf()).toBeNull();
    });

    it('storage.saveFile lỗi → KHÔNG throw, raw event vẫn persist, snapshot_file_id null', async () => {
      wire();
      storageMock.saveFile.mockRejectedValueOnce(new Error('disk full'));
      await expect(
        service.onVehicleEvent(withImage()),
      ).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
      expect(snapshotFileIdOf()).toBeNull();
    });

    it('INSERT media_files lỗi → KHÔNG throw, snapshot_file_id null, raw event vẫn persist', async () => {
      wire({ mediaFileInsertThrows: true });
      await expect(
        service.onVehicleEvent(withImage()),
      ).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
      expect(snapshotFileIdOf()).toBeNull();
    });

    it('SEC-01 vẫn giữ nguyên: payload_json KHÔNG chứa base64 dù đã lưu snapshot', async () => {
      wire();
      await service.onVehicleEvent(withImage());
      const rawPayload = insert()!.params[2];
      expect(rawPayload).not.toContain('base64');
      expect(rawPayload).not.toContain('SGVsbG8');
      expect(snapshotFileIdOf()).toBe('media1');
    });
  });

  // ── UC9 (VCC-001): wiring VehicleControlAlertService.evaluate ──
  describe('UC9 control-list alert wiring', () => {
    it('matched: evaluate được gọi với (plateNumber, {channelId, direction})', async () => {
      wire();
      await service.onVehicleEvent(evt({ eventAction: 'in' }));
      expect(alertMock.evaluate).toHaveBeenCalledWith(
        '30A12345',
        { channelId: 5, direction: 'enter' },
        expect.any(String),
        { registeredActive: true },
      );
    });

    it('unmatched: evaluate VẪN được gọi (độc lập matchState)', async () => {
      wire({ user: [] });
      await service.onVehicleEvent(evt());
      expect(alertMock.evaluate).toHaveBeenCalledTimes(1);
    });

    it('STT 20: unmatched → registeredActive=false (evaluate vẫn tra đăng ký xe)', async () => {
      wire({ user: [] });
      await service.onVehicleEvent(evt());
      expect(alertMock.evaluate.mock.calls[0]?.[3]).toEqual({
        registeredActive: false,
      });
    });

    it('NotThrow: alertMock.evaluate reject → onVehicleEvent KHÔNG throw', async () => {
      wire();
      alertMock.evaluate.mockRejectedValue(new Error('alert boom'));
      await expect(service.onVehicleEvent(evt())).resolves.toBeUndefined();
    });
  });

  // === UC-108 (FR-004, FR-008b): INSERT chạy TRƯỚC evaluate, truyền source_event_id ===
  // Dùng wire() làm nền: mock rỗng sẽ khiến resolveBridgeDeviceId ném (outer catch nuốt) →
  // INSERT không bao giờ chạy và test luôn đỏ.
  describe('UC-108 INSERT trước evaluate', () => {
    it('FR-004: evaluate được gọi SAU INSERT', async () => {
      const callOrder: string[] = [];
      wire();
      const base = dsMock.manager.query.getMockImplementation();
      dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO iot_device_events'))
          callOrder.push('INSERT');
        return base(sql, params);
      });
      alertMock.evaluate.mockImplementation(() => {
        callOrder.push('evaluate');
        return Promise.resolve();
      });
      await service.onVehicleEvent(evt());
      expect(callOrder).toEqual(['INSERT', 'evaluate']);
    });

    it('FR-008b: eventId từ RETURNING id được truyền vào evaluate', async () => {
      wire();
      await service.onVehicleEvent(evt());
      expect(alertMock.evaluate).toHaveBeenCalledWith(
        '30A12345',
        { channelId: 5, direction: 'enter' },
        'evt1',
        expect.any(Object),
      );
    });

    it('AC-006: INSERT lỗi → eventId undefined, evaluate VẪN được gọi, KHÔNG ném', async () => {
      wire({ insertThrows: true });
      await expect(service.onVehicleEvent(evt())).resolves.toBeUndefined();
      expect(alertMock.evaluate).toHaveBeenCalledWith(
        '30A12345',
        { channelId: 5, direction: 'enter' },
        undefined,
        expect.any(Object),
      );
    });

    // Quyết định merge: INSERT hỏng → không có raw event để tham chiếu → KHÔNG ghi gate log
    // mồ côi (giữ hành vi UC-105 gốc, khi INSERT ném là cả luồng dừng).
    it('AC-006 + GAW-001: INSERT lỗi → KHÔNG ghi gate log', async () => {
      wire({ ...GATE, insertThrows: true });
      await expect(
        service.onVehicleEvent(evt({ utc: new Date().toISOString() })),
      ).resolves.toBeUndefined();
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
    });

    it('INSERT dùng RETURNING id', async () => {
      wire();
      await service.onVehicleEvent(evt());
      expect(insert()!.sql).toContain('RETURNING id');
    });
  });

  // ── B3 (GAW-001): readers channel_zone/direction_map + resolveUserByPlate mở rộng ──
  describe('channel maps readers (GAW-001)', () => {
    const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    it('getChannelZoneMap: chỉ giữ entry value là UUID hợp lệ', async () => {
      dsMock.manager.query.mockResolvedValueOnce([
        { config_json: { '3': UUID, '4': 'not-a-uuid', '5': 123 } },
      ]);
      const map = await (service as any).getChannelZoneMap();
      expect(map).toEqual({ '3': UUID });
    });

    it('getChannelZoneMap: config trống/thiếu → {}', async () => {
      dsMock.manager.query.mockResolvedValueOnce([]);
      expect(await (service as any).getChannelZoneMap()).toEqual({});
    });

    it('getChannelZoneMap: query ném → {} (KHÔNG throw)', async () => {
      dsMock.manager.query.mockRejectedValueOnce(new Error('cfg down'));
      expect(await (service as any).getChannelZoneMap()).toEqual({});
    });

    it('getChannelDirectionMap: chỉ nhận enter/leave/seen, bỏ value lạ', async () => {
      dsMock.manager.query.mockResolvedValueOnce([
        { config_json: { '3': 'enter', '4': 'leave', '5': 'seen', '6': 'up' } },
      ]);
      const map = await (service as any).getChannelDirectionMap();
      expect(map).toEqual({ '3': 'enter', '4': 'leave', '5': 'seen' });
    });

    it('getChannelDirectionMap: query ném → {} (KHÔNG throw)', async () => {
      dsMock.manager.query.mockRejectedValueOnce(new Error('cfg down'));
      expect(await (service as any).getChannelDirectionMap()).toEqual({});
    });
  });

  describe('resolveUserByPlate mở rộng (QC-7)', () => {
    it('matched → {userId, vehicleRegistrationId} (một query SELECT vr.id, vr.user_id JOIN users)', async () => {
      dsMock.manager.query.mockResolvedValueOnce([
        { id: 'reg-9', user_id: 'u9' },
      ]);
      const r = await (service as any).resolveUserByPlate('30A12345');
      expect(r).toEqual({ userId: 'u9', vehicleRegistrationId: 'reg-9' });
      const sql = String(dsMock.manager.query.mock.calls[0][0]);
      expect(sql).toContain('SELECT vr.id, vr.user_id');
    });

    it('không match → null', async () => {
      dsMock.manager.query.mockResolvedValueOnce([]);
      expect(await (service as any).resolveUserByPlate('X')).toBeNull();
    });
  });

  // ── B4 (GAW-001 / UC-105): writer gate log ──
  describe('gate log writer (GAW-001)', () => {
    // utc gần "now" để parseUtc KHÔNG fallback (utcFallback=false).
    const nowIso = () => new Date().toISOString();

    // T4.1 — AC-BACKCOMPAT (characterization): channel_zone_map trống = hiện trạng hôm nay.
    it('AC-BACKCOMPAT: map trống → KHÔNG writeGateLog, INSERT giữ trường/giá trị cũ, không ném', async () => {
      wire(); // KHÔNG zoneMap → zone_unmapped
      await expect(
        service.onVehicleEvent(evt({ utc: nowIso() })),
      ).resolves.toBeUndefined();
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
      // CHỨA các khoá cũ với giá trị cũ (toMatchObject — KHÔNG toEqual cả payload).
      expect(payloadOf()).toMatchObject({
        plateNumber: '30A12345',
        plateRaw: '30A-123.45',
        userId: 'u1',
        matchState: 'matched',
        direction: 'enter',
        channelId: 5,
      });
      expect(insert()!.params).toHaveLength(5);
      expect(insert()!.sql).toContain('RETURNING id');
    });

    it('T4.3: map trống → gateLogSkipped=zone_unmapped trong payload', async () => {
      wire();
      await service.onVehicleEvent(evt({ utc: nowIso() }));
      expect(payloadOf().gateLogSkipped).toBe('zone_unmapped');
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
    });

    it('direction_seen: zone mapped nhưng direction resolve = seen → KHÔNG ghi', async () => {
      wire({ zoneMap: GATE.zoneMap }); // KHÔNG dirMap + eventAction lạ → seen
      await service.onVehicleEvent(
        evt({ eventAction: 'weird', utc: nowIso() }),
      );
      expect(payloadOf().gateLogSkipped).toBe('direction_seen');
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
    });

    it('plate_too_long: biển >16 ký tự → KHÔNG ghi', async () => {
      wire(GATE);
      await service.onVehicleEvent(
        evt({ plateNumber: 'A'.repeat(17), utc: nowIso() }),
      );
      expect(payloadOf().gateLogSkipped).toBe('plate_too_long');
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
    });

    it('bad_utc (ISO hỏng): utcFallback → KHÔNG ghi, KHÔNG dùng now()', async () => {
      wire(GATE);
      await service.onVehicleEvent(evt({ utc: 'not-a-date' }));
      expect(payloadOf().gateLogSkipped).toBe('bad_utc');
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
    });

    it('bad_utc (lệch >1h): utc quá xa → KHÔNG ghi', async () => {
      wire(GATE);
      await service.onVehicleEvent(evt({ utc: '2000-01-01T00:00:00.000Z' }));
      expect(payloadOf().gateLogSkipped).toBe('bad_utc');
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
    });

    it('zone_not_gate: writeGateLog trả zone_not_gate → UPDATE payload, KHÔNG pairing', async () => {
      gateMock.writeGateLog.mockResolvedValue({
        written: false,
        skipReason: 'zone_not_gate',
      });
      wire(GATE);
      await service.onVehicleEvent(evt({ utc: nowIso() }));
      expect(gateMock.writeGateLog).toHaveBeenCalledTimes(1);
      const upd = update();
      expect(upd).toBeDefined();
      expect(upd!.params[0]).toBe('zone_not_gate');
      expect(pairMock.pairForLeaveLog).not.toHaveBeenCalled();
    });

    it('duplicate: writeGateLog trả duplicate → UPDATE gateLogSkipped=duplicate, KHÔNG pairing', async () => {
      gateMock.writeGateLog.mockResolvedValue({
        written: false,
        skipReason: 'duplicate',
      });
      wire({ zoneMap: GATE.zoneMap, dirMap: { '5': 'leave' } });
      await service.onVehicleEvent(evt({ utc: nowIso() }));
      expect(update()!.params[0]).toBe('duplicate');
      expect(pairMock.pairForLeaveLog).not.toHaveBeenCalled();
    });

    it('QĐ-6 + QC-8 + QC-5: eventId, accessTime=utc (KHÔNG now), metadata truyền đúng', async () => {
      const iso = nowIso();
      wire(GATE);
      await service.onVehicleEvent(evt({ utc: iso }));
      const arg = gateMock.writeGateLog.mock.calls[0][0];
      expect(arg.eventId).toBe('evt1'); // QĐ-6: từ RETURNING id
      expect(arg.accessTime.toISOString()).toBe(iso); // QC-8: từ evt.utc, KHÔNG now()
      expect(arg.metadata).toEqual({ channelId: 5, plateRaw: '30A-123.45' }); // QC-5
      expect(arg.userId).toBe('u1');
      expect(arg.vehicleRegistrationId).toBe('reg1'); // QC-7
      expect(arg.direction).toBe('enter');
    });

    it('A.5 biển rỗng → writeGateLog nhận plateNumber=null, VẪN ghi', async () => {
      wire(GATE);
      await service.onVehicleEvent(evt({ plateNumber: '', utc: nowIso() }));
      expect(gateMock.writeGateLog).toHaveBeenCalledTimes(1);
      expect(gateMock.writeGateLog.mock.calls[0][0].plateNumber).toBeNull();
    });

    it('leave → pairForLeaveLog(logId); enter → KHÔNG pairing (FR-07)', async () => {
      // leave
      wire({ zoneMap: GATE.zoneMap, dirMap: { '5': 'leave' } });
      await service.onVehicleEvent(evt({ utc: nowIso() }));
      expect(pairMock.pairForLeaveLog).toHaveBeenCalledWith('gl1');
      // enter
      pairMock.pairForLeaveLog.mockClear();
      wire(GATE); // dirMap ch5=enter
      // STT 7: map kênh cache 30s → đổi config giữa 2 event phải xoá cache.
      (service as any).zoneMapCache = undefined;
      (service as any).dirMapCache = undefined;
      await service.onVehicleEvent(evt({ utc: nowIso() }));
      expect(pairMock.pairForLeaveLog).not.toHaveBeenCalled();
    });

    it('QĐ-8: pairForLeaveLog ném → onVehicleEvent KHÔNG ném, writeGateLog vẫn đã gọi', async () => {
      wire({ zoneMap: GATE.zoneMap, dirMap: { '5': 'leave' } });
      pairMock.pairForLeaveLog.mockRejectedValue(new Error('pair boom'));
      await expect(
        service.onVehicleEvent(evt({ utc: nowIso() })),
      ).resolves.toBeUndefined();
      expect(gateMock.writeGateLog).toHaveBeenCalledTimes(1);
    });

    it('writeGateLog ném lỗi THƯỜNG → KHÔNG ném, INSERT còn, KHÔNG pairing (spec §8.1)', async () => {
      wire(GATE);
      gateMock.writeGateLog.mockRejectedValue(new Error('conn lost'));
      await expect(
        service.onVehicleEvent(evt({ utc: nowIso() })),
      ).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
      expect(pairMock.pairForLeaveLog).not.toHaveBeenCalled();
    });

    it('gateDirection từ channel_direction_map (QĐ-3) ưu tiên hơn eventAction', async () => {
      // eventAction 'in' (→enter) nhưng dirMap ch5='leave' → gate ghi leave.
      wire({ zoneMap: GATE.zoneMap, dirMap: { '5': 'leave' } });
      await service.onVehicleEvent(evt({ eventAction: 'in', utc: nowIso() }));
      expect(gateMock.writeGateLog.mock.calls[0][0].direction).toBe('leave');
      // payload.direction (raw) GIỮ eventAction-based = enter (AC-BACKCOMPAT).
      expect(payloadOf().direction).toBe('enter');
      // [FIX 2026-08-11, B4] payload.gateDirection PHẢI mang giá trị ĐÃ GHI ĐÈ (leave) —
      // khác payload.direction (enter) — đây chính là field UI cần đọc để hiện đúng chiều.
      expect(payloadOf().gateDirection).toBe('leave');
    });

    // [FIX 2026-08-11, B4] payload.gateDirection — field mới cho UI đọc đúng nguồn.
    describe('B4: payload.gateDirection (field mới, KHÔNG đổi payload.direction)', () => {
      it('channel KHÔNG có channel_direction_map (dùng thẳng eventAction) → gateDirection = direction (giống nhau), không có gì thay đổi', async () => {
        wire({ zoneMap: GATE.zoneMap }); // KHÔNG dirMap
        await service.onVehicleEvent(evt({ eventAction: 'in', utc: nowIso() }));
        const p = payloadOf();
        expect(p.direction).toBe('enter');
        expect(p.gateDirection).toBe('enter');
        expect(p.gateDirection).toBe(p.direction);
      });

      it('channel KHÔNG map zone (zone_unmapped) → gateDirection vẫn = direction thô (mirror giá trị mặc định, KHÔNG lỗi)', async () => {
        wire(); // KHÔNG zoneMap → zoneId null → dirMap KHÔNG được đọc (theo logic dòng ~123-126)
        await service.onVehicleEvent(evt({ eventAction: 'out' }));
        const p = payloadOf();
        expect(p.direction).toBe('leave');
        expect(p.gateDirection).toBe('leave');
      });
    });

    // ⭐ CRUX camera ANPR IPC thật: TRAFFICJUNCTION 0x17 → bridge hard-code eventAction='seen'.
    // channel_direction_map PHẢI cứu (QĐ-3): 'seen' đơn độc sẽ skip direction_seen, nhưng
    // dirMap='enter' → gateDirection='enter' → VẪN ghi gate log. KHÔNG có test này thì lỗi
    // "không dòng gate log nào lúc cắm camera thật" quay lại âm thầm.
    it('IPC: eventAction=seen NHƯNG channel_direction_map=enter → PHẢI ghi enter, KHÔNG skip', async () => {
      wire({ zoneMap: GATE.zoneMap, dirMap: { '5': 'enter' } });
      await service.onVehicleEvent(evt({ eventAction: 'seen', utc: nowIso() }));
      expect(payloadOf().gateLogSkipped).toBeNull();
      expect(gateMock.writeGateLog).toHaveBeenCalledTimes(1);
      expect(gateMock.writeGateLog.mock.calls[0][0].direction).toBe('enter');
    });

    // Sau merge FR-008b: evaluate() chạy SAU INSERT (thứ tự khẳng định ở describe UC-108).
    // Test này chỉ giữ bất biến "có writer gate log thì evaluate vẫn được gọi đúng 1 lần".
    it('evaluate() vẫn được gọi đúng 1 lần khi có writer gate log', async () => {
      wire(GATE);
      await service.onVehicleEvent(evt({ utc: nowIso() }));
      expect(alertMock.evaluate).toHaveBeenCalledTimes(1);
    });
  });

  // ── OCR-MERGE (recon 2026-08-08): gộp nhiều lần OCR đọc biển KHÁC NHAU cho
  // CÙNG 1 lượt xe (channel+direction giống, cách nhau < 15s) thành 1 row —
  // mirror tinh thần bump AlertsService.recordAlert()/bumpOccurrence().
  describe('OCR-MERGE: gộp nhiều lần đọc OCR khác nhau cho cùng 1 lượt xe', () => {
    const selectMerge = () =>
      captured.find(
        (c) =>
          c.sql.includes('SELECT id,') &&
          c.sql.includes("payload_json->>'channelId'"),
      );
    const mergeUpdate = () =>
      captured.find(
        (c) =>
          c.sql.includes('UPDATE iot_device_events') &&
          c.sql.includes('rawReads'),
      );

    // wire() riêng: cho phép giả lập lookback SELECT "DB có/không thấy row gần nhất
    // khớp channelId+direction+cửa sổ 15s, VÀ plateNumber của row đó" — việc lọc THẬT
    // theo direction/thời gian là logic Postgres (WHERE/interval), không mock lại ở
    // đây; unit test chỉ xác nhận (a) code bind đúng tham số để DB lọc đúng, (b) code
    // nhánh đúng theo kết quả DB trả về + kết quả isSimilarPlate.
    // recentPlateNumber: plateNumber của row gần nhất giả lập — mặc định null (không
    // trả row nào nếu recentEventId null; nếu recentEventId có nhưng recentPlateNumber
    // không set, plate_number=null → isSimilarPlate luôn false, đúng hành vi "không đủ
    // căn cứ để gộp").
    const wireMerge = (
      recentEventId: string | null,
      recentPlateNumber: string | null = null,
    ) => {
      captured = [];
      dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
        captured.push({ sql, params });
        if (sql.includes('FROM iot_devices WHERE device_code'))
          return Promise.resolve([{ id: 'bridge1' }]);
        if (sql.includes('FROM vehicle_registrations'))
          return Promise.resolve([{ id: 'reg1', user_id: 'u1' }]);
        if (sql.includes('FROM system_configs')) return Promise.resolve([]);
        if (
          sql.includes('SELECT id,') &&
          sql.includes("payload_json->>'channelId'")
        ) {
          return Promise.resolve(
            recentEventId
              ? [{ id: recentEventId, plate_number: recentPlateNumber }]
              : [],
          );
        }
        if (sql.includes('INSERT INTO iot_device_events'))
          return Promise.resolve([{ id: 'evt-new' }]);
        if (sql.includes('UPDATE iot_device_events'))
          return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });
    };

    // [FIX 2026-08-19] eventTime của "sự kiện đang xử lý" — tham số MỚI của
    // mergeIntoRecentEvent(), dùng chung 1 mốc cố định cho mọi lời gọi trực tiếp trong
    // suite này (mirror evt().utc mặc định) để test window/bind không phụ thuộc đồng hồ máy chạy test.
    const MERGE_EVENT_TIME = new Date('2026-06-24T09:00:00.000Z');

    it('có row gần nhất cùng channel+direction trong cửa sổ + plate đủ giống → UPDATE (bump) + trả true', async () => {
      wireMerge('evt-old', '30A99998'); // OCR lệch 1 ký tự cuối — vẫn coi cùng xe
      const merged = await (service as any).mergeIntoRecentEvent(
        dsMock.manager,
        5,
        'enter',
        '30A99999',
        null,
        MERGE_EVENT_TIME,
      );
      expect(merged).toBe(true);
      expect(mergeUpdate()).toBeDefined();
    });

    it('SELECT trả rỗng (DB không thấy row khớp) → false, KHÔNG UPDATE', async () => {
      wireMerge(null);
      const merged = await (service as any).mergeIntoRecentEvent(
        dsMock.manager,
        5,
        'enter',
        '30A99999',
        null,
        MERGE_EVENT_TIME,
      );
      expect(merged).toBe(false);
      expect(mergeUpdate()).toBeUndefined();
    });

    // [FIX 2026-08-19] event_time giờ so với $3 (mốc Date tính TRONG JS từ eventTime của
    // sự kiện hiện tại — mirror dedupe Face Recognition), KHÔNG còn `NOW() - INTERVAL`.
    // created_at vẫn dùng NOW() - INTERVAL như cũ (không có bug, cùng miền đồng hồ server).
    it('SQL SELECT bind đúng channelId(string)/direction/mốc cửa sổ 15s tính từ eventTime + trần tổng 90s để DB tự lọc theo channel+direction+thời gian', async () => {
      wireMerge(null);
      await (service as any).mergeIntoRecentEvent(
        dsMock.manager,
        5,
        'enter',
        '30A99999',
        null,
        MERGE_EVENT_TIME,
      );
      const sel = selectMerge();
      expect(sel!.sql).toContain("event_type = 'ivss_vehicle_event'");
      expect(sel!.sql).toContain("payload_json->>'channelId' = $1");
      expect(sel!.sql).toContain("payload_json->>'direction' = $2");
      expect(sel!.sql).toContain('event_time > $3::timestamptz');
      // [FIX 2026-08-11, A1] điều kiện created_at SONG SONG (AND) event_time — KHÔNG thay thế.
      expect(sel!.sql).toContain(
        "created_at > NOW() - ($4::int * INTERVAL '1 second')",
      );
      expect(sel!.params).toEqual([
        '5',
        'enter',
        new Date(MERGE_EVENT_TIME.getTime() - 15 * 1000), // OCR_MERGE_WINDOW_SECONDS=15
        90,
      ]);
    });

    // [FIX 2026-08-11, A1] Trần TỔNG thời gian gộp — chống "cửa sổ tự làm mới vô hạn".
    describe('A1: trần tổng thời gian gộp (MAX_MERGE_DURATION_SECONDS=90, dựa trên created_at)', () => {
      it('chuỗi merge liên tục mỗi lần <15s, TỔNG thời gian <90s → vẫn gộp bình thường (regression)', async () => {
        // DB (giả lập) vẫn thấy row cũ vì CẢ 2 điều kiện event_time VÀ created_at đều
        // còn trong ngưỡng — mirror đúng convention file này: unit test xác nhận code bind
        // đúng $3/$4 để Postgres tự lọc, KHÔNG re-implement logic thời gian ở tầng JS.
        wireMerge('evt-old', '30A99998');
        const merged = await (service as any).mergeIntoRecentEvent(
          dsMock.manager,
          5,
          'enter',
          '30A99999',
          null,
          MERGE_EVENT_TIME,
        );
        expect(merged).toBe(true);
        expect(mergeUpdate()).toBeDefined();
        const sel = selectMerge();
        expect(sel!.params[3]).toBe(90); // MAX_MERGE_DURATION_SECONDS truyền đúng
      });

      it('TỔNG thời gian VƯỢT 90s (dù mỗi lần đọc vẫn <15s) → lần đọc tiếp theo KHÔNG gộp nữa, tạo dòng MỚI', async () => {
        // created_at của row cũ đã quá 90s → điều kiện created_at loại row đó khỏi kết
        // quả SELECT (hành vi Postgres thật) — mock DB trả RỖNG để mô phỏng đúng kết quả
        // đó, y hệt cách file này mô phỏng "SELECT không thấy row" ở các test khác.
        wireMerge(null);
        await service.onVehicleEvent(evt({ plateNumber: '30A11111' }));
        expect(insert()).toBeDefined(); // KHÔNG gộp — tạo row MỚI
        expect(mergeUpdate()).toBeUndefined();
        expect(payloadOf().plateNumber).toBe('30A11111');
        expect(payloadOf().rawReads).toEqual(['30A11111']);
        expect(alertMock.evaluate).toHaveBeenCalledTimes(1); // xe/row mới → evaluate() riêng
        const sel = selectMerge();
        expect(sel!.params[3]).toBe(90);
      });

      it('created_at của dòng MỚI (sau khi bị chặn gộp) do DB default quyết định — INSERT KHÔNG tự set/kế thừa created_at từ dòng cũ', async () => {
        wireMerge(null);
        await service.onVehicleEvent(evt());
        // Cột created_at KHÔNG nằm trong danh sách cột INSERT ⇒ Postgres tự áp DEFAULT
        // now() lúc INSERT THẬT — code tầng application không truyền/kế thừa giá trị nào.
        expect(insert()!.sql).toMatch(
          /INSERT INTO iot_device_events\s*\([^)]*\)/,
        );
        const columnsList = insert()!.sql.match(
          /INSERT INTO iot_device_events\s*\(([^)]*)\)/,
        )![1];
        expect(columnsList).not.toContain('created_at');
      });
    });

    it('UPDATE dùng COALESCE(snapshot_file_id, $2) — ưu tiên giữ ảnh cũ, chỉ nhận ảnh mới khi cũ NULL', async () => {
      wireMerge('evt-old', '30A99998');
      await (service as any).mergeIntoRecentEvent(
        dsMock.manager,
        5,
        'enter',
        '30A99999',
        'media-new',
        MERGE_EVENT_TIME,
      );
      const upd = mergeUpdate();
      expect(upd!.sql).toContain('COALESCE(snapshot_file_id, $2)');
      // [FIX 2026-08-19] SET event_time = $5 (eventTime của lần đọc hiện tại), KHÔNG còn NOW().
      expect(upd!.sql).toContain('event_time = $5::timestamptz');
      expect(upd!.params).toEqual([
        JSON.stringify(['30A99999']),
        'media-new',
        'evt-old',
        12, // [FIX 2026-08-11, A2] MAX_RAW_READS
        MERGE_EVENT_TIME,
      ]);
    });

    it('UPDATE append biển mới vào payload_json->rawReads qua jsonb_set + || (KHÔNG ghi đè mảng cũ)', async () => {
      wireMerge('evt-old', '30A99998');
      await (service as any).mergeIntoRecentEvent(
        dsMock.manager,
        5,
        'enter',
        '30A99999',
        null,
        MERGE_EVENT_TIME,
      );
      const upd = mergeUpdate();
      expect(upd!.sql).toContain('jsonb_set(');
      expect(upd!.sql).toContain("'{rawReads}'");
      expect(upd!.sql).toContain(
        "COALESCE(payload_json->'rawReads', '[]'::jsonb) || $1::jsonb",
      );
    });

    // [FIX 2026-08-11, A2] Cap rawReads atomic (MAX_RAW_READS=12), mirror kỹ thuật
    // AlertsService.bumpOccurrence() (occurrences) — TRONG câu UPDATE, KHÔNG SELECT-rồi-
    // UPDATE riêng. Dùng mock "stateful" tự mô phỏng đúng thuật toán append+cap mà SQL
    // thật thực hiện — mirror ĐÚNG convention đã dùng ở alerts.service.spec.ts
    // (makeStatefulQueryMock) để xác nhận hành vi tích luỹ qua nhiều lần gọi liên tiếp.
    describe('A2: cap rawReads (MAX_RAW_READS=12, atomic slice trong UPDATE)', () => {
      const makeStatefulRawReadsMock = (row: {
        id: string;
        rawReads: string[];
      }) =>
        jest.fn((sql: string, params: any[]) => {
          if (
            sql.includes('SELECT id,') &&
            sql.includes("payload_json->>'channelId'")
          ) {
            return Promise.resolve([
              {
                id: row.id,
                plate_number: row.rawReads[row.rawReads.length - 1] ?? null,
              },
            ]);
          }
          if (
            sql.includes('UPDATE iot_device_events') &&
            sql.includes('rawReads')
          ) {
            const [plateJson, , , max] = params as [
              string,
              string | null,
              string,
              number,
            ];
            const newPlates = JSON.parse(plateJson) as string[];
            row.rawReads = [...row.rawReads, ...newPlates].slice(-max);
          }
          return Promise.resolve(undefined);
        });

      it('rawReads dưới ngưỡng (5 phần tử) → append bình thường', async () => {
        const row = { id: 'evt-old', rawReads: ['a', 'b', 'c', 'd', 'e'] };
        dsMock.manager.query = makeStatefulRawReadsMock(row);
        const merged = await (service as any).mergeIntoRecentEvent(
          dsMock.manager,
          5,
          'enter',
          'e', // trùng entry cuối → isSimilarPlate('e','e')=true qua nhánh a===b
          null,
          MERGE_EVENT_TIME,
        );
        expect(merged).toBe(true);
        expect(row.rawReads).toEqual(['a', 'b', 'c', 'd', 'e', 'e']);
      });

      it('rawReads đã đạt đúng MAX_RAW_READS(12) → append thêm 1 vẫn giữ đúng 12 phần tử, CẮT BỚT phần tử CŨ NHẤT', async () => {
        const seeded = Array.from({ length: 12 }, (_, i) => `p${i}`);
        const row = { id: 'evt-old', rawReads: seeded };
        dsMock.manager.query = makeStatefulRawReadsMock(row);
        const merged = await (service as any).mergeIntoRecentEvent(
          dsMock.manager,
          5,
          'enter',
          'p11', // trùng entry cuối cùng đã seed
          null,
          MERGE_EVENT_TIME,
        );
        expect(merged).toBe(true);
        expect(row.rawReads).toHaveLength(12);
        expect(row.rawReads[0]).toBe('p1'); // p0 (cũ nhất) bị cắt, KHÔNG phải phần tử mới nhất
        expect(row.rawReads).not.toContain('p0');
      });

      it('rawReads thiếu/null trong payload_json → COALESCE fallback [] được dùng ở CẢ 2 chỗ trong khối cap mới, KHÔNG lỗi', async () => {
        wireMerge('evt-old', '30A99998');
        await (service as any).mergeIntoRecentEvent(
          dsMock.manager,
          5,
          'enter',
          '30A99999',
          null,
          MERGE_EVENT_TIME,
        );
        const upd = mergeUpdate();
        const coalesceCount = (
          upd!.sql.match(
            /COALESCE\(payload_json->'rawReads', '\[\]'::jsonb\)/g,
          ) ?? []
        ).length;
        // 1 lần trong jsonb_array_elements(...), 1 lần trong jsonb_array_length(...) —
        // cả 2 đều fallback [] nếu rawReads thiếu/null, KHÔNG có nhánh nào thiếu COALESCE.
        expect(coalesceCount).toBe(2);
      });
    });

    it('SELECT lỗi → false (NotThrow, fallback INSERT)', async () => {
      dsMock.manager.query.mockRejectedValueOnce(new Error('db down'));
      const merged = await (service as any).mergeIntoRecentEvent(
        dsMock.manager,
        5,
        'enter',
        '30A99999',
        null,
        MERGE_EVENT_TIME,
      );
      expect(merged).toBe(false);
    });

    it('DONE: 2 event cùng channel+direction cách nhau <15s (DB thấy row cũ) + plate đủ giống → gộp: KHÔNG INSERT mới, KHÔNG evaluate()/gate-log lại, rawReads chứa biển mới', async () => {
      wireMerge('evt-old', '30A11112'); // OCR lệch 1 ký tự cuối — cùng xe
      await service.onVehicleEvent(evt({ plateNumber: '30A11111' }));
      expect(insert()).toBeUndefined();
      const upd = mergeUpdate();
      expect(upd).toBeDefined();
      expect(upd!.params[0]).toBe(JSON.stringify(['30A11111']));
      expect(alertMock.evaluate).not.toHaveBeenCalled();
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
    });

    it('DONE: KHÔNG có row gần nhất (lần đầu / cách nhau >15s / khác direction — DB không thấy) → INSERT như bình thường, rawReads=[plateNumber gốc]', async () => {
      wireMerge(null);
      await service.onVehicleEvent(evt());
      expect(insert()).toBeDefined();
      expect(payloadOf().rawReads).toEqual(['30A12345']);
      expect(alertMock.evaluate).toHaveBeenCalledTimes(1);
    });

    // ── Bug thật phát hiện qua test phần cứng 2026-08-08: handleTrafficJunction (bridge,
    // camera ANPR thuần) luôn gửi eventAction="seen" cố định → direction KHÔNG BAO GIỜ
    // phân biệt được 2 xe khác nhau cùng channel trong cửa sổ gộp 15s → mọi xe khác nhau
    // bị gộp nhầm thành 1. Fix: thêm điều kiện plateNumber đủ giống (isSimilarPlate) —
    // xem plate-similarity.ts cho test đơn vị đầy đủ của thuật toán so khớp.
    describe('Fix bug thật 2026-08-08: direction="seen" cố định không còn đủ để gộp — cần plateNumber đủ giống', () => {
      it('DONE: mergeIntoRecentEvent trực tiếp — "86886" vs row cũ "51L868" (2 xe khác nhau) → false, KHÔNG UPDATE dù cùng channel+direction+cửa sổ', async () => {
        wireMerge('evt-old', '51L868');
        const merged = await (service as any).mergeIntoRecentEvent(
          dsMock.manager,
          5,
          'seen',
          '86886',
          null,
          MERGE_EVENT_TIME,
        );
        expect(merged).toBe(false);
        expect(mergeUpdate()).toBeUndefined();
      });

      it('DONE: onVehicleEvent full-flow — "51L868" rồi "86886", cùng channel, cùng direction=seen, <15s → KHÔNG gộp, INSERT row RIÊNG cho xe mới (không phải bump)', async () => {
        wireMerge('evt-old', '51L868');
        await service.onVehicleEvent(
          evt({ plateNumber: '86886', eventAction: 'seen' }),
        );
        expect(insert()).toBeDefined(); // tạo row MỚI, KHÔNG bump row cũ
        expect(mergeUpdate()).toBeUndefined();
        expect(payloadOf().plateNumber).toBe('86886');
        expect(payloadOf().direction).toBe('seen');
        expect(alertMock.evaluate).toHaveBeenCalledTimes(1); // xe mới → evaluate() cho row mới
      });

      // Regression: fix KHÔNG được làm hỏng khả năng gộp lỗi OCR nhẹ đã hoạt động trước đó
      // — case log thật đêm 2026-08-06/07: 3 lần đọc CÙNG 1 xe, đọc thiếu/thừa đầu-cuối.
      // plateNumber gốc lưu trong row KHÔNG đổi khi gộp (chỉ rawReads được nối thêm) nên
      // lần đọc thứ 3 vẫn so với lần đọc ĐẦU TIÊN "699", không phải lần đọc liền trước.
      it('DONE: giữ nguyên khả năng gộp OCR nhẹ (log thật) — "G69946" vs row cũ "699" (đọc thiếu/thừa đầu-cuối) → true, VẪN gộp như cũ', async () => {
        wireMerge('evt-old', '699');
        await service.onVehicleEvent(
          evt({ plateNumber: 'G69946', eventAction: 'seen' }),
        );
        expect(insert()).toBeUndefined(); // KHÔNG tạo row mới — vẫn gộp vào row cũ
        const upd = mergeUpdate();
        expect(upd).toBeDefined();
        expect(upd!.params[0]).toBe(JSON.stringify(['G69946']));
        expect(alertMock.evaluate).not.toHaveBeenCalled();
      });
    });

    it('SELECT merge bind đúng direction hiện tại (enter/leave) — nền tảng để DB lọc đúng, tránh gộp nhầm 2 xe ngược chiều', async () => {
      wireMerge(null);
      await service.onVehicleEvent(evt({ eventAction: 'out' }));
      expect(payloadOf().direction).toBe('leave');
      const sel = selectMerge();
      expect(sel!.params[1]).toBe('leave');
    });

    // [FIX 2026-08-19] Bug thật phát hiện qua đối chiếu dữ liệu production 2026-08-15:
    // rolling-window trước đây so `event_time` (giờ CAMERA, từ evt.utc) với `NOW()` (giờ
    // SERVER) — độ trễ camera→server thật (~13s đo được) ăn mòn gần hết cửa sổ 15s danh
    // nghĩa, khiến 2 lần đọc CÙNG 1 biển số cách nhau chỉ 3s (giờ camera) KHÔNG merge được.
    // Các test dưới đây xác nhận ngưỡng SELECT giờ tính hoàn toàn từ `eventTime` của sự
    // kiện đang xử lý (JS, giống hệt cách dedupe Face Recognition làm), không còn phụ
    // thuộc NOW()/đồng hồ máy chạy test — đúng quy ước sẵn có của file này: unit test xác
    // nhận code BIND đúng tham số để Postgres tự lọc, không re-implement logic thời gian.
    describe('[FIX 2026-08-19] rolling-window event_time tính từ eventTime hiện tại (JS), không còn NOW() (giờ server)', () => {
      // parseUtc() có ngưỡng lệch SKEW_MS=1h so với giờ thật của máy chạy test (fallback
      // sang now() nếu evt.utc lệch quá 1h) — dùng mốc TƯƠNG ĐỐI theo Date.now() (không
      // hardcode ngày cụ thể) để test luôn hợp lệ bất kể chạy vào lúc nào, không rơi vào
      // nhánh utcFallback ngoài ý muốn.
      const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);

      it('Kịch bản bug thật: 2 lần đọc CÙNG 1 biển cách nhau 3s theo giờ camera (độ trễ server ~13s không còn ảnh hưởng) → ngưỡng SELECT tính đúng từ eventTime hiện tại, merge thành công', async () => {
        // Mô phỏng đúng tỉ lệ đã quan sát trong DB thật (2026-08-15): 2 lần đọc cách nhau
        // 3s theo giờ CAMERA, dù request thứ 2 tới server trễ hơn ~13s so với request 1
        // (độ trễ đó KHÔNG còn xuất hiện ở đâu trong công thức ngưỡng nữa, vì chỉ có
        // eventTime — giờ camera — tham gia phép tính, không có NOW() nào cả).
        const eventTime1 = secondsAgo(20); // giờ camera của lần đọc 1
        const eventTime2 = secondsAgo(17); // +3s so với lần đọc 1 (giờ camera)

        wireMerge('evt-old', '30F5577'); // giả lập DB "thấy" row của lần đọc 1 (Postgres thật sẽ thấy, vì event_time1 > ngưỡng mới)
        await service.onVehicleEvent(
          evt({ plateNumber: '30F5577', utc: eventTime2.toISOString() }),
        );

        const sel = selectMerge();
        const threshold = sel!.params[2] as Date;
        // Ngưỡng PHẢI tính từ eventTime2 (sự kiện đang xử lý), KHÔNG phải NOW() lúc test chạy.
        expect(threshold.toISOString()).toBe(
          new Date(eventTime2.getTime() - 15 * 1000).toISOString(),
        );
        // Chứng minh bằng số học: event_time1 (giờ camera lần đọc 1) PHẢI lớn hơn ngưỡng mới
        // → Postgres thật (event_time > $3) sẽ TÌM THẤY row lần đọc 1 → merge được.
        expect(eventTime1.getTime()).toBeGreaterThan(threshold.getTime());

        expect(insert()).toBeUndefined(); // đã merge — KHÔNG tạo row mới
        const upd = mergeUpdate();
        expect(upd).toBeDefined();
      });

      it('Case bình thường (độ trễ ~0, môi trường test/demo thật) → vẫn merge đúng như trước, hành vi không đổi', async () => {
        const eventTime1 = secondsAgo(2);
        const eventTime2 = secondsAgo(0); // +2s, độ trễ gần 0

        wireMerge('evt-old', '30A99998');
        await service.onVehicleEvent(
          evt({ plateNumber: '30A99999', utc: eventTime2.toISOString() }),
        );

        expect(insert()).toBeUndefined();
        expect(mergeUpdate()).toBeDefined();
        const sel = selectMerge();
        const threshold = sel!.params[2] as Date;
        expect(eventTime1.getTime()).toBeGreaterThan(threshold.getTime());
      });

      it('2 lần đọc cách nhau NGOÀI cửa sổ merge (>15s theo giờ camera) → ngưỡng SELECT loại trừ đúng, Postgres thật sẽ KHÔNG thấy row (không merge quá đà)', async () => {
        const eventTime1 = secondsAgo(25);
        const eventTime2 = secondsAgo(5); // cách 20s, vượt 15s

        // Mock vẫn "thấy" row (wireMerge không tự lọc theo thời gian, giống mọi test khác
        // trong file — chỉ dùng để xác nhận GIÁ TRỊ ngưỡng đúng, việc Postgres thật loại
        // trừ row nào là trách nhiệm của WHERE event_time > $3, không phải của JS).
        wireMerge('evt-old', '30A99998');
        await service.onVehicleEvent(
          evt({ plateNumber: '30A99999', utc: eventTime2.toISOString() }),
        );

        const sel = selectMerge();
        const threshold = sel!.params[2] as Date;
        expect(threshold.toISOString()).toBe(
          new Date(eventTime2.getTime() - 15 * 1000).toISOString(),
        );
        // event_time1 giờ PHẢI nhỏ hơn ngưỡng → Postgres thật (event_time > $3) sẽ KHÔNG
        // thấy row lần đọc 1 → không merge quá đà 2 lượt xe cách xa nhau.
        expect(eventTime1.getTime()).toBeLessThan(threshold.getTime());
      });

      it('Sau merge, event_time của dòng kết quả = eventTime của lần đọc GẦN NHẤT (giờ camera) — không còn nhảy sang NOW() (giờ server)', async () => {
        const eventTimeLatest = secondsAgo(1);
        wireMerge('evt-old', '30F5577');
        await service.onVehicleEvent(
          evt({ plateNumber: '30F5577', utc: eventTimeLatest.toISOString() }),
        );
        const upd = mergeUpdate();
        expect(upd).toBeDefined();
        expect(upd!.sql).toContain('event_time = $5::timestamptz');
        expect(upd!.sql).not.toContain('event_time = NOW()');
        expect((upd!.params[4] as Date).toISOString()).toBe(
          eventTimeLatest.toISOString(),
        );
      });
    });
  });

  // ── RACE FIX (bằng chứng thật production 2026-08-08): 2 event cùng biển/channel,
  // event_time TRÙNG TUYỆT ĐỐI → trước đây cả 2 cùng INSERT (SELECT+INSERT là 2
  // statement rời rạc, không gì khoá 2 request lại). Fix: bọc merge-hoặc-insert trong
  // this.dataSource.transaction(...) + pg_advisory_xact_lock theo channelId.
  describe('RACE FIX: pg_advisory_xact_lock chống 2 request đồng thời cùng channel tạo 2 row', () => {
    it('DONE: Promise.all 2 request đồng thời, cùng channel, biển tương tự (isSimilarPlate) → CHỈ 1 row được tạo, request thứ 2 bump vào row của request thứ nhất', async () => {
      // Trạng thái bảng iot_device_events giả lập (in-memory) — mô phỏng đúng ngữ nghĩa
      // pg_advisory_xact_lock thật: request 2 chỉ bắt đầu SELECT sau khi request 1 đã
      // COMMIT (INSERT xong), nên LUÔN thấy row vừa tạo — không còn cửa sổ race.
      let insertedRow: { id: string; plate_number: string } | null = null;
      let insertCount = 0;
      let updateCount = 0;

      // Mutex thủ công mô phỏng pg_advisory_xact_lock: request 2 PHẢI đợi transaction
      // của request 1 chạy XONG HẲN (kể cả INSERT) rồi mới được bắt đầu callback của
      // nó. Đây chính là hành vi cần chứng minh — KHÔNG có mutex này (code trước khi
      // fix, gọi `this.dataSource.manager.query(...)` rời rạc KHÔNG qua transaction())
      // thì 2 lệnh gọi sẽ interleave theo microtask, cả 2 đều SELECT ra `insertedRow
      // = null` trước khi bên nào set nó → race y hệt bug thật đã xác nhận.
      let lockChain: Promise<unknown> = Promise.resolve();
      dsMock.transaction = jest.fn((cb: (m: any) => Promise<unknown>) => {
        const run = lockChain.then(() => cb(dsMock.manager));
        lockChain = run.catch(() => undefined);
        return run;
      });

      dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
        if (sql.includes('FROM iot_devices WHERE device_code'))
          return Promise.resolve([{ id: 'bridge1' }]);
        if (sql.includes('FROM vehicle_registrations'))
          return Promise.resolve([]); // unmatched — không quan trọng cho test này
        if (sql.includes('FROM system_configs')) return Promise.resolve([]);
        if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([{}]);
        if (
          sql.includes('SELECT id,') &&
          sql.includes("payload_json->>'channelId'")
        ) {
          return Promise.resolve(insertedRow ? [insertedRow] : []);
        }
        if (sql.includes('INSERT INTO iot_device_events')) {
          insertCount++;
          const payload = JSON.parse(params[2]);
          insertedRow = {
            id: `evt-${insertCount}`,
            plate_number: payload.plateNumber,
          };
          return Promise.resolve([{ id: insertedRow.id }]);
        }
        if (sql.includes('UPDATE iot_device_events')) {
          updateCount++;
          return Promise.resolve(undefined);
        }
        return Promise.resolve(undefined);
      });

      await Promise.all([
        service.onVehicleEvent(evt({ plateNumber: '30A11111' })),
        service.onVehicleEvent(evt({ plateNumber: '30A11112' })), // OCR lệch 1 ký tự cuối — isSimilarPlate=true
      ]);

      expect(insertCount).toBe(1); // CHỈ 1 row được tạo
      expect(updateCount).toBe(1); // request thứ 2 bump vào row của request thứ nhất, KHÔNG tạo row riêng
    });

    it("advisory lock bind đúng channelId qua hashtext (mirror hashtext('vehicle_channel_' || channelId))", async () => {
      captured = [];
      dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
        captured.push({ sql, params });
        if (sql.includes('FROM iot_devices WHERE device_code'))
          return Promise.resolve([{ id: 'bridge1' }]);
        if (sql.includes('FROM vehicle_registrations'))
          return Promise.resolve([]);
        if (sql.includes('FROM system_configs')) return Promise.resolve([]);
        if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([{}]);
        if (
          sql.includes('SELECT id,') &&
          sql.includes("payload_json->>'channelId'")
        )
          return Promise.resolve([]);
        if (sql.includes('INSERT INTO iot_device_events'))
          return Promise.resolve([{ id: 'evt-new' }]);
        return Promise.resolve(undefined);
      });
      await service.onVehicleEvent(evt({ channelId: 7 }));
      const lockCall = captured.find((c) =>
        c.sql.includes('pg_advisory_xact_lock'),
      );
      expect(lockCall).toBeDefined();
      expect(lockCall!.sql).toContain(
        "hashtext('vehicle_channel_' || $1::text)",
      );
      expect(lockCall!.params).toEqual(['7']);
    });

    it('transaction() được gọi (không còn query() rời rạc cho merge-hoặc-insert)', async () => {
      wire();
      await service.onVehicleEvent(evt());
      expect(dsMock.transaction).toHaveBeenCalledTimes(1);
    });
  });
});
