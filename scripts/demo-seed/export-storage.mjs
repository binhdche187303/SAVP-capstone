// Xuất file ảnh demo (provider 'local') ra thư mục để copy vào storage của backend.
//   DEMO_DB_URL='postgresql://...' node scripts/demo-seed/export-storage.mjs [thư-mục-đích]
// Đường dẫn file = <storage root>/<storage_key>. Storage root của backend = STORAGE_LOCAL_PATH
// (mặc định ./uploads) hoặc bucket S3/MinIO. Copy thư mục demo-seed/ vào đúng root đó.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { connect } from './lib.mjs';

const outDir = process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), 'storage-export');
const c = connect();
await c.connect();
const { rows } = await c.query(
  `SELECT storage_key, file_url FROM public.media_files
    WHERE id::text LIKE 'de0de0de-%' AND storage_provider = 'local' AND mime_type = 'image/jpeg' AND file_url LIKE 'data:image/jpeg;base64,%'`,
);
for (const r of rows) {
  const dest = path.join(outDir, r.storage_key);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(r.file_url.split(',')[1], 'base64'));
}
console.log(`Đã xuất ${rows.length} ảnh vào ${outDir}`);
await c.end();
