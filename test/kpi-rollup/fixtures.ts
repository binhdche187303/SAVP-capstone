import type { DataSource } from 'typeorm';
import { ZoneHourlyRollupService } from '../../src/modules/kpi-rollup/services/zone-hourly-rollup.service';
import { VehicleHourlyRollupService } from '../../src/modules/kpi-rollup/services/vehicle-hourly-rollup.service';

/** Dữ liệu test nằm ở năm 2001 để không lẫn dữ liệu dev thật. */
export const BASE = new Date('2001-01-01T00:00:00Z');
export const HOURS = 72;
export const hoursAfter = (h: number): Date =>
  new Date(BASE.getTime() + h * 3_600_000);

export interface KpiFixture {
  zoneIds: string[]; // [A, B, C] — C chỉ có event occupancy NULL
  deviceId: string;
  tag: string;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export async function seedKpiFixture(ds: DataSource): Promise<KpiFixture> {
  const tag = `KPITEST-${Date.now()}`;
  const zoneIds: string[] = [];
  for (const suffix of ['A', 'B', 'C']) {
    const rows: Array<{ id: string }> = await ds.query(
      `INSERT INTO zones (zone_code, zone_name, building, floor)
       VALUES ($1, $2, 'Tòa KPI', '1') RETURNING id`,
      [`${tag}-${suffix}`, `KPI Zone ${suffix}`],
    );
    zoneIds.push(rows[0].id);
  }
  const dev: Array<{ id: string }> = await ds.query(
    `INSERT INTO iot_devices (device_code, device_name, device_type)
     VALUES ($1, 'KPI test cam', 'room_camera') RETURNING id`,
    [tag],
  );
  const deviceId = dev[0].id;
  const rnd = lcg(42);

  // Zone events
  const zZone: string[] = [];
  const zTime: Date[] = [];
  const zOcc: Array<number | null> = [];
  const pushZ = (zone: string, t: Date, occ: number | null): void => {
    zZone.push(zone);
    zTime.push(t);
    zOcc.push(occ);
  };
  for (const zone of zoneIds.slice(0, 2)) {
    for (let i = 0; i < 400; i++) {
      pushZ(
        zone,
        hoursAfter(rnd() * HOURS),
        rnd() < 0.1 ? null : Math.floor(rnd() * 30),
      );
    }
  }
  pushZ(zoneIds[0], hoursAfter(5), 50); // đúng giờ tròn 05:00 (Review Focus #2)
  pushZ(zoneIds[0], hoursAfter(9), 7); // đúng 09:00 = `to` của 1 case so khớp
  pushZ(zoneIds[0], hoursAfter(40.25), 50); // hoà đỉnh 50, muộn hơn ⇒ phải thắng (Review Focus #3)
  // Hoà đỉnh trong CÙNG 1 giờ (non-NULL): event_time DESC phải chọn event muộn hơn làm peak_at
  pushZ(zoneIds[1], hoursAfter(15.1), 77);
  pushZ(zoneIds[1], hoursAfter(15.9), 77);
  pushZ(zoneIds[0], hoursAfter(33.2), 88);
  pushZ(zoneIds[0], hoursAfter(33.8), 88);
  pushZ(zoneIds[2], hoursAfter(61.1), null); // zone C: giờ toàn NULL
  pushZ(zoneIds[2], hoursAfter(61.2), null);
  pushZ(zoneIds[2], hoursAfter(61.3), null);
  await ds.query(
    `INSERT INTO zone_presence_events (zone_id, device_id, event_type, event_time, occupancy_count, source_type)
     SELECT z, $1, 'count', t, o, 'kpitest'
     FROM unnest($2::uuid[], $3::timestamptz[], $4::int[]) AS u(z, t, o)`,
    [deviceId, zZone, zTime, zOcc],
  );

  // Vehicle events
  const dirs = ['enter', 'leave', 'seen', null];
  const states = ['matched', 'unmatched'];
  const types = ['car', 'motorbike'];
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const vTime: Date[] = [];
  const vPayload: string[] = [];
  const pushV = (t: Date, p: Record<string, unknown>): void => {
    vTime.push(t);
    vPayload.push(JSON.stringify(p));
  };
  for (let i = 0; i < 300; i++) {
    pushV(hoursAfter(rnd() * HOURS), {
      direction: pick(dirs),
      matchState: pick(states),
      vehicleType: pick(types),
      plateNumber:
        rnd() < 0.1
          ? null
          : `29A-${String(Math.floor(rnd() * 20)).padStart(3, '0')}`,
    });
  }
  // Cùng biển ở phần raw (02:30) và phần agg (20:00) ⇒ unique đếm 1 lần (Review Focus #4)
  pushV(hoursAfter(2.5), {
    direction: 'enter',
    matchState: 'matched',
    vehicleType: 'car',
    plateNumber: '29A-999',
  });
  pushV(hoursAfter(20), {
    direction: 'leave',
    matchState: 'matched',
    vehicleType: 'car',
    plateNumber: '29A-999',
  });
  pushV(hoursAfter(9), {
    direction: 'enter',
    matchState: 'unmatched',
    vehicleType: 'car',
    plateNumber: '30F-111',
  });
  await ds.query(
    `INSERT INTO iot_device_events (device_id, event_type, event_time, payload_json)
     SELECT $1, 'ivss_vehicle_event', t, p
     FROM unnest($2::timestamptz[], $3::jsonb[]) AS u(t, p)`,
    [deviceId, vTime, vPayload],
  );

  return { zoneIds, deviceId, tag };
}

export async function rollupAll(
  ds: DataSource,
  from: Date,
  to: Date,
): Promise<void> {
  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    await new ZoneHourlyRollupService().rollup(qr, from, to);
    await new VehicleHourlyRollupService().rollup(qr, from, to);
    await qr.commitTransaction();
  } catch (e) {
    await qr.rollbackTransaction();
    throw e;
  } finally {
    await qr.release();
  }
}

export async function cleanupKpiFixture(
  ds: DataSource,
  f: KpiFixture,
): Promise<void> {
  const lo = hoursAfter(-24);
  const hi = hoursAfter(HOURS + 24);
  await ds.query(
    `DELETE FROM kpi_zone_hourly WHERE zone_id = ANY($1::uuid[])`,
    [f.zoneIds],
  );
  await ds.query(
    `DELETE FROM kpi_vehicle_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
    [lo, hi],
  );
  await ds.query(
    `DELETE FROM kpi_vehicle_plate_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
    [lo, hi],
  );
  await ds.query(`DELETE FROM zone_presence_events WHERE device_id = $1`, [
    f.deviceId,
  ]);
  await ds.query(`DELETE FROM iot_device_events WHERE device_id = $1`, [
    f.deviceId,
  ]);
  await ds.query(`DELETE FROM iot_devices WHERE id = $1`, [f.deviceId]);
  await ds.query(`DELETE FROM zones WHERE id = ANY($1::uuid[])`, [f.zoneIds]);
}
