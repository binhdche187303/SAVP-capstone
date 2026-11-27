/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { HgvisionError } from './hgvision.client.js';
import {
  HgvisionPersonBlacklistSyncService,
  NO_FACE_MSG,
} from './hgvision-person-blacklist-sync.service.js';

/** [2026-11-27] Danh sách người giám sát → cờ danh sách đen HGVision. */
describe('HgvisionPersonBlacklistSyncService', () => {
  let client: any;
  let hook: any;
  let storage: any;
  let query: jest.Mock;
  let service: HgvisionPersonBlacklistSyncService;
  let entry: any;
  let faceIdent: string | null;
  let otherActive: boolean;

  const route = (sql: string) => {
    if (sql.includes('FROM person_control_list WHERE id')) return [entry];
    if (sql.includes('FROM device_user_mappings'))
      return faceIdent ? [{ ident: faceIdent }] : [];
    if (sql.includes('id <> $2')) return otherActive ? [1] : [];
    if (sql.includes('FROM media_files'))
      return [{ storage_key: 'k.jpg', mime_type: 'image/jpeg' }];
    return [];
  };
  const marks = () =>
    query.mock.calls
      .filter(([sql]) => String(sql).includes('UPDATE person_control_list'))
      .map(([, p]) => p);

  beforeEach(() => {
    entry = {
      id: 'e1',
      user_id: 'u1',
      display_name: 'Nguyễn A',
      photo_media_file_id: null,
      active: true,
      deleted_at: null,
      hgvision_face_ident: null,
      hgvision_synced_at: null,
    };
    faceIdent = 'K245';
    otherActive = false;
    client = {
      writeEnabled: true,
      setFaceBlacklist: jest.fn().mockResolvedValue({}),
      deleteFace: jest.fn().mockResolvedValue(undefined),
      registerFace: jest.fn().mockResolvedValue({ registered: 1, failed: 0 }),
    };
    hook = { register: jest.fn() };
    storage = { downloadFile: jest.fn().mockResolvedValue(Buffer.from('x')) };
    query = jest.fn((sql: string) => Promise.resolve(route(sql)));
    service = new HgvisionPersonBlacklistSyncService(
      client,
      hook,
      storage,
      { query } as any,
      { get: jest.fn((_k: string, d: unknown) => d) } as any,
    );
  });

  it('CAMERA_PROVIDER khác hgvision → không đăng ký hook', () => {
    service.onModuleInit();
    expect(hook.register).not.toHaveBeenCalled();
  });

  it('user có khuôn mặt → bật cờ danh sách đen, synced', async () => {
    await service.syncPersonControl('e1');
    expect(client.setFaceBlacklist).toHaveBeenCalledWith('K245', true);
    expect(marks()[0].slice(0, 4)).toEqual(['e1', 'synced', null, 'K245']);
  });

  it('user chưa có khuôn mặt → failed "chưa có khuôn mặt trên HGVision"', async () => {
    faceIdent = null;
    await service.syncPersonControl('e1');
    expect(client.setFaceBlacklist).not.toHaveBeenCalled();
    expect(marks()[0].slice(0, 3)).toEqual(['e1', 'failed', NO_FACE_MSG]);
  });

  it('tắt hồ sơ → gỡ cờ; còn hồ sơ active khác cùng user → giữ cờ', async () => {
    entry.active = false;
    await service.syncPersonControl('e1');
    expect(client.setFaceBlacklist).toHaveBeenLastCalledWith('K245', false);
    otherActive = true;
    await service.syncPersonControl('e1');
    expect(client.setFaceBlacklist).toHaveBeenLastCalledWith('K245', true);
  });

  it('người ngoài có ảnh → đăng ký WL-<id> blacklist, bật kiểm tra chất lượng', async () => {
    entry.user_id = null;
    entry.photo_media_file_id = 'm1';
    await service.syncPersonControl('e1');
    expect(client.registerFace).toHaveBeenCalledWith(
      expect.objectContaining({
        faceIdent: 'WL-e1',
        isBlacklist: true,
        skipQualityCheck: false,
      }),
    );
    expect(marks()[0].slice(0, 4)).toEqual(['e1', 'synced', null, 'WL-e1']);
  });

  it('ảnh người ngoài không đạt → giữ hồ sơ, failed "Chưa đẩy được"', async () => {
    entry.user_id = null;
    entry.photo_media_file_id = 'm1';
    client.registerFace.mockResolvedValue({ registered: 0, failed: 1 });
    await service.syncPersonControl('e1');
    expect(marks()[0][1]).toBe('failed');
    expect(marks()[0][2]).toContain('Chưa đẩy được sang HGVision');
  });

  it('xoá người ngoài đã đẩy → deleteFace (404 bỏ qua), xoá trạng thái', async () => {
    entry.user_id = null;
    entry.deleted_at = new Date();
    entry.hgvision_face_ident = 'WL-e1';
    client.deleteFace.mockRejectedValue(new HgvisionError('nf', 404));
    await service.syncPersonControl('e1');
    expect(client.deleteFace).toHaveBeenCalledWith('WL-e1');
    expect(marks()[0].slice(0, 4)).toEqual(['e1', null, null, null]);
  });

  it('tắt ghi HGVision → pending, không gọi API', async () => {
    client.writeEnabled = false;
    await service.syncPersonControl('e1');
    expect(client.setFaceBlacklist).not.toHaveBeenCalled();
    expect(marks()[0][1]).toBe('pending');
  });

  it('HGVision lỗi → failed, không ném', async () => {
    client.setFaceBlacklist.mockRejectedValue(new Error('boom'));
    await expect(service.syncPersonControl('e1')).resolves.toBeUndefined();
    expect(marks()[0].slice(0, 3)).toEqual(['e1', 'failed', 'boom']);
  });
});
