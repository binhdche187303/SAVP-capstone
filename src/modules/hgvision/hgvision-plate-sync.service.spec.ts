import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { HgvisionPlateSyncService } from './hgvision-plate-sync.service.js';
import { HgvisionError, type HgvisionClient } from './hgvision.client.js';
import { ControlListSyncHook } from '../anpr/services/control-list-sync.hook.js';
import type { VehicleControlListEntity } from '../anpr/entities/vehicle-control-list.entity.js';

type Row = Partial<VehicleControlListEntity>;

function setup(opts: {
  live?: Row[];
  owned?: boolean;
  writeEnabled?: boolean;
  provider?: string;
}) {
  const client = {
    writeEnabled: opts.writeEnabled ?? true,
    createPlate: jest.fn().mockResolvedValue({}),
    updatePlate: jest.fn().mockResolvedValue({}),
    deletePlate: jest.fn().mockResolvedValue(undefined),
  };
  const repo = {
    find: jest.fn().mockResolvedValue(opts.live ?? []),
    exists: jest.fn().mockResolvedValue(!!opts.owned),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const hook = new ControlListSyncHook();
  const config = {
    get: jest.fn((k: string, d?: unknown) =>
      k === 'CAMERA_PROVIDER' ? (opts.provider ?? 'hgvision') : d,
    ),
  };
  const svc = new HgvisionPlateSyncService(
    client as unknown as HgvisionClient,
    repo as unknown as Repository<VehicleControlListEntity>,
    hook,
    config as unknown as ConfigService,
  );
  const lastMark = (): Row => {
    const calls = repo.update.mock.calls as unknown[][];
    return calls[calls.length - 1]?.[1] ?? {};
  };
  return { svc, client, repo, hook, lastMark };
}

const black: Row = {
  plateNumber: '51A12345',
  listType: 'blocklist',
  active: true,
  reason: 'Trộm xe',
};
const watch: Row = {
  plateNumber: '51A12345',
  listType: 'watchlist',
  active: true,
  reason: null,
};

describe('HgvisionPlateSyncService', () => {
  it('chỉ đăng ký hook khi CAMERA_PROVIDER=hgvision', () => {
    const on = setup({});
    on.svc.onModuleInit();
    expect(on.hook.enabled).toBe(true);
    const off = setup({ provider: 'ivss' });
    off.svc.onModuleInit();
    expect(off.hook.enabled).toBe(false);
  });

  it('cờ ghi tắt → không gọi HGVision, đánh dấu pending', async () => {
    const { svc, client, lastMark } = setup({
      live: [black],
      writeEnabled: false,
    });
    await svc.syncPlate('51A12345');
    expect(client.createPlate).not.toHaveBeenCalled();
    expect(client.deletePlate).not.toHaveBeenCalled();
    expect(lastMark()).toMatchObject({ hgvisionSyncStatus: 'pending' });
  });

  it('biển mới blocklist → createPlate is_blacklist=true, đánh dấu synced', async () => {
    const { svc, client, lastMark } = setup({ live: [black] });
    await svc.syncPlate('51A12345');
    expect(client.createPlate).toHaveBeenCalledWith({
      licensePlate: '51A12345',
      ident: 'SAVP',
      lpInfor: 'SAVP - Danh sách đen: Trộm xe',
      isBlacklist: true,
      visibleTo: 'all',
    });
    const m = lastMark();
    expect(m.hgvisionSyncStatus).toBe('synced');
    expect(m.hgvisionSyncError).toBeNull();
    expect(m.hgvisionSyncedAt).toBeInstanceOf(Date);
  });

  it('watchlist → tạo biển, is_blacklist=false', async () => {
    const { svc, client } = setup({ live: [watch] });
    await svc.syncPlate('51A12345');
    expect(client.createPlate).toHaveBeenCalledWith(
      expect.objectContaining({
        isBlacklist: false,
        lpInfor: 'SAVP - Theo dõi',
      }),
    );
  });

  it('biển có cả watchlist + blocklist → blacklist thắng', async () => {
    const { svc, client } = setup({ live: [watch, black] });
    await svc.syncPlate('51A12345');
    expect(client.createPlate).toHaveBeenCalledWith(
      expect.objectContaining({ isBlacklist: true }),
    );
  });

  it('biển SAVP đã tạo trước đó → updatePlate, không create', async () => {
    const { svc, client } = setup({ live: [black], owned: true });
    await svc.syncPlate('51A12345');
    expect(client.updatePlate).toHaveBeenCalledWith(
      '51A12345',
      expect.objectContaining({ isBlacklist: true }),
    );
    expect(client.createPlate).not.toHaveBeenCalled();
  });

  it('update trả 404 (bị xoá tay trên HGVision) → tạo lại', async () => {
    const { svc, client, lastMark } = setup({ live: [black], owned: true });
    client.updatePlate.mockRejectedValue(new HgvisionError('not found', 404));
    await svc.syncPlate('51A12345');
    expect(client.createPlate).toHaveBeenCalled();
    expect(lastMark()).toMatchObject({ hgvisionSyncStatus: 'synced' });
  });

  it('tắt active hết + SAVP đã tạo → deletePlate', async () => {
    const { svc, client } = setup({
      live: [{ ...black, active: false }],
      owned: true,
    });
    await svc.syncPlate('51A12345');
    expect(client.deletePlate).toHaveBeenCalledWith('51A12345');
  });

  it('xoá mềm hết dòng + SAVP đã tạo → deletePlate, 404 coi như xong', async () => {
    const { svc, client, repo } = setup({ live: [], owned: true });
    client.deletePlate.mockRejectedValue(new HgvisionError('nf', 404));
    await svc.syncPlate('51A12345');
    expect(client.deletePlate).toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled(); // không còn dòng sống để đánh dấu
  });

  it('biển KHÔNG do SAVP tạo + không còn active → KHÔNG xoá trên HGVision', async () => {
    const { svc, client } = setup({ live: [], owned: false });
    await svc.syncPlate('51A12345');
    expect(client.deletePlate).not.toHaveBeenCalled();
  });

  it('biển có sẵn trên HGVision (409) → failed, báo rõ, không ghi đè', async () => {
    const { svc, client, lastMark } = setup({ live: [black] });
    client.createPlate.mockRejectedValue(
      new HgvisionError('License plate already exists', 400),
    );
    await svc.syncPlate('51A12345');
    expect(client.updatePlate).not.toHaveBeenCalled();
    const m = lastMark();
    expect(m.hgvisionSyncStatus).toBe('failed');
    expect(m.hgvisionSyncError).toContain('không ghi đè');
  });

  it('HGVision lỗi khác → failed, lỗi đã che token', async () => {
    const { svc, client, lastMark } = setup({ live: [black] });
    client.createPlate.mockRejectedValue(
      new HgvisionError('Forbidden Bearer abc.def.ghi', 403),
    );
    await svc.syncPlate('51A12345');
    const m = lastMark();
    expect(m.hgvisionSyncStatus).toBe('failed');
    expect(m.hgvisionSyncError).toContain('HTTP 403');
    expect(m.hgvisionSyncError).not.toContain('abc.def.ghi');
  });
});
