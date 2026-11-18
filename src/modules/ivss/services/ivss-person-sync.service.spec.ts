/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { createHash } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { IvssPersonSyncService } from './ivss-person-sync.service.js';
import { IVSS_BRIDGE } from '../ports/ivss-bridge.port.js';
import { FaceProfileService } from '../../accounts/services/face-profile.service.js';

const okEnroll = { ok: true, data: { szUid: 'SZ1' } };
const okGroup = { ok: true, data: { groupId: 'g' } };
const okDelete = { ok: true, data: { deleted: true } };

describe('IvssPersonSyncService (IPS-001 #37)', () => {
  let service: IvssPersonSyncService;
  let dsMock: any;
  let bridgeMock: any;
  let faceMock: any;
  let cfg: Record<string, unknown>;
  let captured: Array<{ sql: string; params: any[] }>;

  const build = async () => {
    captured = [];
    dsMock = { manager: { query: jest.fn() } };
    bridgeMock = {
      createGroup: jest.fn().mockResolvedValue(okGroup),
      enrollFace: jest.fn().mockResolvedValue(okEnroll),
      deleteFace: jest.fn().mockResolvedValue(okDelete),
    };
    faceMock = {
      getPortraitBytes: jest.fn().mockResolvedValue(Buffer.from('IMG')),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssPersonSyncService,
        { provide: DataSource, useValue: dsMock },
        { provide: IVSS_BRIDGE, useValue: bridgeMock },
        { provide: FaceProfileService, useValue: faceMock },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
      ],
    }).compile();
    service = module.get(IvssPersonSyncService);
  };

  beforeEach(async () => {
    cfg = {
      IVSS_DEFAULT_GROUP: 'SMRMPTS',
      IVSS_SYNC_LEAD_MINUTES: 5,
      IVSS_SYNC_GRACE_MINUTES: 5,
    };
    await build();
  });

  // ── provision routing ──
  // bridge seeded, 1 meeting, 1 participant, no live mapping, no existing → INSERT.
  const wireProvision = (
    over: { live?: any[]; existing?: any[]; stale?: any[] } = {},
  ) => {
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve([{ id: 'bridge1' }]);
      if (sql.includes('FROM meetings')) return Promise.resolve([{ id: 'm1' }]);
      if (sql.includes('FROM meeting_participants'))
        return Promise.resolve([{ user_id: 'u1' }]);
      // Nợ #2: stale person check (SELECT device_person_id …) — default không có stale.
      if (sql.includes('SELECT device_person_id FROM device_user_mappings'))
        return Promise.resolve(over.stale ?? []);
      // dedupe live check (có sync_status='synced' + deleted_at)
      if (
        sql.includes("sync_status = 'synced'") &&
        sql.includes('deleted_at IS NULL')
      )
        return Promise.resolve(over.live ?? []);
      // upsert existing check
      if (
        sql.includes('SELECT id FROM device_user_mappings') &&
        !sql.includes("sync_status = 'synced'")
      )
        return Promise.resolve(over.existing ?? []);
      return Promise.resolve(undefined);
    });
  };

  it('enroll ok → enrollFace + INSERT mapping synced + szUid (device_person_id) + source ivss', async () => {
    wireProvision();
    const r = await service.provisionUpcoming();
    expect(r).toMatchObject({ scanned: 1, enrolled: 1 });
    expect(bridgeMock.enrollFace).toHaveBeenCalledTimes(1);
    const enrollArg = bridgeMock.enrollFace.mock.calls[0][0];
    expect(enrollArg.groupId).toBe('SMRMPTS');
    expect(enrollArg.imageBase64).toBe(Buffer.from('IMG').toString('base64'));
    // INSERT mapping: device_person_id = szUid, sync_status synced
    const ins = captured.find((c) =>
      c.sql.includes('INSERT INTO device_user_mappings'),
    );
    expect(ins).toBeDefined();
    expect(ins!.params).toContain('SZ1'); // szUid → device_person_id
    expect(ins!.params).toContain('synced');
    // metadata JSON là param riêng (chuỗi) — chứa source ivss.
    expect(
      ins!.params.some(
        (p: any) => typeof p === 'string' && p.includes('"source":"ivss"'),
      ),
    ).toBe(true);
  });

  it('enroll ok nhưng data KHÔNG có szUid → device_person_id = personUid (fallback C3)', async () => {
    wireProvision();
    bridgeMock.enrollFace.mockResolvedValue({ ok: true, data: {} });
    const personUid = createHash('sha256')
      .update('u1')
      .digest('hex')
      .slice(0, 32);
    const r = await service.provisionUpcoming();
    expect(r.enrolled).toBe(1);
    const ins = captured.find((c) =>
      c.sql.includes('INSERT INTO device_user_mappings'),
    );
    // device_person_id (param[3]) = personUid (không có szUid).
    expect(ins!.params).toContain(personUid);
  });

  it('C4(b): query enroll/dedupe lọc device_id + source=ivss', async () => {
    wireProvision();
    await service.provisionUpcoming();
    const dedupe = captured.find(
      (c) =>
        c.sql.includes("sync_status = 'synced'") &&
        c.sql.includes('deleted_at IS NULL'),
    );
    expect(String(dedupe?.sql)).toContain('device_id = $1');
    expect(String(dedupe?.sql)).toContain("metadata_json->>'source' = 'ivss'");
  });

  it('OQ-5 bridge ok:false → mapping failed + last_sync_error, KHÔNG throw', async () => {
    wireProvision();
    bridgeMock.enrollFace.mockResolvedValue({
      ok: false,
      error: { code: 'BRIDGE_UNREACHABLE', message: 'x' },
    });
    const r = await service.provisionUpcoming();
    expect(r.failed).toBe(1);
    const ins = captured.find((c) =>
      c.sql.includes('INSERT INTO device_user_mappings'),
    );
    expect(ins!.params).toContain('failed');
    expect(ins!.params).toContain('BRIDGE_UNREACHABLE');
  });

  it('OQ-7 portrait null → skip, KHÔNG enrollFace', async () => {
    wireProvision();
    faceMock.getPortraitBytes.mockResolvedValue(null);
    const r = await service.provisionUpcoming();
    expect(r.skipped).toBe(1);
    expect(bridgeMock.enrollFace).not.toHaveBeenCalled();
  });

  it('OQ-6 dedupe: live synced mapping → noop (KHÔNG enrollFace)', async () => {
    wireProvision({ live: [{ id: 'live1' }] });
    const r = await service.provisionUpcoming();
    expect(r.skipped).toBe(1);
    expect(bridgeMock.enrollFace).not.toHaveBeenCalled();
  });

  it('group rỗng → skip provision', async () => {
    cfg = { IVSS_DEFAULT_GROUP: '' };
    await build();
    dsMock.manager.query.mockResolvedValue([{ id: 'bridge1' }]);
    const r = await service.provisionUpcoming();
    expect(r).toEqual({ scanned: 0, enrolled: 0, skipped: 0, failed: 0 });
  });

  it('bridge device không seed được (INSERT throw) → no-op', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve([]);
      if (sql.includes('INSERT INTO iot_devices'))
        return Promise.reject(new Error('seed fail'));
      return Promise.resolve([]);
    });
    const r = await service.provisionUpcoming();
    expect(r).toEqual({ scanned: 0, enrolled: 0, skipped: 0, failed: 0 });
  });

  // Nợ #1: test cũ "ensureGroup createGroup ok:false → vẫn enroll" đã bỏ — nó mock
  // createGroup lỗi rồi assert enroll vẫn chạy, nhưng code KHÔNG còn gọi createGroup
  // nên test đó không kiểm chứng gì (xanh giả). Thay bằng test chốt hành vi mới.
  it('Nợ #1: provision KHÔNG gọi bridge.createGroup (group tạo thủ công; createGroup không idempotent)', async () => {
    wireProvision();
    const r = await service.provisionUpcoming();
    expect(bridgeMock.createGroup).not.toHaveBeenCalled();
    // Không tạo group vẫn enroll bình thường vào groupId có sẵn.
    expect(r.enrolled).toBe(1);
    expect(bridgeMock.enrollFace).toHaveBeenCalledTimes(1);
    expect(bridgeMock.enrollFace.mock.calls[0][0].groupId).toBe('SMRMPTS');
  });

  // ── Nợ #2: enroll idempotent ──
  it('Nợ #2: mapping cũ còn device_person_id → deleteFace person cũ TRƯỚC enrollFace', async () => {
    wireProvision({ stale: [{ device_person_id: 'SZ_OLD' }] });
    const r = await service.provisionUpcoming();
    expect(bridgeMock.deleteFace).toHaveBeenCalledWith({
      groupId: 'SMRMPTS',
      personUid: 'SZ_OLD',
    });
    // Thứ tự bắt buộc: xóa sạch person cũ rồi mới enroll → 1 user chỉ còn 1 szUID.
    expect(bridgeMock.deleteFace.mock.invocationCallOrder[0]).toBeLessThan(
      bridgeMock.enrollFace.mock.invocationCallOrder[0],
    );
    expect(r.enrolled).toBe(1);
  });

  it('Nợ #2: KHÔNG có person cũ → KHÔNG gọi deleteFace, enroll như thường', async () => {
    wireProvision({ stale: [] });
    const r = await service.provisionUpcoming();
    expect(bridgeMock.deleteFace).not.toHaveBeenCalled();
    expect(r.enrolled).toBe(1);
  });

  it('Nợ #2: deleteFace person cũ throw → vẫn enroll (best-effort, KHÔNG chặn họp)', async () => {
    wireProvision({ stale: [{ device_person_id: 'SZ_OLD' }] });
    bridgeMock.deleteFace.mockRejectedValue(new Error('bridge down'));
    const r = await service.provisionUpcoming();
    expect(bridgeMock.enrollFace).toHaveBeenCalledTimes(1);
    expect(r.enrolled).toBe(1);
  });

  it('enroll: mapping đã tồn tại (failed cũ) → UPDATE (revive) thay vì INSERT', async () => {
    wireProvision({ existing: [{ id: 'old1' }] });
    const r = await service.provisionUpcoming();
    expect(r.enrolled).toBe(1);
    const upd = captured.find(
      (c) =>
        c.sql.includes('UPDATE device_user_mappings') &&
        c.sql.includes('deleted_at = NULL'),
    );
    expect(upd).toBeDefined();
    expect(upd!.params).toContain('SZ1');
  });

  it('provision per-item: dedupe query throw → failed++ (batch không chặn)', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve([{ id: 'bridge1' }]);
      if (sql.includes('FROM meetings')) return Promise.resolve([{ id: 'm1' }]);
      if (sql.includes('FROM meeting_participants'))
        return Promise.resolve([{ user_id: 'u1' }]);
      if (sql.includes("sync_status = 'synced'"))
        return Promise.reject(new Error('db boom'));
      return Promise.resolve(undefined);
    });
    const r = await service.provisionUpcoming();
    expect(r.failed).toBe(1);
  });

  it('find-or-create bridge: chưa có → INSERT iot_devices', async () => {
    let created = false;
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve([]);
      if (sql.includes('INSERT INTO iot_devices')) {
        created = true;
        return Promise.resolve([{ id: 'bridge-new' }]);
      }
      if (sql.includes('FROM meetings')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    await service.provisionUpcoming();
    expect(created).toBe(true);
  });

  // ── cleanup ──
  const wireCleanup = (maps: any[]) => {
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve([{ id: 'bridge1' }]);
      if (sql.includes('FROM device_user_mappings mp'))
        return Promise.resolve(maps);
      return Promise.resolve(undefined);
    });
  };

  it('cleanup: user hết active → deleteFace + soft-delete (deleted_at)', async () => {
    wireCleanup([
      {
        id: 'mp1',
        user_id: 'u1',
        device_person_id: 'SZ1',
        device_person_code: 'PUID1',
      },
    ]);
    const r = await service.cleanupEnded();
    expect(r).toMatchObject({ scanned: 1, removed: 1 });
    // deleteFace theo device_person_id (szUid IVSS trả), KHÔNG phải device_person_code.
    expect(bridgeMock.deleteFace).toHaveBeenCalledWith({
      groupId: 'SMRMPTS',
      personUid: 'SZ1',
    });
    const upd = captured.find(
      (c) =>
        c.sql.includes('UPDATE device_user_mappings') &&
        c.sql.includes('deleted_at = now()'),
    );
    expect(upd).toBeDefined();
  });

  it('cleanup deleteFace ok:false → giữ mapping (KHÔNG soft-delete)', async () => {
    wireCleanup([
      {
        id: 'mp1',
        user_id: 'u1',
        device_person_id: 'SZ1',
        device_person_code: 'PUID1',
      },
    ]);
    bridgeMock.deleteFace.mockResolvedValue({
      ok: false,
      error: { code: 'BRIDGE_TIMEOUT', message: 'x' },
    });
    const r = await service.cleanupEnded();
    expect(r.failed).toBe(1);
    expect(r.removed).toBe(0);
    const upd = captured.find((c) =>
      c.sql.includes('UPDATE device_user_mappings'),
    );
    expect(upd).toBeUndefined();
  });

  it('C4(b): cleanup query lọc device_id + source=ivss + NOT EXISTS', async () => {
    wireCleanup([]);
    await service.cleanupEnded();
    const mapsQ = captured.find((c) =>
      c.sql.includes('FROM device_user_mappings mp'),
    );
    expect(String(mapsQ?.sql)).toContain('mp.device_id = $1');
    expect(String(mapsQ?.sql)).toContain("metadata_json->>'source' = 'ivss'");
    expect(String(mapsQ?.sql)).toContain('NOT EXISTS');
  });

  it('cleanup batch resilience: 1 lỗi không chặn item còn lại', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve([{ id: 'bridge1' }]);
      if (sql.includes('FROM device_user_mappings mp'))
        return Promise.resolve([
          // device_person_id BẮT BUỘC có — deleteFace chỉ được gọi khi mapping có szUid.
          { id: 'mp1', user_id: 'u1', device_person_id: 'SZ1' },
          { id: 'mp2', user_id: 'u2', device_person_id: 'SZ2' },
        ]);
      return Promise.resolve(undefined);
    });
    bridgeMock.deleteFace
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(okDelete);
    const r = await service.cleanupEnded();
    expect(r.scanned).toBe(2);
    expect(r.removed).toBe(1);
    expect(r.failed).toBe(1);
  });

  // ── Task A: extractSzUid (top-level + nested .data, guard object) ──
  describe('extractSzUid', () => {
    const call = (data: unknown): string | null =>
      (service as any).extractSzUid(data);

    it('nested data.szUid → "620" (shape bridge thật)', () => {
      expect(
        call({ success: true, data: { groupId: '1', szUid: '620' } }),
      ).toBe('620');
    });

    it('top-level phẳng {szUid:"620"} → "620"', () => {
      expect(call({ szUid: '620' })).toBe('620');
    });

    it('không có szUid (success:false) → null', () => {
      expect(call({ success: false, message: 'X' })).toBeNull();
    });

    it('{} / null / string → null', () => {
      expect(call({})).toBeNull();
      expect(call(null)).toBeNull();
      expect(call('abc')).toBeNull();
    });

    it('both present → deterministic: top-level scanned first', () => {
      // KHÔNG phải rule nghiệp vụ — chỉ chốt tính xác định của thứ tự quét.
      expect(call({ szUid: 'top', data: { szUid: 'nested' } })).toBe('top');
    });

    it('guard .data không phải object hợp lệ → null', () => {
      expect(call({ success: false, data: null })).toBeNull();
      expect(call({ data: 'xyz' })).toBeNull();
      expect(call({ data: [] })).toBeNull();
      expect(call({ data: {} })).toBeNull();
    });
  });
});
