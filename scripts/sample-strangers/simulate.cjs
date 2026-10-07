/**
 * GIẢ LẬP CAMERA — bắn 1 sự kiện người lạ qua ĐÚNG API camera thật dùng
 * (POST /api/v1/device-callbacks/face/stranger), để test realtime Trung tâm Cảnh báo:
 * lần 1 tạo cảnh báo "Người lạ" mới; các lần sau cùng khu vực → dòng đó "+1 mới", tô vàng,
 * nhảy lên đầu. Mỗi lần chạy tạo 1 thiết bị mẫu MỚI (mã DEMO-SIM-…) — vì BE chặn 1 cảnh
 * báo/thiết bị/5 phút. Thiết bị KHÔNG gắn khu vực (zone NULL) để không cộng lượt vào cảnh báo
 * thật của khu nào; dừng nếu đang có cảnh báo người lạ thật (zone NULL) còn mở.
 * Chạy: node scripts/sample-strangers/simulate.cjs · Xoá: purge.cjs
 */
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
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
  const { rows: base } = await db.query(
    `SELECT room_id FROM iot_devices
      WHERE device_type = 'face_server' AND (metadata_json->>'sample') IS DISTINCT FROM $1
      ORDER BY device_code LIMIT 1`,
    [MARK],
  );
  if (!base.length)
    throw new Error('Không có thiết bị face_server nào để lấy phòng/khu.');
  const { rows: clash } = await db.query(
    `SELECT 1 FROM security_alerts a
      WHERE a.alert_type = 'stranger' AND a.zone_id IS NULL AND a.status <> 'resolved'
        AND (a.payload_json->>'deviceId') NOT IN (
          SELECT id::text FROM iot_devices WHERE metadata_json->>'sample' = $1)
      LIMIT 1`,
    [MARK],
  );
  if (clash.length)
    throw new Error(
      'Đang có cảnh báo người lạ thật (không khu vực) còn mở — xử lý nó trước để không cộng lượt giả vào.',
    );
  const token = crypto.randomBytes(16).toString('hex');
  const code = `DEMO-SIM-${Date.now().toString(36).toUpperCase()}`;
  await db.query(
    `INSERT INTO iot_devices (device_code, device_name, device_type, status, health_status,
        room_id, zone_id, metadata_json)
     VALUES ($1, $2, 'face_server', 'online', 'healthy', $3, $4, $5)`,
    [
      code,
      `Camera giả lập ${code}`,
      base[0].room_id,
      null,
      {
        sample: MARK,
        face_server_config: {
          callback_enabled: true,
          callback_token_hash: crypto
            .createHash('sha256')
            .update(token)
            .digest('hex'),
        },
      },
    ],
  );
  await db.end();

  const port = process.env.APP_PORT || 3000;
  const res = await fetch(
    `http://localhost:${port}/api/v1/device-callbacks/face/stranger`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-callback-token': token,
      },
      body: JSON.stringify({ device_code: code, similarity: '38' }),
    },
  );
  console.log(`${code}: HTTP ${res.status}`, res.ok ? '' : await res.text());
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
