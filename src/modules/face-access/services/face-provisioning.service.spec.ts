/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { createHash } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { FaceProvisioningService } from './face-provisioning.service.js';
import { FaceDeviceProviderFactory } from '../face-device-provider.factory.js';
import { FaceProfileService } from '../../accounts/services/face-profile.service.js';

// device uname = hash 32-hex deterministic của `${userId}:${meetingId}` (B đẩy lên cam).
const deviceUname = (userId: string, meetingId: string) =>
  createHash('sha256')
    .update(`${userId}:${meetingId}`)
    .digest('hex')
    .slice(0, 32);
const UNAME = deviceUname('u1', 'm1');

const meeting = (over: any = {}) => ({
  id: 'm1',
  room_id: 'r1',
  start_time: '2026-06-17T09:00:00Z',
  end_time: '2026-06-17T10:00:00Z',
  ...over,
});
const device = { id: 'dev1', ip_address: '192.168.1.222', metadata_json: {} };

const calls = (mock: jest.Mock, needle: string) =>
  mock.mock.calls.filter((c: any[]) => String(c[0]).includes(needle));

describe('FaceProvisioningService (FMP-001)', () => {
  let service: FaceProvisioningService;
  let dsMock: any;
  let factoryMock: any;
  let profileMock: any;
  let provider: any;

  beforeEach(async () => {
    provider = {
      uploadFace: jest
        .fn()
        .mockResolvedValue({ dwfiletype: 0, dwfileindex: 1, dwfilepos: 5 }),
      addPerson: jest.fn().mockResolvedValue({ ok: true }),
      findUidByName: jest.fn().mockResolvedValue('70'),
      deletePerson: jest.fn().mockResolvedValue({ ok: true }),
    };
    factoryMock = { create: jest.fn().mockReturnValue(provider) };
    profileMock = {
      getPortraitBytes: jest.fn().mockResolvedValue(Buffer.from('JPEG')),
    };
    dsMock = { manager: { query: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FaceProvisioningService,
        { provide: DataSource, useValue: dsMock },
        { provide: FaceDeviceProviderFactory, useValue: factoryMock },
        { provide: FaceProfileService, useValue: profileMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
      ],
    }).compile();
    service = module.get(FaceProvisioningService);
  });

  afterEach(() => jest.clearAllMocks());

  // default router: device found, 1 participant, slot trống, upsert chưa có row
  const defaultRouter =
    (
      over: { participants?: any[]; slot?: any[]; upsertExisting?: any[] } = {},
    ) =>
    (sql: string) => {
      if (sql.includes('FROM iot_devices') && sql.includes('face_server'))
        return Promise.resolve([device]);
      if (sql.includes('FROM iot_devices WHERE id'))
        return Promise.resolve([device]);
      if (sql.includes('FROM meeting_participants'))
        return Promise.resolve(over.participants ?? [{ user_id: 'u1' }]);
      // MCS #2 slot-check (device,user, deleted_at IS NULL) — có alias booking_id.
      if (sql.includes('AS booking_id'))
        return Promise.resolve(over.slot ?? []);
      // upsertMapping existing-check (user,device,bookingId).
      if (sql.includes('SELECT id FROM device_user_mappings'))
        return Promise.resolve(over.upsertExisting ?? []);
      return Promise.resolve(undefined);
    };

  // ── PROVISION ──
  it('happy: upload→add→find→upsert mapping synced (uname = hash 32-hex)', async () => {
    dsMock.manager.query.mockImplementation(defaultRouter());
    await service.provisionMeeting(meeting());
    expect(provider.uploadFace).toHaveBeenCalledTimes(1);
    expect(provider.addPerson).toHaveBeenCalledWith(
      expect.objectContaining({ uname: UNAME }),
    );
    expect(provider.findUidByName).toHaveBeenCalledWith(UNAME);
    const ins = calls(dsMock.manager.query, 'INSERT INTO device_user_mappings');
    expect(ins.length).toBe(1);
    // device_person_code/name = UNAME (hash), kèm uid thật + synced.
    expect(ins[0][1]).toEqual(expect.arrayContaining(['synced', '70', UNAME]));
  });

  it('device uname: hash 32-hex (≤47, vừa giới hạn cam) + deterministic', () => {
    expect(UNAME).toMatch(/^[0-9a-f]{32}$/);
    expect(UNAME.length).toBeLessThanOrEqual(47);
    // deterministic: tính lại từ cùng (userId, meetingId) → trùng (re-provision idempotent).
    expect(deviceUname('u1', 'm1')).toBe(UNAME);
    expect(deviceUname('u1', 'm2')).not.toBe(UNAME);
  });

  it('MCS #2 idempotency-merged: slot synced cùng booking → noop (KHÔNG upload/add)', async () => {
    dsMock.manager.query.mockImplementation(
      defaultRouter({
        slot: [{ id: 'x', sync_status: 'synced', booking_id: 'm1' }],
      }),
    );
    await service.provisionMeeting(meeting());
    expect(provider.uploadFace).not.toHaveBeenCalled();
    expect(provider.addPerson).not.toHaveBeenCalled();
    // KHÔNG còn query 'SELECT sync_status FROM device_user_mappings' (đã gỡ check cũ).
    expect(
      calls(
        dsMock.manager.query,
        'SELECT sync_status FROM device_user_mappings',
      ).length,
    ).toBe(0);
  });

  it('MCS #2 busy: slot bận bởi meeting KHÁC → SKIP (factory KHÔNG gọi, 0 INSERT/UPDATE)', async () => {
    dsMock.manager.query.mockImplementation(
      defaultRouter({
        slot: [{ id: 'x', sync_status: 'synced', booking_id: 'm2' }],
      }),
    );
    const r = await service.provisionMeeting(meeting({ id: 'm1' }));
    expect(r).toEqual({ skipped: 1 });
    expect(factoryMock.create).not.toHaveBeenCalled();
    expect(provider.uploadFace).not.toHaveBeenCalled();
    const writes = calls(dsMock.manager.query, 'device_user_mappings').filter(
      (c: any[]) =>
        String(c[0]).includes('INSERT') || String(c[0]).includes('UPDATE'),
    );
    expect(writes.length).toBe(0);
  });

  it('MCS #2 revive: slot cùng booking chưa synced → upload + UPDATE (deleted_at=NULL)', async () => {
    dsMock.manager.query.mockImplementation(
      defaultRouter({
        slot: [{ id: 'x', sync_status: 'failed', booking_id: 'm1' }],
        upsertExisting: [{ id: 'x' }],
      }),
    );
    await service.provisionMeeting(meeting({ id: 'm1' }));
    expect(provider.uploadFace).toHaveBeenCalledTimes(1);
    const upd = calls(dsMock.manager.query, 'UPDATE device_user_mappings');
    expect(upd.length).toBe(1);
    expect(String(upd[0][0])).toContain('deleted_at = NULL');
    expect(
      calls(dsMock.manager.query, 'INSERT INTO device_user_mappings').length,
    ).toBe(0);
  });

  it('isolation: 1 participant lỗi → failed, người khác vẫn synced', async () => {
    dsMock.manager.query.mockImplementation(
      defaultRouter({ participants: [{ user_id: 'u1' }, { user_id: 'u2' }] }),
    );
    provider.addPerson
      .mockRejectedValueOnce(new Error('device boom'))
      .mockResolvedValueOnce({ ok: true });
    await service.provisionMeeting(meeting());
    expect(provider.uploadFace).toHaveBeenCalledTimes(2);
    const writes = calls(dsMock.manager.query, 'device_user_mappings').filter(
      (c: any[]) =>
        String(c[0]).includes('INSERT') || String(c[0]).includes('UPDATE'),
    );
    const statuses = writes.map((c: any[]) =>
      (c[1] as any[]).find((p) => p === 'failed' || p === 'synced'),
    );
    expect(statuses).toContain('failed');
    expect(statuses).toContain('synced');
  });

  it('portrait null → skip enroll (F4: vẫn ghi mapping pending/no_portrait để có vết)', async () => {
    dsMock.manager.query.mockImplementation(defaultRouter());
    profileMock.getPortraitBytes.mockResolvedValue(null);
    await service.provisionMeeting(meeting());
    expect(provider.uploadFace).not.toHaveBeenCalled();
    const ins = calls(dsMock.manager.query, 'INSERT INTO device_user_mappings');
    expect(ins.length).toBe(1);
    expect(ins[0][1]).toEqual(
      expect.arrayContaining(['pending', 'no_portrait']),
    );
  });

  it('no device trong room → bỏ qua', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM iot_devices')) return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    await service.provisionMeeting(meeting());
    expect(provider.uploadFace).not.toHaveBeenCalled();
    expect(
      calls(dsMock.manager.query, 'FROM meeting_participants').length,
    ).toBe(0);
  });

  it('provisionUpcomingMeetings: quét meetings + cô lập lỗi + cộng dồn skipped', async () => {
    const meetings = [meeting({ id: 'm1' }), meeting({ id: 'm2' })];
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM meetings')) return Promise.resolve(meetings);
      return defaultRouter()(sql);
    });
    // m1 ném lỗi (KHÔNG chặn m2); m2 trả {skipped:1} → counter cộng dồn.
    const spy = jest
      .spyOn(service, 'provisionMeeting')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ skipped: 1 });
    const r = await service.provisionUpcomingMeetings();
    expect(r.scanned).toBe(2);
    expect(r.skipped).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // ── DEPROVISION (mapping-driven) ──
  it('deprovisionEndedMeetings: họp kết thúc ≥ grace + synced → gỡ (deletePerson + deleted)', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('JOIN meetings me'))
        return Promise.resolve([
          { id: 'map1', device_id: 'dev1', device_person_id: '64' },
        ]);
      if (sql.includes('FROM iot_devices WHERE id'))
        return Promise.resolve([device]);
      return Promise.resolve(undefined);
    });
    const r = await service.deprovisionEndedMeetings();
    expect(r.scanned).toBe(1);
    expect(provider.deletePerson).toHaveBeenCalledWith('64');
    const upd = calls(dsMock.manager.query, 'UPDATE device_user_mappings');
    expect(String(upd[0][0])).toContain("sync_status = 'deleted'");
    // MCS #1: soft-delete thật → set deleted_at.
    expect(String(upd[0][0])).toContain('deleted_at = now()');
  });

  it('deprovisionEndedMeetings: còn trong grace (DB lọc rỗng) → CHƯA gỡ', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('JOIN meetings me')) return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const r = await service.deprovisionEndedMeetings();
    expect(r.scanned).toBe(0);
    expect(provider.deletePerson).not.toHaveBeenCalled();
  });

  it('deprovisionEndedMeetings: họp kết thúc rất lâu + vẫn synced → vẫn gỡ (hết miss-window)', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('JOIN meetings me'))
        return Promise.resolve([
          { id: 'old1', device_id: 'dev1', device_person_id: '99' },
        ]);
      if (sql.includes('FROM iot_devices WHERE id'))
        return Promise.resolve([device]);
      return Promise.resolve(undefined);
    });
    const r = await service.deprovisionEndedMeetings();
    expect(r.scanned).toBe(1);
    expect(provider.deletePerson).toHaveBeenCalledWith('99');
  });

  it('deprovisionEndedMeetings: query lấy MỌI sync_status (chỉ deleted_at IS NULL) + grace (MCS #1)', async () => {
    let captured = '';
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('JOIN meetings me')) {
        captured = sql;
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });
    await service.deprovisionEndedMeetings();
    // MCS #1 cleanup: KHÔNG còn lọc sync_status='synced' (cleanup cả failed/pending).
    expect(captured).not.toContain("mp.sync_status = 'synced'");
    expect(captured).toContain('mp.deleted_at IS NULL');
    expect(captured).toContain(
      "end_time <= now() - ($1 * interval '1 minute')",
    );
    // IPS-001 C1: cleanup FMP KHÔNG đụng mapping IVSS.
    expect(captured).toContain("metadata_json->>'source', '') <> 'ivss'");
  });

  it('IPS-001 C1: reconcile (stale + dedup) loại trừ mapping IVSS', async () => {
    const captured: string[] = [];
    dsMock.manager.query.mockImplementation((sql: string) => {
      captured.push(sql);
      return Promise.resolve([]);
    });
    await service.reconcile();
    const stale = captured.find(
      (s) =>
        s.includes('JOIN meetings me') && s.includes("sync_status = 'synced'"),
    );
    const dedup = captured.find((s) =>
      s.includes('SELECT device_id, device_person_id, device_person_code'),
    );
    expect(String(stale)).toContain("metadata_json->>'source', '') <> 'ivss'");
    // F3 (PORTRAIT-001): nhánh dedup KHÔNG join meetings/bookingId nên phải loại trừ
    // MỌI source ngoài FMP — thêm 'portrait' (kho mặt thường trực) cạnh 'ivss'; VIS-BE-001 thêm 'visitor'.
    expect(String(dedup)).toContain(
      "metadata_json->>'source', '') NOT IN ('ivss', 'portrait', 'visitor')",
    );
  });

  it('MCS #1 cleanup: row failed (uid NULL) họp đã kết thúc → freed (deleted_at set, KHÔNG deletePerson)', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('JOIN meetings me'))
        return Promise.resolve([
          { id: 'fail1', device_id: 'dev1', device_person_id: null },
        ]);
      return Promise.resolve(undefined);
    });
    const r = await service.deprovisionEndedMeetings();
    expect(r.scanned).toBe(1);
    expect(provider.deletePerson).not.toHaveBeenCalled(); // uid null → bỏ qua
    const upd = calls(dsMock.manager.query, 'UPDATE device_user_mappings');
    expect(String(upd[0][0])).toContain('deleted_at = now()'); // vẫn freed slot
  });

  it('deprovision: deletePerson(uid) → mapping removed', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes("metadata_json->>'bookingId' = $1 AND sync_status"))
        return Promise.resolve([
          { id: 'map1', device_id: 'dev1', device_person_id: '64' },
        ]);
      if (sql.includes('FROM iot_devices WHERE id'))
        return Promise.resolve([device]);
      return Promise.resolve(undefined);
    });
    await service.deprovisionMeeting(meeting());
    expect(provider.deletePerson).toHaveBeenCalledWith('64');
    const upd = calls(dsMock.manager.query, 'UPDATE device_user_mappings');
    expect(String(upd[0][0])).toContain("sync_status = 'deleted'");
  });

  // ── deprovisionParticipant (Bug 2 — gỡ đúng 1 người, KHÔNG đụng deprovisionMeeting) ──
  describe('deprovisionParticipant (gỡ khuôn mặt của đúng 1 participant)', () => {
    it('mapping synced của người bị gỡ → deletePerson thật + mapping chuyển deleted', async () => {
      let capturedParams: any[] = [];
      dsMock.manager.query.mockImplementation((sql: string, params?: any[]) => {
        if (sql.includes('AND user_id = $2 AND sync_status')) {
          capturedParams = params ?? [];
          return Promise.resolve([
            { id: 'map-u1', device_id: 'dev1', device_person_id: '64' },
          ]);
        }
        if (sql.includes('FROM iot_devices WHERE id'))
          return Promise.resolve([device]);
        return Promise.resolve(undefined);
      });
      await service.deprovisionParticipant('m1', 'u1');
      expect(capturedParams).toEqual(['m1', 'u1']);
      expect(provider.deletePerson).toHaveBeenCalledWith('64');
      const upd = calls(dsMock.manager.query, 'UPDATE device_user_mappings');
      expect(String(upd[0][0])).toContain("sync_status = 'deleted'");
      expect(upd[0][1]).toContain('map-u1');
    });

    it('họp có 2+ người: chỉ gỡ ĐÚNG người bị remove, KHÔNG đụng mapping người khác', async () => {
      // Query đã tự lọc user_id = $2 ở tầng SQL — mock chỉ trả về mapping của u1,
      // xác nhận deprovisionParticipant('m1','u1') không hề query/đụng gì tới u2.
      dsMock.manager.query.mockImplementation((sql: string, params?: any[]) => {
        if (sql.includes('AND user_id = $2 AND sync_status')) {
          expect(params).toEqual(['m1', 'u1']);
          return Promise.resolve([
            { id: 'map-u1', device_id: 'dev1', device_person_id: '64' },
          ]);
        }
        if (sql.includes('FROM iot_devices WHERE id'))
          return Promise.resolve([device]);
        return Promise.resolve(undefined);
      });
      await service.deprovisionParticipant('m1', 'u1');
      expect(provider.deletePerson).toHaveBeenCalledTimes(1);
      expect(provider.deletePerson).toHaveBeenCalledWith('64');
    });

    it('user không có mapping nào (chưa từng provision) → no-op an toàn, KHÔNG throw', async () => {
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('AND user_id = $2 AND sync_status'))
          return Promise.resolve([]);
        return Promise.resolve(undefined);
      });
      await expect(
        service.deprovisionParticipant('m1', 'u-never-provisioned'),
      ).resolves.toBeUndefined();
      expect(provider.deletePerson).not.toHaveBeenCalled();
    });

    it('lỗi mạng/thiết bị khi xoá → KHÔNG throw ra ngoài (best-effort, log lỗi)', async () => {
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('AND user_id = $2 AND sync_status'))
          return Promise.resolve([
            { id: 'map-u1', device_id: 'dev1', device_person_id: '64' },
          ]);
        if (sql.includes('FROM iot_devices WHERE id'))
          return Promise.resolve([device]);
        return Promise.resolve(undefined);
      });
      provider.deletePerson.mockRejectedValueOnce(
        new Error('network unreachable'),
      );
      const errSpy = jest.spyOn((service as any).logger, 'error');
      await expect(
        service.deprovisionParticipant('m1', 'u1'),
      ).resolves.toBeUndefined();
      expect(
        errSpy.mock.calls.some((c) =>
          String(c[0]).includes('deprovision participant mapping map-u1'),
        ),
      ).toBe(true);
    });

    it('regression: deprovisionMeeting() (cả họp) không đổi hành vi — vẫn KHÔNG lọc theo user_id', async () => {
      let capturedSql = '';
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes("metadata_json->>'bookingId' = $1 AND sync_status")) {
          capturedSql = sql;
          return Promise.resolve([
            { id: 'map1', device_id: 'dev1', device_person_id: '64' },
          ]);
        }
        if (sql.includes('FROM iot_devices WHERE id'))
          return Promise.resolve([device]);
        return Promise.resolve(undefined);
      });
      await service.deprovisionMeeting(meeting());
      expect(capturedSql).not.toContain('user_id');
      expect(provider.deletePerson).toHaveBeenCalledWith('64');
    });
  });

  // ── [FIX 2026-08-16] SAFETY NET (deprovisionByMeetingStatus) ──
  describe('deprovisionByMeetingStatus (safety net, độc lập end_time)', () => {
    it('QUAN TRỌNG NHẤT: meeting status=cancelled + mapping synced → bắt và xoá NGAY (trước đây KHÔNG có lưới nào bắt được)', async () => {
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes("me.status IN ('completed', 'cancelled')"))
          return Promise.resolve([
            { id: 'map-cancel', device_id: 'dev1', device_person_id: '77' },
          ]);
        if (sql.includes('FROM iot_devices WHERE id'))
          return Promise.resolve([device]);
        return Promise.resolve(undefined);
      });
      const r = await service.deprovisionByMeetingStatus();
      expect(r.scanned).toBe(1);
      expect(provider.deletePerson).toHaveBeenCalledWith('77');
      const upd = calls(dsMock.manager.query, 'UPDATE device_user_mappings');
      expect(String(upd[0][0])).toContain("sync_status = 'deleted'");
    });

    it('meeting status=completed SỚM (bấm Kết thúc trước giờ end_time theo lịch) → bắt và xoá NGAY, không cần đợi end_time trôi qua', async () => {
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes("me.status IN ('completed', 'cancelled')"))
          return Promise.resolve([
            {
              id: 'map-completed-early',
              device_id: 'dev1',
              device_person_id: '88',
            },
          ]);
        if (sql.includes('FROM iot_devices WHERE id'))
          return Promise.resolve([device]);
        return Promise.resolve(undefined);
      });
      const r = await service.deprovisionByMeetingStatus();
      expect(r.scanned).toBe(1);
      expect(provider.deletePerson).toHaveBeenCalledWith('88');
    });

    it('meeting status=in_progress (họp đang diễn ra thật) → WHERE loại trừ, KHÔNG đụng tới', async () => {
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes("me.status IN ('completed', 'cancelled')"))
          return Promise.resolve([]); // in_progress không khớp WHERE → DB trả rỗng
        return Promise.resolve(undefined);
      });
      const r = await service.deprovisionByMeetingStatus();
      expect(r.scanned).toBe(0);
      expect(provider.deletePerson).not.toHaveBeenCalled();
    });

    it('mapping không JOIN được meeting nào (dữ liệu rác/test cũ) → INNER JOIN tự loại, bỏ qua an toàn', async () => {
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes("me.status IN ('completed', 'cancelled')"))
          return Promise.resolve([]); // không JOIN được → không có dòng nào trả về
        return Promise.resolve(undefined);
      });
      await expect(service.deprovisionByMeetingStatus()).resolves.toEqual({
        scanned: 0,
      });
      expect(provider.deletePerson).not.toHaveBeenCalled();
    });

    it('lỗi mạng/thiết bị khi xoá 1 dòng → KHÔNG crash cron, dòng khác trong cùng lượt vẫn xử lý, log lỗi rõ ràng', async () => {
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes("me.status IN ('completed', 'cancelled')"))
          return Promise.resolve([
            { id: 'map-fail', device_id: 'dev1', device_person_id: '11' },
            { id: 'map-ok', device_id: 'dev1', device_person_id: '22' },
          ]);
        if (sql.includes('FROM iot_devices WHERE id'))
          return Promise.resolve([device]);
        return Promise.resolve(undefined);
      });
      provider.deletePerson
        .mockRejectedValueOnce(new Error('network unreachable'))
        .mockResolvedValueOnce({ ok: true });
      const errSpy = jest.spyOn((service as any).logger, 'error');

      const r = await service.deprovisionByMeetingStatus();

      expect(r.scanned).toBe(1); // chỉ dòng thứ 2 thành công
      expect(provider.deletePerson).toHaveBeenCalledTimes(2);
      expect(
        errSpy.mock.calls.some((c) =>
          String(c[0]).includes(
            'safety-net deprovision mapping map-fail failed',
          ),
        ),
      ).toBe(true);
    });

    it('query KHÔNG có bất kỳ điều kiện thời gian nào (KHÔNG grace, KHÔNG now()/interval) — bắt ngay lượt cron kế tiếp, không đợi thêm', async () => {
      let captured = '';
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes("me.status IN ('completed', 'cancelled')")) {
          captured = sql;
          return Promise.resolve([]);
        }
        return Promise.resolve(undefined);
      });
      await service.deprovisionByMeetingStatus();
      expect(captured).not.toContain('now()');
      expect(captured).not.toContain('interval');
      expect(captured).toContain("mp.sync_status = 'synced'");
      expect(captured).toContain("metadata_json->>'source', '') <> 'ivss'");
      expect(captured).toContain('mp.deleted_at IS NULL');
    });

    it('Tích hợp thật: removeMapping() KHÔNG mock — factory.create()+provider.deletePerson() được gọi đúng device_person_id của mapping tìm được', async () => {
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes("me.status IN ('completed', 'cancelled')"))
          return Promise.resolve([
            { id: 'map-real', device_id: 'dev1', device_person_id: '999' },
          ]);
        if (sql.includes('FROM iot_devices WHERE id'))
          return Promise.resolve([device]);
        return Promise.resolve(undefined);
      });
      await service.deprovisionByMeetingStatus();
      expect(factoryMock.create).toHaveBeenCalledWith({
        ipAddress: device.ip_address,
        metadataJson: device.metadata_json,
      });
      expect(provider.deletePerson).toHaveBeenCalledWith('999');
    });
  });

  // ── RECONCILE ──
  it('reconcile stale: synced + meeting ended ≥ grace → deprovision (query có grace)', async () => {
    let staleSql = '';
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('JOIN meetings me')) {
        staleSql = sql;
        return Promise.resolve([
          { id: 'map1', device_id: 'dev1', device_person_id: '64' },
        ]);
      }
      if (sql.includes('FROM iot_devices WHERE id'))
        return Promise.resolve([device]);
      if (
        sql.includes('SELECT device_id, device_person_id, device_person_code')
      )
        return Promise.resolve([]); // no dedup
      return Promise.resolve(undefined);
    });
    const r = await service.reconcile();
    expect(r.stale).toBe(1);
    expect(provider.deletePerson).toHaveBeenCalledWith('64');
    // grace: không gỡ sớm trong cửa sổ grace.
    expect(staleSql).toContain(
      "end_time <= now() - ($1 * interval '1 minute')",
    );
  });

  it('upsertMapping UPDATE: mapping đã tồn tại (user,device,bookingId) → UPDATE thay vì INSERT', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM iot_devices') && sql.includes('face_server'))
        return Promise.resolve([device]);
      if (sql.includes('FROM meeting_participants'))
        return Promise.resolve([{ user_id: 'u1' }]);
      if (sql.includes('SELECT sync_status FROM device_user_mappings'))
        return Promise.resolve([]); // chưa synced → tiếp tục enroll
      if (sql.includes('SELECT id FROM device_user_mappings'))
        return Promise.resolve([{ id: 'existing-map' }]); // upsert → UPDATE
      return Promise.resolve(undefined);
    });
    await service.provisionMeeting(meeting());
    const upd = calls(dsMock.manager.query, 'UPDATE device_user_mappings');
    expect(upd.length).toBe(1);
    expect(upd[0][1]).toEqual(
      expect.arrayContaining(['existing-map', 'synced']),
    );
    expect(
      calls(dsMock.manager.query, 'INSERT INTO device_user_mappings').length,
    ).toBe(0);
  });

  it('uid null sau addPerson → upsert status=failed (KHÔNG synced), có error message, KHÔNG crash', async () => {
    dsMock.manager.query.mockImplementation(defaultRouter());
    provider.findUidByName.mockResolvedValue(null);
    await service.provisionMeeting(meeting());
    const ins = calls(dsMock.manager.query, 'INSERT INTO device_user_mappings');
    expect(ins.length).toBe(1);
    expect((ins[0][1] as any[])[2]).toBeNull(); // device_person_id = null
    // Bug 3 fix: KHÔNG set 'synced' khi uid không tìm ra — tái dùng 'failed' đã có
    // sẵn, kèm error rõ ràng, để removeMapping() sau này không im lặng bỏ qua
    // deletePerson thật vì tưởng đã 'synced' thành công.
    expect(ins[0][1]).toEqual(
      expect.arrayContaining(['failed', 'uid not found after addPerson']),
    );
    expect(ins[0][1]).not.toContain('synced');
  });

  it('uid null → status=failed cho phép cron tick kế tiếp tự retry (KHÔNG bị coi synced/noop)', async () => {
    // Mô phỏng: lượt cron trước đã ghi mapping 'failed' (uid not found) cho đúng
    // booking này — slot-check (dòng 160) chỉ noop khi sync_status==='synced', nên
    // 'failed' phải khiến lượt sau upload+addPerson lại từ đầu (tự phục hồi).
    dsMock.manager.query.mockImplementation(
      defaultRouter({
        slot: [{ id: 'x', sync_status: 'failed', booking_id: 'm1' }],
        upsertExisting: [{ id: 'x' }],
      }),
    );
    provider.findUidByName.mockResolvedValue('70'); // lần retry này thành công
    await service.provisionMeeting(meeting());
    expect(provider.uploadFace).toHaveBeenCalledTimes(1);
    expect(provider.addPerson).toHaveBeenCalledTimes(1);
    expect(provider.findUidByName).toHaveBeenCalledWith(UNAME);
    const upd = calls(dsMock.manager.query, 'UPDATE device_user_mappings');
    expect(upd.length).toBe(1);
    expect(upd[0][1]).toEqual(expect.arrayContaining(['synced', '70']));
  });

  it('removeMapping: device_person_id null → chỉ UPDATE removed, KHÔNG deletePerson', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes("metadata_json->>'bookingId' = $1 AND sync_status"))
        return Promise.resolve([
          { id: 'map1', device_id: 'dev1', device_person_id: null },
        ]);
      return Promise.resolve(undefined);
    });
    await service.deprovisionMeeting(meeting());
    expect(provider.deletePerson).not.toHaveBeenCalled();
    expect(
      calls(dsMock.manager.query, 'FROM iot_devices WHERE id').length,
    ).toBe(0);
    const upd = calls(dsMock.manager.query, 'UPDATE device_user_mappings');
    expect(String(upd[0][0])).toContain("sync_status = 'deleted'");
  });

  it('deprovision: findDeviceById null → skip deletePerson nhưng vẫn UPDATE removed', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes("metadata_json->>'bookingId' = $1 AND sync_status"))
        return Promise.resolve([
          { id: 'map1', device_id: 'dev1', device_person_id: '64' },
        ]);
      if (sql.includes('FROM iot_devices WHERE id')) return Promise.resolve([]); // device đã bị xoá
      return Promise.resolve(undefined);
    });
    await service.deprovisionMeeting(meeting());
    expect(provider.deletePerson).not.toHaveBeenCalled();
    const upd = calls(dsMock.manager.query, 'UPDATE device_user_mappings');
    expect(String(upd[0][0])).toContain("sync_status = 'deleted'");
  });

  it('reconcile dedup: findUidByName trả ĐÚNG uid đang lưu → KHÔNG xoá', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('JOIN meetings me')) return Promise.resolve([]);
      if (
        sql.includes('SELECT device_id, device_person_id, device_person_code')
      )
        return Promise.resolve([
          {
            device_id: 'dev1',
            device_person_id: '50',
            device_person_code: 'u1:m1',
            metadata_json: {},
          },
        ]);
      if (sql.includes('FROM iot_devices WHERE id'))
        return Promise.resolve([device]);
      return Promise.resolve(undefined);
    });
    provider.findUidByName.mockResolvedValue('50'); // trùng uid đang lưu
    const r = await service.reconcile();
    expect(r.deduped).toBe(0);
    expect(provider.deletePerson).not.toHaveBeenCalled();
  });

  it('reconcile dedup: findUidByName trả null → KHÔNG xoá', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('JOIN meetings me')) return Promise.resolve([]);
      if (
        sql.includes('SELECT device_id, device_person_id, device_person_code')
      )
        return Promise.resolve([
          {
            device_id: 'dev1',
            device_person_id: '50',
            device_person_code: 'u1:m1',
            metadata_json: {},
          },
        ]);
      if (sql.includes('FROM iot_devices WHERE id'))
        return Promise.resolve([device]);
      return Promise.resolve(undefined);
    });
    provider.findUidByName.mockResolvedValue(null);
    const r = await service.reconcile();
    expect(r.deduped).toBe(0);
    expect(provider.deletePerson).not.toHaveBeenCalled();
  });

  it('reconcile dedup: findDeviceById null → skip (continue)', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('JOIN meetings me')) return Promise.resolve([]);
      if (
        sql.includes('SELECT device_id, device_person_id, device_person_code')
      )
        return Promise.resolve([
          {
            device_id: 'dev1',
            device_person_id: '50',
            device_person_code: 'u1:m1',
            metadata_json: {},
          },
        ]);
      if (sql.includes('FROM iot_devices WHERE id')) return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const r = await service.reconcile();
    expect(r.deduped).toBe(0);
    expect(provider.findUidByName).not.toHaveBeenCalled();
  });

  it('reconcile dedup: mapping thiếu uname/uid → continue', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('JOIN meetings me')) return Promise.resolve([]);
      if (
        sql.includes('SELECT device_id, device_person_id, device_person_code')
      )
        return Promise.resolve([
          {
            device_id: 'dev1',
            device_person_id: null,
            device_person_code: null,
            metadata_json: {},
          },
        ]);
      return Promise.resolve(undefined);
    });
    const r = await service.reconcile();
    expect(r.deduped).toBe(0);
    expect(factoryMock.create).not.toHaveBeenCalled();
  });

  it('reconcile dedup: findUidByName trả uid khác → xoá uid cũ', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('JOIN meetings me')) return Promise.resolve([]); // no stale
      if (
        sql.includes('SELECT device_id, device_person_id, device_person_code')
      )
        return Promise.resolve([
          {
            device_id: 'dev1',
            device_person_id: '50',
            device_person_code: 'u1:m1',
            metadata_json: {},
          },
        ]);
      if (sql.includes('FROM iot_devices WHERE id'))
        return Promise.resolve([device]);
      return Promise.resolve(undefined);
    });
    provider.findUidByName.mockResolvedValue('70'); // mới hơn 50
    const r = await service.reconcile();
    expect(r.deduped).toBe(1);
    expect(provider.deletePerson).toHaveBeenCalledWith('50');
  });
});
