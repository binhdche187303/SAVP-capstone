/**
 * DỮ LIỆU MẪU TẠM — trang "Người lạ" (2.3). Chạy: node scripts/sample-strangers/seed.cjs
 * Xoá sạch:  node scripts/sample-strangers/purge.cjs
 *
 * Tạo 4 người lạ (ảnh chân dung mẫu từ randomuser.me) xuất hiện 5/3/2/1 lần trong 7 ngày
 * qua trên các thiết bị face_server có sẵn. Mọi bản ghi đánh dấu `sample = 'stranger-demo'`
 * (payload_json / metadata_json) để purge.cjs xoá đúng, không đụng dữ liệu thật.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const MARK = 'stranger-demo';
const DIR = 'sample-strangers';
const PEOPLE = [
  { code: 'DEMO-STR-01', img: 'men/32', hits: 5, sim: 41 },
  { code: 'DEMO-STR-02', img: 'women/44', hits: 3, sim: 37 },
  { code: 'DEMO-STR-03', img: 'men/76', hits: 2, sim: 45 },
  { code: 'DEMO-STR-04', img: 'women/68', hits: 1, sim: 33 },
];

(async () => {
  const db = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
  await db.connect();
  const { rows: existing } = await db.query(
    `SELECT 1 FROM iot_device_events WHERE payload_json->>'sample' = $1 LIMIT 1`,
    [MARK],
  );
  if (existing.length) {
    console.log('Đã có dữ liệu mẫu — chạy purge.cjs trước nếu muốn tạo lại.');
    return db.end();
  }
  const { rows: devices } = await db.query(
    `SELECT id, room_id, zone_id FROM iot_devices WHERE device_type = 'face_server' ORDER BY device_code LIMIT 3`,
  );
  if (!devices.length) throw new Error('Không có thiết bị face_server nào.');

  const root = path.resolve(process.env.STORAGE_LOCAL_PATH || './uploads', DIR);
  fs.mkdirSync(root, { recursive: true });
  let n = 0;
  for (const [pi, p] of PEOPLE.entries()) {
    const res = await fetch(`https://randomuser.me/api/portraits/${p.img}.jpg`);
    if (!res.ok) throw new Error(`Tải ảnh lỗi ${p.img}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dev = devices[pi % devices.length];
    for (let h = 0; h < p.hits; h++) {
      // rải trong 7 ngày qua, giờ hành chính
      const t = new Date(Date.now() - (h * 26 + pi * 5 + 2) * 3600 * 1000);
      const key = `${DIR}/${p.code}-${h + 1}.jpg`;
      fs.writeFileSync(path.join(root, `${p.code}-${h + 1}.jpg`), buf);
      const { rows: mf } = await db.query(
        `INSERT INTO media_files (file_code, related_entity_type, file_name, file_type, mime_type,
            storage_provider, storage_key, file_size_bytes, checksum, version_no, visibility_level,
            is_active, uploaded_at, metadata_json)
         VALUES ($1,'iot_device_event',$2,'image','image/jpeg','local',$3,$4,$5,1,'private',true,$6,$7)
         RETURNING id`,
        [
          `${MARK}-${p.code}-${h + 1}`,
          `${p.code}-${h + 1}.jpg`,
          key,
          buf.length,
          crypto.createHash('sha256').update(buf).digest('hex'),
          t,
          { sample: MARK },
        ],
      );
      await db.query(
        `INSERT INTO iot_device_events (device_id, room_id, zone_id, event_type, event_time,
            source_protocol, severity, payload_json, processed_status, snapshot_file_id, created_at)
         VALUES ($1,$2,$3,'face_stranger',$4,'http','warning',$5,'processed',$6,$4)`,
        [
          dev.id,
          dev.room_id,
          dev.zone_id,
          t,
          {
            sample: MARK,
            extracted_fields: {
              stranger_id: p.code,
              similarity: String(p.sim + h),
              event_result: 'stranger',
            },
          },
          mf[0].id,
        ],
      );
      n++;
    }
  }
  console.log(`Đã tạo ${PEOPLE.length} người lạ mẫu, ${n} lần xuất hiện.`);
  await db.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
