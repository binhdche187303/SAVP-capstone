/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { DeviceEventSnapshotService } from './device-event-snapshot.service.js';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const MEDIA_ID = '22222222-2222-4222-8222-222222222222';
// [FIX 2026-08-13] getSnapshot() giờ bắt buộc callerId (ownership-check EMPLOYEE).
const ADMIN_CALLER = 'admin-1';

describe('DeviceEventSnapshotService (F-F)', () => {
  let service: DeviceEventSnapshotService;
  let dsMock: any;
  let storageMock: any;
  let authzMock: any;
  let hgClient: any;
  let moduleRefMock: any;

  const wire = (
    over: {
      event?: Array<{
        snapshot_file_id: string | null;
        owner_user_id?: string | null;
        remote_image_path?: string | null;
        remote_plate_image_path?: string | null;
      }>;
      media?: Array<{
        storage_key: string;
        mime_type: string;
        file_name: string;
      }>;
    } = {},
  ) => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM iot_device_events'))
        return Promise.resolve(
          over.event ?? [
            { snapshot_file_id: MEDIA_ID, owner_user_id: 'owner-1' },
          ],
        );
      if (sql.includes('FROM media_files'))
        return Promise.resolve(
          over.media ?? [
            {
              storage_key: 'stranger-snapshots/x.jpg',
              mime_type: 'image/jpeg',
              file_name: 'x.jpg',
            },
          ],
        );
      return Promise.resolve([]);
    });
  };

  const roleOf = (role: string): void => {
    authzMock.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: [role],
      permissions: [],
    });
  };

  beforeEach(() => {
    dsMock = { manager: { query: jest.fn() } };
    storageMock = {
      downloadFile: jest.fn().mockResolvedValue(Buffer.from('IMG')),
    };
    authzMock = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: ['SYSTEM_ADMIN'], permissions: [] }),
    };
    hgClient = { fetchImageBase64: jest.fn().mockResolvedValue('UkVN') };
    moduleRefMock = { get: jest.fn().mockReturnValue(hgClient) };
    service = new DeviceEventSnapshotService(
      dsMock,
      storageMock,
      authzMock,
      moduleRefMock,
    );
  });

  it('event có snapshot_file_id + media tồn tại → trả buffer/mimeType/fileName', async () => {
    wire();
    const result = await service.getSnapshot(EVENT_ID, ADMIN_CALLER);
    expect(storageMock.downloadFile).toHaveBeenCalledWith(
      'stranger-snapshots/x.jpg',
    );
    expect(result).toEqual({
      buffer: Buffer.from('IMG'),
      mimeType: 'image/jpeg',
      fileName: 'x.jpg',
    });
  });

  it('event không tồn tại → NotFoundException, KHÔNG gọi storage', async () => {
    wire({ event: [] });
    await expect(
      service.getSnapshot(EVENT_ID, ADMIN_CALLER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storageMock.downloadFile).not.toHaveBeenCalled();
  });

  it('event tồn tại nhưng snapshot_file_id null → NotFoundException', async () => {
    wire({ event: [{ snapshot_file_id: null }] });
    await expect(
      service.getSnapshot(EVENT_ID, ADMIN_CALLER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storageMock.downloadFile).not.toHaveBeenCalled();
  });

  it('snapshot_file_id có nhưng media_files row bị xoá/mất → NotFoundException', async () => {
    wire({ media: [] });
    await expect(
      service.getSnapshot(EVENT_ID, ADMIN_CALLER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storageMock.downloadFile).not.toHaveBeenCalled();
  });

  it('bind eventId đúng tham số cho query đầu tiên (SEC-03)', async () => {
    wire();
    await service.getSnapshot(EVENT_ID, ADMIN_CALLER);
    expect(dsMock.manager.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM iot_device_events'),
      [EVENT_ID],
    );
    expect(dsMock.manager.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM media_files'),
      [MEDIA_ID],
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  // [FIX 2026-08-13] Ownership-check EMPLOYEE — permission ivss.access_log.read
  // vừa mở cho EMPLOYEE, phải tự chặn phạm vi ngay trong service.
  // ══════════════════════════════════════════════════════════════════════
  describe('ownership-check (FIX 2026-08-13)', () => {
    it('Employee xem snapshot của CHÍNH MÌNH → thành công', async () => {
      roleOf('EMPLOYEE');
      wire({ event: [{ snapshot_file_id: MEDIA_ID, owner_user_id: 'emp-1' }] });
      const result = await service.getSnapshot(EVENT_ID, 'emp-1');
      expect(result.buffer).toEqual(Buffer.from('IMG'));
      expect(storageMock.downloadFile).toHaveBeenCalled();
    });

    // [FIX 2026-08-13] TEST QUAN TRỌNG NHẤT — chặn Employee dò UUID xem ảnh người khác.
    it('Employee xem snapshot của NGƯỜI KHÁC (dò UUID) → 403 SELF_ONLY, KHÔNG gọi storage', async () => {
      roleOf('EMPLOYEE');
      wire({
        event: [{ snapshot_file_id: MEDIA_ID, owner_user_id: 'owner-1' }],
      });
      let caught: unknown;
      try {
        await service.getSnapshot(EVENT_ID, 'emp-1');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as ForbiddenException).getResponse()).toMatchObject({
        error: { code: 'SELF_ONLY' },
      });
      expect(storageMock.downloadFile).not.toHaveBeenCalled();
    });

    it('Employee xem event KHÔNG có userId trong payload (domain khác, VD ANPR) → 403 (mặc định từ chối)', async () => {
      roleOf('EMPLOYEE');
      wire({
        event: [{ snapshot_file_id: MEDIA_ID, owner_user_id: null }],
      });
      await expect(
        service.getSnapshot(EVENT_ID, 'emp-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('Manager xem snapshot của người khác (không phải chủ nhân) → vẫn thành công (regression, không đổi hành vi cũ)', async () => {
      roleOf('MANAGER');
      wire({
        event: [{ snapshot_file_id: MEDIA_ID, owner_user_id: 'someone-else' }],
      });
      const result = await service.getSnapshot(EVENT_ID, 'mgr-1');
      expect(result.buffer).toEqual(Buffer.from('IMG'));
    });

    it('Business Admin xem snapshot của người khác → vẫn thành công (regression)', async () => {
      roleOf('BUSINESS_ADMIN');
      wire({
        event: [{ snapshot_file_id: MEDIA_ID, owner_user_id: 'someone-else' }],
      });
      const result = await service.getSnapshot(EVENT_ID, 'ba-1');
      expect(result.buffer).toEqual(Buffer.from('IMG'));
    });

    it('System Admin xem snapshot của người khác → vẫn thành công (regression)', async () => {
      roleOf('SYSTEM_ADMIN');
      wire({
        event: [{ snapshot_file_id: MEDIA_ID, owner_user_id: 'someone-else' }],
      });
      const result = await service.getSnapshot(EVENT_ID, 'sa-1');
      expect(result.buffer).toEqual(Buffer.from('IMG'));
    });
  });

  describe('HGVision: ảnh chỉ lưu đường dẫn → proxy qua BE', () => {
    const remoteEvent = {
      snapshot_file_id: null,
      owner_user_id: null,
      remote_image_path: '/data/img/full.jpg',
      remote_plate_image_path: '/data/img/plate.jpg',
    };

    it('không có snapshot_file_id → lấy ảnh toàn cảnh từ HGVision, remote=true', async () => {
      wire({ event: [remoteEvent] });
      const r = await service.getSnapshot(EVENT_ID, ADMIN_CALLER);
      expect(hgClient.fetchImageBase64).toHaveBeenCalledWith(
        '/data/img/full.jpg',
      );
      expect(storageMock.downloadFile).not.toHaveBeenCalled();
      expect(r).toEqual({
        buffer: Buffer.from('REM'),
        mimeType: 'image/jpeg',
        fileName: 'full.jpg',
        remote: true,
      });
    });

    it('type=plate → ảnh cắt biển, kể cả khi event đã có ảnh lưu MinIO', async () => {
      wire({ event: [{ ...remoteEvent, snapshot_file_id: MEDIA_ID }] });
      await service.getSnapshot(EVENT_ID, ADMIN_CALLER, 'plate');
      expect(hgClient.fetchImageBase64).toHaveBeenCalledWith(
        '/data/img/plate.jpg',
      );
      expect(storageMock.downloadFile).not.toHaveBeenCalled();
    });

    it('HGVision lỗi/xoá ảnh → 404', async () => {
      wire({ event: [remoteEvent] });
      hgClient.fetchImageBase64.mockRejectedValue(new Error('HTTP 404'));
      await expect(
        service.getSnapshot(EVENT_ID, ADMIN_CALLER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('EMPLOYEE không phải chủ → 403, KHÔNG gọi HGVision', async () => {
      wire({ event: [remoteEvent] });
      roleOf('EMPLOYEE');
      await expect(
        service.getSnapshot(EVENT_ID, 'emp-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(hgClient.fetchImageBase64).not.toHaveBeenCalled();
    });
  });
});
