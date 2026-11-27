import { db, insertTracked, pick, randInt, trackedIds } from './lib';

/**
 * PHẦN 2 — di chuyển: lưu lượng zone (zone-traffic), ra/vào phòng bằng khuôn mặt
 * (room-access-logs), hành trình người dùng (user-journey). room-analytics đọc booking/usage
 * của part5 nên không cần thêm.
 *
 * Bảng nguồn (khớp BE):
 * - zone_presence_events: 'count' (đếm người, zone-traffic) + 'appear'/'disappear' (journey).
 * - kpi_zone_hourly: chạy ĐÚNG SQL của zone-hourly-rollup cho zone demo → vẫn hiện khi server đã
 *   có watermark (đoạn trước watermark đọc từ bảng tổng hợp). Bảng không có id → purge xoá theo zone.
 * - iot_device_events 'ivss_face_event': payload {userId, roomId, meetingId, direction,
 *   matchState, similarity} — sinh từ điểm danh các cuộc họp part5 (+ vài lượt không nhận diện).
 * - gate_access_logs: vào cổng buổi sáng / ra cổng buổi chiều (direction enter|leave).
 */

export const PART = 'part2';

const DAYS_BACK = 30;
const JOURNEY_DAYS = 14;

/** Thứ tự zone theo part1. */
const Z = {
  gateMain: 0,
  gateSide: 1,
  lobbyA: 2,
  cor1: 3,
  cor2: 4,
  server: 5,
  lobbyB: 6,
  corB1: 7,
  corB3: 8,
  parking: 9,
};

/** Hệ số đông người theo zone (sảnh/cổng đông, phòng máy chủ vắng). */
const ZONE_WEIGHT = [1.6, 0.7, 1.4, 0.9, 0.8, 0.1, 1.1, 0.7, 0.6, 0.9];

const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

function vnDate(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toLocaleDateString(
    'en-CA',
    { timeZone: 'Asia/Ho_Chi_Minh' },
  );
}

const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`);

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00+07:00`).getUTCDay();
  return day === 0 || day === 6;
}

/** Đường cong lưu lượng trong ngày: đỉnh 8-9h, 12h, 17h. */
function crowdAt(hour: number, weekend: boolean): number {
  const peaks =
    6 * Math.exp(-((hour - 8.5) ** 2) / 1.2) +
    4 * Math.exp(-((hour - 12) ** 2) / 0.8) +
    5 * Math.exp(-((hour - 17.3) ** 2) / 1) +
    (hour >= 8 && hour <= 18 ? 3 : 0);
  return weekend ? peaks * 0.15 : peaks;
}

export async function seedPart2(log: (m: string) => void): Promise<void> {
  const users = await trackedIds('users');
  const zones = await trackedIds('zones');
  const devices = await trackedIds('iot_devices');
  const rooms = await trackedIds('rooms');
  const now = new Date();
  // part1: 10 camera zone trước, sau đó mỗi phòng [camera phòng, cảm biến]
  const zoneCam = (z: number) => devices[z];
  const roomCam = new Map(rooms.map((r, i) => [r, devices[10 + i * 2]]));

  // ── 1. Đếm người theo zone (zone-traffic) ──────────────────────────────
  const countRows: Record<string, unknown>[] = [];
  for (let offset = -DAYS_BACK; offset <= 0; offset++) {
    const date = vnDate(offset);
    const weekend = isWeekend(date);
    for (let h = 6; h < 22; h++) {
      for (const mm of ['00', '15', '30', '45']) {
        const t = at(date, `${String(h).padStart(2, '0')}:${mm}`);
        if (t > now) break;
        const hour = h + Number(mm) / 60;
        zones.forEach((zoneId, z) => {
          const base = crowdAt(hour, weekend) * ZONE_WEIGHT[z] * 2.2;
          const occ = Math.max(
            0,
            Math.round(base * (0.75 + Math.random() * 0.5)),
          );
          countRows.push({
            zone_id: zoneId,
            device_id: zoneCam(z),
            event_type: 'count',
            occupancy_count: occ,
            event_time: addMin(t, randInt(0, 4)),
            source_type: 'ivss',
            metadata_json: { demo: true },
          });
        });
      }
    }
  }
  const countIds = await insertTracked(PART, 'zone_presence_events', countRows);
  log(`  ✔ ${countIds.length} mẫu đếm người theo zone`);

  // Tổng hợp theo giờ — y hệt zone-hourly-rollup, chỉ cho zone demo; không đè dữ liệu sẵn có
  await db.query(
    `WITH src AS (
       SELECT zone_id, event_time, occupancy_count,
              date_trunc('hour', event_time, 'UTC') AS bucket_hour
       FROM zone_presence_events
       WHERE event_type = 'count' AND zone_id = ANY($1::uuid[])
     ), agg AS (
       SELECT bucket_hour, zone_id, COUNT(*) AS event_count,
              COUNT(occupancy_count) AS sample_count,
              COALESCE(SUM(occupancy_count), 0) AS occupancy_sum,
              MAX(occupancy_count) AS occupancy_peak
       FROM src GROUP BY bucket_hour, zone_id
     ), peak AS (
       SELECT DISTINCT ON (zone_id, bucket_hour) zone_id, bucket_hour, event_time AS peak_at
       FROM src
       ORDER BY zone_id, bucket_hour, occupancy_count DESC NULLS LAST, event_time DESC
     )
     INSERT INTO kpi_zone_hourly
       (bucket_hour, zone_id, event_count, sample_count, occupancy_sum, occupancy_peak, peak_at)
     SELECT a.bucket_hour, a.zone_id, a.event_count, a.sample_count, a.occupancy_sum,
            a.occupancy_peak, p.peak_at
     FROM agg a JOIN peak p USING (zone_id, bucket_hour)
     ON CONFLICT DO NOTHING`,
    [zones],
  );
  log(`  ✔ tổng hợp theo giờ (kpi_zone_hourly)`);

  // ── 2. Ra/vào phòng bằng khuôn mặt — từ điểm danh họp part5 ────────────
  const presence: Array<{
    user_id: string;
    room_id: string;
    meeting_id: string;
    joined_at: Date;
    left_at: Date | null;
  }> = await db.query(
    `SELECT p.user_id, m.room_id, m.id AS meeting_id, p.joined_at, p.left_at
       FROM meeting_participants p
       JOIN meetings m ON m.id = p.meeting_id
      WHERE m.meeting_code LIKE 'DEMO-MTG-%' AND m.room_id IS NOT NULL
        AND p.joined_at IS NOT NULL`,
  );
  const faceRows: Record<string, unknown>[] = [];
  const face = (
    roomId: string,
    meetingId: string | null,
    userId: string | null,
    direction: string,
    time: Date,
  ) => {
    const matched = userId !== null;
    faceRows.push({
      device_id: roomCam.get(roomId),
      room_id: roomId,
      meeting_id: meetingId,
      event_type: 'ivss_face_event',
      event_time: time,
      source_protocol: 'http',
      severity: matched ? 'info' : 'warning',
      processed_status: matched ? 'processed' : 'unmatched',
      payload_json: {
        userId,
        roomId,
        meetingId,
        direction,
        matchState: matched ? 'matched' : 'unmatched_identity',
        similarity: matched
          ? Number((0.82 + Math.random() * 0.16).toFixed(3))
          : null,
        demo: true,
      },
    });
  };
  for (const p of presence) {
    face(p.room_id, p.meeting_id, p.user_id, 'enter', new Date(p.joined_at));
    if (p.left_at)
      face(p.room_id, p.meeting_id, p.user_id, 'leave', new Date(p.left_at));
    // Thỉnh thoảng có người lạ / không nhận diện được đi cùng
    if (Math.random() < 0.05)
      face(
        p.room_id,
        p.meeting_id,
        null,
        'enter',
        addMin(new Date(p.joined_at), 1),
      );
  }
  const faceIds = await insertTracked(PART, 'iot_device_events', faceRows);
  log(`  ✔ ${faceIds.length} lượt ra/vào phòng (nhận diện khuôn mặt)`);

  // ── 3. Hành trình: cổng + zone mỗi ngày làm việc ───────────────────────
  const gateRows: Record<string, unknown>[] = [];
  const appearRows: Record<string, unknown>[] = [];
  const appear = (z: number, userId: string, time: Date, type = 'appear') => {
    if (time > now) return;
    appearRows.push({
      zone_id: zones[z],
      device_id: zoneCam(z),
      user_id: userId,
      event_type: type,
      confidence_score: (0.85 + Math.random() * 0.14).toFixed(4),
      event_time: time,
      source_type: 'ivss',
      metadata_json: { demo: true },
    });
  };
  for (let offset = -JOURNEY_DAYS; offset <= 0; offset++) {
    const date = vnDate(offset);
    if (isWeekend(date)) continue;
    users.forEach((userId, i) => {
      if (Math.random() < 0.12) return; // nghỉ phép
      const arrive = at(date, `0${randInt(7, 8)}:${randInt(10, 59)}`);
      if (arrive > now) return;
      const gate = Math.random() < 0.8 ? Z.gateMain : Z.gateSide;
      const byCar = i % 3 === 0;
      gateRows.push({
        zone_id: zones[byCar ? Z.parking : gate],
        device_id: zoneCam(byCar ? Z.parking : gate),
        user_id: userId,
        direction: 'enter',
        access_time: arrive,
        metadata_json: { demo: true },
      });
      const lobby = i % 2 === 0 ? Z.lobbyA : Z.lobbyB;
      appear(lobby, userId, addMin(arrive, randInt(2, 5)));
      appear(
        lobby === Z.lobbyA ? pick([Z.cor1, Z.cor2]) : pick([Z.corB1, Z.corB3]),
        userId,
        addMin(arrive, randInt(6, 12)),
      );
      // Giữa ngày: đi lại vài zone (kỹ thuật thỉnh thoảng vào phòng máy chủ)
      for (let k = 0; k < randInt(1, 3); k++) {
        const z =
          i % 5 === 1 && Math.random() < 0.3
            ? Z.server
            : pick([Z.cor1, Z.cor2, Z.lobbyA, Z.lobbyB, Z.corB1, Z.corB3]);
        appear(z, userId, at(date, `${randInt(10, 15)}:${randInt(10, 59)}`));
      }
      const depart = at(date, `${randInt(17, 18)}:${randInt(10, 59)}`);
      if (depart > now) return;
      appear(lobby, userId, addMin(depart, -randInt(3, 6)), 'disappear');
      gateRows.push({
        zone_id: zones[byCar ? Z.parking : gate],
        device_id: zoneCam(byCar ? Z.parking : gate),
        user_id: userId,
        direction: 'leave',
        access_time: depart,
        duration_seconds: Math.round(
          (depart.getTime() - arrive.getTime()) / 1000,
        ),
        metadata_json: { demo: true },
      });
    });
  }
  const gateIds = await insertTracked(PART, 'gate_access_logs', gateRows);
  const appearIds = await insertTracked(
    PART,
    'zone_presence_events',
    appearRows,
  );
  log(
    `  ✔ ${gateIds.length} lượt qua cổng, ${appearIds.length} lượt xuất hiện tại zone`,
  );
}
