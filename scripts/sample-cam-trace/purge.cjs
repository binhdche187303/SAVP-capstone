/**
 * Xoá SẠCH dữ liệu do seed.cjs tạo (đánh dấu sample = 'cam-trace-demo' / mã DEMO-CT-).
 * Không đụng dữ liệu thật. Chạy: node scripts/sample-cam-trace/purge.cjs
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MARK = 'cam-trace-demo';
const CODE = 'DEMO-CT-';
const DIR = 'sample-cam-trace';

(async () => {
  const db = new Client({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE,
  });
  await db.connect();
  const run = async (label, sql, params = []) => {
    const r = await db.query(sql, params);
    console.log(`  ${label}: ${r.rowCount}`);
  };
  await db.query('BEGIN');
  try {
    await run('zone_presence_events', `DELETE FROM zone_presence_events WHERE metadata_json->>'sample' = $1`, [MARK]);
    await run('gate_access_logs', `DELETE FROM gate_access_logs WHERE metadata_json->>'sample' = $1`, [MARK]);
    await run('iot_device_events', `DELETE FROM iot_device_events WHERE payload_json->>'sample' = $1`, [MARK]);
    await run('attendance_records', `DELETE FROM attendance_records WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_code LIKE $1)`, [`${CODE}%`]);
    await run('meeting_participants', `DELETE FROM meeting_participants WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_code LIKE $1)`, [`${CODE}%`]);
    await run('meetings', `DELETE FROM meetings WHERE meeting_code LIKE $1`, [`${CODE}%`]);
    await run('camera_group_members', `DELETE FROM camera_group_members WHERE group_id IN (SELECT id FROM camera_groups WHERE group_code LIKE $1)`, [`${CODE}%`]);
    await run('camera_groups', `DELETE FROM camera_groups WHERE group_code LIKE $1`, [`${CODE}%`]);
    await run('media_files', `DELETE FROM media_files WHERE metadata_json->>'sample' = $1`, [MARK]);
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
  const root = path.resolve(process.env.STORAGE_LOCAL_PATH || './uploads', DIR);
  if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  console.log('Đã xoá dữ liệu mẫu truy vết camera.');
  await db.end();
})().catch((e) => {
  console.error('LỖI:', e.message);
  process.exit(1);
});
