/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CampusDashboardRepository } from '../repositories/campus-dashboard.repository.js';
import { KpiReadWindowService } from '../../kpi-rollup/services/kpi-read-window.service.js';
import { ZoneTrafficHeatmapService } from './zone-traffic-heatmap.service.js';

describe('ZoneTrafficHeatmapService — lọc nhóm camera + gom theo phút (họp 20/10)', () => {
  let service: ZoneTrafficHeatmapService;
  let repoMock: any;
  let dataSourceMock: any;
  let readWindowMock: any;
  const from = new Date('2026-07-01T08:00:00Z');
  const to = new Date('2026-07-01T09:00:00Z');
  const GROUP = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    repoMock = {
      loadZoneHierarchy: jest.fn().mockResolvedValue([{ id: 'zone-1', zoneName: 'Sảnh A', building: 'A', floor: '1' }]),
    };
    dataSourceMock = { query: jest.fn().mockResolvedValue([]) };
    readWindowMock = { resolve: jest.fn() };
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

  const sqls = (): string[] => dataSourceMock.query.mock.calls.map((c: any[]) => c[0] as string);

  it('bucket=minute: đọc raw (không qua rollup theo giờ) và gom theo phút', async () => {
    await service.getTraffic(from, to, undefined, undefined, { bucket: 'minute' });
    expect(readWindowMock.resolve).not.toHaveBeenCalled();
    expect(sqls().some((s) => s.includes("date_trunc('minute'"))).toBe(true);
    expect(sqls().every((s) => !s.includes('kpi_zone_hourly'))).toBe(true);
  });

  it('mặc định vẫn gom theo giờ và dùng rollup', async () => {
    readWindowMock.resolve.mockResolvedValue({ agg: null, raw: [{ from, to, toInclusive: true }] });
    await service.getTraffic(from, to);
    expect(readWindowMock.resolve).toHaveBeenCalled();
    expect(sqls().some((s) => s.includes("date_trunc('hour'"))).toBe(true);
    expect(sqls().every((s) => !s.includes('camera_group_members'))).toBe(true);
  });

  it('groupId: đọc raw và lọc device_id theo camera_group_members với tham số bind', async () => {
    await service.getTraffic(from, to, undefined, undefined, { groupId: GROUP });
    expect(readWindowMock.resolve).not.toHaveBeenCalled();
    expect(dataSourceMock.query).toHaveBeenCalledTimes(2);
    for (const [sql, params] of dataSourceMock.query.mock.calls) {
      expect(sql).toContain('camera_group_members WHERE group_id =');
      expect(params).toContain(GROUP);
      expect(sql).not.toContain(GROUP); // luôn bind, không nội suy
    }
  });

  it('bucket=minute với khoảng > 24 giờ → 400', async () => {
    await expect(
      service.getTraffic(from, new Date('2026-07-03T09:00:00Z'), undefined, undefined, { bucket: 'minute' }),
    ).rejects.toThrow(BadRequestException);
  });
});
