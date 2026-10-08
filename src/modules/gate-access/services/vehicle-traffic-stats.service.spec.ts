/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { BadRequestException } from '@nestjs/common';
import { VehicleTrafficStatsService } from './vehicle-traffic-stats.service.js';

describe('VehicleTrafficStatsService (VTS-001 / UC-114 + KPI-001)', () => {
  let service: VehicleTrafficStatsService;
  let query: jest.Mock;
  let readWindow: any;
  const from = '2026-07-01T00:00:00Z';
  const to = '2026-07-31T23:59:59Z';
  const allRaw = {
    agg: null,
    raw: [{ from: new Date(from), to: new Date(to), toInclusive: true }],
  };
  const withAgg = {
    agg: {
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-31T23:00:00Z'),
    },
    raw: [
      {
        from: new Date('2026-07-31T23:00:00Z'),
        to: new Date(to),
        toInclusive: true,
      },
    ],
  };

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    readWindow = { resolve: jest.fn().mockResolvedValue(allRaw) };
    service = new VehicleTrafficStatsService(
      { manager: { query } } as any,
      readWindow,
    );
  });

  it('from > to → 400 INVALID_DATE_RANGE, KHÔNG query', async () => {
    await expect(
      service.getStats({
        from: '2026-07-31T00:00:00Z',
        to: '2026-07-01T00:00:00Z',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('resolve với vehicle_hourly + Date(from/to); 3 query summary → unique → series', async () => {
    await service.getStats({ from, to });
    expect(readWindow.resolve).toHaveBeenCalledWith(
      'vehicle_hourly',
      new Date(from),
      new Date(to),
    );
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[1][0]).toContain('COUNT(DISTINCT plate)');
  });

  it('phần raw: event_type là điều kiện WHERE đầu tiên trong mọi query', async () => {
    await service.getStats({ from, to });
    for (const [sql] of query.mock.calls) {
      expect(sql).toMatch(
        /FROM iot_device_events\s+WHERE event_type = 'ivss_vehicle_event' AND/,
      );
    }
  });

  it('toàn raw → KHÔNG đụng bảng kpi_*', async () => {
    await service.getStats({ from, to });
    for (const [sql] of query.mock.calls)
      expect(sql).not.toContain('kpi_vehicle');
  });

  it('có agg → summary/series đọc kpi_vehicle_hourly, unique đọc kpi_vehicle_plate_hourly', async () => {
    readWindow.resolve.mockResolvedValue(withAgg);
    await service.getStats({ from, to });
    expect(query.mock.calls[0][0]).toContain('kpi_vehicle_hourly');
    expect(query.mock.calls[1][0]).toContain('kpi_vehicle_plate_hourly');
    expect(query.mock.calls[2][0]).toContain('kpi_vehicle_hourly');
  });

  it('filter zoneId/vehicleType áp cho cả agg (cột) và raw (payload), giá trị bind tham số', async () => {
    readWindow.resolve.mockResolvedValue(withAgg);
    await service.getStats({ from, to, zoneId: 'z1', vehicleType: 'car' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/vehicle_type = \$\d+/);
    expect(sql).toMatch(/payload_json->>'vehicleType' = \$\d+/);
    expect(sql).not.toContain("'car'");
    expect(params).toEqual(expect.arrayContaining(['z1', 'car']));
  });

  it('không filter → không có điều kiện zone_id/vehicleType', async () => {
    await service.getStats({ from, to });
    const sql = query.mock.calls[0][0] as string;
    expect(sql).not.toContain('zone_id =');
    expect(sql).not.toContain("payload_json->>'vehicleType' =");
  });

  it('bucket theo giờ VN (KPI-001 D9): hour / day', async () => {
    await service.getStats({ from, to, groupBy: 'hour' } as any);
    expect(query.mock.calls[2][0]).toContain(
      "to_char(event_time AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:00')",
    );
    query.mockClear();
    await service.getStats({ from, to });
    expect(query.mock.calls[2][0]).toContain(
      "to_char(event_time AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')",
    );
  });

  it('không dữ liệu → summary toàn 0, series rỗng', async () => {
    const r = await service.getStats({ from, to });
    expect(r.summary).toEqual({
      total_events: 0,
      total_matched: 0,
      total_unmatched: 0,
      total_enter: 0,
      total_leave: 0,
      total_seen: 0,
      unique_vehicles: 0,
    });
    expect(r.series).toEqual([]);
  });

  it('map summary + unique + pivot series', async () => {
    query
      .mockResolvedValueOnce([
        {
          total: 100,
          matched: 80,
          unmatched: 20,
          enter_count: 45,
          leave_count: 40,
          seen_count: 15,
        },
      ])
      .mockResolvedValueOnce([{ unique_vehicles: 30 }])
      .mockResolvedValueOnce([
        { bucket: '2026-07-01', direction: 'enter', cnt: 5 },
        { bucket: '2026-07-02', direction: 'leave', cnt: 3 },
        { bucket: '2026-07-02', direction: 'seen', cnt: 1 },
      ]);
    const r = await service.getStats({ from, to });
    expect(r.summary).toEqual({
      total_events: 100,
      total_matched: 80,
      total_unmatched: 20,
      total_enter: 45,
      total_leave: 40,
      total_seen: 15,
      unique_vehicles: 30,
    });
    expect(r.series).toEqual([
      { bucket: '2026-07-01', enter: 5, leave: 0, seen: 0 },
      { bucket: '2026-07-02', enter: 0, leave: 3, seen: 1 },
    ]);
  });
});
