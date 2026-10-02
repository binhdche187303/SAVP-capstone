import { AppDataSource } from '../src/database/data-source.js';
async function main() {
  const ds = await AppDataSource.initialize();
  const u = await ds.query("SELECT count(*)::int c FROM room_booking_usages WHERE booking_id IN (SELECT id FROM room_bookings WHERE booking_code LIKE 'KPI-TEST-%')");
  console.log('usages', u[0].c);
  const cols = await ds.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='attendance_records' ORDER BY ordinal_position");
  console.log('attendance cols', cols.map((c:any)=>`${c.column_name}:${c.data_type}`).join(', '));
  const users = await ds.query("SELECT id FROM users WHERE deleted_at IS NULL LIMIT 5");
  console.log('users', users.length, users.map((x:any)=>x.id));
  const meetings = await ds.query("SELECT count(*)::int c FROM meetings WHERE meeting_code LIKE 'KPI-TEST-%'");
  console.log('meetings KPI', meetings[0].c);
  // try manual insert 1 row to see error
  try {
    const m = await ds.query("SELECT id, start_time, end_time FROM meetings WHERE meeting_code LIKE 'KPI-TEST-%' LIMIT 1");
    console.log('sample meeting', m[0]);
    if (m[0] && users[0]) {
      await ds.query(
        "INSERT INTO attendance_records (id, meeting_id, user_id, check_in_method, attendance_source, is_present, is_late, attendance_status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'manual', 'mixed', true, false, 'present', now(), now())",
        [m[0].id, users[0].id],
      );
      console.log('manual insert OK');
      // rollback test row
      await ds.query("DELETE FROM attendance_records WHERE meeting_id=$1 AND user_id=$2", [m[0].id, users[0].id]);
      console.log('rollback test row OK');
    }
  } catch(e:any){ console.error('manual insert failed', e.message); }
  await ds.destroy();
}
main().catch(e=>{console.error(e);process.exit(1);});
