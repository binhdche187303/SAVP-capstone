/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { createHash } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { IvssPortraitSyncService } from './ivss-portrait-sync.service.js';
import { IVSS_BRIDGE } from '../ports/ivss-bridge.port.js';
import { FaceProfileService } from '../../accounts/services/face-profile.service.js';

const okEnroll = { ok: true, data: { szUid: 'SZP1' } };
const okDelete = { ok: true, data: { deleted: true } };
const failEnroll = {
  ok: false,
  error: { code: 'BRIDGE_UNREACHABLE', message: 'down' },
};

const uidOf = (userId: string) =>
  createHash('sha256').update(userId).digest('hex').slice(0, 32);

describe('IvssPortraitSyncService (PORTRAIT-001 / UC-109+110)', () => {
  let service: IvssPortraitSyncService;
  let dsMock: any;
  let bridgeMock: any;
  let faceMock: any;
  let cfg: Record<string, unknown>;
  let captured: Array<{ sql: string; params: any[] }>;

  /** Mock DB theo SQL fragment. `over` ghi đè từng nhóm query. */
  const wire = (
    over: {
      bridge?: any[];
      live?: any[];
      stale?: any[];
      existing?: any[];
      mapping?: any[];
      toEnroll?: any[];
      toRemove?: any[];
      resync?: any[];
    } = {},
  ) => {
    captured = [];
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve(over.bridge ?? [{ id: 'pbridge1' }]);
      if (sql.includes('INSERT INTO iot_devices'))
        return Promise.resolve([{ id: 'pbridge1' }]);
      // reconcile (2) PHẢI khớp TRƯỚC (1): query remove chứa cả `LEFT JOIN users u`
      // lẫn `FROM face_profiles fp` (trong NOT EXISTS) — khớp (1) trước sẽ trả sai nhóm.
      if (sql.includes('LEFT JOIN users u'))
        return Promise.resolve(over.toRemove ?? []);
      // reconcile (1): cần enroll
      if (sql.includes('FROM face_profiles fp'))
        return Promise.resolve(over.toEnroll ?? []);
      // removePortrait: tìm mapping của user
      if (
        sql.includes('SELECT id, user_id, device_person_id, device_person_code')
      )
        return Promise.resolve(over.mapping ?? []);
      // resyncMapping: UPDATE ... RETURNING id (khác TTL sweep — TTL sweep KHÔNG RETURNING).
      if (
        sql.includes("SET sync_status = 'pending'") &&
        sql.includes('RETURNING id')
      )
        return Promise.resolve(over.resync ?? []);
      // enroll dedupe
      if (sql.includes("sync_status = 'synced'") && sql.includes('SELECT id'))
        return Promise.resolve(over.live ?? []);
      // stale cleanup
      if (sql.includes('SELECT device_person_id FROM device_user_mappings'))
        return Promise.resolve(over.stale ?? []);
      // upsert existence
      if (sql.includes('SELECT id FROM device_user_mappings'))
        return Promise.resolve(over.existing ?? []);
      return Promise.resolve(undefined);
    });
  };

  const sqlOf = (frag: string) => captured.find((c) => c.sql.includes(frag));

  beforeEach(async () => {
    cfg = { IVSS_PORTRAIT_GROUP: 'portrait-grp' };
    dsMock = { manager: { query: jest.fn() } };
    bridgeMock = {
      createGroup: jest.fn(),
      enrollFace: jest.fn().mockResolvedValue(okEnroll),
      deleteFace: jest.fn().mockResolvedValue(okDelete),
      status: jest.fn(),
    };
    faceMock = {
      getPortraitBytes: jest.fn().mockResolvedValue(Buffer.from('IMG')),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssPortraitSyncService,
        { provide: DataSource, useValue: dsMock },
        { provide: IVSS_BRIDGE, useValue: bridgeMock },
        { provide: FaceProfileService, useValue: faceMock },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
      ],
    }).compile();
    service = module.get(IvssPortraitSyncService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── ISOLATION (F2/F3): device row riêng + source='portrait' ───────────────
  it('F2: dùng bridge device RIÊNG IVSS-BRIDGE-PORTRAIT (không dùng IVSS-BRIDGE)', async () => {
    wire();
    await service.enrollPortrait('u1');
    const q = sqlOf('FROM iot_devices WHERE device_code')!;
    expect(q.params[0]).toBe('IVSS-BRIDGE-PORTRAIT');
    expect(q.params[0]).not.toBe('IVSS-BRIDGE');
  });

  it("mọi query lọc metadata source='portrait'", async () => {
    wire();
    await service.enrollPortrait('u1');
    const withSource = captured.filter((c) =>
      c.sql.includes("metadata_json->>'source'"),
    );
    expect(withSource.length).toBeGreaterThan(0);
    for (const c of withSource) expect(c.params).toContain('portrait');
  });

  // ── ENROLL ────────────────────────────────────────────────────────────────
  it('enroll ok: gọi bridge với portrait group + lưu mapping synced', async () => {
    wire();
    const r = await service.enrollPortrait('u1');
    expect(r).toBe('enrolled');
    expect(bridgeMock.enrollFace).toHaveBeenCalledWith({
      groupId: 'portrait-grp',
      personUid: uidOf('u1'),
      imageBase64: Buffer.from('IMG').toString('base64'),
    });
    const ins = sqlOf('INSERT INTO device_user_mappings')!;
    expect(ins.params).toContain('SZP1'); // szUid từ bridge
    expect(ins.params).toContain('synced');
  });

  it('dedupe: đã có mapping portrait synced → noop, KHÔNG gọi bridge', async () => {
    wire({ live: [{ id: 'm1' }] });
    const r = await service.enrollPortrait('u1');
    expect(r).toBe('noop');
    expect(bridgeMock.enrollFace).not.toHaveBeenCalled();
  });

  it('thiếu ảnh duyệt → skipped, KHÔNG gọi bridge, KHÔNG throw', async () => {
    wire();
    faceMock.getPortraitBytes.mockResolvedValue(null);
    await expect(service.enrollPortrait('u1')).resolves.toBe('skipped');
    expect(bridgeMock.enrollFace).not.toHaveBeenCalled();
  });

  it('IVSS_PORTRAIT_GROUP rỗng → skipped, KHÔNG gọi bridge', async () => {
    cfg = {};
    wire();
    await expect(service.enrollPortrait('u1')).resolves.toBe('skipped');
    expect(bridgeMock.enrollFace).not.toHaveBeenCalled();
  });

  it('idempotent (Nợ #2): xóa person cũ trước khi enroll khi mapping lệch', async () => {
    wire({ stale: [{ device_person_id: 'OLD_SZ' }] });
    await service.enrollPortrait('u1');
    expect(bridgeMock.deleteFace).toHaveBeenCalledWith({
      groupId: 'portrait-grp',
      personUid: 'OLD_SZ',
    });
    expect(bridgeMock.enrollFace).toHaveBeenCalled();
  });

  it('best-effort: bridge enroll fail → mapping failed, return failed, KHÔNG throw', async () => {
    wire();
    bridgeMock.enrollFace.mockResolvedValue(failEnroll);
    await expect(service.enrollPortrait('u1')).resolves.toBe('failed');
    const ins = sqlOf('INSERT INTO device_user_mappings')!;
    expect(ins.params).toContain('failed');
    expect(ins.params).toContain('BRIDGE_UNREACHABLE');
  });

  // ── REMOVE ────────────────────────────────────────────────────────────────
  it('remove ok: deleteFace + soft-delete mapping', async () => {
    wire({ mapping: [{ id: 'm9', user_id: 'u1', device_person_id: 'SZP1' }] });
    const r = await service.removePortrait('u1');
    expect(r).toBe('removed');
    expect(bridgeMock.deleteFace).toHaveBeenCalledWith({
      groupId: 'portrait-grp',
      personUid: 'SZP1',
    });
    expect(sqlOf("SET sync_status = 'deleted'")).toBeDefined();
  });

  it('remove: không có mapping portrait → noop', async () => {
    wire({ mapping: [] });
    await expect(service.removePortrait('u1')).resolves.toBe('noop');
    expect(bridgeMock.deleteFace).not.toHaveBeenCalled();
  });

  it('remove: bridge fail → GIỮ mapping để retry, return failed, KHÔNG throw', async () => {
    wire({ mapping: [{ id: 'm9', user_id: 'u1', device_person_id: 'SZP1' }] });
    bridgeMock.deleteFace.mockResolvedValue({
      ok: false,
      error: { code: 'BRIDGE_TIMEOUT', message: 't' },
    });
    await expect(service.removePortrait('u1')).resolves.toBe('failed');
    expect(sqlOf("SET sync_status = 'deleted'")).toBeUndefined();
  });

  // ── FORCE RE-SYNC (phương án c, phần 2) ─────────────────────────────────
  it('resyncMapping: có mapping portrait → UPDATE sync_status=pending, trả true', async () => {
    wire({ resync: [{ id: 'map1' }] });
    const r = await service.resyncMapping('u1');
    expect(r).toBe(true);
    const upd = captured.find(
      (c) =>
        c.sql.includes("SET sync_status = 'pending'") &&
        c.sql.includes('RETURNING id'),
    );
    expect(upd).toBeDefined();
    expect(upd!.sql).toContain('AND user_id = $2');
    expect(upd!.sql).toContain("metadata_json->>'source' = $3");
    expect(upd!.params).toEqual(['pbridge1', 'u1', 'portrait']);
  });

  it('resyncMapping: user KHÔNG có mapping portrait nào (chưa từng enroll) → trả false', async () => {
    wire({ resync: [] });
    const r = await service.resyncMapping('u1');
    expect(r).toBe(false);
  });

  it('resyncMapping: bridge device chưa sẵn → trả false, KHÔNG throw', async () => {
    wire({ bridge: [] });
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve([]);
      if (sql.includes('INSERT INTO iot_devices'))
        return Promise.reject(new Error('seed fail'));
      return Promise.resolve([]);
    });
    await expect(service.resyncMapping('u1')).resolves.toBe(false);
  });

  // ── RECONCILE ─────────────────────────────────────────────────────────────
  it('reconcile: enroll user có ảnh active chưa synced + remove mapping hết điều kiện', async () => {
    wire({
      toEnroll: [{ user_id: 'u1' }],
      toRemove: [{ id: 'm2', user_id: 'u2', device_person_id: 'SZP2' }],
    });
    const r = await service.reconcilePortraits();
    expect(r).toEqual({ scanned: 2, enrolled: 1, removed: 1, failed: 0 });
    expect(bridgeMock.enrollFace).toHaveBeenCalledTimes(1);
    expect(bridgeMock.deleteFace).toHaveBeenCalledWith({
      groupId: 'portrait-grp',
      personUid: 'SZP2',
    });
  });

  it('reconcile: query enroll lọc face_profiles active + account active', async () => {
    wire();
    await service.reconcilePortraits();
    const q = sqlOf('FROM face_profiles fp')!;
    expect(q.sql).toContain("fp.status = 'active'");
    expect(q.sql).toContain("u.account_status = 'active'");
    expect(q.sql).toContain('fp.deleted_at IS NULL');
    expect(q.sql).toContain('u.deleted_at IS NULL');
  });

  it('reconcile: query remove bắt account inactive/locked/deleted + ảnh hết active', async () => {
    wire();
    await service.reconcilePortraits();
    const q = sqlOf('LEFT JOIN users u')!;
    expect(q.sql).toContain("u.account_status <> 'active'");
    expect(q.sql).toContain('u.deleted_at IS NOT NULL');
    expect(q.sql).toContain('FROM face_profiles fp');
  });

  it('reconcile: group rỗng → không quét, trả 0 hết', async () => {
    cfg = {};
    wire();
    const r = await service.reconcilePortraits();
    expect(r).toEqual({ scanned: 0, enrolled: 0, removed: 0, failed: 0 });
    expect(sqlOf('FROM face_profiles fp')).toBeUndefined();
  });

  it('reconcile: enroll fail đếm vào failed, KHÔNG throw', async () => {
    wire({ toEnroll: [{ user_id: 'u1' }] });
    bridgeMock.enrollFace.mockResolvedValue(failEnroll);
    const r = await service.reconcilePortraits();
    expect(r.failed).toBe(1);
    expect(r.enrolled).toBe(0);
  });

  // ── TTL sweep (phương án c, phần 1) ─────────────────────────────────────
  it('reconcile: TTL sweep hạ mapping synced quá hạn về pending TRƯỚC khi chọn toEnroll, dùng ttlDays mặc định 21', async () => {
    wire();
    await service.reconcilePortraits();
    const ttl = captured.find(
      (c) =>
        c.sql.includes("SET sync_status = 'pending'") &&
        c.sql.includes('last_synced_at <') &&
        !c.sql.includes('RETURNING id'), // phân biệt với resyncMapping (có RETURNING id)
    );
    expect(ttl).toBeDefined();
    expect(ttl!.sql).toContain("sync_status = 'synced'");
    expect(ttl!.sql).toContain("metadata_json->>'source' = $2");
    expect(ttl!.params).toEqual(['pbridge1', 'portrait', 21]);
  });

  it('reconcile: ttlDays đọc từ config IVSS_PORTRAIT_TTL_DAYS (override khác default)', async () => {
    cfg = { IVSS_PORTRAIT_GROUP: 'portrait-grp', IVSS_PORTRAIT_TTL_DAYS: 7 };
    wire();
    await service.reconcilePortraits();
    const ttl = captured.find(
      (c) =>
        c.sql.includes("SET sync_status = 'pending'") &&
        c.sql.includes('last_synced_at <') &&
        !c.sql.includes('RETURNING id'),
    );
    expect(ttl!.params).toEqual(['pbridge1', 'portrait', 7]);
  });

  it('mapping quá TTL đã bị hạ pending (giả lập tick trước) → tick này lọt vào toEnroll, enroll lại với device_person_id MỚI khác cũ', async () => {
    bridgeMock.enrollFace.mockResolvedValue({
      ok: true,
      data: { szUid: 'SZP_NEW' },
    });
    wire({
      // TTL đã hạ 'pending' ở tick trước → NOT EXISTS(...sync_status='synced') không còn loại user này → lọt vào toEnroll.
      toEnroll: [{ user_id: 'u1' }],
      // Dòng mapping CŨ (device_person_id='648' theo bối cảnh) vẫn còn (chỉ đổi sync_status) → upsert đi nhánh UPDATE.
      existing: [{ id: 'map-old-1' }],
    });
    const r = await service.reconcilePortraits();
    expect(r.enrolled).toBe(1);
    const upd = captured.find(
      (c) =>
        c.sql.includes('UPDATE device_user_mappings SET') &&
        c.sql.includes('deleted_at = NULL'),
    );
    expect(upd).toBeDefined();
    expect(upd!.params).toContain('SZP_NEW'); // device_person_id MỚI
    expect(upd!.params).not.toContain('648'); // KHÔNG còn giá trị cũ
  });
});
