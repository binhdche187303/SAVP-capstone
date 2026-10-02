import { AppDataSource } from '../src/database/data-source.js';
async function main() {
  const ds = await AppDataSource.initialize();
  const m = await ds.query("SELECT count(*)::int c FROM meetings WHERE meeting_code LIKE 'KPI-TEST-%'");
  const b = await ds.query("SELECT count(*)::int c FROM room_bookings WHERE booking_code LIKE 'KPI-TEST-%'");
  const a = await ds.query("SELECT count(*)::int c FROM attendance_records WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_code LIKE 'KPI-TEST-%')");
  const n = await ds.query("SELECT count(*)::int c FROM no_show_cases WHERE booking_id IN (SELECT id FROM room_bookings WHERE booking_code LIKE 'KPI-TEST-%')");
  console.log('meetings', m[0].c, 'bookings', b[0].c, 'attendance', a[0].c, 'no_show', n[0].c);
  await ds.destroy();
}
main().catch(e => { console.error(e); process.exit(1); });
