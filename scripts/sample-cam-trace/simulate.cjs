/**
 * GIẢ LẬP CAMERA ĐẾM NGƯỜI — mỗi phút ghi 1 mẫu "count" cho 8 camera (như camera thật) + thỉnh thoảng 1 lượt
 * người xuất hiện/rời đi, để test Heatmap mốc 5/10/30 phút/1 giờ (tự làm mới) và Truy vết mốc "1 giờ qua".
 * Chạy (giữ cửa sổ mở):  node scripts/sample-cam-trace/simulate.cjs [số-phút=120]
 * Dừng: Ctrl+C. Bản ghi đánh dấu sample = 'cam-trace-demo' nên purge.cjs xoá được.
 */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const MARK = 'cam-trace-demo';
const MINUTES = Number(process.argv[2]) || 120;
const COUNT_CAMS = ['KTL-A1-G-AI01', 'KTL-A1-1-AI01', 'KTL-A2-1-AI01', 'KTL-B1-G-AI01', 'KTL-CONG1-AN01', 'KTL-CONG2-CU-AN01', 'KTL-CONG2-MOI-AN01', 'KTL-CONG3-AI01'];
const BUSY = { 'KTL-A1-G': 1.0, 'KTL-CONG1': 0.85, 'KTL-A2-1': 0.6, 'KTL-B1-G': 0.45, 'KTL-A1-1': 0.4, 'KTL-CONG2-MOI': 0.3, 'KTL-CONG2-CU': 0.25, 'KTL-CONG3': 0.15 };
const PEOPLE = ['EMP003', 'EMP004', 'EMP005', 'EMP006', 'EMP007', 'EMP008', 'EMP009', 'EMP010'];
const curve = (h) => Math.max(0.05, Math.exp(-((h - 9.5) ** 2) / 4) + 0.8 * Math.exp(-((h - 13.5) ** 2) / 3) + 0.5 * Math.exp(-((h - 17) ** 2) / 2));
const vnHour = (d) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false }).format(d)) + d.getUTCMinutes() / 60;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

(async () => {
  const db = new Client({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE,
  });
  await db.connect();
  const cams = (await db.query(`SELECT d.id, d.device_code, d.zone_id, z.zone_code FROM iot_devices d LEFT JOIN zones z ON z.id = d.zone_id WHERE device_code = ANY($1)`, [COUNT_CAMS])).rows;
  const users = (await db.query(`SELECT id FROM users WHERE employee_code = ANY($1)`, [PEOPLE])).rows;
  if (!cams.length) throw new Error('Không thấy camera đếm người (KTL-*-AI01/AN01).');
  let tick = 0;
  const run = async () => {
    const now = new Date();
    const t = new Date(Math.floor(now.getTime() / 60000) * 60000);
    for (const c of cams) {
      // vài phút lại có đợt đông đột biến để thấy màu đỏ trên bản đồ nhiệt
      const surge = Math.random() < 0.08 ? 12 : 0;
      const occ = Math.max(0, Math.round(curve(vnHour(t)) * (BUSY[c.zone_code] ?? 0.3) * 38 + (Math.random() * 5 - 2) + surge));
      await db.query(
        `INSERT INTO zone_presence_events (zone_id, device_id, event_type, occupancy_count, confidence_score, event_time, source_type, metadata_json)
         VALUES ($1,$2,'count',$3,$4,$5,'ai_camera',$6::jsonb)`,
        [c.zone_id, c.id, occ, (0.86 + Math.random() * 0.13).toFixed(4), t, JSON.stringify({ sample: MARK, live: true })]);
    }
    if (users.length && Math.random() < 0.5) {
      const c = pick(cams);
      await db.query(
        `INSERT INTO zone_presence_events (zone_id, device_id, user_id, event_type, occupancy_count, confidence_score, event_time, source_type, metadata_json)
         VALUES ($1,$2,$3,$4,1,$5,$6,'ai_camera',$7::jsonb)`,
        [c.zone_id, c.id, pick(users).id, Math.random() < 0.6 ? 'appear' : 'disappear', (0.88 + Math.random() * 0.1).toFixed(4), now, JSON.stringify({ sample: MARK, live: true })]);
    }
    tick += 1;
    console.log(`${now.toLocaleTimeString('vi-VN')}  +${cams.length} mẫu đếm  (${tick}/${MINUTES})`);
    if (tick >= MINUTES) { await db.end(); process.exit(0); }
  };
  console.log(`Giả lập ${cams.length} camera, ${MINUTES} phút. Ctrl+C để dừng.`);
  await run();
  setInterval(() => run().catch((e) => { console.error(e.message); process.exit(1); }), 60000);
})().catch((e) => { console.error('LỖI:', e.message); process.exit(1); });
