/**
 * Xoá dữ liệu mẫu do seed.cjs tạo (đánh dấu `sample = 'stranger-demo'`), gồm cả bản ghi
 * "Danh sách người giám sát" đã thêm từ ảnh mẫu. Chạy: node scripts/sample-strangers/purge.cjs
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
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
  await db.query('BEGIN');
  const simDevices = `SELECT id::text FROM iot_devices WHERE metadata_json->>'sample' = $1`;
  const al = await db.query(
    `DELETE FROM security_alerts WHERE payload_json->>'sample' = $1
        OR payload_json->>'deviceId' IN (${simDevices})`,
    [MARK],
  );
  const sampleMedia = `SELECT id FROM media_files WHERE metadata_json->>'sample' = $1`;
  const pcl = await db.query(
    `DELETE FROM person_control_list WHERE photo_media_file_id IN (${sampleMedia})`,
    [MARK],
  );
  const ev = await db.query(
    `DELETE FROM iot_device_events WHERE payload_json->>'sample' = $1`,
    [MARK],
  );
  await db.query(
    `DELETE FROM iot_device_events WHERE device_id::text IN (${simDevices})`,
    [MARK],
  );
  const dv = await db.query(
    `DELETE FROM iot_devices WHERE metadata_json->>'sample' = $1`,
    [MARK],
  );
  const mf = await db.query(
    `DELETE FROM media_files WHERE metadata_json->>'sample' = $1`,
    [MARK],
  );
  await db.query('COMMIT');
  fs.rmSync(
    path.resolve(
      process.env.STORAGE_LOCAL_PATH || './uploads',
      'sample-strangers',
    ),
    { recursive: true, force: true },
  );
  console.log(
    `Đã xoá: ${al.rowCount} cảnh báo, ${dv.rowCount} camera giả lập, ${ev.rowCount} sự kiện, ${mf.rowCount} ảnh, ${pcl.rowCount} người theo dõi tạo từ ảnh mẫu.`,
  );
  await db.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
