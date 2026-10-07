/**
 * DỮ LIỆU MẪU TẠM — tạo cảnh báo "Người lạ" trong Trung tâm Cảnh báo An ninh từ các lượt
 * mẫu của seed.cjs (chạy seed.cjs trước). Mỗi thiết bị 1 cảnh báo, gom lượt của NHIỀU người
 * lạ (giống thật: cảnh báo người lạ gom theo khu vực) → test "Theo dõi" chỉ đổi đúng lượt chọn.
 * Chạy: node scripts/sample-strangers/seed-alert.cjs · Xoá: purge.cjs
 */
require('dotenv').config();
const { Client } = require('pg');

const MARK = 'stranger-demo';

(async () => {
  const db = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
  await db.connect();
  await db.query(
    `DELETE FROM security_alerts WHERE payload_json->>'sample' = $1`,
    [MARK],
  );
  const { rows } = await db.query(
    `SELECT e.id, e.device_id, e.room_id, e.zone_id, e.created_at,
            d.device_code, r.room_name
       FROM iot_device_events e
       JOIN iot_devices d ON d.id = e.device_id
       LEFT JOIN rooms r ON r.id = e.room_id
      WHERE e.payload_json->>'sample' = $1
      ORDER BY e.created_at`,
    [MARK],
  );
  if (!rows.length) throw new Error('Chưa có lượt mẫu — chạy seed.cjs trước.');
  const byDevice = new Map();
  for (const r of rows) {
    if (!byDevice.has(r.device_id)) byDevice.set(r.device_id, []);
    byDevice.get(r.device_id).push(r);
  }
  for (const evs of byDevice.values()) {
    const first = evs[0];
    const last = evs[evs.length - 1];
    const occurrences = evs.slice(-20).map((e) => ({
      userId: null,
      sourceEventId: e.id,
      occurredAt: e.created_at.toISOString(),
    }));
    await db.query(
      `INSERT INTO security_alerts (alert_type, severity, zone_id, dedupe_key, status,
          triggered_at, last_seen_at, occurrence_count, source_event_id, payload_json,
          created_at, updated_at)
       VALUES ('stranger','medium',$1,$2,'new',$3,$4,$5,$6,$7,$3,$4)`,
      [
        first.zone_id,
        `${MARK}-${first.device_id}`,
        first.created_at,
        last.created_at,
        evs.length,
        first.id,
        {
          sample: MARK,
          deviceId: first.device_id,
          deviceCode: first.device_code,
          roomId: first.room_id,
          roomName: first.room_name,
          occurrences,
        },
      ],
    );
  }
  console.log(
    `Đã tạo ${byDevice.size} cảnh báo "Người lạ" mẫu từ ${rows.length} lượt.`,
  );
  await db.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
