import { db, insertTracked, pick, randInt, trackedIds } from './lib';
import { UNKNOWN_PLATES, plateRaw, registeredPlates } from './plates';

/**
 * Part 9 — số liệu cho API camera thật (2.2), thay cho phần FE trước đây mock:
 *  - lượt xe qua từng camera biển số 30 ngày (iot_device_events 'ivss_vehicle_event' gắn
 *    device_id camera ANPR) → GET /iot-devices/anpr-stats
 *  - dung lượng ghi hình đã dùng theo camera (metadata_json.recording_stats.used_gb — khi có
 *    NVR thật, job đồng bộ ghi vào đây) → GET /iot-devices/recording-storage
 *
 * Cấu hình lịch ghi / vị trí sơ đồ KHÔNG seed: chưa cấu hình thì FE dùng mặc định theo loại camera.
 */

const PART = 'part9';
const DAYS = 30;
const VN_OFFSET_MS = 7 * 3_600_000;

const CAMERA_TYPES = ['ip_camera', 'door_camera', 'room_camera', 'anpr_camera'];

export async function seedPart9(log: (m: string) => void) {
  const cams: Array<{
    id: string;
    device_type: string;
    zone_id: string | null;
    metadata_json: { anpr?: { lane_direction?: string } } | null;
  }> = await db.query(
    `SELECT id, device_type, zone_id, metadata_json FROM iot_devices
     WHERE id = ANY($1::uuid[]) AND device_type = ANY($2)`,
    [await trackedIds('iot_devices'), CAMERA_TYPES],
  );
  const anpr = cams.filter((c) => c.device_type === 'anpr_camera');
  if (anpr.length === 0)
    throw new Error('Chưa có camera biển số (chạy part8 trước).');

  // ── 1. Lượt xe theo camera biển số ──────────────────────────────────────
  const plates = [...registeredPlates().map((r) => r.plate), ...UNKNOWN_PLATES];
  const now = Date.now();
  // 00:00 hôm nay giờ VN (UTC+7)
  const todayVn =
    Math.floor((now + VN_OFFSET_MS) / 86_400_000) * 86_400_000 - VN_OFFSET_MS;
  const events: Record<string, unknown>[] = [];
  for (let d = DAYS - 1; d >= 0; d--) {
    const dayStart = todayVn - d * 86_400_000;
    const weekday = new Date(dayStart + VN_OFFSET_MS).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    for (const cam of anpr) {
      const lane = cam.metadata_json?.anpr?.lane_direction ?? 'both';
      const count = weekend ? randInt(10, 35) : randInt(60, 150);
      for (let n = 0; n < count; n++) {
        // Giờ cao điểm sáng/chiều dày hơn
        const hour = pick([
          6, 7, 7, 7, 8, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 17, 17, 18, 18,
          19, 20,
        ]);
        const time = new Date(
          dayStart + hour * 3_600_000 + randInt(0, 3_599) * 1000,
        );
        if (time.getTime() > now) continue;
        const direction =
          lane === 'in'
            ? 'enter'
            : lane === 'out'
              ? 'leave'
              : pick(['enter', 'leave']);
        const p = pick(plates);
        events.push({
          device_id: cam.id,
          zone_id: cam.zone_id,
          event_type: 'ivss_vehicle_event',
          event_time: time,
          source_protocol: 'ivss',
          severity: 'info',
          processed_status: 'processed',
          payload_json: {
            plateRaw: plateRaw(p),
            plateNumber: p,
            direction,
            gateDirection: direction,
            vehicleType: pick([
              'car',
              'car',
              'motorbike',
              'motorbike',
              'truck',
            ]),
            utc: time.toISOString(),
            receivedAt: time.toISOString(),
            source: 'anpr_camera',
            demo: true,
          },
        });
      }
    }
  }
  const evIds = await insertTracked(PART, 'iot_device_events', events);
  log(
    `  ✔ ${evIds.length} lượt xe qua ${anpr.length} camera biển số (30 ngày)`,
  );

  // ── 2. Dung lượng ghi hình đã dùng ──────────────────────────────────────
  // Ước lượng theo chính sách mặc định: camera thường 4 Mbps liên tục, phòng/biển số ghi theo
  // sự kiện → GB/ngày × số ngày lưu × mức đầy 55–100%.
  for (const cam of cams) {
    const perDay =
      cam.device_type === 'ip_camera' || cam.device_type === 'door_camera'
        ? (4 * 3600 * 24) / 8 / 1024
        : (2 * 3600 * 24 * 0.15) / 8 / 1024;
    const retention = cam.device_type === 'anpr_camera' ? 90 : 30;
    const usedGb =
      Math.round(perDay * retention * (randInt(55, 100) / 100) * 10) / 10;
    await db.query(
      `UPDATE iot_devices
       SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) ||
           jsonb_build_object('recording_stats', jsonb_build_object('used_gb', $2::numeric, 'measured_at', now(), 'demo', true))
       WHERE id = $1`,
      [cam.id, usedGb],
    );
  }
  log(`  ✔ dung lượng ghi hình cho ${cams.length} camera demo`);
}
