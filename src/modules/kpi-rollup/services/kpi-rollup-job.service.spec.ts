/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { KpiRollupJobService } from './kpi-rollup-job.service.js';

const T = (iso: string): Date => new Date(iso);

describe('KpiRollupJobService (KPI-001)', () => {
  let qr: any;
  let dataSource: any;
  let watermarkRepo: any;
  let zoneRollup: any;
  let vehicleRollup: any;
  let service: KpiRollupJobService;

  beforeEach(() => {
    qr = {
      isTransactionActive: false,
      connect: jest.fn(async () => undefined),
      startTransaction: jest.fn(async () => {
        qr.isTransactionActive = true;
      }),
      commitTransaction: jest.fn(async () => {
        qr.isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn(async () => {
        qr.isTransactionActive = false;
      }),
      release: jest.fn(async () => undefined),
      query: jest.fn(async () => [{ ok: true }]),
    };
    dataSource = { createQueryRunner: jest.fn(() => qr) };
    watermarkRepo = {
      get: jest.fn(async () => null),
      save: jest.fn(async () => undefined),
    };
    zoneRollup = { rollup: jest.fn(async () => undefined) };
    vehicleRollup = { rollup: jest.fn(async () => undefined) };
    service = new KpiRollupJobService(
      dataSource,
      watermarkRepo,
      zoneRollup,
      vehicleRollup,
    );
  });

  it('không lấy được lock → skipped, KHÔNG rollup, rollback', async () => {
    qr.query.mockResolvedValueOnce([{ ok: false }]);
    const r = await service.runIncremental(T('2026-10-05T10:37:00Z'));
    expect(r).toEqual({ skipped: true, windows: {} });
    expect(zoneRollup.rollup).not.toHaveBeenCalled();
    expect(qr.rollbackTransaction).toHaveBeenCalled();
    expect(qr.release).toHaveBeenCalled();
  });

  it('startTransaction lỗi → vẫn release, ném lỗi, KHÔNG rollback', async () => {
    qr.startTransaction.mockRejectedValueOnce(new Error('tx-fail'));
    await expect(
      service.runIncremental(T('2026-10-05T10:37:00Z')),
    ).rejects.toThrow('tx-fail');
    expect(qr.release).toHaveBeenCalledTimes(1);
    expect(qr.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('connect lỗi → vẫn release, ném lỗi, KHÔNG rollback', async () => {
    qr.connect.mockRejectedValueOnce(new Error('conn-fail'));
    await expect(
      service.runIncremental(T('2026-10-05T10:37:00Z')),
    ).rejects.toThrow('conn-fail');
    expect(qr.release).toHaveBeenCalledTimes(1);
    expect(qr.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('incremental: rollup cả 2 với cùng cửa sổ, lưu watermark, commit', async () => {
    const r = await service.runIncremental(T('2026-10-05T10:37:00Z'));
    const w = {
      from: T('2026-10-05T08:00:00Z'),
      to: T('2026-10-05T10:00:00Z'),
    };
    expect(zoneRollup.rollup).toHaveBeenCalledWith(qr, w.from, w.to);
    expect(vehicleRollup.rollup).toHaveBeenCalledWith(qr, w.from, w.to);
    expect(watermarkRepo.save).toHaveBeenCalledWith(qr, 'zone_hourly', {
      coveredFrom: w.from,
      coveredUntil: w.to,
    });
    expect(r).toEqual({
      skipped: false,
      windows: { zone_hourly: w, vehicle_hourly: w },
    });
    expect(qr.commitTransaction).toHaveBeenCalled();
  });

  it('rollup lỗi → rollback, ném lỗi, KHÔNG lưu watermark', async () => {
    zoneRollup.rollup.mockRejectedValueOnce(new Error('boom'));
    await expect(
      service.runIncremental(T('2026-10-05T10:37:00Z')),
    ).rejects.toThrow('boom');
    expect(watermarkRepo.save).not.toHaveBeenCalled();
    expect(qr.rollbackTransaction).toHaveBeenCalled();
    expect(qr.commitTransaction).not.toHaveBeenCalled();
    expect(qr.release).toHaveBeenCalled();
  });

  it('runRange: chỉ 1 rollup, lock blocking (pg_advisory_xact_lock)', async () => {
    qr.query.mockResolvedValueOnce([{}]);
    await service.runRange(
      'vehicle_hourly',
      T('2026-10-01T00:00:00Z'),
      T('2026-10-02T00:00:00Z'),
    );
    expect(qr.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(vehicleRollup.rollup).toHaveBeenCalledTimes(1);
    expect(zoneRollup.rollup).not.toHaveBeenCalled();
  });

  it('runRange: from/to không phải giờ tròn → Error, không mở transaction', async () => {
    await expect(
      service.runRange(
        'zone_hourly',
        T('2026-10-01T00:30:00Z'),
        T('2026-10-02T00:00:00Z'),
      ),
    ).rejects.toThrow();
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('runRange không liền watermark → KpiWatermarkGapError, rollback', async () => {
    watermarkRepo.get.mockResolvedValueOnce({
      coveredFrom: T('2026-10-05T00:00:00Z'),
      coveredUntil: T('2026-10-06T00:00:00Z'),
    });
    qr.query.mockResolvedValueOnce([{}]);
    await expect(
      service.runRange(
        'zone_hourly',
        T('2026-10-01T00:00:00Z'),
        T('2026-10-02T00:00:00Z'),
      ),
    ).rejects.toThrow('không liền');
    expect(zoneRollup.rollup).not.toHaveBeenCalled();
    expect(qr.rollbackTransaction).toHaveBeenCalled();
  });

  describe('runRange: `to` không được vượt giờ tròn hiện tại', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('to = giờ tròn kế tiếp (tương lai) → Error, không mở transaction', async () => {
      jest.useFakeTimers().setSystemTime(T('2026-10-05T10:37:00Z'));
      await expect(
        service.runRange(
          'zone_hourly',
          T('2026-10-05T09:00:00Z'),
          T('2026-10-05T11:00:00Z'),
        ),
      ).rejects.toThrow('vượt giờ tròn hiện tại');
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it('to = floorHour(now) đúng → được phép', async () => {
      jest.useFakeTimers().setSystemTime(T('2026-10-05T10:37:00Z'));
      qr.query.mockResolvedValueOnce([{}]);
      await service.runRange(
        'zone_hourly',
        T('2026-10-05T09:00:00Z'),
        T('2026-10-05T10:00:00Z'),
      );
      expect(zoneRollup.rollup).toHaveBeenCalledTimes(1);
      expect(qr.commitTransaction).toHaveBeenCalled();
    });
  });
});
