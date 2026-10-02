import { AppDataSource } from '../src/database/data-source.js';
async function main() {
  const ds = await AppDataSource.initialize();
  console.log('DB OK:', (await ds.query('select current_database() as db, current_user as usr'))[0]);

  const tests: [string, string][] = [
    ['meetings count', "SELECT count(*)::int c FROM meetings WHERE meeting_code LIKE 'KPI-TEST-%'"],
    ['room_bookings count', "SELECT count(*)::int c FROM room_bookings WHERE booking_code LIKE 'KPI-TEST-%'"],
    ['EXPLAIN meetings', "EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM meetings WHERE start_time BETWEEN '2026-07-02' AND '2026-10-02' AND deleted_at IS NULL"],
    ['EXPLAIN room_bookings', "EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM room_bookings WHERE reserved_start_time BETWEEN '2026-07-02' AND '2026-10-02'"],
    ['indexes', "SELECT tablename, indexname FROM pg_indexes WHERE tablename IN ('meetings','room_bookings','attendance_records','no_show_cases') ORDER BY tablename, indexname"],
  ];

  for (const [label, sql] of tests) {
    console.log('\n=== ' + label + ' ===');
    const rows = await ds.query(sql);
    if (rows[0] && 'QUERY PLAN' in rows[0]) {
      console.log(rows.map((r: any) => r['QUERY PLAN']).join('\n'));
    } else {
      console.log(rows);
    }
  }
  await ds.destroy();
}
main().catch(e => { console.error(e); process.exit(1); });
