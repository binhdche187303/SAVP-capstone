import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';
import {
  cronOf,
  intervalDueOf,
  nextIntervalRunOf,
  runAllPlanOf,
  schoolYearEndOf,
  UelSyncSettingsService as SettingsService,
  validatePeriods,
  vnDate,
} from './uel-sync-settings.service';
import type {
  UelSyncSettings,
  UelSyncSettingsService,
} from './uel-sync-settings.service';
import { scheduleLabelOf, UelSyncScheduler } from './uel-sync.scheduler';
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
  intervalDays: 3,
};

describe('runAllPlanOf', () => {
  // 2026-11-08 18:30 UTC = 2026-11-09 01:30 giờ VN.
  const now = new Date('2026-11-08T18:30:00Z');

  it('lịch học từ hôm nay (giờ VN) đến hết năm học, không lấy quá khứ', () => {
    expect(runAllPlanOf(SETTINGS, now)).toEqual({
      fromDate: '2026-11-09',
      toDate: '2027-08-31',
      termMode: 'auto',
      terms: [],
    });
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

describe('schoolYearEndOf', () => {
  const at = (iso: string) => new Date(iso);
  it('tháng ≥ 9 ⇒ 31/08 năm sau', () =>
    expect(schoolYearEndOf(at('2026-11-08T18:30:00Z'))).toBe('2027-08-31'));
  it('tháng < 9 ⇒ 31/08 năm nay', () =>
    expect(schoolYearEndOf(at('2027-03-10T03:00:00Z'))).toBe('2027-08-31'));
  it('01/09 giờ VN (31/08 17:00 UTC) ⇒ năm sau', () =>
    expect(schoolYearEndOf(at('2027-08-31T17:00:00Z'))).toBe('2028-08-31'));
  it('cuối tháng 8 vẫn ≥ hôm nay + 13 ngày', () =>
    expect(schoolYearEndOf(at('2027-08-25T03:00:00Z'))).toBe('2027-09-07'));
});

describe('runAllPlanOf — ngày kết thúc không phụ thuộc năm học chỉ định', () => {
  const now = new Date('2026-11-08T18:30:00Z');
  it.each(['2025-2026', '2026-2027', '2027-2028', '2026'])(
    'fixed namHoc %s ⇒ vẫn đến 31/08 năm học hiện tại',
    (namHoc) =>
      expect(
        runAllPlanOf(
          { ...SETTINGS, termMode: 'fixed', namHoc, hocKy: 'HK01' },
          now,
        ).toDate,
      ).toBe('2027-08-31'),
  );
  it('fixed có namHoc nhưng thiếu hocKy ⇒ chạy auto, cùng ngày kết thúc', () =>
    expect(
      runAllPlanOf(
        { ...SETTINGS, termMode: 'fixed', namHoc: '2027-2028' },
        now,
      ),
    ).toMatchObject({ termMode: 'auto', toDate: '2027-08-31' }));
});

describe('UelSyncSettingsService — không còn số ngày kéo trước', () => {
  function make() {
    const written: unknown[] = [];
    const m = {
      query: jest.fn((_sql: string, params: unknown[]) => {
        written.push(params[0]);
        return Promise.resolve([[], 1]);
      }),
    };
    const db = {
      query: jest
        .fn()
        .mockResolvedValue([
          { config_key: 'uel_sync.session_days_ahead', config_value: '30' },
        ]),
      transaction: jest.fn((fn: (x: typeof m) => Promise<void>) => fn(m)),
    };
    return { svc: new SettingsService(db as never), written };
  }

  it('getSettings không trả sessionDaysAhead', async () => {
    const { svc } = make();
    expect(await svc.getSettings()).not.toHaveProperty('sessionDaysAhead');
  });

  it('updateSettings không ghi uel_sync.session_days_ahead', async () => {
    const { svc, written } = make();
    await svc.updateSettings({ time: '02:00' }, null);
    expect(written).toContain('uel_sync.time');
    expect(written).not.toContain('uel_sync.session_days_ahead');
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
    const sync = {
      configured,
      startAll: jest.fn().mockResolvedValue({}),
      lastScheduledRunAt: jest.fn().mockResolvedValue(null),
    };
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

describe('lịch mỗi N ngày', () => {
  // now = 2026-11-17 02:00 giờ VN.
  const now = new Date('2026-11-16T19:00:00Z');

  it('chưa chạy lần nào ⇒ đến hạn', () =>
    expect(intervalDueOf(null, now, 3)).toBe(true));
  it('lần trước cách 2 ngày (theo ngày VN) ⇒ chưa đến hạn với N=3', () =>
    expect(intervalDueOf('2026-11-14T19:00:00Z', now, 3)).toBe(false));
  it('lần trước cách đúng 3 ngày ⇒ đến hạn', () =>
    expect(intervalDueOf('2026-11-13T19:05:00Z', now, 3)).toBe(true));
  it('tính theo ngày VN: 23:30 VN hôm 14 cách 17 là 3 ngày', () =>
    expect(intervalDueOf('2026-11-14T16:30:00Z', now, 3)).toBe(true));

  it('lần chạy kế tiếp = ngày lần trước + N lúc HH:mm (giờ VN), không sớm hơn lịch cron', () => {
    const cronNext = new Date('2026-11-17T19:00:00Z'); // 18/11 02:00 VN
    expect(
      nextIntervalRunOf(
        '2026-11-16T19:00:00Z',
        cronNext,
        5,
        '02:00',
      ).toISOString(),
    ).toBe('2026-11-21T19:00:00.000Z'); // 22/11 02:00 VN
    expect(nextIntervalRunOf(null, cronNext, 5, '02:00')).toBe(cronNext);
    expect(
      nextIntervalRunOf('2026-10-01T19:00:00Z', cronNext, 5, '02:00'),
    ).toBe(cronNext);
  });

  it('cron của lịch mỗi N ngày = hằng ngày lúc HH:mm (bộ hẹn giờ tự bỏ qua ngày chưa đến hạn)', () =>
    expect(cronOf({ frequency: 'interval', weekday: 0, time: '03:15' })).toBe(
      '0 15 3 * * *',
    ));

  it('nhãn', () =>
    expect(
      scheduleLabelOf({ ...SETTINGS, frequency: 'interval', intervalDays: 30 }),
    ).toBe('02:00 mỗi 30 ngày'));
});

describe('UelSyncSettingsService — số ngày của lịch mỗi N ngày', () => {
  function make(rows: { config_key: string; config_value: string }[]) {
    const written: unknown[][] = [];
    const m = {
      query: jest.fn((_sql: string, params: unknown[]) => {
        written.push(params);
        return Promise.resolve([[], 1]);
      }),
    };
    const db = {
      query: jest.fn().mockResolvedValue(rows),
      transaction: jest.fn((fn: (x: typeof m) => Promise<void>) => fn(m)),
    };
    return { svc: new SettingsService(db as never), written };
  }

  it('đọc frequency interval + interval_days; thiếu/sai thì 3', async () => {
    const { svc } = make([
      { config_key: 'uel_sync.frequency', config_value: 'interval' },
      { config_key: 'uel_sync.interval_days', config_value: '30' },
    ]);
    expect(await svc.getSettings()).toMatchObject({
      frequency: 'interval',
      intervalDays: 30,
    });
    const bad = make([
      { config_key: 'uel_sync.interval_days', config_value: 'x' },
    ]);
    expect((await bad.svc.getSettings()).intervalDays).toBe(3);
  });

  it('ghi uel_sync.interval_days', async () => {
    const { svc, written } = make([]);
    await svc.updateSettings({ frequency: 'interval', intervalDays: 5 }, null);
    expect(written).toContainEqual(['uel_sync.interval_days', '5', null]);
    expect(written).toContainEqual(['uel_sync.frequency', 'interval', null]);
  });

  it('số ngày ngoài 2..90 ⇒ 400', async () => {
    const { svc } = make([]);
    await expect(
      svc.updateSettings({ frequency: 'interval', intervalDays: 1 }, null),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.updateSettings({ frequency: 'interval', intervalDays: 91 }, null),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('UelSyncScheduler — lịch mỗi N ngày', () => {
  const INTERVAL: UelSyncSettings = {
    ...SETTINGS,
    frequency: 'interval',
    intervalDays: 3,
  };
  function make(last: string | null) {
    const config = { get: () => true } as unknown as ConfigService;
    const sync = {
      configured: true,
      startAll: jest.fn().mockResolvedValue({}),
      lastScheduledRunAt: jest.fn().mockResolvedValue(last),
    };
    const s = new UelSyncScheduler(
      config,
      sync as unknown as UelSyncService,
      {
        getSettings: jest.fn().mockResolvedValue(INTERVAL),
      } as unknown as UelSyncSettingsService,
      {
        addCronJob: jest.fn(),
        deleteCronJob: jest.fn(),
      } as unknown as SchedulerRegistry,
    );
    return { s, sync };
  }
  afterEach(() => jest.useRealTimers());

  it('chưa đủ N ngày từ lượt tự động trước ⇒ bỏ qua', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-16T19:00:00Z') });
    const { s, sync } = make('2026-11-15T19:00:00Z');
    await s.tick();
    expect(sync.startAll).not.toHaveBeenCalled();
  });

  it('đủ N ngày ⇒ chạy', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-16T19:00:00Z') });
    const { s, sync } = make('2026-11-13T19:00:00Z');
    await s.tick();
    expect(sync.startAll).toHaveBeenCalledTimes(1);
  });
});
