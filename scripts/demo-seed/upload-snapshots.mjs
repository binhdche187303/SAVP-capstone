// Đẩy ảnh demo (khuôn mặt, người lạ, biển số) lên STORAGE của backend đã deploy,
// bằng đúng đường lưu snapshot của hệ thống (endpoint dev `mock-camera-face-scan`).
// Kết quả: dòng media_files có file thật, đặt file_code = 'RSNAP-<khoá>' để các bước seed tái sử dụng.
//
//   DEMO_DB_URL='postgresql://...' [DEMO_API_URL=https://<backend>/api/v1] node scripts/demo-seed/upload-snapshots.mjs
//
// Idempotent: chỉ tải ảnh chưa có. Chạy SAU lần seed đầu (cần user demo có sẵn), rồi chạy lại run.mjs.
// Dùng 1 cuộc họp tạm (không người tham dự) trong RM-A101 → endpoint chỉ ghi 1 event "không khớp"
// kèm snapshot; script lấy snapshot_file_id rồi xoá event + cuộc họp tạm.
import { asset, connect, DEMO_TAG } from './lib.mjs';

const API = (process.env.DEMO_API_URL ?? 'https://smartracking-be.onrender.com/api/v1').replace(/\/$/, '');
const TMP_MEETING = 'de0de0de-ffff-4000-8000-000000000001';
const CONCURRENCY = 4;

const c = connect();
await c.connect();
try {
  const faces = asset('faces.json');
  const plates = asset('plates.json');

  // 1. Danh sách ảnh cần có: khoá → data URI
  const wanted = new Map();
  const { rows: users } = await c.query(
    `SELECT employee_code, avatar_url FROM public.users WHERE id::text LIKE 'de0de0de-%' AND avatar_url LIKE 'data:image/%'`,
  );
  users.forEach((u) => wanted.set(`U-${u.employee_code}`, u.avatar_url));
  ['strangerM', 'strangerF'].forEach((g) => faces[g].forEach((f, i) => wanted.set(`S-${g}-${i}`, f.uri)));
  Object.entries(plates).forEach(([k, p]) => wanted.set(`P-${k}`, p.uri));

  const { rows: have } = await c.query(`SELECT file_code FROM public.media_files WHERE file_code LIKE 'RSNAP-%'`);
  const done = new Set(have.map((r) => r.file_code.replace('RSNAP-', '')));
  const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity);
  const todo = [...wanted].filter(([k]) => !done.has(k)).slice(0, limit);
  console.log(`Cần ${wanted.size} ảnh, đã có ${done.size}, sẽ tải ${todo.length} ảnh lên ${API}`);
  if (!todo.length) process.exit(0);

  // 2. Cuộc họp tạm trong RM-A101 (không có người tham dự)
  const { rows: [room] } = await c.query(`SELECT id FROM public.rooms WHERE room_code = 'RM-A101' AND deleted_at IS NULL`);
  const { rows: [admin] } = await c.query(`SELECT id FROM public.users WHERE username = 'sysadmin'`);
  await c.query(`DELETE FROM public.meetings WHERE id = $1`, [TMP_MEETING]);
  await c.query(
    `INSERT INTO public.meetings (id, meeting_code, title, organizer_id, host_id, room_id, status, start_time, end_time, timezone)
     VALUES ($1, 'MTG-DEMO-TMP', 'Tạm - tải ảnh demo', $2, $2, $3, 'completed', now() - interval '2 hours', now() - interval '1 hour', 'Asia/Ho_Chi_Minh')`,
    [TMP_MEETING, admin.id, room.id],
  );

  // 3. Tải từng ảnh
  let ok = 0, fail = 0;
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const [key, uri] = queue.shift();
      try {
        const res = await fetch(`${API}/dev/mock-camera-face-scan`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meetingId: TMP_MEETING, direction: 'in', snapshotImageBase64: uri }),
          signal: AbortSignal.timeout(60000),
        });
        const json = await res.json();
        const evId = json?.data?.accessLogEventId;
        if (!evId) throw new Error(`phản hồi không có accessLogEventId: ${JSON.stringify(json).slice(0, 160)}`);
        const { rows: [ev] } = await c.query(`SELECT snapshot_file_id FROM public.iot_device_events WHERE id = $1`, [evId]);
        if (!ev?.snapshot_file_id) throw new Error('event không có snapshot_file_id');
        await c.query(
          `UPDATE public.media_files SET file_code = $2, metadata_json = $3::jsonb, mime_type = 'image/jpeg' WHERE id = $1`,
          [ev.snapshot_file_id, `RSNAP-${key}`, JSON.stringify({ seed: DEMO_TAG, key })],
        );
        await c.query(`DELETE FROM public.iot_device_events WHERE id = $1`, [evId]);
        ok++;
        if (ok % 10 === 0) console.log(`  ... ${ok}/${todo.length}`);
      } catch (e) {
        fail++;
        console.error(`  ✗ ${key}: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // 4. Dọn cuộc họp tạm
  await c.query(`DELETE FROM public.iot_device_events WHERE meeting_id = $1`, [TMP_MEETING]);
  await c.query(`DELETE FROM public.meetings WHERE id = $1`, [TMP_MEETING]);
  console.log(`Xong: ${ok} ảnh đã lên storage backend, ${fail} lỗi.`);
  if (fail) process.exitCode = 1;
} finally {
  await c.end();
}
