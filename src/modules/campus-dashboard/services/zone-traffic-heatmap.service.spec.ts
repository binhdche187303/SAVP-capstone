/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CampusDashboardRepository } from '../repositories/campus-dashboard.repository.js';
import { KpiReadWindowService } from '../../kpi-rollup/services/kpi-read-window.service.js';
import { ZoneTrafficHeatmapService } from './zone-traffic-heatmap.service.js';

describe('ZoneTrafficHeatmapService (ZTH-001 / UC-120 + KPI-001)', () => {
  let service: ZoneTrafficHeatmapService;
  let repoMock: any;
  let dataSourceMock: any;
  let readWindowMock: any;

  const zone = (over: any = {}): any => ({
    id: 'zone-1',
    zoneName: 'Sảnh A',
    building: 'Tòa A',
    floor: '1',
    ...over,
  });

  const from = new Date('2026-07-01T00:00:00Z');
  const to = new Date('2026-07-02T00:00:00Z');
  const allRaw = { agg: null, raw: [{ from, to, toInclusive: true }] };

  beforeEach(async () => {
    repoMock = { loadZoneHierarchy: jest.fn().mockResolvedValue([]) };
    dataSourceMock = { query: jest.fn().mockResolvedValue([]) };
    readWindowMock = { resolve: jest.fn().mockResolvedValue(allRaw) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZoneTrafficHeatmapService,
        { provide: CampusDashboardRepository, useValue: repoMock },
        { provide: DataSource, useValue: dataSourceMock },
        { provide: KpiReadWindowService, useValue: readWindowMock },
      ],
    }).compile();
    service = module.get(ZoneTrafficHeatmapService);
  });

  it('range >31 ngày → 400 INVALID_TRAFFIC_RANGE', async () => {
    await expect(
      service.getTraffic(from, new Date('2026-09-30T00:00:00Z')),
    ).rejects.toThrow(BadRequestException);
  });

  it('không zone nào khớp filter → {series: [], heatmap: []}, KHÔNG query', async () => {
    expect(await service.getTraffic(from, to, 'Tòa X')).toEqual({
      series: [],
      heatmap: [],
    });
    expect(dataSourceMock.query).not.toHaveBeenCalled();
  });

  it('toàn raw → 2 query (series, heatmap raw), KHÔNG đụng kpi_zone_hourly', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([zone()]);
    await service.getTraffic(from, to);
    expect(readWindowMock.resolve).toHaveBeenCalledWith(
      'zone_hourly',
      from,
      to,
    );
    expect(dataSourceMock.query).toHaveBeenCalledTimes(2);
    for (const [sql] of dataSourceMock.query.mock.calls) {
      expect(sql).not.toContain('kpi_zone_hourly');
    }
  });

  it('có phần agg → series UNION ALL kpi_zone_hourly + query heatmap agg riêng', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([zone()]);
    readWindowMock.resolve.mockResolvedValue({
      agg: {
        from: new Date('2026-07-01T01:00:00Z'),
        to: new Date('2026-07-01T23:00:00Z'),
      },
      raw: [
        { from, to: new Date('2026-07-01T01:00:00Z'), toInclusive: false },
        { from: new Date('2026-07-01T23:00:00Z'), to, toInclusive: true },
      ],
    });
    await service.getTraffic(from, to);
    const sqls = dataSourceMock.query.mock.calls.map(
      (c: any[]) => c[0] as string,
    );
    expect(sqls[0]).toContain('UNION ALL');
    expect(sqls[0]).toContain('kpi_zone_hourly');
    expect(
      sqls.filter((s: string) => s.includes('kpi_zone_hourly')),
    ).toHaveLength(2);
    expect(dataSourceMock.query).toHaveBeenCalledTimes(3);
  });

  it('relativeDensity: zone peak cao nhất = 1.0, zone thấp hơn đúng tỉ lệ', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([
      zone({ id: 'z1' }),
      zone({ id: 'z2', latitude: 21.0285, longitude: 105.8542 }),
    ]);
    dataSourceMock.query
      .mockResolvedValueOnce([]) // series
      .mockResolvedValueOnce([
        {
          zone_id: 'z1',
          event_count: '2',
          occupancy_sum: '20',
          sample_count: '2',
          peak_occupancy: 20,
          peak_at: null,
        },
        {
          zone_id: 'z2',
          event_count: '2',
          occupancy_sum: '10',
          sample_count: '2',
          peak_occupancy: 10,
          peak_at: null,
        },
      ]);
    const result = await service.getTraffic(from, to);
    const z1 = result.heatmap.find((h) => h.zoneId === 'z1')!;
    const z2 = result.heatmap.find((h) => h.zoneId === 'z2')!;
    expect(z1.relativeDensity).toBe(1);
    expect(z2.relativeDensity).toBe(0.5);
    expect(z1.avgOccupancy).toBe(10);
    // Zone chưa đặt vị trí → null; có toạ độ → {lat, lng}.
    expect(z1.coordinates).toBeNull();
    expect(z2.coordinates).toEqual({ lat: 21.0285, lng: 105.8542 });
  });

  it('tất cả peak=0 → relativeDensity=0 (không NaN)', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([zone({ id: 'z1' })]);
    dataSourceMock.query.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        zone_id: 'z1',
        event_count: '1',
        occupancy_sum: '0',
        sample_count: '1',
        peak_occupancy: 0,
        peak_at: null,
      },
    ]);
    const result = await service.getTraffic(from, to);
    expect(result.heatmap[0].relativeDensity).toBe(0);
  });

  it('series: avg = sum/sample; sample=0 → avg 0, peak NULL → 0', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([zone({ id: 'z1' })]);
    dataSourceMock.query
      .mockResolvedValueOnce([
        {
          zone_id: 'z1',
          hour_bucket: '2026-07-01T08:00:00.000Z',
          occupancy_sum: '25',
          sample_count: '2',
          peak_occupancy: 20,
        },
        {
          zone_id: 'z1',
          hour_bucket: '2026-07-01T09:00:00.000Z',
          occupancy_sum: '0',
          sample_count: '0',
          peak_occupancy: null,
        },
      ])
      .mockResolvedValueOnce([]);
    const result = await service.getTraffic(from, to);
    expect(result.series).toEqual([
      {
        zoneId: 'z1',
        hourBucket: '2026-07-01T08:00:00.000Z',
        avgOccupancy: 12.5,
        peakOccupancy: 20,
      },
      {
        zoneId: 'z1',
        hourBucket: '2026-07-01T09:00:00.000Z',
        avgOccupancy: 0,
        peakOccupancy: 0,
      },
    ]);
  });
});
