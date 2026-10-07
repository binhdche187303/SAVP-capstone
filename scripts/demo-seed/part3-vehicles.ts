import { db, insertTracked, pick, randInt, trackedIds } from './lib';
import {
  UNKNOWN_PLATES,
  controlPlate,
  plateRaw,
  registeredPlates,
} from './plates';

/**
 * PHẦN 3 — phương tiện: đăng ký xe của nhân viên, danh sách kiểm soát biển số
 * (blocklist/watchlist), lượt xe qua cổng ANPR (iot_device_events 'ivss_vehicle_event' — payload
 * giống vehicle-resolve.service) + tổng hợp kpi_vehicle_hourly / kpi_vehicle_plate_hourly cho
 * zone demo (purge xoá theo zone — bảng id bigint không vào registry được).
 */

export const PART = 'part3';

const DAYS = 14;
/** Theo part1: cổng chính, cổng phụ, bãi xe. */
const GATE_ZONES = [0, 1, 9];
const CHANNEL_IN = 801;
const CHANNEL_OUT = 802;

const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

function vnDate(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toLocaleDateString(
    'en-CA',
    { timeZone: 'Asia/Ho_Chi_Minh' },
  );
}

const at = (date: string, hh: number, mm: number) =>
  new Date(
    `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+07:00`,
  );

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00+07:00`).getUTCDay();
  return day === 0 || day === 6;
}

export async function seedPart3(log: (m: string) => void): Promise<void> {
  const users = await trackedIds('users');
  const zones = await trackedIds('zones');
  const devices = await trackedIds('iot_devices');
  const now = new Date();

  // ── 1. Đăng ký xe: 2/3 nhân viên có xe, vài người 2 xe, vài xe bị vô hiệu ──
  const regs = registeredPlates();
  const regIds = await insertTracked(
    PART,
    'vehicle_registrations',
    regs.map((r, k) => ({
      user_id: users[r.userIdx],
      plate_number: r.plate,
      plate_raw: plateRaw(r.plate),
      vehicle_type: r.type,
      note: r.type === 'car' ? 'Ô tô cá nhân' : 'Xe máy',
      status: k % 9 === 8 ? 'disabled' : 'active',
    })),
  );
  log(`  ✔ ${regIds.length} đăng ký xe`);

  // ── 2. Danh sách kiểm soát biển số ─────────────────────────────────────
  const controlPlates = [
    ['blocklist', 'Xe từng gây sự cố an ninh'],
    ['blocklist', 'Xe nhà thầu đã chấm dứt hợp đồng'],
    ['blocklist', 'Biển số giả mạo đã báo công an'],
    ['watchlist', 'Xe khách thường xuyên, cần theo dõi'],
    ['watchlist', 'Xe giao hàng ngoài giờ'],
    ['watchlist', 'Xe đối tác — báo bảo vệ khi đến'],
  ].map(([listType, reason], i) => ({
    plate: controlPlate(i),
    listType,
    reason,
  }));
  const clIds = await insertTracked(
    PART,
    'vehicle_control_list',
    controlPlates.map((c, i) => ({
      plate_number: c.plate,
      plate_raw: plateRaw(c.plate),
      list_type: c.listType,
      reason: c.reason,
      active: i !== 2,
      created_by: users[5],
    })),
  );
  log(`  ✔ ${clIds.length} biển số trong danh sách kiểm soát`);

  // ── 3. Lượt xe qua cổng ────────────────────────────────────────────────
  const events: Record<string, unknown>[] = [];
  const ev = (
    p: string,
    userId: string | null,
    vehicleType: string,
    direction: 'enter' | 'leave',
    time: Date,
  ) => {
    if (time > now) return;
    const z = GATE_ZONES[direction === 'enter' ? randInt(0, 2) : 2];
    const channelId = direction === 'enter' ? CHANNEL_IN : CHANNEL_OUT;
    events.push({
      device_id: devices[z],
      zone_id: zones[z],
      event_type: 'ivss_vehicle_event',
      event_time: time,
      source_protocol: 'ivss',
      severity: 'info',
      processed_status: userId ? 'processed' : 'unmatched',
      payload_json: {
        plateRaw: plateRaw(p),
        plateNumber: p,
        userId,
        channelId,
        direction,
        gateDirection: direction,
        matchState: userId ? 'matched' : 'unmatched',
        eventActionRaw: null,
        plateColor: pick(['white', 'white', 'yellow', 'blue']),
        vehicleColor: pick(['black', 'white', 'silver', 'red', 'blue']),
        vehicleType,
        utc: time.toISOString(),
        receivedAt: time.toISOString(),
        gateLogSkipped: null,
        rawReads: [p],
        demo: true,
      },
    });
  };
  for (let offset = -DAYS; offset <= 0; offset++) {
    const date = vnDate(offset);
    const weekend = isWeekend(date);
    regs.forEach((r, k) => {
      if (weekend || k % 9 === 8 || Math.random() < 0.15) return;
      ev(
        r.plate,
        users[r.userIdx],
        r.type,
        'enter',
        at(date, randInt(7, 8), randInt(0, 59)),
      );
      ev(
        r.plate,
        users[r.userIdx],
        r.type,
        'leave',
        at(date, randInt(17, 18), randInt(0, 59)),
      );
    });
    // Xe lạ (khách, giao hàng) — vào rồi ra sau 30-120 phút
    for (let n = 0; n < (weekend ? 2 : randInt(5, 10)); n++) {
      const p = pick(UNKNOWN_PLATES);
      const t = at(date, randInt(8, 17), randInt(0, 59));
      const type = pick(['car', 'car', 'motorbike', 'truck']);
      ev(p, null, type, 'enter', t);
      ev(p, null, type, 'leave', addMin(t, randInt(30, 120)));
    }
    // Xe trong danh sách kiểm soát thỉnh thoảng xuất hiện
    if (Math.random() < 0.35) {
      const c = pick(controlPlates);
      ev(
        c.plate,
        null,
        'car',
        'enter',
        at(date, randInt(9, 20), randInt(0, 59)),
      );
    }
  }
  const evIds = await insertTracked(PART, 'iot_device_events', events);
  log(`  ✔ ${evIds.length} lượt xe qua cổng (ANPR)`);

  // Tổng hợp theo giờ — y hệt vehicle-hourly-rollup, chỉ cho zone demo
  await db.query(
    `INSERT INTO kpi_vehicle_hourly
       (bucket_hour, zone_id, vehicle_type, direction, match_state, event_count)
     SELECT date_trunc('hour', event_time, 'UTC'), zone_id,
            payload_json->>'vehicleType', payload_json->>'direction',
            payload_json->>'matchState', COUNT(*)
     FROM iot_device_events
     WHERE event_type = 'ivss_vehicle_event' AND zone_id = ANY($1::uuid[])
     GROUP BY 1, 2, 3, 4, 5`,
    [zones],
  );
  await db.query(
    `INSERT INTO kpi_vehicle_plate_hourly (bucket_hour, zone_id, vehicle_type, plate_number)
     SELECT DISTINCT date_trunc('hour', event_time, 'UTC'), zone_id,
            payload_json->>'vehicleType', payload_json->>'plateNumber'
     FROM iot_device_events
     WHERE event_type = 'ivss_vehicle_event' AND zone_id = ANY($1::uuid[])
       AND payload_json->>'plateNumber' IS NOT NULL`,
    [zones],
  );
  log(`  ✔ tổng hợp xe theo giờ (kpi_vehicle_*)`);
}
