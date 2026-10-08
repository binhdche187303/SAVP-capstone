/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { KpiReadWindowService } from './kpi-read-window.service.js';

const T = (iso: string): Date => new Date(iso);

describe('KpiReadWindowService (KPI-001 §5.4)', () => {
  const from = T('2026-10-02T08:17:00Z');
  const to = T('2026-10-02T12:43:00Z');
  const wm = {
    coveredFrom: T('2026-10-01T00:00:00Z'),
    coveredUntil: T('2026-10-05T00:00:00Z'),
  };
  const cfg = (enabled?: boolean): any => ({
    get: (_k: string, d: unknown) => (enabled === undefined ? d : enabled),
  });

  it('mặc định bật: có watermark → có phần agg', async () => {
    const repo = { get: jest.fn(async () => wm) };
    const s = new KpiReadWindowService(repo as any, cfg());
    const r = await s.resolve('zone_hourly', from, to);
    expect(r.agg).toEqual({
      from: T('2026-10-02T09:00:00Z'),
      to: T('2026-10-02T12:00:00Z'),
    });
    expect(repo.get).toHaveBeenCalledWith('zone_hourly');
  });

  it('KPI_ROLLUP_READ_ENABLED=false → toàn raw, KHÔNG đọc watermark', async () => {
    const repo = { get: jest.fn(async () => wm) };
    const s = new KpiReadWindowService(repo as any, cfg(false));
    const r = await s.resolve('zone_hourly', from, to);
    expect(r).toEqual({ agg: null, raw: [{ from, to, toInclusive: true }] });
    expect(repo.get).not.toHaveBeenCalled();
  });

  it('đọc watermark lỗi (bảng chưa migrate) → toàn raw, KHÔNG ném (Review Focus #1)', async () => {
    const repo = {
      get: jest.fn(async () => {
        throw new Error('relation "kpi_rollup_watermarks" does not exist');
      }),
    };
    const s = new KpiReadWindowService(repo as any, cfg());
    await expect(s.resolve('vehicle_hourly', from, to)).resolves.toEqual({
      agg: null,
      raw: [{ from, to, toInclusive: true }],
    });
  });
});
