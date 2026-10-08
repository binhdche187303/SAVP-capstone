/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { StrangerAlertService } from './stranger-alert.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';

const evt = (over: any = {}) => ({
  deviceId: 'dev1',
  deviceCode: 'FACE-1',
  roomId: 'room1',
  strangerId: 's1',
  similarity: '88',
  capturedAt: new Date('2026-06-19T09:00:00.000Z'),
  ...over,
});

describe('StrangerAlertService (SAL-001)', () => {
  let service: StrangerAlertService;
  let dsMock: any;
  let wsMock: any;
  let alertRulesMock: any;
  let alertsMock: any;
  let cfg: Record<string, unknown>;

  const build = async () => {
    dsMock = {
      manager: {
        query: jest.fn((sql: string) => {
          if (sql.includes('FROM rooms'))
            return Promise.resolve([{ room_name: 'Phòng A' }]);
          return Promise.resolve([]);
        }),
      },
    };
    wsMock = { emitToRoom: jest.fn() };
    alertRulesMock = {
      findEffectiveRule: jest
        .fn()
        .mockResolvedValue({ rule: null, suppressed: false }),
    };
    alertsMock = { recordAlert: jest.fn().mockResolvedValue({ isNew: true }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrangerAlertService,
        { provide: DataSource, useValue: dsMock },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
        { provide: WebsocketService, useValue: wsMock },
        { provide: AlertRulesService, useValue: alertRulesMock },
        { provide: AlertsService, useValue: alertsMock },
      ],
    }).compile();
    service = module.get(StrangerAlertService);
  };

  beforeEach(async () => {
    cfg = {};
    await build();
  });

  // ── onStranger ──
  it('lần đầu: recordAlert + WS room, payload metadata-only kèm deviceCode/roomName', async () => {
    await service.onStranger(evt());
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'room:room1',
      'face.stranger.alert',
      expect.objectContaining({ deviceId: 'dev1', roomId: 'room1' }),
    );
    expect(alertsMock.recordAlert).toHaveBeenCalledTimes(1);
    const input = alertsMock.recordAlert.mock.calls[0][0];
    expect(input.alertType).toBe('stranger');
    expect(input.zoneId).toBeNull();
    expect(input.payloadJson).toMatchObject({
      deviceId: 'dev1',
      roomId: 'room1',
      deviceCode: 'FACE-1',
      roomName: 'Phòng A',
    });
    expect(JSON.stringify(input.payloadJson)).not.toContain('SanpPic');
    expect(JSON.stringify(input.payloadJson)).not.toContain('base64');
  });

  it('lỗi 1.1/1.2/1.3: KHÔNG tự gửi notification/email — giao cho notifier (inject không có NotificationsService)', async () => {
    cfg = { STRANGER_ALERT_EMAIL_ENABLED: true };
    await build(); // compile được dù KHÔNG provide NotificationsService
    await service.onStranger(evt());
    const sqls = (dsMock.manager.query.mock.calls as Array<[string]>).map(
      (c) => c[0],
    );
    expect(sqls.some((s) => s.includes('FROM users'))).toBe(false);
  });

  it('throttle HIT (cùng device trong window): lần 2 KHÔNG recordAlert/WS', async () => {
    await service.onStranger(evt());
    await service.onStranger(evt());
    expect(wsMock.emitToRoom).toHaveBeenCalledTimes(1);
    expect(alertsMock.recordAlert).toHaveBeenCalledTimes(1);
  });

  it('device khác → KHÔNG throttle (mỗi device riêng)', async () => {
    await service.onStranger(evt({ deviceId: 'dev1' }));
    await service.onStranger(evt({ deviceId: 'dev2' }));
    expect(alertsMock.recordAlert).toHaveBeenCalledTimes(2);
  });

  it('room null → KHÔNG emitToRoom, KHÔNG query rooms, vẫn recordAlert (roomName=null)', async () => {
    await service.onStranger(evt({ roomId: null }));
    expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    const sqls = dsMock.manager.query.mock.calls.map((c: any[]) => c[0]);
    expect(sqls.some((q: string) => q.includes('FROM rooms'))).toBe(false);
    expect(
      alertsMock.recordAlert.mock.calls[0][0].payloadJson.roomName,
    ).toBeNull();
  });

  it('suppressed=true → KHÔNG WS, KHÔNG recordAlert (AF1)', async () => {
    alertRulesMock.findEffectiveRule.mockResolvedValue({
      rule: null,
      suppressed: true,
    });
    await service.onStranger(evt());
    expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    expect(alertsMock.recordAlert).not.toHaveBeenCalled();
  });

  it('recordAlert lỗi → NotThrow, WS VẪN chạy', async () => {
    alertsMock.recordAlert.mockRejectedValue(new Error('db down'));
    await expect(service.onStranger(evt())).resolves.toBeUndefined();
    expect(wsMock.emitToRoom).toHaveBeenCalledTimes(1);
  });

  it('ruleId truyền từ findEffectiveRule khi có rule', async () => {
    alertRulesMock.findEffectiveRule.mockResolvedValue({
      rule: { id: 'rule-9' },
      suppressed: false,
    });
    await service.onStranger(evt());
    expect(alertsMock.recordAlert.mock.calls[0][0].ruleId).toBe('rule-9');
  });

  it('thiết bị có khu vực → zoneId = iot_devices.zone_id cho cả rule lẫn recordAlert', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM iot_devices'))
        return Promise.resolve([{ zone_id: 'zone-A' }]);
      if (sql.includes('FROM rooms'))
        return Promise.resolve([{ room_name: 'Phòng A' }]);
      return Promise.resolve([]);
    });
    await service.onStranger(evt());
    expect(alertRulesMock.findEffectiveRule).toHaveBeenCalledWith(
      'stranger',
      'zone-A',
    );
    expect(alertsMock.recordAlert.mock.calls[0][0].zoneId).toBe('zone-A');
  });

  it('tra khu vực lỗi → fallback zoneId null, vẫn recordAlert', async () => {
    dsMock.manager.query.mockImplementation((sql: string) =>
      sql.includes('FROM iot_devices')
        ? Promise.reject(new Error('db boom'))
        : Promise.resolve([]),
    );
    await service.onStranger(evt());
    expect(alertsMock.recordAlert.mock.calls[0][0].zoneId).toBeNull();
  });

  // ── list ──
  it('list: query face_stranger + window; KHÔNG select payload base64; map field', async () => {
    let captured = '';
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('face_stranger') && sql.includes('LIMIT')) {
        captured = sql;
        return Promise.resolve([
          {
            device_id: 'dev1',
            device_code: 'CAM-1',
            stranger_id: 's1',
            first_seen: '2026-06-19T08:00:00Z',
            last_seen: '2026-06-19T09:00:00Z',
            hit_count: 4,
            room_id: 'room1',
            room_name: 'Phòng 1',
            zone_name: 'Khu A',
            similarity: '88',
            latest_event_id: 'ev2',
            snapshot_event_id: 'ev1',
            snapshot_file_id: 'mf1',
          },
        ]);
      }
      if (sql.includes('COUNT(*)::int AS total')) {
        return Promise.resolve([{ total: 1 }]);
      }
      return Promise.resolve([]);
    });
    const r = await service.list({ page: 1, limit: 20 });
    expect(r.data).toEqual([
      {
        deviceId: 'dev1',
        deviceCode: 'CAM-1',
        strangerId: 's1',
        roomId: 'room1',
        roomName: 'Phòng 1',
        zoneName: 'Khu A',
        similarity: '88',
        firstSeen: '2026-06-19T08:00:00Z',
        lastSeen: '2026-06-19T09:00:00Z',
        hitCount: 4,
        latestEventId: 'ev2',
        snapshotEventId: 'ev1',
        snapshotFileId: 'mf1',
      },
    ]);
    expect(r.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(captured).toContain("event_type = 'face_stranger'");
    expect(captured).toContain('created_at >= now() - ($1');
    // SEC-02: KHÔNG select raw payload / SanpPic
    expect(captured).not.toContain('raw_payload_sample');
    expect(captured).not.toContain('SanpPic');
  });

  it('list: phân trang → LIMIT/OFFSET param đúng', async () => {
    let p: any[] = [];
    dsMock.manager.query.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes('face_stranger') && sql.includes('LIMIT')) {
        p = params ?? [];
      }
      return Promise.resolve([]);
    });
    await service.list({ page: 3, limit: 10 });
    expect(p).toEqual([1440, 10, 20]);
  });

  it('list: from/to/deviceId → lọc khoảng ngày giờ VN thay cho window', async () => {
    let captured = '';
    let p: any[] = [];
    dsMock.manager.query.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes('face_stranger') && sql.includes('LIMIT')) {
        captured = sql;
        p = params ?? [];
      }
      return Promise.resolve([]);
    });
    await service.list({
      page: 1,
      limit: 20,
      from: '2026-10-01',
      to: '2026-10-07',
      deviceId: 'dev1',
    });
    expect(p).toEqual(['2026-10-01', '2026-10-07', 'dev1', 20, 0]);
    expect(captured).toContain("AT TIME ZONE 'Asia/Ho_Chi_Minh'");
    expect(captured).toContain('e.device_id = $3');
    expect(captured).not.toContain('now() -');
  });

  it('listSightings: lọc device + strangerId (null-safe), không lộ payload', async () => {
    let captured = '';
    let p: any[] = [];
    dsMock.manager.query.mockImplementation((sql: string, params?: any[]) => {
      captured = sql;
      p = params ?? [];
      return Promise.resolve([
        { id: 'ev1', created_at: 't', similarity: '70', has_snapshot: true },
      ]);
    });
    const r = await service.listSightings('dev1', null);
    expect(p).toEqual(['dev1', null]);
    expect(captured).toContain('IS NOT DISTINCT FROM $2');
    expect(captured).not.toContain('raw_payload_sample');
    expect(r).toEqual([
      { eventId: 'ev1', time: 't', similarity: '70', hasSnapshot: true },
    ]);
  });
});
