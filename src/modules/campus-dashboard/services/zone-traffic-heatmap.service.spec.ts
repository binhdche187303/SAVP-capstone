/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CampusDashboardRepository } from '../repositories/campus-dashboard.repository.js';
import { ZoneTrafficHeatmapService } from './zone-traffic-heatmap.service.js';

describe('ZoneTrafficHeatmapService (ZTH-001 / UC-120)', () => {
  let service: ZoneTrafficHeatmapService;
  let repoMock: any;
  let dataSourceMock: any;

  const zone = (over: any = {}): any => ({
    id: 'zone-1',
    zoneName: 'Sảnh A',
    building: 'Tòa A',
    floor: '1',
    ...over,
  });

  const build = () => {
    repoMock = { loadZoneHierarchy: jest.fn().mockResolvedValue([]) };
    dataSourceMock = { query: jest.fn().mockResolvedValue([]) };
  };

  const compile = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZoneTrafficHeatmapService,
        { provide: CampusDashboardRepository, useValue: repoMock },
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();
    service = module.get(ZoneTrafficHeatmapService);
  };

  beforeEach(async () => {
    build();
    await compile();
  });

  const from = new Date('2026-07-01T00:00:00Z');
  const to = new Date('2026-07-02T00:00:00Z');

  it('range >31 ngày → 400 INVALID_TRAFFIC_RANGE', async () => {
    const farTo = new Date('2026-09-30T00:00:00Z');
    await expect(service.getTraffic(from, farTo)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('không zone nào khớp filter → {series: [], heatmap: []}, KHÔNG query aggregate', async () => {
    const result = await service.getTraffic(from, to, 'Tòa X');
    expect(result).toEqual({ series: [], heatmap: [] });
    expect(dataSourceMock.query).not.toHaveBeenCalled();
  });

  it('relativeDensity: zone peak cao nhất = 1.0, zone thấp hơn tính đúng tỉ lệ', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([
      zone({ id: 'z1' }),
      zone({ id: 'z2', latitude: 21.0285, longitude: 105.8542 }),
    ]);
    dataSourceMock.query
      .mockResolvedValueOnce([]) // series
      .mockResolvedValueOnce([
        {
          zone_id: 'z1',
          avg_occupancy: '10',
          peak_occupancy: '20',
          peak_at: null,
        },
        {
          zone_id: 'z2',
          avg_occupancy: '5',
          peak_occupancy: '10',
          peak_at: null,
        },
      ]);

    const result = await service.getTraffic(from, to);
    const z1 = result.heatmap.find((h) => h.zoneId === 'z1')!;
    const z2 = result.heatmap.find((h) => h.zoneId === 'z2')!;
    expect(z1.relativeDensity).toBe(1);
    expect(z2.relativeDensity).toBe(0.5);
    // Zone chưa đặt vị trí → null; có toạ độ → {lat, lng}.
    expect(z1.coordinates).toBeNull();
    expect(z2.coordinates).toEqual({ lat: 21.0285, lng: 105.8542 });
  });

  it('tất cả peakOccupancy=0 → relativeDensity=0 cho tất cả (không NaN)', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([zone({ id: 'z1' })]);
    dataSourceMock.query.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        zone_id: 'z1',
        avg_occupancy: '0',
        peak_occupancy: '0',
        peak_at: null,
      },
    ]);

    const result = await service.getTraffic(from, to);
    expect(result.heatmap[0].relativeDensity).toBe(0);
    expect(Number.isNaN(result.heatmap[0].relativeDensity)).toBe(false);
  });

  it('series: map đúng cấu trúc TrafficSeriesPointDto', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([zone({ id: 'z1' })]);
    dataSourceMock.query
      .mockResolvedValueOnce([
        {
          zone_id: 'z1',
          hour_bucket: '2026-07-01T08:00:00.000Z',
          avg_occupancy: '12.5',
          peak_occupancy: '20',
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
    ]);
  });
});
