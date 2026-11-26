import { CameraGroupHgSyncService } from './camera-group-hg-sync.service.js';

describe('CameraGroupHgSyncService', () => {
  const make = (rows: unknown[], update = jest.fn().mockResolvedValue({})) => {
    const ds = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new CameraGroupHgSyncService(
      ds as never,
      { updateCamera: update } as never,
    );
    return { svc, ds, update };
  };

  it('đẩy tên nhóm SAVP sang HGVision, bỏ nhóm thì gửi rỗng', async () => {
    const { svc, update } = make([
      { camera_name: 'G-1 A1-101', group_name: 'Cam truy vet' },
      { camera_name: 'Cong', group_name: null },
    ]);
    await svc.syncDevices(['a', 'b']);
    expect(update).toHaveBeenCalledWith('G-1 A1-101', {
      camera_group: 'Cam truy vet',
    });
    expect(update).toHaveBeenCalledWith('Cong', { camera_group: '' });
  });

  it('lỗi HGVision không ném ra ngoài', async () => {
    const { svc } = make(
      [{ camera_name: 'X', group_name: 'G' }],
      jest.fn().mockRejectedValue(new Error('down')),
    );
    await expect(svc.syncDevices(['a'])).resolves.toBeUndefined();
  });

  it('danh sách rỗng thì không truy vấn', async () => {
    const { svc, ds } = make([]);
    await svc.syncDevices([]);
    expect(ds.query).not.toHaveBeenCalled();
  });
});
