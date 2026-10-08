/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { AppDataSource } from '../../src/database/data-source';
import { acquireRollupLock } from '../../src/modules/kpi-rollup/utils/rollup-lock.util';
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

describeDb('KPI-001 rollup trên DB thật', () => {
  let f: KpiFixture;
  const end = hoursAfter(HOURS);

  const snapshot = async (): Promise<unknown[]> => [
    await AppDataSource.query(
      `SELECT zone_id, bucket_hour, event_count, sample_count, occupancy_sum, occupancy_peak, peak_at
       FROM kpi_zone_hourly WHERE zone_id = ANY($1::uuid[]) ORDER BY 1, 2`,
      [f.zoneIds],
    ),
    await AppDataSource.query(
      `SELECT bucket_hour, zone_id, vehicle_type, direction, match_state, event_count
       FROM kpi_vehicle_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2
       ORDER BY 1, 2, 3, 4, 5`,
      [BASE, end],
    ),
    await AppDataSource.query(
      `SELECT bucket_hour, zone_id, vehicle_type, plate_number
       FROM kpi_vehicle_plate_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2
       ORDER BY 1, 2, 3, 4`,
      [BASE, end],
    ),
  ];

  beforeAll(async () => {
    await AppDataSource.initialize();
    f = await seedKpiFixture(AppDataSource);
    await rollupAll(AppDataSource, BASE, end);
  });

  afterAll(async () => {
    try {
      if (f) await cleanupKpiFixture(AppDataSource, f);
    } finally {
      if (AppDataSource.isInitialized) await AppDataSource.destroy();
    }
  });

  it('T6 — rollup cùng cửa sổ 2 lần → bảng tổng hợp y hệt', async () => {
    const first = await snapshot();
    await rollupAll(AppDataSource, BASE, end);
    expect(await snapshot()).toEqual(first);
  });

  it('tổng event_count = số event raw (zone & xe)', async () => {
    const [z] = await AppDataSource.query(
      `SELECT
         (SELECT COALESCE(SUM(event_count),0)::int FROM kpi_zone_hourly WHERE zone_id = ANY($1::uuid[])) AS agg,
         (SELECT COUNT(*)::int FROM zone_presence_events WHERE zone_id = ANY($1::uuid[]) AND event_type = 'count') AS raw`,
      [f.zoneIds],
    );
    expect(z.agg).toBe(z.raw);
    const [v] = await AppDataSource.query(
      `SELECT
         (SELECT COALESCE(SUM(event_count),0)::int FROM kpi_vehicle_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2) AS agg,
         (SELECT COUNT(*)::int FROM iot_device_events WHERE device_id = $3) AS raw`,
      [BASE, end, f.deviceId],
    );
    expect(v.agg).toBe(v.raw);
  });

  it('zone C giờ toàn NULL → sample_count=0, sum=0, peak NULL, peak_at = event muộn nhất (Review Focus #3)', async () => {
    const rows = await AppDataSource.query(
      `SELECT event_count, sample_count, occupancy_sum, occupancy_peak, peak_at
       FROM kpi_zone_hourly WHERE zone_id = $1`,
      [f.zoneIds[2]],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event_count).toBe(3);
    expect(rows[0].sample_count).toBe(0);
    expect(Number(rows[0].occupancy_sum)).toBe(0);
    expect(rows[0].occupancy_peak).toBeNull();
    expect(new Date(rows[0].peak_at)).toEqual(hoursAfter(61.3));
  });

  it('hoà đỉnh non-NULL trong cùng giờ → peak_at là event muộn hơn (event_time DESC)', async () => {
    const peakAt = async (zone: string, hour: number): Promise<Date> => {
      const rows = await AppDataSource.query(
        `SELECT peak_at FROM kpi_zone_hourly WHERE zone_id = $1 AND bucket_hour = $2`,
        [zone, hoursAfter(hour)],
      );
      expect(rows).toHaveLength(1);
      return new Date(rows[0].peak_at);
    };
    expect(await peakAt(f.zoneIds[1], 15)).toEqual(hoursAfter(15.9));
    expect(await peakAt(f.zoneIds[0], 33)).toEqual(hoursAfter(33.8));
  });

  it('T7 — lock: transaction thứ 2 không lấy được khi transaction 1 đang giữ', async () => {
    const qr1 = AppDataSource.createQueryRunner();
    const qr2 = AppDataSource.createQueryRunner();
    await qr1.connect();
    await qr2.connect();
    await qr1.startTransaction();
    await qr2.startTransaction();
    try {
      expect(await acquireRollupLock(qr1, false)).toBe(true);
      expect(await acquireRollupLock(qr2, false)).toBe(false);
    } finally {
      await qr1.rollbackTransaction();
      await qr2.rollbackTransaction();
      await qr1.release();
      await qr2.release();
    }
  });
});
