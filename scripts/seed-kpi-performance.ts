import { AppDataSource } from '../src/database/data-source.js';

/**
 * Seed data giả để test performance KPI Dashboard (STT-10).
 * - KHÔNG phải migration — chỉ chạy khi cần test, không lên prod.
 * - Idempotent: chạy lại không nhân đôi nhờ marker `KPI-TEST-` prefix.
 * - Dùng INSERT ... SELECT generate_series (1 query / bảng, < 2s cho 3k dòng).
 *
 * Usage:
 *   npx tsx scripts/seed-kpi-performance.ts          # bơm (default 3000 meetings)
 *   npx tsx scripts/seed-kpi-performance.ts --clean  # xóa data test
 *   npx tsx scripts/seed-kpi-performance.ts --count=5000  # bơm 5000
 */

const MARKER = 'KPI-TEST-';
const DEFAULT_COUNT = 3000;

async function ensurePrerequisites(): Promise<{ roomIds: string[]; userIds: string[] }> {
  // Đảm bảo có ít nhất 1 department, 3 rooms, 5 users để FK hợp lệ
  const dept = await AppDataSource.query(`SELECT id FROM departments LIMIT 1`);
  let deptId: string;
  if (dept.length === 0) {
    const r = await AppDataSource.query(
      `INSERT INTO departments (id, name, code, created_at, updated_at) VALUES (gen_random_uuid(), 'KPI Test Dept', 'KPI-DEPT', now(), now()) RETURNING id`,
    );
    deptId = r[0].id;
    console.log('  + Created dept', deptId);
  } else deptId = dept[0].id;

  let rooms = await AppDataSource.query(`SELECT id FROM rooms WHERE deleted_at IS NULL LIMIT 3`);
  if (rooms.length < 3) {
    for (let i = rooms.length; i < 3; i++) {
      await AppDataSource.query(
        `INSERT INTO rooms (id, room_code, room_name, capacity, current_status, administrative_status, is_active, created_at, updated_at)
         VALUES (gen_random_uuid(), 'KPI-R-'|| to_char(now(),'YYYYMMDD') || '-' || lpad('${i+1}',3,'0'), 'KPI Room ${i+1}', 20, 'available','available', true, now(), now())`,
      );
    }
    rooms = await AppDataSource.query(`SELECT id FROM rooms WHERE deleted_at IS NULL LIMIT 3`);
    console.log('  + Created rooms', rooms.length);
  }

  let users = await AppDataSource.query(`SELECT id FROM users WHERE deleted_at IS NULL LIMIT 5`);
  if (users.length < 5) {
    // Tạo user tối thiểu — chỉ các cột bắt buộc
    const cols = await AppDataSource.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position`);
    console.log('  users columns:', cols.map((c: any) => c.column_name).join(', '));
    // Fallback: thử insert với các cột phổ biến, nếu lỗi sẽ báo
    for (let i = users.length; i < 5; i++) {
      try {
        await AppDataSource.query(
          `INSERT INTO users (id, email, password_hash, full_name, employee_code, account_status, created_at, updated_at)
           VALUES (gen_random_uuid(), 'kpi-test-${Date.now()}-${i}@test.local', '$2b$10$fakehashfakehashfakehashfakeha', 'KPI User ${i}', 'KPI-${Date.now()}-${i}', 'active', now(), now())`,
        );
      } catch (e: any) {
        console.error('  ! Failed to create user:', e.message);
        // Thử variant khác (username thay vì full_name...)
        try {
          await AppDataSource.query(
            `INSERT INTO users (id, email, password, full_name, created_at, updated_at)
             VALUES (gen_random_uuid(), 'kpi-test-${Date.now()}-${i}@test.local', 'fake', 'KPI User ${i}', now(), now())`,
          );
        } catch (e2: any) {
          console.error('  ! Variant also failed:', e2.message);
          throw e2;
        }
      }
    }
    users = await AppDataSource.query(`SELECT id FROM users WHERE deleted_at IS NULL LIMIT 5`);
  }

  return { roomIds: rooms.map((r: any) => r.id), userIds: users.map((u: any) => u.id) };
}

async function clean() {
  console.log('🧹 Xóa data KPI-TEST...');
  // Xóa theo thứ tự FK ngược
  const noShowDel = await AppDataSource.query(
    `DELETE FROM no_show_cases WHERE booking_id IN (SELECT id FROM room_bookings WHERE booking_code LIKE '${MARKER}%')`,
  );
  console.log('  - no_show_cases deleted (by booking_code marker)');
  const usageDel = await AppDataSource.query(
    `DELETE FROM room_booking_usages WHERE booking_id IN (SELECT id FROM room_bookings WHERE booking_code LIKE '${MARKER}%')`,
  );
  console.log('  - room_booking_usages deleted');
  await AppDataSource.query(`DELETE FROM attendance_records WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_code LIKE '${MARKER}%')`);
  console.log('  - attendance_records deleted');
  await AppDataSource.query(`DELETE FROM room_bookings WHERE booking_code LIKE '${MARKER}%'`);
  console.log('  - room_bookings deleted');
  await AppDataSource.query(`DELETE FROM meetings WHERE meeting_code LIKE '${MARKER}%'`);
  console.log('  - meetings deleted');
  console.log('✅ Đã xóa sạch data KPI-TEST');
}

async function seed(count: number) {
  // Idempotent: nếu đã có data marker thì skip bơm trùng
  const existing = await AppDataSource.query(`SELECT count(*)::int as c FROM meetings WHERE meeting_code LIKE '${MARKER}%'`);
  if (existing[0].c > 0) {
    console.log(`⚠️  Đã có ${existing[0].c} meetings marker KPI-TEST. Dùng --clean trước khi bơm lại. Skip.`);
    return;
  }

  const { roomIds, userIds } = await ensurePrerequisites();
  const roomIdsSql = `ARRAY['${roomIds.join("','")}']::uuid[]`;
  const userIdsSql = `ARRAY['${userIds.join("','")}']::uuid[]`;
  const organizerId = userIds[0];

  console.log(`\n📦 Bơm ${count} meetings + bookings + attendance + no_show + usages...`);

  // 1. meetings — 90 ngày gần nhất, mỗi ngày ~ count/90
  console.log('  → meetings...');
  await AppDataSource.query(`
    INSERT INTO meetings (id, meeting_code, title, organizer_id, room_id, meeting_type, meeting_mode, priority, status, visibility_level, start_time, end_time, timezone, created_at, updated_at)
    SELECT
      gen_random_uuid(),
      '${MARKER}' || lpad(g::text, 6, '0') || '-' || substr(gen_random_uuid()::text,1,4),
      'KPI Test Meeting ' || g,
      '${organizerId}'::uuid,
      (${roomIdsSql})[1 + floor(random()* ${roomIds.length})::int],
      (ARRAY['normal','training','interview','emergency'])[1+ floor(random()*4)::int],
      (ARRAY['offline','online','hybrid'])[1+ floor(random()*3)::int],
      (ARRAY['low','normal','high','urgent'])[1+ floor(random()*4)::int],
      (ARRAY['completed','completed','completed','cancelled','scheduled'])[1+ floor(random()*5)::int],
      'internal',
      (now() - ((90 - (g % 90)) || ' days')::interval - (floor(random()*8) || ' hours')::interval - (floor(random()*60) || ' minutes')::interval),
      (now() - ((90 - (g % 90)) || ' days')::interval - (floor(random()*8) || ' hours')::interval - (floor(random()*60) || ' minutes')::interval + interval '1 hour' + (floor(random()*60) || ' minutes')::interval),
      'Asia/Ho_Chi_Minh',
      now(), now()
    FROM generate_series(1, ${count}) g
  `);
  const mCount = await AppDataSource.query(`SELECT count(*)::int as c FROM meetings WHERE meeting_code LIKE '${MARKER}%'`);
  console.log(`    ✓ meetings: ${mCount[0].c}`);

  // 2. room_bookings — 1 booking / meeting (chỉ meetings có room_id)
  console.log('  → room_bookings...');
  await AppDataSource.query(`
    INSERT INTO room_bookings (id, booking_code, meeting_id, room_id, booking_type, reserved_start_time, reserved_end_time, status, booked_by, created_at, updated_at)
    SELECT
      gen_random_uuid(),
      '${MARKER}' || substr(gen_random_uuid()::text,1,8),
      m.id, m.room_id,
      (ARRAY['scheduled','ad_hoc'])[1+ floor(random()*2)::int],
      m.start_time, m.end_time,
      (CASE WHEN m.status='cancelled' THEN 'cancelled' ELSE (ARRAY['approved','active','completed'])[1+ floor(random()*3)::int] END),
      m.organizer_id,
      now(), now()
    FROM meetings m WHERE m.meeting_code LIKE '${MARKER}%'
  `);
  const bCount = await AppDataSource.query(`SELECT count(*)::int as c FROM room_bookings WHERE booking_code LIKE '${MARKER}%'`);
  console.log(`    ✓ room_bookings: ${bCount[0].c}`);

  // 3. room_booking_usages — 1 usage / booking
  console.log('  → room_booking_usages...');
  await AppDataSource.query(`
    INSERT INTO room_booking_usages (id, booking_id, meeting_id, room_id, reserved_start_time, reserved_end_time, actual_start_time, actual_end_time, usage_status, occupancy_source)
    SELECT
      gen_random_uuid(), b.id, b.meeting_id, b.room_id, b.reserved_start_time, b.reserved_end_time,
      CASE WHEN b.status IN ('active','completed') THEN b.reserved_start_time + interval '2 minutes' ELSE NULL END,
      CASE WHEN b.status='completed' THEN b.reserved_end_time ELSE NULL END,
      (CASE WHEN b.status='cancelled' THEN 'no_show' WHEN b.status='completed' THEN (ARRAY['completed','early_empty'])[1+ floor(random()*2)::int] ELSE 'in_use' END),
      'camera'
    FROM room_bookings b WHERE b.booking_code LIKE '${MARKER}%'
  `);
  console.log('    ✓ room_booking_usages done');

  // 4. attendance_records — 3-5 records / meeting (mỗi user 1 record cho 60% meetings)
  console.log('  → attendance_records...');
  await AppDataSource.query(`
    INSERT INTO attendance_records (id, meeting_id, user_id, check_in_method, attendance_source, check_in_time, check_out_time, is_present, is_late, late_minutes, attendance_status, created_at, updated_at)
    SELECT
      gen_random_uuid(), m.id, u::uuid,
      (ARRAY['manual','door_camera','room_camera'])[1+ floor(random()*3)::int],
      'mixed',
      CASE WHEN random() < 0.85 THEN m.start_time + (floor(random()*20) || ' minutes')::interval ELSE NULL END,
      CASE WHEN random() < 0.8 THEN m.end_time - (floor(random()*10) || ' minutes')::interval ELSE NULL END,
      random() < 0.85,
      random() < 0.15,
      CASE WHEN random() < 0.15 THEN floor(random()*15)::int ELSE NULL END,
      (ARRAY['present','present','late','absent'])[1+ floor(random()*4)::int],
      now(), now()
    FROM meetings m
    CROSS JOIN unnest(${userIdsSql}) AS u
    WHERE m.meeting_code LIKE '${MARKER}%' AND random() < 0.6
  `);
  const aCount = await AppDataSource.query(`SELECT count(*)::int as c FROM attendance_records WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_code LIKE '${MARKER}%')`);
  console.log(`    ✓ attendance_records: ${aCount[0].c}`);

  // 5. no_show_cases — 5% bookings
  console.log('  → no_show_cases...');
  await AppDataSource.query(`
    INSERT INTO no_show_cases (id, booking_id, meeting_id, room_id, detection_status, detected_at)
    SELECT gen_random_uuid(), b.id, b.meeting_id, b.room_id,
      (ARRAY['risk','confirmed','released'])[1+ floor(random()*3)::int],
      b.reserved_start_time + interval '15 minutes'
    FROM room_bookings b
    WHERE b.booking_code LIKE '${MARKER}%' AND b.status IN ('approved','active')
    ORDER BY random() LIMIT ${Math.ceil(count * 0.05)}
  `);
  const nCount = await AppDataSource.query(`SELECT count(*)::int as c FROM no_show_cases WHERE booking_id IN (SELECT id FROM room_bookings WHERE booking_code LIKE '${MARKER}%')`);
  console.log(`    ✓ no_show_cases: ${nCount[0].c}`);

  // Tổng kết
  console.log('\n✅ Seed KPI-TEST xong!');
  console.log(`   meetings: ${mCount[0].c} | bookings: ${bCount[0].c} | attendance: ${aCount[0].c} | no_show: ${nCount[0].c}`);
  console.log(`   Marker: meeting_code/booking_code LIKE '${MARKER}%'`);
  console.log(`   Xóa: npx tsx scripts/seed-kpi-performance.ts --clean`);
}

async function main() {
  const args = process.argv.slice(2);
  const isClean = args.includes('--clean');
  const countArg = args.find((a) => a.startsWith('--count='));
  const count = countArg ? parseInt(countArg.split('=')[1], 10) : DEFAULT_COUNT;

  console.log('🔌 Kết nối DB...');
  await AppDataSource.initialize();
  console.log('✅ DB connected');

  try {
    if (isClean) await clean();
    else await seed(count);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((e) => {
  console.error('❌ Lỗi:', e);
  process.exit(1);
});
