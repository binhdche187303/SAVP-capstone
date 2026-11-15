import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';
import {
  cronOf,
  runAllPlanOf,
  validatePeriods,
  vnDate,
} from './uel-sync-settings.service';
import type {
  UelSyncSettings,
  UelSyncSettingsService,
} from './uel-sync-settings.service';
import { UelSyncScheduler } from './uel-sync.scheduler';
import { runStatusOf } from './uel-sync.service';
import type { UelSyncService, UelSyncStepResult } from './uel-sync.service';

describe('validatePeriods', () => {
  it('sắp theo số tiết', () => {
    expect(
      validatePeriods([
        { periodNo: 2, startTime: '07:50', endTime: '08:40' },
        { periodNo: 1, startTime: '07:00', endTime: '07:50' },
      ]).map((p) => p.periodNo),
    ).toEqual([1, 2]);
  });

  it.each([
    [
      [{ periodNo: 1, startTime: '08:00', endTime: '07:00' }],
      /sau giờ bắt đầu/,
    ],
    [[{ periodNo: 1, startTime: '7:00', endTime: '07:50' }], /HH:mm/],
    [
      [
        { periodNo: 1, startTime: '07:00', endTime: '07:50' },
        { periodNo: 1, startTime: '08:00', endTime: '08:50' },
      ],
      /trùng/,
    ],
    [
      [
        { periodNo: 1, startTime: '07:00', endTime: '07:50' },
        { periodNo: 2, startTime: '07:40', endTime: '08:30' },
      ],
      /trước khi tiết 1 kết thúc/,
    ],
  ])('bảng tiết sai → 400 (%#)', (periods, msg) => {
    try {
      validatePeriods(periods);
      throw new Error('không ném');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify((e as BadRequestException).getResponse())).toMatch(
        msg,
      );
    }
  });
});

const SETTINGS: UelSyncSettings = {
  autoEnabled: true,
  frequency: 'daily',
  weekday: 0,
  time: '02:00',
  termMode: 'auto',
  namHoc: '',
  hocKy: '',
  sessionDaysAhead: 14,
};

describe('runAllPlanOf', () => {
  // 2026-11-08 18:30 UTC = 2026-11-09 01:30 giờ VN.
  const now = new Date('2026-11-08T18:30:00Z');

  it('lịch học chỉ từ hôm nay (giờ VN) → +N−1 ngày, không lấy quá khứ', () => {
    expect(runAllPlanOf(SETTINGS, now)).toEqual({
      fromDate: '2026-11-09',
      toDate: '2026-11-22',
      termMode: 'auto',
      terms: [],
    });
    expect(runAllPlanOf({ ...SETTINGS, sessionDaysAhead: 1 }, now).toDate).toBe(
      '2026-11-09',
    );
  });

  it('học kỳ chỉ định → 1 học kỳ; thiếu năm/kỳ thì quay về tự nhận', () => {
    expect(
      runAllPlanOf(
        { ...SETTINGS, termMode: 'fixed', namHoc: '2026-2027', hocKy: 'HK01' },
        now,
      ),
    ).toMatchObject({
      termMode: 'fixed',
      terms: [{ namHoc: '2026-2027', hocKy: 'HK01' }],
    });
    expect(runAllPlanOf({ ...SETTINGS, termMode: 'fixed' }, now)).toMatchObject(
      { termMode: 'auto', terms: [] },
    );
  });

  it('vnDate cộng ngày theo giờ VN', () => {
    expect(vnDate(new Date('2026-11-08T16:59:00Z'))).toBe('2026-11-08');
    expect(vnDate(new Date('2026-11-08T17:00:00Z'))).toBe('2026-11-09');
    expect(vnDate(new Date('2026-11-08T17:00:00Z'), 1)).toBe('2026-11-10');
  });
});

describe('cronOf', () => {
  it('hằng ngày / hằng tuần theo giờ HH:mm', () => {
    expect(cronOf({ frequency: 'daily', weekday: 3, time: '02:30' })).toBe(
      '0 30 2 * * *',
    );
    expect(cronOf({ frequency: 'weekly', weekday: 1, time: '23:05' })).toBe(
      '0 5 23 * * 1',
    );
    expect(cronOf({ frequency: 'daily', weekday: 0, time: 'x' })).toBe(
      '0 0 2 * * *',
    );
  });
});

describe('runStatusOf', () => {
  const r = (error?: string) => ({ step: 'staff', error }) as UelSyncStepResult;
  it('phân loại kết quả lượt chạy', () => {
    expect(runStatusOf([r(), r()])).toBe('succeeded');
    expect(runStatusOf([r(), r('x')])).toBe('partial');
    expect(runStatusOf([r('x'), r('y')])).toBe('failed');
  });
});

describe('UelSyncScheduler', () => {
  function make(
    flags: Record<string, boolean>,
    configured = true,
    settings: UelSyncSettings = SETTINGS,
  ) {
    const config = {
      get: (k: string, d: boolean) => (k in flags ? flags[k] : d),
    } as unknown as ConfigService;
    const sync = { configured, startAll: jest.fn().mockResolvedValue({}) };
    const settingsService = {
      getSettings: jest.fn().mockResolvedValue(settings),
    };
    const registry = {
      addCronJob: jest.fn(),
      deleteCronJob: jest.fn(),
    };
    const s = new UelSyncScheduler(
      config,
      sync as unknown as UelSyncService,
      settingsService as unknown as UelSyncSettingsService,
      registry as unknown as SchedulerRegistry,
    );
    return { s, sync, registry };
  }

  it('env mặc định tắt → không tạo job, không chạy', async () => {
    const { s, sync, registry } = make({});
    await s.onApplicationBootstrap();
    expect(registry.addCronJob).not.toHaveBeenCalled();
    expect(s.enabled).toBe(false);
    expect(s.nextRunAt).toBeNull();
    await s.tick();
    expect(sync.startAll).not.toHaveBeenCalled();
  });

  it('env bật + cài đặt bật → tạo job, có lần chạy kế tiếp; tắt trong cài đặt → gỡ job', async () => {
    const { s, registry } = make({ SCHEDULER_UEL_SYNC_ENABLED: true });
    await s.onApplicationBootstrap();
    expect(registry.addCronJob).toHaveBeenCalledTimes(1);
    expect(s.enabled).toBe(true);
    expect(s.nextRunAt).toEqual(expect.any(String));
    s.apply({ ...SETTINGS, autoEnabled: false });
    expect(registry.deleteCronJob).toHaveBeenCalled();
    expect(s.enabled).toBe(false);
    s.onModuleDestroy();
  });

  it('bật nhưng chưa có API key → không chạy', async () => {
    const { s, sync } = make({ SCHEDULER_UEL_SYNC_ENABLED: true }, false);
    await s.tick();
    expect(sync.startAll).not.toHaveBeenCalled();
  });

  it('tick → đồng bộ toàn bộ trigger schedule; đang có lượt khác thì không ném', async () => {
    const { s, sync } = make({ SCHEDULER_UEL_SYNC_ENABLED: true });
    await s.tick();
    expect(sync.startAll).toHaveBeenCalledWith(
      expect.objectContaining({ termMode: 'auto' }),
      { trigger: 'schedule' },
    );
    sync.startAll.mockRejectedValueOnce(new ConflictException());
    await expect(s.tick()).resolves.toBeUndefined();
  });
});
