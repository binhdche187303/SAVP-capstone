import { DataSource } from 'typeorm';
import { RTAG, ReportFixture } from './fixtures';

export interface RoomFixture { rooms: Record<'R1' | 'R2' | 'R3' | 'R4', string> }

export async function cleanupRoomSecurityFixture(ds: DataSource): Promise<void> {
  await ds.query(`DELETE FROM security_alerts WHERE dedupe_key LIKE '${RTAG}-%'`);
  await ds.query(`DELETE FROM no_show_cases WHERE room_id IN (SELECT id FROM rooms WHERE room_code LIKE '${RTAG}-%')`);
  await ds.query(`DELETE FROM room_booking_usages WHERE room_id IN (SELECT id FROM rooms WHERE room_code LIKE '${RTAG}-%')`);
  await ds.query(`DELETE FROM room_bookings WHERE room_id IN (SELECT id FROM rooms WHERE room_code LIKE '${RTAG}-%')`);
  await ds.query(`DELETE FROM meetings WHERE meeting_code LIKE '${RTAG}-%'`);
  await ds.query(`DELETE FROM rooms WHERE room_code LIKE '${RTAG}-%'`);
}

/**
 * 4 phòng, 2 tòa (A1: R1,R2 · B2: R3,R4), 12 cuộc họp. Số liệu biết trước:
 * R1 3 họp × 2h đặt, dùng 1,5h mỗi họp, 1 không đến · R2 2 × 2h dùng đủ · R3 3 × 1h dùng 0,5h, 1 không đến (14/9) · R4 4 × 1h dùng đủ (15/9).
 * Tổng 12 họp, đặt 17h, dùng 14h, 2 không đến. Giờ dùng theo ngày VN: 14/9 = 10h, 15/9 = 4h.
 */
export async function seedRoomFixture(ds: DataSource, fx: ReportFixture): Promise<RoomFixture> {
  await cleanupRoomSecurityFixture(ds);
  const rooms = {} as RoomFixture['rooms'];
  for (const [code, building] of [['R1', 'A1'], ['R2', 'A1'], ['R3', 'B2'], ['R4', 'B2']] as const) {
    rooms[code] = (await ds.query(
      `INSERT INTO rooms (room_code, room_name, site_name, capacity) VALUES ($1,$2,$3,20) RETURNING id`,
      [`${RTAG}-${code}`, `${RTAG} Phòng ${code}`, building]))[0].id;
  }
  let seq = 0;
  const booking = async (room: keyof typeof rooms, startUtc: string, hours: number, usedHours: number, noShow: boolean) => {
    seq += 1;
    const end = new Date(Date.parse(startUtc) + hours * 3_600_000).toISOString();
    const actualEnd = new Date(Date.parse(startUtc) + usedHours * 3_600_000).toISOString();
    const meeting = (await ds.query(
      `INSERT INTO meetings (meeting_code, title, organizer_id, room_id, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [`${RTAG}-M${seq}`, `${RTAG} họp ${seq}`, fx.staffA, rooms[room], startUtc, end]))[0].id;
    const b = (await ds.query(
      `INSERT INTO room_bookings (booking_code, meeting_id, room_id, reserved_start_time, reserved_end_time, status, booked_by) VALUES ($1,$2,$3,$4,$5,'completed',$6) RETURNING id`,
      [`${RTAG}-B${seq}`, meeting, rooms[room], startUtc, end, fx.staffA]))[0].id;
    await ds.query(
      `INSERT INTO room_booking_usages (booking_id, meeting_id, room_id, reserved_start_time, reserved_end_time, actual_start_time, actual_end_time)
       VALUES ($1,$2,$3,$4,$5,$4,$6)`, [b, meeting, rooms[room], startUtc, end, actualEnd]);
    if (noShow) {
      await ds.query(`INSERT INTO no_show_cases (booking_id, meeting_id, room_id, detection_status) VALUES ($1,$2,$3,'confirmed')`, [b, meeting, rooms[room]]);
    }
  };
  const d14 = (h: number) => `2026-09-14T${String(h).padStart(2, '0')}:00:00Z`; // h theo UTC: 02Z = 09:00 VN
  await booking('R1', d14(2), 2, 1.5, true);
  await booking('R1', d14(5), 2, 1.5, false);
  await booking('R1', d14(8), 2, 1.5, false);
  await booking('R2', d14(2), 2, 2, false);
  await booking('R2', d14(5), 2, 2, false);
  await booking('R3', d14(2), 1, 0.5, true);
  await booking('R3', d14(5), 1, 0.5, false);
  await booking('R3', d14(8), 1, 0.5, false);
  for (const h of [2, 4, 6, 8]) await booking('R4', `2026-09-15T${String(h).padStart(2, '0')}:00:00Z`, 1, 1, false);
  return { rooms };
}

/** 15 cảnh báo: 14/9 có 8 cảnh báo đầu, 15/9 có 7 cảnh báo sau (10:00 VN). */
export async function seedAlertFixture(ds: DataSource, fx: ReportFixture): Promise<void> {
  type A = [string, string, string, string | null, number | null, Record<string, string>?];
  const list: A[] = [
    ['stranger', 'medium', 'resolved', fx.g1, 30], ['stranger', 'medium', 'resolved', fx.g1, 60],
    ['stranger', 'medium', 'new', fx.g2, null], ['stranger', 'medium', 'acknowledged', fx.g2, null],
    ['crowd', 'high', 'resolved', fx.g1, 90], ['crowd', 'high', 'new', fx.g1, null], ['crowd', 'high', 'new', fx.g2, null],
    ['person_watchlist_match', 'critical', 'resolved', fx.g1, 10],
    ['person_watchlist_match', 'critical', 'new', fx.g2, null],
    ['device_error', 'low', 'resolved', null, 120], ['device_error', 'low', 'new', null, null],
    ['visitor_overstay', 'medium', 'resolved', fx.g1, 20, { visitorName: 'Khách A' }], ['visitor_overstay', 'medium', 'new', fx.g1, null],
    ['intrusion', 'critical', 'resolved', fx.g2, 50], ['intrusion', 'critical', 'new', fx.g2, null],
  ];
  let i = 0;
  for (const [type, severity, status, zone, resolveMin, payload] of list) {
    i += 1;
    const day = i <= 8 ? '14' : '15';
    const triggered = `2026-09-${day}T03:00:00Z`; // 10:00 VN
    const resolvedAt = resolveMin === null ? null : new Date(Date.parse(triggered) + resolveMin * 60_000).toISOString();
    await ds.query(
      `INSERT INTO security_alerts (alert_type, severity, zone_id, dedupe_key, status, triggered_at, resolved_at, resolved_by, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [type, severity, zone, `${RTAG}-${i}`, status, triggered, resolvedAt, resolvedAt ? fx.staffB : null, payload ? JSON.stringify(payload) : '{}']);
  }
}
