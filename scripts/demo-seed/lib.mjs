// Helper dùng chung cho bộ seed DEMO (tag DEMO-2026-10).
//
// Quy ước nhận diện để dọn dẹp: MỌI dòng demo có id (uuid) bắt đầu bằng
// DEMO_PREFIX. cleanup-demo.mjs xoá theo tiền tố này — không đụng dữ liệu thật.
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const DEMO_TAG = 'DEMO-2026-10';
export const DEMO_PREFIX = 'de0de0de-';

const here = path.dirname(fileURLToPath(import.meta.url));
export const asset = (name) =>
  JSON.parse(readFileSync(path.join(here, 'assets', name), 'utf8'));

// Mỗi bảng một mã 4 hex để id ổn định + duy nhất: de0de0de-TTTT-4000-8000-NNNNNNNNNNNN
const tableCodes = new Map();
export function did(table, n) {
  if (!tableCodes.has(table)) {
    tableCodes.set(table, (tableCodes.size + 1).toString(16).padStart(4, '0'));
  }
  return `${DEMO_PREFIX}${tableCodes.get(table)}-4000-8000-${String(n).padStart(12, '0')}`;
}

/** Bộ sinh số giả-ngẫu-nhiên có seed để chạy lại ra cùng dữ liệu. */
export function rng(seed = 20261008) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle: (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}

export function connect() {
  const url = process.env.DEMO_DB_URL;
  if (!url) throw new Error('Thiếu biến môi trường DEMO_DB_URL (connection string Neon).');
  return new pg.Client({ connectionString: url });
}

/** Chèn nhiều dòng (cùng tập cột). Object/array → JSON. Trả về số dòng chèn. */
export async function insert(c, table, rows, { onConflict = 'DO NOTHING' } = {}) {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const values = [];
  const params = [];
  rows.forEach((row, i) => {
    const ph = cols.map((col, j) => {
      let v = row[col];
      if (v !== null && v !== undefined && typeof v === 'object' && !(v instanceof Date)) {
        v = JSON.stringify(v);
      }
      params.push(v === undefined ? null : v);
      return `$${i * cols.length + j + 1}`;
    });
    values.push(`(${ph.join(',')})`);
  });
  // pg giới hạn 65535 tham số/lệnh → chia lô
  const perBatch = Math.max(1, Math.floor(60000 / cols.length));
  let total = 0;
  for (let off = 0; off < rows.length; off += perBatch) {
    const sliceRows = values.slice(off, off + perBatch);
    const sliceParams = params.slice(off * cols.length, (off + perBatch) * cols.length);
    // đánh số lại placeholder cho lô
    let k = 0;
    const text = sliceRows.map((r) => r.replace(/\$\d+/g, () => `$${++k}`)).join(',');
    const sql = `INSERT INTO public."${table}" (${cols.map((x) => `"${x}"`).join(',')}) VALUES ${text} ON CONFLICT ${onConflict}`;
    const res = await c.query(sql, sliceParams);
    total += res.rowCount ?? 0;
  }
  return total;
}

export const iso = (d) => d.toISOString();
/** Mốc thời gian theo giờ VN (UTC+7): ngày tương đối so với hôm nay. */
export function vnTime(dayOffset, hour, minute = 0, base = new Date()) {
  const d = new Date(base);
  const vn = new Date(d.getTime() + 7 * 3600 * 1000);
  vn.setUTCDate(vn.getUTCDate() + dayOffset);
  vn.setUTCHours(hour, minute, 0, 0);
  return new Date(vn.getTime() - 7 * 3600 * 1000);
}
export const addMin = (d, m) => new Date(d.getTime() + m * 60000);
