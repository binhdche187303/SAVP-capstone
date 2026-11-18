#!/usr/bin/env node
/**
 * Captures real JSON from HGVision (READ ONLY, never writes anything) to check the field
 * shapes the SAVP backend assumes (see docs/hgvision).
 *
 * On the school machine (where HGVision runs):
 *   npm run hgvision:capture                      → reads HGVISION_BASE_URL / CLIENT_ID / CLIENT_SECRET from .env
 *   npm run hgvision:capture -- --label that      → saved to scripts/hgvision/.capture/that/
 * Compare two captures (field names/types, not values), e.g. before/after an HGVision upgrade:
 *   npm run hgvision:capture -- --compare real that
 *
 * Camera username/password fields are replaced with "***" before saving.
 * The .capture/ folder is gitignored: copy it back to the dev machine via AnyDesk; do not commit it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.join(DIR, '.capture');
const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};

function readEnv() {
  const file = path.join(DIR, '..', '..', '.env');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

// ─────────────── Compare mode ───────────────
function shape(v) {
  if (Array.isArray(v)) return v.length ? [shape(v[0])] : ['(rỗng)'];
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  return v === null ? 'null' : typeof v;
}
function diff(a, b, p, out) {
  if (typeof a === 'string' || typeof b === 'string') {
    if (a !== b && a !== '(rỗng)' && b !== '(rỗng)' && a !== 'null' && b !== 'null') out.push(`${p}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return out.push(`${p}: mảng ≠ object`);
  if (Array.isArray(a)) return diff(a[0], b[0], `${p}[]`, out);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(k in a)) out.push(`${p}.${k}: chỉ có ở bản 2`);
    else if (!(k in b)) out.push(`${p}.${k}: chỉ có ở bản 1`);
    else diff(a[k], b[k], `${p}.${k}`, out);
  }
}
if (args.includes('--compare')) {
  const [l1, l2] = args.slice(args.indexOf('--compare') + 1);
  const d1 = path.join(OUT_ROOT, l1);
  const d2 = path.join(OUT_ROOT, l2);
  let total = 0;
  for (const f of fs.readdirSync(d1).filter((x) => x.endsWith('.json')).sort()) {
    const f2 = path.join(d2, f);
    if (!fs.existsSync(f2)) { console.log(`✗ ${f}: không có ở ${l2}`); continue; }
    const a = JSON.parse(fs.readFileSync(path.join(d1, f), 'utf8'));
    const b = JSON.parse(fs.readFileSync(f2, 'utf8'));
    const out = [];
    if (a.status !== b.status) out.push(`HTTP ${a.status} ≠ ${b.status}`);
    diff(shape(a.body), shape(b.body), '$', out);
    total += out.length;
    console.log(out.length ? `≠ ${f}\n    ${out.join('\n    ')}` : `✓ ${f}`);
  }
  console.log(`\n${total} điểm khác (bản 1 = ${l1}, bản 2 = ${l2})`);
  process.exit(0);
}

// ─────────────── Capture mode ───────────────
const env = { ...readEnv(), ...process.env };
const BASE = (arg('base', env.HGVISION_BASE_URL) || '').replace(/\/+$/, '');
const ID = arg('id', env.HGVISION_CLIENT_ID);
const SECRET = arg('secret', env.HGVISION_CLIENT_SECRET);
const LABEL = arg('label', 'real');
const OUT = path.join(OUT_ROOT, LABEL);
if (!BASE || !ID || !SECRET) {
  console.error('Thiếu HGVISION_BASE_URL / HGVISION_CLIENT_ID / HGVISION_CLIENT_SECRET (trong .env hoặc --base/--id/--secret).');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const now = Math.floor(Date.now() / 1000);
const dayAgo = now - 86400;
const enc = encodeURIComponent;

function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /^(username|password)$/i.test(k) && x ? '***' : redact(x)]));
  }
  return v;
}
/** Long arrays are truncated to 5 items (keep the shape, avoid large files). */
function trim(v) {
  if (Array.isArray(v)) return v.slice(0, 5).map(trim);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x)]));
  return v;
}

let token = '';
async function call(name, p, { auth = true } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + p, { headers: auth ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20000) });
    const type = res.headers.get('content-type') || '';
    let body;
    if (type.includes('json')) body = await res.json();
    else {
      const buf = Buffer.from(await res.arrayBuffer());
      body = type.startsWith('text') || type.includes('mpegurl') ? buf.toString('utf8').slice(0, 2000) : `<${type} ${buf.length} bytes>`;
    }
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ path: p, status: res.status, content_type: type, body: trim(redact(body)) }, null, 2));
    console.log(`${res.ok ? '✓' : '✗'} ${String(res.status).padEnd(3)} ${name.padEnd(28)} ${Date.now() - started}ms`);
    return res.ok ? body : null;
  } catch (e) {
    console.log(`✗ ERR ${name.padEnd(28)} ${e.message}`);
    return null;
  }
}

console.log(`HGVision: ${BASE}  →  ${OUT}\n`);
const tokRes = await fetch(`${BASE}/api/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'client_credentials', client_id: ID, client_secret: SECRET }),
}).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }));
const tok = await tokRes.json().catch(() => ({}));
fs.writeFileSync(path.join(OUT, '00-token.json'), JSON.stringify({ status: tokRes.status, body: { ...tok, access_token: tok.access_token ? '***' : undefined } }, null, 2));
if (!tokRes.ok || !tok.access_token) {
  console.error(`Không lấy được token (HTTP ${tokRes.status}): ${JSON.stringify(tok)}`);
  process.exit(1);
}
token = tok.access_token;
console.log(`✓ token, scope = "${tok.scope}"\n`);

const cams = (await call('cameras', '/api/cameras')) || [];
await call('cameras-statuses', '/api/cameras/statuses');
await call('cameras-health', '/api/cameras/health');
await call('groups', '/api/groups');
await call('shapes', '/api/shapes');
const cam = (cams.find?.((c) => c.status === 'Online') || cams[0])?.camera_name;
if (cam) {
  await call('camera-one', `/api/cameras/${enc(cam)}`);
  await call('camera-one-health', `/api/cameras/${enc(cam)}/health`);
  await call('camera-one-logs', `/api/cameras/${enc(cam)}/logs?limit=5`);
  await call('playback-recordings', `/api/playback/recordings?camera_id=${enc(cam)}&start_time=${dayAgo}&end_time=${now}`, { auth: false });
  await call('recording-segments', `/api/recording/segments?camera_id=${enc(cam)}&start_time=${now - 3 * 3600}&end_time=${now}`, { auth: false });
  await call('playback-playlist', `/api/playback/playlist?camera_id=${enc(cam)}&start_time=${now - 600}&end_time=${now - 300}`, { auth: false });
  const live = cams.find((c) => c.camera_name === cam)?.live_hls_path;
  if (live) await call('live-hls', live.startsWith('http') ? live.replace(BASE, '') : live, { auth: false });
}
await call('history', `/api/history?start_time=${dayAgo}&end_time=${now}&page=1&page_size=5`);
await call('history-has-face', `/api/history?start_time=${dayAgo}&end_time=${now}&page=1&page_size=5&has_face=true`);
await call('history-statistics', `/api/history/statistics?start_time=${dayAgo}&end_time=${now}`);
const lines = (await call('counting-lines', '/api/counting-lines')) || [];
const line = lines[0]?.line_id;
if (line) {
  await call('counting-counts', `/api/counting-lines/${enc(line)}/counts?from=${dayAgo}&to=${now}`);
  await call('counting-timeseries', `/api/counting-lines/${enc(line)}/timeseries?from=${dayAgo}&to=${now}&bucket=3600`);
  await call('counting-events', `/api/counting-lines/${enc(line)}/events?from=${dayAgo}&to=${now}&page=1&page_size=5`);
}
for (const p of ['stats', 'resources', 'activity', 'recent-events', 'object-type-stats', 'traffic-flow', 'detection-flow', 'overview']) {
  await call(`dashboard-${p}`, `/api/dashboard/${p}`);
}
await call('notifications', '/api/notifications?limit=5');
await call('notifications-unread', '/api/notifications/unread-count');
await call('faces', '/api/identification/faces?page=1&page_size=5');
await call('license-plates', '/api/identification/license-plates?page=1&page_size=5');

console.log(`\nXong. Gửi thư mục ${OUT} về máy dev (AnyDesk → File Transfer). KHÔNG commit thư mục này.`);
