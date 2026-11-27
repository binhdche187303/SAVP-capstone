// From backend root: node scripts/seed-report-runs-ui.cjs [cleanup]
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const marker = 'report-runs-ui-20261123';
async function main() {
  const db = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false });
  await db.connect();
  try {
    await db.query('BEGIN');
    if (process.argv[2] === 'cleanup') {
      const result = await db.query("DELETE FROM report_schedules WHERE filters_json->>'uiTestBatch' = $1", [marker]);
      await db.query('COMMIT');
      console.log(`Removed ${result.rowCount} test schedules and their test history.`);
      return;
    }
    const exists = await db.query("SELECT id FROM report_schedules WHERE filters_json->>'uiTestBatch' = $1", [marker]);
    if (exists.rowCount) { await db.query('COMMIT'); console.log('Test data already exists.'); return; }
    const owner = (await db.query("SELECT id FROM users WHERE username = 'sysadmin' LIMIT 1")).rows[0];
    if (!owner) throw new Error('System Admin account not found.');
    const types = ['staff-attendance', 'student-attendance', 'gate-access', 'room-utilization', 'vehicle', 'visitor', 'security-alert'];
    const titles = ['Chuyên cần cán bộ', 'Chuyên cần sinh viên', 'Ra vào khuôn viên', 'Sử dụng phòng họp', 'Phương tiện', 'Khách đến làm việc', 'Sự kiện an ninh'];
    for (let i = 0; i < types.length; i++) {
      const name = `[UI TEST] Lịch gửi ${titles[i]}`;
      const schedule = (await db.query(`INSERT INTO report_schedules
        (name,report_type,filters_json,period,frequency,send_time,formats,recipients_json,enabled,owner_user_id)
        VALUES ($1,$2,$3,'last_month','monthly','08:00',ARRAY['xlsx'],'[]',false,$4) RETURNING id`,
        [name, types[i], { uiTestBatch: marker }, owner.id])).rows[0];
      for (let j = 0; j < 4; j++) {
        const at = new Date(Date.now() - (i * 4 + j) * 3600000);
        const status = j % 2 === 0 ? 'success' : 'failed';
        await db.query(`INSERT INTO report_schedule_runs
          (schedule_id,schedule_name,report_type,trigger,status,period_from,period_to,formats,recipient_count,error_message,started_at,finished_at,created_at)
          VALUES ($1,$2,$3,$4,$5,CURRENT_DATE - 7,CURRENT_DATE,ARRAY[]::text[],$6,$7,$8,$8,$8)`,
          [schedule.id, name, types[i], j < 2 ? 'scheduled' : 'manual', status, [1,3,12,25][j],
            status === 'failed' ? '[UI TEST] Không gửi được báo cáo. Đây là dữ liệu thử giao diện.' : null, at]);
      }
    }
    await db.query('COMMIT');
    console.log('Created 7 disabled test schedules and 28 history records (14 success, 14 failed). No emails or jobs dispatched.');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
