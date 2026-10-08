// Seed dữ liệu DEMO (tag DEMO-2026-10) vào Postgres/Neon.
//
//   DEMO_DB_URL='postgresql://...' node scripts/demo-seed/run.mjs            # nạp (idempotent: tự dọn bản demo cũ trước)
//   DEMO_DB_URL='postgresql://...' node scripts/demo-seed/run.mjs --dry-run  # chạy hết rồi ROLLBACK (kiểm tra lỗi)
//   DEMO_DB_URL='postgresql://...' node scripts/demo-seed/cleanup-demo.mjs   # xoá toàn bộ dữ liệu demo
//
// Chạy lại vào sáng ngày demo để các số liệu "hôm nay" được dựng lại theo ngày đó.
import { connect } from './lib.mjs';
import { cleanupDemo } from './cleanup-lib.mjs';
import { seedPeople } from './01-people.mjs';
import { seedSites } from './02-sites.mjs';
import { seedTraffic } from './03-traffic.mjs';
import { seedMeetings } from './04-meetings.mjs';
import { seedContent } from './05-content.mjs';
import { seedAcademic } from './06-academic.mjs';
import { seedRoomFaces } from './07-room-faces.mjs';

const dryRun = process.argv.includes('--dry-run');
const only = (process.argv.find((a) => a.startsWith('--until='))?.split('=')[1]) ?? 'all';

const PHASES = [
  ['people', seedPeople],
  ['sites', seedSites],
  ['traffic', seedTraffic],
  ['meetings', seedMeetings],
  ['content', seedContent],
  ['academic', seedAcademic],
  ['roomFaces', seedRoomFaces],
];

async function loadRef(c) {
  const map = async (sql, k, v) =>
    Object.fromEntries((await c.query(sql)).rows.map((r) => [r[k], r[v]]));
  return {
    role: await map('SELECT role_code, id FROM public.roles', 'role_code', 'id'),
    dept: await map('SELECT department_code, id FROM public.departments WHERE deleted_at IS NULL', 'department_code', 'id'),
    user: await map(`SELECT username, id FROM public.users WHERE id::text NOT LIKE 'de0de0de-%' AND deleted_at IS NULL`, 'username', 'id'),
    room: await map('SELECT room_code, id FROM public.rooms WHERE deleted_at IS NULL', 'room_code', 'id'),
  };
}

const c = connect();
await c.connect();
const started = Date.now();
try {
  await c.query('BEGIN');
  const removed = await cleanupDemo(c, { keepSnapshots: true });
  console.log(`🧹 Dọn bản demo cũ: ${removed} dòng`);

  const snap = new Map((await c.query(`SELECT file_code, id FROM public.media_files WHERE file_code LIKE 'RSNAP-%'`)).rows.map((x) => [x.file_code.replace('RSNAP-', ''), x.id]));
  console.log(`🖼  Ảnh snapshot đã có trên storage backend: ${snap.size}`);
  const ctx = { c, now: new Date(), ref: await loadRef(c), out: {}, snap };
  const report = {};
  for (const [name, fn] of PHASES) {
    const n = await fn(ctx);
    report[name] = n;
    console.log(`✅ ${name}:`, JSON.stringify(n));
    if (only === name) break;
  }

  if (dryRun) {
    await c.query('ROLLBACK');
    console.log('↩️  --dry-run: đã ROLLBACK, không ghi gì.');
  } else {
    await c.query('COMMIT');
    console.log('💾 COMMIT xong.');
  }
} catch (err) {
  await c.query('ROLLBACK').catch(() => {});
  console.error('❌ Lỗi — đã ROLLBACK toàn bộ:', err.message);
  if (err.detail) console.error('   detail:', err.detail);
  if (err.where) console.error('   where:', err.where);
  process.exitCode = 1;
} finally {
  await c.end();
  console.log(`⏱  ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
