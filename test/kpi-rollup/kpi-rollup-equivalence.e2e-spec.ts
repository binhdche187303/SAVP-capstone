/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
import { AppDataSource } from '../../src/database/data-source';
import { ZoneTrafficHeatmapService } from '../../src/modules/campus-dashboard/services/zone-traffic-heatmap.service';
import { VehicleTrafficStatsService } from '../../src/modules/gate-access/services/vehicle-traffic-stats.service';
import { splitReadWindow } from '../../src/modules/kpi-rollup/utils/split-read-window.util';
import {
  BASE,
  HOURS,
  cleanupKpiFixture,
  hoursAfter,
  rollupAll,
  seedKpiFixture,
  type KpiFixture,
} from './fixtures';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

const WM = { coveredFrom: BASE, coveredUntil: hoursAfter(HOURS) };
const hybridWindow: any = {
  resolve: (_n: string, f: Date, t: Date) =>
    Promise.resolve(splitReadWindow(f, t, WM, true)),
};
const rawWindow: any = {
  resolve: (_n: string, f: Date, t: Date) =>
    Promise.resolve(splitReadWindow(f, t, null, false)),
};

/** Các cặp [from, to] (giờ, tính từ BASE): lẻ phút, giờ tròn, trong 1 giờ, vượt watermark, điểm. */
const CASES: Array<[number, number]> = [
  [0.2833, 50.7167], // 00:17 → 50:43
  [3, 9], // giờ tròn, to = 09:00 có event đúng biên (Review Focus #2)
  [2.1667, 2.8333], // trong cùng 1 giờ
  [-1, 73], // vượt cả 2 đầu watermark
  [10, 10], // điểm
  [2.25, 21], // biển 29A-999 ở mép raw (02:30) + phần agg (20:00) (Review Focus #4)
  [14, 17], // chứa trọn giờ 15 (hoà đỉnh 77 → peak_at = 15:54)
  [15.5, 20], // bắt đầu đúng 15:30: giờ hoà đỉnh bị cắt, nửa raw ở mép + phần agg
];

/** Các case rộng, dữ liệu fixture chắc chắn có ⇒ phải assert không rỗng (tránh so khớp rỗng = rỗng). */
const BROAD_CASES = new Set(['-1,73', '0.2833,50.7167']);

/** Query raw NGUYÊN BẢN trước KPI-001 (copy từ zone-traffic-heatmap.service.ts cũ). */
async function legacyHeatmap(
  zoneIds: string[],
  from: Date,
  to: Date,
): Promise<any[]> {
  return AppDataSource.query(
    `SELECT zone_id, AVG(occupancy_count) AS avg_occupancy, MAX(occupancy_count) AS peak_occupancy,
       (SELECT event_time FROM zone_presence_events e2
         WHERE e2.zone_id = e1.zone_id AND e2.event_type = 'count' AND e2.event_time BETWEEN $2 AND $3
         ORDER BY e2.occupancy_count DESC NULLS LAST, e2.event_time DESC LIMIT 1) AS peak_at
     FROM zone_presence_events e1
     WHERE zone_id = ANY($1::uuid[]) AND event_type = 'count' AND event_time BETWEEN $2 AND $3
     GROUP BY zone_id ORDER BY zone_id`,
    [zoneIds, from, to],
  );
}

/** Summary NGUYÊN BẢN trước KPI-001 (copy từ vehicle-traffic-stats.service.ts cũ). */
async function legacyVehicleSummary(
  from: Date,
  to: Date,
  vehicleType?: string,
): Promise<any> {
  const params: unknown[] = [from, to];
  let where = `event_type = 'ivss_vehicle_event' AND event_time >= $1 AND event_time <= $2`;
  if (vehicleType) {
    params.push(vehicleType);
    where += ` AND payload_json->>'vehicleType' = $3`;
  }
  const [r] = await AppDataSource.query(
    `SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE payload_json->>'matchState' = 'matched')::int AS matched,
       COUNT(*) FILTER (WHERE payload_json->>'matchState' = 'unmatched')::int AS unmatched,
       COUNT(*) FILTER (WHERE payload_json->>'direction' = 'enter')::int AS enter_count,
       COUNT(*) FILTER (WHERE payload_json->>'direction' = 'leave')::int AS leave_count,
       COUNT(*) FILTER (WHERE payload_json->>'direction' = 'seen')::int AS seen_count,
       COUNT(DISTINCT payload_json->>'plateNumber')::int AS unique_vehicles
     FROM iot_device_events WHERE ${where}`,
    params,
  );
  return {
    total_events: r.total,
    total_matched: r.matched,
    total_unmatched: r.unmatched,
    total_enter: r.enter_count,
    total_leave: r.leave_count,
    total_seen: r.seen_count,
    unique_vehicles: r.unique_vehicles,
  };
}

describeDb('KPI-001 so khớp đọc lai vs raw (T5, T8)', () => {
  let f: KpiFixture;
  let zones: any[];
  const zoneSvc = (w: any): ZoneTrafficHeatmapService =>
    new ZoneTrafficHeatmapService(
      { loadZoneHierarchy: () => Promise.resolve(zones) } as any,
      AppDataSource,
      w,
    );
  const vehSvc = (w: any): VehicleTrafficStatsService =>
    new VehicleTrafficStatsService(AppDataSource, w);

  const expectSameTraffic = (a: any, b: any): void => {
    expect(
      b.series.map((s: any) => [s.zoneId, s.hourBucket, s.peakOccupancy]),
    ).toEqual(
      a.series.map((s: any) => [s.zoneId, s.hourBucket, s.peakOccupancy]),
    );
    a.series.forEach((s: any, i: number) =>
      expect(b.series[i].avgOccupancy).toBeCloseTo(s.avgOccupancy, 9),
    );
    const sortH = (h: any[]): any[] =>
      [...h].sort((x, y) => (x.zoneId < y.zoneId ? -1 : 1));
    const ha = sortH(a.heatmap);
    const hb = sortH(b.heatmap);
    expect(
      hb.map((h: any) => [
        h.zoneId,
        h.peakOccupancy,
        h.peakAt,
        h.relativeDensity,
      ]),
    ).toEqual(
      ha.map((h: any) => [
        h.zoneId,
        h.peakOccupancy,
        h.peakAt,
        h.relativeDensity,
      ]),
    );
    ha.forEach((h: any, i: number) =>
      expect(hb[i].avgOccupancy).toBeCloseTo(h.avgOccupancy, 9),
    );
  };

  beforeAll(async () => {
    await AppDataSource.initialize();
    f = await seedKpiFixture(AppDataSource);
    zones = f.zoneIds.map((id, i) => ({
      id,
      zoneName: `KPI Zone ${'ABC'[i]}`,
      building: 'Tòa KPI',
      floor: '1',
    }));
    await rollupAll(AppDataSource, BASE, hoursAfter(HOURS));
  });

  afterAll(async () => {
    try {
      if (f) await cleanupKpiFixture(AppDataSource, f);
    } finally {
      if (AppDataSource.isInitialized) await AppDataSource.destroy();
    }
  });

  it.each(CASES)(
    'zone traffic [%s h, %s h]: hybrid = raw = query cũ',
    async (a, b) => {
      const from = hoursAfter(a);
      const to = hoursAfter(b);
      const hybrid = await zoneSvc(hybridWindow).getTraffic(from, to);
      const raw = await zoneSvc(rawWindow).getTraffic(from, to);
      expectSameTraffic(raw, hybrid);
      if (BROAD_CASES.has(`${a},${b}`)) {
        expect(raw.heatmap.length).toBeGreaterThan(0);
        expect(raw.series.length).toBeGreaterThan(0);
      }

      const legacy = await legacyHeatmap(f.zoneIds, from, to);
      expect(raw.heatmap.map((h: any) => h.zoneId).sort()).toEqual(
        legacy.map((l: any) => l.zone_id),
      );
      for (const l of legacy) {
        const h = raw.heatmap.find((x: any) => x.zoneId === l.zone_id)!;
        expect(h.avgOccupancy).toBeCloseTo(Number(l.avg_occupancy) || 0, 9);
        expect(h.peakOccupancy).toBe(Number(l.peak_occupancy) || 0);
        expect(h.peakAt).toBe(
          l.peak_at ? new Date(l.peak_at).toISOString() : null,
        );
      }
    },
  );

  it.each(CASES)(
    'vehicle stats [%s h, %s h]: hybrid = raw; summary = query cũ',
    async (a, b) => {
      const from = hoursAfter(a).toISOString();
      const to = hoursAfter(b).toISOString();
      for (const vehicleType of [undefined, 'car']) {
        for (const groupBy of ['hour', 'day'] as const) {
          const q = { from, to, vehicleType, groupBy };
          const hybrid = await vehSvc(hybridWindow).getStats(q);
          const raw = await vehSvc(rawWindow).getStats(q);
          expect(hybrid).toEqual(raw);
          if (a === -1 && b === 73) {
            expect(raw.series.length).toBeGreaterThan(0);
          }
        }
        const raw = await vehSvc(rawWindow).getStats({ from, to, vehicleType });
        expect(raw.summary).toEqual(
          await legacyVehicleSummary(new Date(from), new Date(to), vehicleType),
        );
      }
    },
  );

  it('bucket xe theo giờ VN: event trong giờ 00:xx UTC ngày 01/01 → bucket "2001-01-01 07:00"', async () => {
    const r = await vehSvc(rawWindow).getStats({
      from: hoursAfter(0).toISOString(),
      to: hoursAfter(0.99).toISOString(), // không chạm 01:00 UTC (= 08:00 VN)
      groupBy: 'hour',
    });
    expect(r.series.length).toBeGreaterThan(0);
    for (const s of r.series) expect(s.bucket).toBe('2001-01-01 07:00');
  });

  it('T8 — event đến muộn: lệch trước khi rollup lại, khớp sau khi rollup lại', async () => {
    await AppDataSource.query(
      `INSERT INTO zone_presence_events (zone_id, device_id, event_type, event_time, occupancy_count, source_type)
       VALUES ($1, $2, 'count', $3, 99, 'kpitest')`,
      [f.zoneIds[1], f.deviceId, hoursAfter(30.25)],
    );
    const from = hoursAfter(24);
    const to = hoursAfter(48);
    const before = await zoneSvc(hybridWindow).getTraffic(from, to);
    const raw = await zoneSvc(rawWindow).getTraffic(from, to);
    expect(
      before.heatmap.find((h: any) => h.zoneId === f.zoneIds[1])!.peakOccupancy,
    ).not.toBe(99);
    expect(
      raw.heatmap.find((h: any) => h.zoneId === f.zoneIds[1])!.peakOccupancy,
    ).toBe(99);

    await rollupAll(AppDataSource, hoursAfter(24), hoursAfter(48));
    expectSameTraffic(raw, await zoneSvc(hybridWindow).getTraffic(from, to));
  });
});
