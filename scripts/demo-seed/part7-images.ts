import * as fs from 'fs';
import * as path from 'path';
import { db, insertTracked, pick, trackedIds } from './lib';
import { DEMO_FOLDER, saveDemoFile, storageProvider } from './storage';

/**
 * PHẦN 7 — ảnh: đưa ảnh từ scripts/demo-camera-mock/images/ (faces, plates, crowd — bị
 * gitignore, scp lên server) vào storage của BE + media_files, rồi gắn snapshot cho dữ liệu
 * các phần trước. Web đọc ảnh qua iot_device_events.snapshot_file_id:
 * - lượt khuôn mặt vào/ra phòng (part2), lượt xe ANPR (part3) → gán thẳng;
 * - hành trình (zone_presence_events.metadata_json.sourceEventId, gate_access_logs.event_id) và
 *   cảnh báo chưa có sự kiện nguồn (security_alerts.source_event_id) → tạo sự kiện "neo ảnh"
 *   giống crowd-alert ('crowd_alert_snapshot') — loại 'presence_snapshot' không phải
 *   'ivss_face_event' nên không lọt vào nhật ký ra/vào phòng;
 * - ảnh đối chiếu của danh sách kiểm soát người (photo_media_file_id).
 * Ảnh dùng chung: mỗi người 1 ảnh mặt cố định, mỗi biển số 1 ảnh vẽ đúng biển.
 */

export const PART = 'part7';

const IMAGES_DIR = path.join(__dirname, '../demo-camera-mock/images');
const ANCHOR_TYPE = 'presence_snapshot';
const CROWD_TYPE = 'crowd_alert_snapshot';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function listImages(sub: string): string[] {
  const dir = path.join(IMAGES_DIR, sub);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => MIME[path.extname(f).toLowerCase()])
    .sort()
    .map((f) => path.join(dir, f));
}

/** Lưu file vào storage + media_files; trả id theo đúng thứ tự `files`. */
async function upload(sub: string, files: string[]): Promise<string[]> {
  const rows: Record<string, unknown>[] = [];
  for (const file of files) {
    const name = path.basename(file);
    const key = `${DEMO_FOLDER}/${sub}/${name}`;
    const buf = fs.readFileSync(file);
    await saveDemoFile(key, buf);
    rows.push({
      file_name: name,
      file_type: 'image',
      mime_type: MIME[path.extname(name).toLowerCase()],
      storage_provider: storageProvider(),
      storage_key: key,
      file_size_bytes: buf.length,
      related_entity_type: 'demo_seed_snapshot',
      metadata_json: { demo: true },
    });
  }
  return insertTracked(PART, 'media_files', rows);
}

/** Tạo sự kiện neo ảnh (giữ đúng thứ tự `rows`). */
function anchors(
  rows: Array<{
    zone_id: string | null;
    device_id: string | null;
    room_id?: string | null;
    event_time: Date;
    user_id: string | null;
    snapshot: string;
    type?: string;
  }>,
): Promise<string[]> {
  return insertTracked(
    PART,
    'iot_device_events',
    rows.map((r) => ({
      device_id: r.device_id,
      zone_id: r.zone_id,
      room_id: r.room_id ?? null,
      event_type: r.type ?? ANCHOR_TYPE,
      event_time: r.event_time,
      source_protocol: 'ivss',
      severity: 'info',
      processed_status: 'processed',
      snapshot_file_id: r.snapshot,
      payload_json: { userId: r.user_id, demo: true },
    })),
  );
}

export async function seedPart7(log: (m: string) => void): Promise<void> {
  const faceFiles = listImages('faces');
  const crowdFiles = listImages('crowd');
  const plateFiles = listImages('plates');
  if (faceFiles.length === 0 || plateFiles.length === 0) {
    throw new Error(
      `Thiếu ảnh trong ${IMAGES_DIR} (faces/, plates/). Chép thư mục images lên rồi chạy "npm run demo:images".`,
    );
  }

  const users = await trackedIds('users');
  const zones = await trackedIds('zones');
  const devices = await trackedIds('iot_devices');
  const events = await trackedIds('iot_device_events');

  // ── 1. Ảnh vào storage ─────────────────────────────────────────────────
  const faces = await upload('faces', faceFiles);
  const crowd = await upload('crowd', crowdFiles);
  const plates = await upload('plates', plateFiles);
  const plateNames = plateFiles.map((f) => path.parse(f).name);
  log(
    `  ✔ ${faces.length + crowd.length + plates.length} ảnh (${faces.length} khuôn mặt, ${plates.length} biển số, ${crowd.length} đám đông) → ${storageProvider()}:${DEMO_FOLDER}/`,
  );
  const faceOf = (userId: string | null) =>
    userId && users.includes(userId)
      ? faces[users.indexOf(userId) % faces.length]
      : pick(faces);

  // ── 2. Lượt khuôn mặt vào/ra phòng ─────────────────────────────────────
  await db.query(
    `UPDATE iot_device_events e SET snapshot_file_id = m.media
       FROM unnest($1::text[], $2::uuid[]) AS m(uid, media)
      WHERE e.id = ANY($3::uuid[]) AND e.event_type = 'ivss_face_event'
        AND e.payload_json->>'userId' = m.uid`,
    [users, users.map((_, i) => faces[i % faces.length]), events],
  );
  const [{ n: strangers }]: Array<{ n: number }> = await db.query(
    `WITH s AS (
       UPDATE iot_device_events SET snapshot_file_id = ($1::uuid[])[1 + floor(random() * $2)::int]
        WHERE id = ANY($3::uuid[]) AND event_type = 'ivss_face_event'
          AND payload_json->>'userId' IS NULL
        RETURNING 1)
     SELECT count(*)::int AS n FROM s`,
    [faces, faces.length, events],
  );
  log(`  ✔ ảnh lượt ra/vào phòng (kể cả ${strangers} lượt người lạ)`);

  // ── 3. Lượt xe ANPR ────────────────────────────────────────────────────
  const [{ n: withPlate, total }]: Array<{ n: number; total: number }> =
    await db.query(
      `WITH u AS (
         UPDATE iot_device_events e SET snapshot_file_id = m.media
           FROM unnest($1::text[], $2::uuid[]) AS m(plate, media)
          WHERE e.id = ANY($3::uuid[]) AND e.event_type = 'ivss_vehicle_event'
            AND e.payload_json->>'plateNumber' = m.plate
          RETURNING 1)
       SELECT (SELECT count(*)::int FROM u) AS n,
              (SELECT count(*)::int FROM iot_device_events
                WHERE id = ANY($3::uuid[]) AND event_type = 'ivss_vehicle_event') AS total`,
      [plateNames, plates, events],
    );
  log(`  ✔ ảnh lượt xe: ${withPlate}/${total}`);
  if (withPlate < total)
    log(
      `  ⚠ ${total - withPlate} lượt xe thiếu ảnh biển số — chạy "npm run demo:images" để vẽ đủ.`,
    );

  // ── 4. Hành trình: zone + cổng ─────────────────────────────────────────
  const appear: Array<{
    id: string;
    zone_id: string;
    device_id: string | null;
    user_id: string;
    event_time: Date;
  }> = await db.query(
    `SELECT id, zone_id, device_id, user_id, event_time FROM zone_presence_events
      WHERE id = ANY($1::uuid[]) AND user_id IS NOT NULL ORDER BY event_time`,
    [await trackedIds('zone_presence_events')],
  );
  const appearAnchors = await anchors(
    appear.map((a) => ({ ...a, snapshot: faceOf(a.user_id) })),
  );
  await db.query(
    `UPDATE zone_presence_events p
        SET metadata_json = COALESCE(p.metadata_json, '{}'::jsonb) || jsonb_build_object('sourceEventId', m.ev)
       FROM unnest($1::uuid[], $2::uuid[]) AS m(id, ev) WHERE p.id = m.id`,
    [appear.map((a) => a.id), appearAnchors],
  );
  const gate: Array<{
    id: string;
    zone_id: string;
    device_id: string | null;
    user_id: string;
    access_time: Date;
  }> = await db.query(
    `SELECT id, zone_id, device_id, user_id, access_time FROM gate_access_logs
      WHERE id = ANY($1::uuid[]) ORDER BY access_time`,
    [await trackedIds('gate_access_logs')],
  );
  const gateAnchors = await anchors(
    gate.map((g) => ({
      ...g,
      event_time: g.access_time,
      snapshot: faceOf(g.user_id),
    })),
  );
  await db.query(
    `UPDATE gate_access_logs g SET event_id = m.ev
       FROM unnest($1::uuid[], $2::uuid[]) AS m(id, ev) WHERE g.id = m.id`,
    [gate.map((g) => g.id), gateAnchors],
  );
  log(
    `  ✔ ảnh hành trình: ${appearAnchors.length} lượt tại zone, ${gateAnchors.length} lượt qua cổng`,
  );

  // ── 5. Cảnh báo chưa có sự kiện nguồn ──────────────────────────────────
  const alerts: Array<{
    id: string;
    alert_type: string;
    zone_id: string | null;
    triggered_at: Date;
    payload_json: {
      userId?: string | null;
      deviceId?: string;
      roomId?: string;
    };
  }> = await db.query(
    `SELECT id, alert_type, zone_id, triggered_at, payload_json FROM security_alerts
      WHERE id = ANY($1::uuid[]) AND source_event_id IS NULL
        AND alert_type IN ('stranger', 'intrusion', 'crowd', 'person_watchlist_match')`,
    [await trackedIds('security_alerts')],
  );
  const zoneCam = (zoneId: string | null) =>
    zoneId && zones.includes(zoneId) ? devices[zones.indexOf(zoneId)] : null;
  const alertAnchors = await anchors(
    alerts.map((a) => {
      const isCrowd = a.alert_type === 'crowd' && crowd.length > 0;
      const userId = a.payload_json.userId ?? null;
      return {
        zone_id: a.zone_id,
        room_id: a.payload_json.roomId ?? null,
        device_id: a.payload_json.deviceId ?? zoneCam(a.zone_id),
        event_time: a.triggered_at,
        user_id: userId,
        type: isCrowd ? CROWD_TYPE : ANCHOR_TYPE,
        snapshot: isCrowd ? pick(crowd) : faceOf(userId),
      };
    }),
  );
  await db.query(
    `UPDATE security_alerts s SET source_event_id = m.ev
       FROM unnest($1::uuid[], $2::uuid[]) AS m(id, ev) WHERE s.id = m.id`,
    [alerts.map((a) => a.id), alertAnchors],
  );
  log(
    `  ✔ ảnh cho ${alertAnchors.length} cảnh báo (người lạ, xâm nhập, đám đông, danh sách theo dõi)`,
  );

  // ── 6. Ảnh đối chiếu danh sách kiểm soát người ─────────────────────────
  const pcl: Array<{ id: string; user_id: string | null }> = await db.query(
    `SELECT id, user_id FROM person_control_list WHERE id = ANY($1::uuid[])`,
    [await trackedIds('person_control_list')],
  );
  await db.query(
    `UPDATE person_control_list p SET photo_media_file_id = m.media
       FROM unnest($1::uuid[], $2::uuid[]) AS m(id, media) WHERE p.id = m.id`,
    [pcl.map((p) => p.id), pcl.map((p) => faceOf(p.user_id))],
  );
  log(`  ✔ ảnh cho ${pcl.length} người trong danh sách kiểm soát`);
}
