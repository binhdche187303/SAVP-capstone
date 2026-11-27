/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { HgvisionError } from './hgvision.client.js';
import { HgvisionFaceSyncService } from './hgvision-face-sync.service.js';

/** [2026-11-23] Đồng bộ khuôn mặt SAVP → HGVision (tự duyệt FaceID). */
describe('HgvisionFaceSyncService', () => {
  let client: any;
  let hook: any;
  let faceProfiles: any;
  let query: jest.Mock;
  let config: any;
  let service: HgvisionFaceSyncService;
  let mapping: any;
  let user: any;
  let watchlisted = false;

  const route = (sql: string) => {
    if (sql.includes('FROM iot_devices')) return [{ id: 'dev-1' }];
    if (sql.includes('SELECT employee_code'))
      return [{ employee_code: 'K245' }];
    if (sql.includes('SELECT full_name')) return user ? [user] : [];
    if (sql.includes("metadata_json->>'profileId' AS profile_id"))
      return mapping ? [mapping] : [];
    if (sql.includes('FROM person_control_list')) return watchlisted ? [1] : [];
    if (sql.includes('SELECT id FROM device_user_mappings'))
      return mapping ? [{ id: mapping.id }] : [];
    return [];
  };

  beforeEach(() => {
    mapping = null;
    watchlisted = false;
    user = {
      full_name: 'Nguyễn A',
      account_status: 'active',
      deleted_at: null,
    };
    client = {
      writeEnabled: true,
      searchFace: jest.fn(),
      deleteFace: jest.fn().mockResolvedValue(undefined),
      registerFace: jest.fn().mockResolvedValue({}),
    };
    hook = { registerChecker: jest.fn(), registerSync: jest.fn() };
    faceProfiles = {
      getActiveEnrollmentImages: jest.fn().mockResolvedValue({
        profileId: 'fp-1',
        images: [
          { data: Buffer.from('a'), mimeType: 'image/jpeg' },
          { data: Buffer.from('b'), mimeType: 'image/jpeg' },
        ],
      }),
    };
    query = jest.fn((sql: string) => Promise.resolve(route(sql)));
    config = { get: jest.fn((_k: string, d: unknown) => d) };
    service = new HgvisionFaceSyncService(
      client,
      hook,
      faceProfiles,
      { manager: { query } } as any,
      config,
    );
  });

  const sqlCalls = (needle: string) =>
    query.mock.calls.filter(([sql]) => String(sql).includes(needle));

  it('onModuleInit: CAMERA_PROVIDER khác hgvision → không đăng ký hook', () => {
    service.onModuleInit();
    expect(hook.registerChecker).not.toHaveBeenCalled();
  });

  it('inspect → client.searchFace(topK=3)', async () => {
    client.searchFace.mockResolvedValue({ faceCount: 1, matches: [] });
    const r = await service.inspect(Buffer.from('x'), 'image/jpeg');
    expect(r).toEqual({ faceCount: 1, matches: [] });
    expect(client.searchFace.mock.calls[0][1]).toBe(3);
  });

  it('faceIdentOf: thiếu mã NV/SV → dùng user id', async () => {
    query.mockResolvedValueOnce([{ employee_code: '  ' }]);
    await expect(service.faceIdentOf('u1')).resolves.toBe('u1');
  });

  it('hồ sơ active + bật ghi → registerFace đủ ảnh + mapping synced', async () => {
    await service.syncUser('u1');
    expect(client.registerFace).toHaveBeenCalledWith(
      expect.objectContaining({ faceIdent: 'K245', skipQualityCheck: true }),
    );
    expect(client.registerFace.mock.calls[0][0].images).toHaveLength(2);
    const ins = sqlCalls('INSERT INTO device_user_mappings');
    expect(ins).toHaveLength(1);
    expect(ins[0][1]).toContain('synced');
  });

  it('cờ ghi tắt → không gọi HGVision, mapping pending', async () => {
    client.writeEnabled = false;
    await service.syncUser('u1');
    expect(client.registerFace).not.toHaveBeenCalled();
    expect(sqlCalls('INSERT INTO device_user_mappings')[0][1]).toContain(
      'pending',
    );
  });

  it('đã synced đúng hồ sơ → không làm gì', async () => {
    mapping = {
      id: 'm1',
      device_person_id: 'K245',
      sync_status: 'synced',
      profile_id: 'fp-1',
    };
    await service.syncUser('u1');
    expect(client.registerFace).not.toHaveBeenCalled();
    expect(client.deleteFace).not.toHaveBeenCalled();
  });

  it('đổi bộ ảnh → xoá định danh cũ rồi đăng ký lại', async () => {
    mapping = {
      id: 'm1',
      device_person_id: 'K245',
      sync_status: 'synced',
      profile_id: 'fp-old',
    };
    await service.syncUser('u1');
    expect(client.deleteFace).toHaveBeenCalledWith('K245');
    expect(client.registerFace).toHaveBeenCalled();
    expect(sqlCalls('UPDATE device_user_mappings SET')).toHaveLength(1);
  });

  it('HGVision lỗi → mapping failed (cron thử lại), không ném', async () => {
    client.registerFace.mockRejectedValue(new Error('timeout'));
    await expect(service.syncUser('u1')).resolves.toBeUndefined();
    const ins = sqlCalls('INSERT INTO device_user_mappings')[0][1];
    expect(ins).toContain('failed');
    expect(ins).toContain('timeout');
  });

  it('hết hồ sơ active (Bị gỡ) + có mapping → deleteFace + mapping deleted', async () => {
    faceProfiles.getActiveEnrollmentImages.mockResolvedValue({
      profileId: null,
      images: [],
    });
    mapping = {
      id: 'm1',
      device_person_id: 'K245',
      sync_status: 'synced',
      profile_id: 'fp-1',
    };
    await service.syncUser('u1');
    expect(client.deleteFace).toHaveBeenCalledWith('K245');
    expect(sqlCalls("sync_status = 'deleted'")).toHaveLength(1);
  });

  it('xoá trên HGVision trả 404 → vẫn đánh dấu deleted', async () => {
    faceProfiles.getActiveEnrollmentImages.mockResolvedValue({
      profileId: null,
      images: [],
    });
    mapping = {
      id: 'm1',
      device_person_id: 'K245',
      sync_status: 'synced',
      profile_id: 'fp-1',
    };
    const err = Object.create(HgvisionError.prototype);
    err.status = 404;
    client.deleteFace.mockRejectedValue(err);
    await service.syncUser('u1');
    expect(sqlCalls("sync_status = 'deleted'")).toHaveLength(1);
  });

  it('không hồ sơ + không mapping → không gọi HGVision', async () => {
    faceProfiles.getActiveEnrollmentImages.mockResolvedValue({
      profileId: null,
      images: [],
    });
    await service.syncUser('u1');
    expect(client.deleteFace).not.toHaveBeenCalled();
    expect(client.registerFace).not.toHaveBeenCalled();
  });

  it('reconcile: gọi syncUser cho từng user, lỗi 1 user không dừng vòng', async () => {
    query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('SELECT DISTINCT user_id')
          ? [{ user_id: 'u1' }, { user_id: 'u2' }]
          : route(sql),
      ),
    );
    const spy = jest
      .spyOn(service, 'syncUser')
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(undefined);
    await expect(service.reconcile()).resolves.toEqual({ checked: 2 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('[2026-11-27] user trong danh sách giám sát → đăng ký lại vẫn giữ cờ danh sách đen', async () => {
    watchlisted = true;
    await service.syncUser('u1');
    expect(client.registerFace).toHaveBeenCalledWith(
      expect.objectContaining({ faceIdent: 'K245', isBlacklist: true }),
    );
  });
});
