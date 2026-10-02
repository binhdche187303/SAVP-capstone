import { AppDataSource } from '../src/database/data-source.js';

async function testApi() {
  // Lấy 1 user admin id để test trực tiếp repository thay vì qua HTTP
  const ds = await AppDataSource.initialize();
  const user = await ds.query("SELECT id, email FROM users WHERE email='sysadmin@meetingsys.vn' LIMIT 1");
  console.log('admin user', user[0]);

  // Test raw queries mà DashboardOverviewRepository đang chạy (7 queries)
  const from = '2026-07-02', to = '2026-10-02';
  const t0 = Date.now();
  const mCount = await ds.query(
    `SELECT COUNT(*)::int AS cnt FROM meetings m WHERE m.start_time >= ($1 || ' 00:00:00+07')::timestamptz AND m.start_time <= ($2 || ' 23:59:59.999+07')::timestamptz AND m.status <> 'draft' AND m.deleted_at IS NULL`,
    [from, to]
  );
  console.log('countMeetings', mCount[0].cnt, `${Date.now()-t0}ms`);

  const t1 = Date.now();
  const activeRooms = await ds.query(
    `SELECT COUNT(DISTINCT rb.room_id)::int AS cnt FROM room_bookings rb INNER JOIN meetings m ON m.id = rb.meeting_id WHERE m.start_time >= ($1 || ' 00:00:00+07')::timestamptz AND m.start_time <= ($2 || ' 23:59:59.999+07')::timestamptz AND m.status <> 'draft' AND m.deleted_at IS NULL AND rb.status IN ('approved','active','completed','released')`,
    [from, to]
  );
  console.log('activeRooms', activeRooms[0].cnt, `${Date.now()-t1}ms`);

  const t2 = Date.now();
  const util = await ds.query(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (rbu.reserved_end_time - rbu.reserved_start_time))/60),0)::numeric AS reserved FROM room_booking_usages rbu INNER JOIN meetings m ON m.id=rbu.meeting_id WHERE m.start_time >= ($1 || ' 00:00:00+07')::timestamptz AND m.start_time <= ($2 || ' 23:59:59.999+07')::timestamptz AND m.status <> 'draft' AND m.deleted_at IS NULL`,
    [from, to]
  );
  console.log('utilization', util[0].reserved, `${Date.now()-t2}ms`);

  const t3 = Date.now();
  const noShow = await ds.query(
    `SELECT (SELECT COUNT(*)::int FROM no_show_cases nsc INNER JOIN meetings m ON m.id=nsc.meeting_id WHERE m.start_time >= ($1 || ' 00:00:00+07')::timestamptz AND m.start_time <= ($2 || ' 23:59:59.999+07')::timestamptz AND m.status <> 'draft' AND m.deleted_at IS NULL AND nsc.detection_status IN ('confirmed','released')) AS no_show_count, (SELECT COUNT(*)::int FROM room_bookings rb INNER JOIN meetings m ON m.id=rb.meeting_id WHERE m.start_time >= ($1 || ' 00:00:00+07')::timestamptz AND m.start_time <= ($2 || ' 23:59:59.999+07')::timestamptz AND m.status <> 'draft' AND m.deleted_at IS NULL AND rb.status IN ('approved','active','completed','released')) AS booking_count`,
    [from, to]
  );
  console.log('noShow', noShow[0], `${Date.now()-t3}ms`);

  const t4 = Date.now();
  const att = await ds.query(
    `SELECT COUNT(*)::int AS total_count, COUNT(*) FILTER (WHERE ar.is_present=true AND ar.is_late=false)::int AS on_time_count FROM attendance_records ar INNER JOIN meetings m ON m.id=ar.meeting_id WHERE m.start_time >= ($1 || ' 00:00:00+07')::timestamptz AND m.start_time <= ($2 || ' 23:59:59.999+07')::timestamptz AND m.status <> 'draft' AND m.deleted_at IS NULL AND ar.attendance_status IN ('present','late')`,
    [from, to]
  );
  console.log('attendance', att[0], `${Date.now()-t4}ms`);

  console.log(`\nTotal sequential: ${Date.now()-t0}ms (nếu Promise.all thì ~max của các query)`);

  // Test login để lấy token
  await ds.destroy();
  console.log('\n--- Test login via HTTP ---');
  const res = await fetch('http://localhost:3000/api/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sysadmin@meetingsys.vn', password: 'Abcd1234@' }),
  });
  const body = await res.text();
  console.log('login status', res.status, body.slice(0,500));
  if (res.ok) {
    const j = JSON.parse(body);
    const token = j.data?.accessToken || j.accessToken || j.token;
    console.log('token', token?.slice(0,30)+'...');
    if (token) {
      for (let i=1;i<=3;i++) {
        const t = Date.now();
        const r = await fetch(`http://localhost:3000/api/v1/analytics/dashboard/overview?from=${from}&to=${to}`, { headers:{ Authorization:`Bearer ${token}` }});
        const b = await r.text();
        console.log(`API lan ${i}: ${Date.now()-t}ms HTTP ${r.status} ${b.slice(0,300)}`);
      }
    }
  }
}
testApi().catch(e=>{console.error(e);process.exit(1);});
