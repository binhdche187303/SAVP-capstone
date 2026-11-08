import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  scheduledOptionsOf,
  validatePeriods,
  vnDate,
} from './uel-sync-settings.service';
import type { UelSyncSettingsService } from './uel-sync-settings.service';
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

describe('scheduledOptionsOf', () => {
  // 2026-11-08 18:30 UTC = 2026-11-09 01:30 giờ VN.
  const now = new Date('2026-11-08T18:30:00Z');

  it('đủ cài đặt → chạy cả 6 bước, lịch học theo ngày VN', () => {
    const { options, skipped } = scheduledOptionsOf(
      { namHoc: '2026-2027', hocKy: '1', sessionDaysAhead: 14 },
      now,
      true,
    );
    expect(options.steps).toEqual([
      'departments',
      'staff',
      'students',
      'sections',
      'enrollments',
      'sessions',
    ]);
    expect(options).toMatchObject({
      namHoc: '2026-2027',
      hocKy: '1',
      fromDate: '2026-11-09',
      toDate: '2026-11-22',
    });
    expect(skipped).toEqual([]);
  });

  it('thiếu học kỳ và bảng tiết → chỉ 3 bước, nêu lý do', () => {
    const { options, skipped } = scheduledOptionsOf(
      { namHoc: '', hocKy: '', sessionDaysAhead: 14 },
      now,
      false,
    );
    expect(options.steps).toEqual(['departments', 'staff', 'students']);
    expect(skipped).toHaveLength(2);
  });

  it('vnDate cộng ngày theo giờ VN', () => {
    expect(vnDate(new Date('2026-11-08T16:59:00Z'))).toBe('2026-11-08');
    expect(vnDate(new Date('2026-11-08T17:00:00Z'))).toBe('2026-11-09');
    expect(vnDate(new Date('2026-11-08T17:00:00Z'), 1)).toBe('2026-11-10');
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
  function make(flags: Record<string, boolean>, configured = true) {
    const config = {
      get: (k: string, d: boolean) => (k in flags ? flags[k] : d),
    } as unknown as ConfigService;
    const sync = { configured, start: jest.fn().mockResolvedValue({}) };
    const settings = {
      getSettings: jest
        .fn()
        .mockResolvedValue({ namHoc: '', hocKy: '', sessionDaysAhead: 14 }),
      getPeriods: jest.fn().mockResolvedValue([]),
    };
    const s = new UelSyncScheduler(
      config,
      sync as unknown as UelSyncService,
      settings as unknown as UelSyncSettingsService,
    );
    return { s, sync };
  }

  it('mặc định tắt → không chạy', async () => {
    const { s, sync } = make({});
    await s.nightly();
    expect(sync.start).not.toHaveBeenCalled();
  });

  it('bật nhưng chưa có API key → không chạy', async () => {
    const { s, sync } = make({ SCHEDULER_UEL_SYNC_ENABLED: true }, false);
    await s.nightly();
    expect(sync.start).not.toHaveBeenCalled();
  });

  it('bật → chạy với trigger schedule; đang có lượt khác thì không ném', async () => {
    const { s, sync } = make({ SCHEDULER_UEL_SYNC_ENABLED: true });
    await s.nightly();
    expect(sync.start).toHaveBeenCalledWith(
      expect.objectContaining({ steps: ['departments', 'staff', 'students'] }),
      { trigger: 'schedule' },
    );
    sync.start.mockRejectedValueOnce(new ConflictException());
    await expect(s.nightly()).resolves.toBeUndefined();
  });
});
