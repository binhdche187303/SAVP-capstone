// Run from backend root: node scripts/seed-visitor-alert-ui.cjs [cleanup]
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const marker = 'visitor-alert-ui-20261123';
async function main() {
  const db = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false });
  await db.connect();
  try {
    await db.query('BEGIN');
    if (process.argv[2] === 'cleanup') {
      const result = await db.query("DELETE FROM security_alerts WHERE payload_json->>'uiTestBatch' = $1", [marker]);
      await db.query('COMMIT');
      console.log(`Removed ${result.rowCount} UI test alerts.`);
      return;
    }
    const exists = await db.query("SELECT count(*)::int AS count FROM security_alerts WHERE payload_json->>'uiTestBatch' = $1", [marker]);
    if (exists.rows[0].count) {
      await db.query('COMMIT');
      console.log('UI test alerts already exist; no duplicates added.');
      return;
    }
    const zones = (await db.query('SELECT id, zone_name FROM zones WHERE deleted_at IS NULL ORDER BY zone_name')).rows;
    const actor = (await db.query("SELECT id FROM users WHERE username = 'guard.demo' LIMIT 1")).rows[0]?.id || null;
    const statuses = ['new', 'acknowledged', 'resolved'];
    const severities = ['low', 'medium', 'high', 'urgent', 'critical'];
    const types = ['visitor_overstay', 'visitor_must_leave', 'visitor_zone_violation'];
    let count = 0;
    for (const [s, status] of statuses.entries()) {
      for (const [v, severity] of severities.entries()) {
        const index = count++;
        const zone = index % 5 === 0 ? null : zones[index % zones.length];
        const at = new Date(Date.now() - index * 60000);
        const payload = { uiTestBatch: marker, visitorName: `[UI TEST] ${index % 2 ? 'Nguyễn Minh Anh' : 'Trần Thị Minh Châu'} ${index + 1}`,
          code: `UI-VIS-${String(index + 1).padStart(3, '0')}`,
          detail: '[UI TEST] Cảnh báo thử để kiểm tra bố cục và bộ lọc.',
          ...(zone ? { zoneName: zone.zone_name } : {}),
          ...(index % 3 ? { cameraName: '[UI TEST] Camera hành lang tầng 2', cameraGroupName: '[UI TEST] Nhóm camera tòa nhà A' } : {}) };
        await db.query(`INSERT INTO security_alerts
          (alert_type,severity,status,zone_id,triggered_at,last_seen_at,occurrence_count,payload_json,
           acknowledged_by,acknowledged_at,resolved_by,resolved_at,resolution_note,dedupe_key)
          VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [types[(s + v) % types.length], severity, status, zone?.id || null, at, index + 1, payload,
            status !== 'new' ? actor : null, status !== 'new' ? at : null,
            status === 'resolved' ? actor : null, status === 'resolved' ? at : null,
            status === 'resolved' ? '[UI TEST] Đã kiểm tra và xử lý.' : null, `${marker}-${index}`]);
      }
    }
    await db.query('COMMIT');
    console.log(`Created ${count} UI test alerts: 5 per status.`);
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
