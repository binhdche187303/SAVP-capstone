import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import {
  HgvisionPlateReconcileService,
  MSG_MISMATCH,
  MSG_MISSING,
  diffPlate,
} from './hgvision-plate-reconcile.service.js';
import type { HgvisionPlateSyncService } from './hgvision-plate-sync.service.js';
import type { HgvisionClient, HgvisionPlate } from './hgvision.client.js';
import { ControlListSyncHook } from '../anpr/services/control-list-sync.hook.js';
import type { VehicleControlListEntity } from '../anpr/entities/vehicle-control-list.entity.js';
import type { VehicleRegistrationEntity } from '../anpr/entities/vehicle-registration.entity.js';
import type { AuditLogsService } from '../administration/services/audit-logs.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationPriority } from '../notifications/entities/notification.entity.js';

type Reg = Partial<VehicleRegistrationEntity>;
type Row = Partial<VehicleControlListEntity>;

const IDENT = 'Nguyen Van A - NV001';
const INFO = 'SAVP - Xe đăng ký (Xe máy)';

function reg(plate: string, status: string | null = 'synced'): Reg {
  return {
    plateNumber: plate,
    status: 'active',
    vehicleType: 'motorbike',
    hgvisionSyncStatus: status,
    user: { fullName: 'Nguyen Van A', employeeCode: 'NV001' } as Reg['user'],
  };
}

function remote(
  plate: string,
  over: Partial<HgvisionPlate> = {},
): HgvisionPlate {
  return {
    license_plate: plate,
    ident: IDENT,
    lp_infor: INFO,
    is_blacklist: 0,
    ...over,
  };
}

function setup(opts: {
  regs?: Reg[];
  live?: Row[];
  owned?: string[];
  remote?: HgvisionPlate[];
  listError?: Error;
  writeEnabled?: boolean;
  afterSync?: string | null; // trạng thái đọc lại sau syncPlate; null = xe đã bị xoá
  provider?: string;
  interval?: number;
}) {
  const client = {
    writeEnabled: opts.writeEnabled ?? true,
    listPlates: jest.fn(async ({ page }: { page: number }) => {
      await Promise.resolve();
      if (opts.listError && page === 2) throw opts.listError;
      const all = opts.remote ?? [];
      if (opts.listError)
        return { total: 150, page, page_size: 100, data: all.slice(0, 100) };
      return {
        total: all.length,
        page,
        page_size: 100,
        data: all.slice((page - 1) * 100, page * 100),
      };
    }),
  };
  const repo = {
    find: jest.fn().mockResolvedValue(opts.live ?? []),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const after = opts.afterSync === undefined ? 'synced' : opts.afterSync;
  const regRepo = {
    find: jest.fn().mockResolvedValue(opts.regs ?? []),
    findOne: jest
      .fn()
      .mockResolvedValue(after === null ? null : { hgvisionSyncStatus: after }),
  };
  const sync = {
    syncPlate: jest.fn().mockResolvedValue(undefined),
    mark: jest.fn().mockResolvedValue(undefined),
  };
  const owned = opts.owned ?? (opts.regs ?? []).map((r) => r.plateNumber!);
  const dataSource = {
    manager: {
      query: jest.fn((sql: string) =>
        Promise.resolve(
          sql.includes('hgvision_synced_at')
            ? owned.map((p) => ({ plate_number: p }))
            : [{ id: 'admin-1' }],
        ),
      ),
    },
  };
  const audit = { logAction: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    createNotification: jest.fn().mockResolvedValue({}),
  };
  const hook = new ControlListSyncHook();
  const config = {
    get: jest.fn((k: string, d?: unknown) =>
      k === 'CAMERA_PROVIDER'
        ? (opts.provider ?? 'hgvision')
        : k === 'HGVISION_RECONCILE_INTERVAL_MS'
          ? (opts.interval ?? 0)
          : d,
    ),
  };
  const svc = new HgvisionPlateReconcileService(
    client as unknown as HgvisionClient,
    repo as unknown as Repository<VehicleControlListEntity>,
    regRepo as unknown as Repository<VehicleRegistrationEntity>,
    sync as unknown as HgvisionPlateSyncService,
    hook,
    audit as unknown as AuditLogsService,
    notifications as unknown as NotificationsService,
    dataSource as unknown as DataSource,
    config as unknown as ConfigService,
  );
  const notified = (i = 0) =>
    (notifications.createNotification.mock.calls as unknown[][])[i][0] as {
      content: string;
      priority: string;
      recipientUserIds: string[];
    };
  const marks = (status: string) =>
    (sync.mark.mock.calls as unknown[][]).filter((c) => c[1] === status);
  return { svc, client, sync, audit, notifications, hook, marks, notified };
}

describe('HgvisionPlateReconcileService', () => {
  afterEach(() => jest.useRealTimers());

  it('khớp hết → không ghi gì, không thông báo', async () => {
    const t = setup({ regs: [reg('99A99997')], remote: [remote('99A99997')] });
    const r = await t.svc.reconcile();
    expect(r).toMatchObject({ checked: 1, restored: 0, mismatched: 0 });
    expect(t.sync.syncPlate).not.toHaveBeenCalled();
    expect(t.notifications.createNotification).not.toHaveBeenCalled();
  });

  it('(1) đọc HGVision lỗi giữa chừng → bỏ lượt, không đẩy gì', async () => {
    const t = setup({
      regs: [reg('99A99997')],
      remote: Array.from({ length: 100 }, (_, i) =>
        remote(`51F${String(i).padStart(5, '0')}`, { lp_infor: 'khác' }),
      ),
      listError: new Error('timeout'),
    });
    const r = await t.svc.reconcile();
    expect(r.aborted).toContain('timeout');
    expect(t.sync.syncPlate).not.toHaveBeenCalled();
    expect(t.sync.mark).not.toHaveBeenCalled();
  });

  it('bị xoá 1 biển bên HGVision → tự khôi phục, ghi chú + audit + báo admin', async () => {
    const t = setup({
      regs: [reg('99A99997'), reg('30A11111')],
      remote: [remote('30A11111')],
    });
    const r = await t.svc.reconcile();
    expect(r.restored).toBe(1);
    expect(t.sync.syncPlate).toHaveBeenCalledWith('99A99997');
    const note = t.marks('synced')[0];
    expect(note[0]).toBe('99A99997');
    expect(String(note[2])).toContain('đã khôi phục lúc');
    expect(t.audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'HGVISION_PLATE_RESTORED' }),
    );
    const n = t.notified();
    expect(n.content).toContain('Đã khôi phục 1 biển');
    expect(n.recipientUserIds).toEqual(['admin-1']);
  });

  it('(2) thiếu quá nhiều cùng lúc → không tự đẩy, đánh dấu missing, báo HIGH', async () => {
    const regs = Array.from({ length: 25 }, (_, i) =>
      reg(`99A9${String(i).padStart(4, '0')}`),
    );
    const t = setup({ regs, remote: [] });
    const r = await t.svc.reconcile();
    expect(r.aborted).toContain('thiếu 25 biển');
    expect(r.missing).toBe(25);
    expect(t.sync.syncPlate).not.toHaveBeenCalled();
    expect(t.marks('missing')).toHaveLength(25);
    const n = t.notified();
    expect(n.priority).toBe(NotificationPriority.HIGH);
  });

  it('(2) đã báo missing rồi → lượt sau không báo lại', async () => {
    const regs = Array.from({ length: 25 }, (_, i) =>
      reg(`99A9${String(i).padStart(4, '0')}`, 'missing'),
    );
    const t = setup({ regs, remote: [] });
    await t.svc.reconcile();
    expect(t.notifications.createNotification).not.toHaveBeenCalled();
  });

  it('(3) xe vừa bị xoá trên SAVP trong lúc đối soát → không tính khôi phục', async () => {
    const t = setup({ regs: [reg('99A99997')], remote: [], afterSync: null });
    const r = await t.svc.reconcile();
    expect(r.restored).toBe(0);
    expect(t.notifications.createNotification).not.toHaveBeenCalled();
  });

  it('(4) HGVision lưu 99A-999.97 vẫn khớp 99A99997', async () => {
    const t = setup({
      regs: [reg('99A99997')],
      remote: [remote('99A-999.97')],
    });
    const r = await t.svc.reconcile();
    expect(r.restored).toBe(0);
    expect(t.sync.syncPlate).not.toHaveBeenCalled();
  });

  it('(5) biển người khác tạo trên HGVision → không đụng', async () => {
    const t = setup({
      regs: [],
      remote: [remote('51F12345', { ident: 'Bảo vệ', lp_infor: 'Xe khách' })],
    });
    await t.svc.reconcile();
    expect(t.sync.syncPlate).not.toHaveBeenCalled();
    expect(t.sync.mark).not.toHaveBeenCalled();
  });

  it('(6) bị sửa tay bên HGVision → chỉ báo lệch, KHÔNG ghi đè', async () => {
    const t = setup({
      regs: [reg('99A99997')],
      remote: [remote('99A99997', { is_blacklist: 1 })],
    });
    const r = await t.svc.reconcile();
    expect(r.mismatched).toBe(1);
    expect(t.sync.syncPlate).not.toHaveBeenCalled();
    const m = t.marks('mismatch')[0];
    expect(String(m[2])).toContain(MSG_MISMATCH);
    expect(t.audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'HGVISION_PLATE_MISMATCH' }),
    );
  });

  it('(6) đã lệch từ trước → không audit/báo lại; sửa khớp lại → về synced', async () => {
    const still = setup({
      regs: [reg('99A99997', 'mismatch')],
      remote: [remote('99A99997', { is_blacklist: 1 })],
    });
    await still.svc.reconcile();
    expect(still.audit.logAction).not.toHaveBeenCalled();
    expect(still.notifications.createNotification).not.toHaveBeenCalled();

    const fixed = setup({
      regs: [reg('99A99997', 'mismatch')],
      remote: [remote('99A99997')],
    });
    await fixed.svc.reconcile();
    expect(fixed.marks('synced')[0]).toEqual(['99A99997', 'synced', null]);
  });

  it('(7) xe đã xoá trên SAVP mà HGVision còn biển SAVP tạo → xoá bên HGVision', async () => {
    const t = setup({
      regs: [],
      owned: ['99A99997'],
      remote: [remote('99A99997')],
      afterSync: null,
    });
    const r = await t.svc.reconcile();
    expect(t.sync.syncPlate).toHaveBeenCalledWith('99A99997');
    expect(r.removed).toBe(1);
  });

  it('(7) biển trùng nhưng ghi chú không phải SAVP → không xoá', async () => {
    const t = setup({
      regs: [],
      owned: ['99A99997'],
      remote: [remote('99A99997', { lp_infor: 'Bảo vệ thêm' })],
    });
    await t.svc.reconcile();
    expect(t.sync.syncPlate).not.toHaveBeenCalled();
  });

  it('(8) xe đồng bộ lỗi → tự đẩy lại', async () => {
    const t = setup({ regs: [reg('99A99997', 'failed')], remote: [] });
    const r = await t.svc.reconcile();
    expect(t.sync.syncPlate).toHaveBeenCalledWith('99A99997');
    expect(r.pushed).toBe(1);
    expect(r.restored).toBe(0);
  });

  it('(9) cờ ghi tắt → chỉ đánh dấu bị xoá, không đẩy', async () => {
    const t = setup({
      regs: [reg('99A99997')],
      remote: [],
      writeEnabled: false,
    });
    const r = await t.svc.reconcile();
    expect(t.sync.syncPlate).not.toHaveBeenCalled();
    expect(t.marks('missing')[0]).toEqual(['99A99997', 'missing', MSG_MISSING]);
    expect(r.missing).toBe(1);
  });

  it('(10) chỉ bật khi CAMERA_PROVIDER=hgvision; interval 0 = không chạy tự động', async () => {
    const off = setup({ provider: 'ivss' });
    off.svc.onModuleInit();
    expect((await off.hook.reconcile()).enabled).toBe(false);

    jest.useFakeTimers();
    const on = setup({ interval: 0 });
    on.svc.onModuleInit();
    jest.advanceTimersByTime(3_600_000);
    expect(on.client.listPlates).not.toHaveBeenCalled();
    expect((await on.hook.reconcile()).enabled).toBe(true);
    on.svc.onModuleDestroy();
  });

  it('(11) đang chạy mà bấm thêm → busy, không chạy lượt 2', async () => {
    const t = setup({ regs: [reg('99A99997')], remote: [remote('99A99997')] });
    const [a, b] = await Promise.all([t.svc.reconcile(), t.svc.reconcile()]);
    expect([a.busy, b.busy].sort()).toEqual([false, true]);
    expect(t.client.listPlates).toHaveBeenCalledTimes(1);
  });

  it('HGVision giới hạn page_size nhỏ → vẫn đọc hết theo total', async () => {
    const t = setup({ regs: [reg('99A99997')] });
    const all = [
      ...Array.from({ length: 50 }, (_, i) =>
        remote(`51F${String(i).padStart(5, '0')}`, { lp_infor: 'khác' }),
      ),
      remote('99A99997'),
    ];
    t.client.listPlates.mockImplementation(({ page }: { page: number }) =>
      Promise.resolve({
        total: all.length,
        page,
        page_size: 50,
        data: all.slice((page - 1) * 50, page * 50),
      }),
    );
    const r = await t.svc.reconcile();
    expect(t.client.listPlates).toHaveBeenCalledTimes(2);
    expect(r.restored).toBe(0);
    expect(t.sync.syncPlate).not.toHaveBeenCalled();
  });

  it('HGVision trả rỗng giữa chừng (total lớn hơn) → bỏ lượt', async () => {
    const t = setup({ regs: [reg('99A99997')] });
    t.client.listPlates.mockResolvedValue({
      total: 10,
      page: 1,
      page_size: 100,
      data: [],
    });
    const r = await t.svc.reconcile();
    expect(r.aborted).toContain('trả thiếu');
    expect(t.sync.syncPlate).not.toHaveBeenCalled();
  });

  it('diffPlate bỏ qua trường HGVision không trả về', () => {
    const want = {
      ident: IDENT,
      lpInfor: INFO,
      isBlacklist: false,
      visibleTo: 'all' as const,
    };
    expect(diffPlate(want, { license_plate: 'X' })).toBeNull();
    expect(
      diffPlate(want, { license_plate: 'X', ident: 'Người khác' }),
    ).toContain('chủ xe');
  });
});
