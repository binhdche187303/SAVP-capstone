import { HgvisionError } from '../../hgvision/hgvision.client.js';
import { CameraGroupHgSyncService } from './camera-group-hg-sync.service.js';

describe('CameraGroupHgSyncService', () => {
  const make = (rows: unknown[] = []) => {
    const ds = { query: jest.fn().mockResolvedValue(rows) };
    const client = {
      updateCamera: jest.fn().mockResolvedValue({}),
      createGroup: jest.fn().mockResolvedValue({}),
      updateGroup: jest.fn().mockResolvedValue({}),
      deleteGroup: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new CameraGroupHgSyncService(ds as never, client as never);
    return { svc, ds, client };
  };

  it('tạo nhóm SAVP → tạo nhóm HGVision', async () => {
    const { svc, client } = make();
    await svc.groupCreated('Camera Toan A', 'mo ta');
    expect(client.createGroup).toHaveBeenCalledWith('Camera Toan A', 'mo ta');
  });

  it('nhóm đã có (409) thì vẫn gán camera', async () => {
    const { svc, client } = make([
      { camera_name: 'G-1', group_name: 'Cam truy vet', description: null },
      { camera_name: 'Cong', group_name: null, description: null },
    ]);
    client.createGroup.mockRejectedValue(new HgvisionError('exists', 409));
    await svc.syncDevices(['a', 'b']);
    expect(client.updateCamera).toHaveBeenCalledWith('G-1', {
      camera_group: 'Cam truy vet',
    });
    expect(client.updateCamera).toHaveBeenCalledWith('Cong', {
      camera_group: '',
    });
  });

  it('đổi tên: tạo nhóm mới rồi xoá nhóm cũ', async () => {
    const { svc, client } = make();
    await svc.groupUpdated('id', 'Cu', 'Moi', null);
    expect(client.createGroup).toHaveBeenCalledWith('Moi', null);
    expect(client.deleteGroup).toHaveBeenCalledWith('Cu');
  });

  it('xoá nhóm SAVP → xoá nhóm HGVision', async () => {
    const { svc, client } = make();
    await svc.groupDeleted('Cu', []);
    expect(client.deleteGroup).toHaveBeenCalledWith('Cu');
  });

  it('lỗi HGVision không ném ra ngoài', async () => {
    const { svc, client } = make([
      { camera_name: 'X', group_name: 'G', description: null },
    ]);
    client.updateCamera.mockRejectedValue(new Error('down'));
    client.deleteGroup.mockRejectedValue(new Error('down'));
    await expect(svc.syncDevices(['a'])).resolves.toBeUndefined();
    await expect(svc.groupDeleted('G', [])).resolves.toBeUndefined();
  });
});
