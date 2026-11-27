// Xoá toàn bộ dữ liệu demo sau khi demo xong.
//   DEMO_DB_URL='postgresql://...' node scripts/demo-seed/cleanup-demo.mjs
import { connect } from './lib.mjs';
import { cleanupDemo } from './cleanup-lib.mjs';

const c = connect();
await c.connect();
try {
  await c.query('BEGIN');
  const n = await cleanupDemo(c);
  await c.query('COMMIT');
  console.log(`🧹 Đã xoá ${n} dòng dữ liệu demo (id bắt đầu bằng de0de0de-). Dữ liệu thật không bị đụng.`);
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  console.error('❌', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
