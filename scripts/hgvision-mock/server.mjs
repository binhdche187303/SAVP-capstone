#!/usr/bin/env node
/**
 * HGVision mock server, for DEV ONLY. It imitates docs/hgvision/openapi-1.0.0.json.
 *
 * Purpose: build and test SAVP without access to the real HGVision server.
 *   - Read APIs (cameras, history, counting lines, dashboard, playback...) return
 *     deterministic generated data. Data comes from timestamps, so reloading the page
 *     does not make it "jump around".
 *   - Write APIs for identities (faces, license plates, blacklist) are stored in
 *     .state/ so you can check what SAVP pushed over.
 *
 * Run:   npm run hgvision:mock          (port 8199)
 * Media: npm run hgvision:mock:media    (generate sample video/HLS/image with ffmpeg, optional)
 * SAVP:  HGVISION_BASE_URL=http://localhost:8199
 *        HGVISION_CLIENT_ID=cli_mock  HGVISION_CLIENT_SECRET=sk_mock
 *
 * Env:
 *   MOCK_PORT=8199
 *   MOCK_CLIENT_ID / MOCK_CLIENT_SECRET     mock client credentials
 *   MOCK_SCOPES="cameras:read ..."          granted scopes (default: all)
 *   MOCK_OFFLINE="Cam A,Cam B"              force these cameras offline
 *   MOCK_CROWD_BOOST=1                      multiplier for people entering halls (2 = crowd alert fires early)
 *   MOCK_DISK_PERCENT=78                    disk % reported by dashboard/resources
 *   MOCK_SEARCH_IDENT=K245022256            faces/search always returns this person (when the image does not match)
 *   MOCK_PLATE=51F12345                     read-from-image always returns this plate
 *   MOCK_LOG=1                              log each request
 *
 * ASSUMPTIONS still to check against the real server (stage B):
 *   - Counting-line events: direction 1 = IN, -1 = OUT.
 *   - POST faces with an existing face_ident → 400 (use POST /faces/{id}/images to add images).
 *   - live_hls_path is a relative path served by :8113.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(DIR, '.state');
const MEDIA_DIR = path.join(DIR, '.media');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

const env = process.env;
const PORT = Number(env.MOCK_PORT || 8199);
const CLIENT_ID = env.MOCK_CLIENT_ID || 'cli_mock';
const CLIENT_SECRET = env.MOCK_CLIENT_SECRET || 'sk_mock';
const ALL_SCOPES = [
  'cameras:read', 'cameras:write', 'history:read', 'history:write',
  'counting:read', 'dashboard:read', 'notifications:read', 'notifications:write',
  'faces:read', 'faces:write', 'plates:read', 'plates:write', 'playback:read',
];
const GRANTED = (env.MOCK_SCOPES || ALL_SCOPES.join(' ')).split(/\s+/).filter(Boolean);
const FORCED_OFFLINE = new Set((env.MOCK_OFFLINE || '').split(',').map((s) => s.trim()).filter(Boolean));
const CROWD_BOOST = Number(env.MOCK_CROWD_BOOST || 1);
const DISK_PERCENT = Number(env.MOCK_DISK_PERCENT || 78);
const LOG = env.MOCK_LOG === '1';
const VN_OFFSET = 7 * 3600;
const DAY = 86400;

// ─────────────────────────── Static data ───────────────────────────

const GROUPS = [
  { GROUP_NAME: 'Cong', DESCRIPTION: 'Camera cổng ra vào', LATITUDE: 10.7941, LONGITUDE: 106.7212 },
  { GROUP_NAME: 'Toa A', DESCRIPTION: 'Toà A – sảnh, hội trường', LATITUDE: 10.7945, LONGITUDE: 106.7218 },
  { GROUP_NAME: 'Toa B', DESCRIPTION: 'Toà B – phòng học', LATITUDE: 10.7949, LONGITUDE: 106.7221 },
  { GROUP_NAME: 'Bai xe', DESCRIPTION: 'Bãi giữ xe', LATITUDE: 10.7938, LONGITUDE: 106.7209 },
];

// flaky: offline 3 of every 10 minutes (to test offline alerts and recording gaps).
// weak: weak connection (low FPS, high latency).
const CAMERAS = [
  { name: 'Cong chinh', group: 'Cong', ip: '192.168.10.11', ai: true, face: true, lp: true, rec: true, lat: 10.79412, lng: 106.72118 },
  { name: 'Cong 2 huong vao', group: 'Cong', ip: '192.168.10.12', ai: true, face: false, lp: true, rec: true, flaky: true, lat: 10.79401, lng: 106.72135 },
  { name: 'Sanh A', group: 'Toa A', ip: '192.168.10.21', ai: true, face: true, lp: false, rec: true, lat: 10.79451, lng: 106.72177 },
  { name: 'Hoi truong A - cua 1', group: 'Toa A', ip: '192.168.10.22', ai: true, face: true, lp: false, rec: true, lat: 10.79458, lng: 106.72186 },
  { name: 'Hoi truong A - cua 2', group: 'Toa A', ip: '192.168.10.23', ai: true, face: true, lp: false, rec: true, lat: 10.79463, lng: 106.72192 },
  { name: 'Phong B.101', group: 'Toa B', ip: '192.168.10.31', ai: true, face: true, lp: false, rec: true, weak: true, lat: 10.79489, lng: 106.72208 },
  { name: 'Phong B.102', group: 'Toa B', ip: '192.168.10.32', ai: false, face: false, lp: false, rec: false, lat: 10.79493, lng: 106.72214 },
  { name: 'Bai xe', group: 'Bai xe', ip: '192.168.10.41', ai: true, face: false, lp: true, rec: true, lat: 10.79377, lng: 106.72089 },
].map((c, i) => ({ ...c, index: i + 1, id: uuidFrom(c.name) }));
const CAM_BY_NAME = new Map(CAMERAS.map((c) => [c.name, c]));
const camOf = (raw) => {
  let key = raw;
  try { key = decodeURIComponent(raw); } catch { /* keep raw */ }
  return CAM_BY_NAME.get(key) || CAMERAS.find((c) => c.id === key);
};

// kind: hall_in = IN direction goes into the hall; hall_rev = IN direction leaves the hall;
// gate = gate (people + vehicles); room = classroom door.
const LINES = [
  { line_id: 'line_ht_cua1', line_name: 'Line_Cua1', camera: 'Hoi truong A - cua 1', kind: 'hall_in', x1: 120, y1: 520, x2: 1160, y2: 520, nx: 0, ny: -1 },
  { line_id: 'line_ht_cua2', line_name: 'Line_Cua2', camera: 'Hoi truong A - cua 2', kind: 'hall_rev', x1: 140, y1: 480, x2: 1140, y2: 500, nx: 0, ny: 1 },
  { line_id: 'line_cong_chinh', line_name: 'Vach_Cong_Chinh', camera: 'Cong chinh', kind: 'gate', x1: 80, y1: 600, x2: 1200, y2: 600, nx: 0, ny: -1 },
  { line_id: 'line_cong2', line_name: 'Vach_Cong_2', camera: 'Cong 2 huong vao', kind: 'gate', x1: 60, y1: 560, x2: 1220, y2: 580, nx: 0, ny: -1 },
  { line_id: 'line_b101', line_name: 'Cua_B101', camera: 'Phong B.101', kind: 'room', x1: 900, y1: 200, x2: 900, y2: 700, nx: -1, ny: 0 },
];
const LINE_BY_ID = new Map(LINES.map((l) => [l.line_id, l]));

const SHAPES = [
  { camera_name: 'Sanh A', shape_id: 'roi_sanh', shape_name: 'Vung sanh', shape_type: 'polygon', data: '[[100,100],[1180,100],[1180,700],[100,700]]' },
  { camera_name: 'Bai xe', shape_id: 'roi_baixe', shape_name: 'Lan vao bai', shape_type: 'polygon', data: '[[300,200],[980,200],[1100,700],[200,700]]' },
];

const SAMPLE_PLATES = ['51F12345', '59X167890', '30A56789', '51G24680', '59D113579', '50H97531'];
const OBJECT_TYPES = ['pedestrian', 'car', 'motorbike', 'truck', 'bus', 'bicycle'];

// ─────────────────────────── State (written by SAVP) ───────────────────────────

const DEFAULT_STATE = {
  faces: {
    K245022256: { face_infor: 'Sinh viên mẫu (mock)', is_blacklist: 0, visible_to: 'admin_only', images: [] },
    DH612: { face_infor: 'Giảng viên mẫu (mock)', is_blacklist: 0, visible_to: 'admin_only', images: [] },
    'BL-0001': { face_infor: 'Tran Van B – danh sách đen mẫu', is_blacklist: 1, visible_to: 'admin_only', images: [] },
  },
  plates: {
    '51F12345': { ident: 'DH612', lp_infor: 'Xe giảng viên', visible_to: 'all', is_blacklist: 0 },
    '50H97531': { ident: 'Khong ro', lp_infor: 'Xe danh sách đen mẫu', visible_to: 'all', is_blacklist: 1 },
  },
  readNotifications: [],
};
let state = loadState();

function loadState() {
  try {
    return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}
function saveState() {
  historyCache.clear();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─────────────────────────── Utilities ───────────────────────────

function uuidFrom(s) {
  const h = crypto.createHash('md5').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
/** Deterministic random number in [0,1) from any key. */
function rnd(...key) {
  const h = crypto.createHash('md5').update(key.join('|')).digest();
  return h.readUInt32LE(0) / 0x100000000;
}
const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];
/** Time params accept seconds or milliseconds (> 1e11 means milliseconds). Returns seconds. */
function toSec(v, def) {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
}
const nowSec = () => Math.floor(Date.now() / 1000);
const vnHour = (t) => Math.floor(((t + VN_OFFSET) % DAY) / 3600);
const startOfVnDay = (t) => t - ((t + VN_OFFSET) % DAY);
const clampRange = (from, to, maxSec) => [Math.max(from, to - maxSec), to];

/** Camera online at minute t? (flaky: offline 3 of every 10 minutes; weak: rarely offline) */
function camOnline(cam, t) {
  if (FORCED_OFFLINE.has(cam.name)) return false;
  const minute = Math.floor(t / 60);
  if (cam.flaky) return minute % 10 >= 3;
  if (cam.weak) return rnd('weak', Math.floor(t / 900)) > 0.04;
  return true;
}
const camStatus = (cam) => (camOnline(cam, nowSec()) ? 'Online' : 'Offline');

// ─────────────────────────── Generated data: history ───────────────────────────

const HISTORY_STEP = 20; // one event every 20 seconds, across all cameras

const historyCache = new Map(); // t -> event; cleared whenever state changes
function historyAt(t) {
  if (historyCache.has(t)) return historyCache.get(t);
  const ev = buildHistoryAt(t);
  if (historyCache.size > 50000) historyCache.clear();
  historyCache.set(t, ev);
  return ev;
}
function buildHistoryAt(t) {
  const r = (k) => rnd('h', t, k);
  const candidates = CAMERAS.filter((c) => c.ai && camOnline(c, t));
  if (!candidates.length) return null;
  const cam = pick(candidates, r('cam'));
  const objectId = `obj_${t}`;
  const roll = r('type');
  let objectType = 'pedestrian';
  if (cam.lp && roll > 0.45) objectType = roll > 0.85 ? 'car' : roll > 0.8 ? 'truck' : 'motorbike';
  else if (roll > 0.97) objectType = 'bicycle';

  const ev = {
    object_id: objectId,
    camera_id: cam.name,
    object_type: objectType,
    object_image_path: `events/${objectId}.jpg`,
    lp_text: '', lp_ident: '', lp_type: '', lp_image_path: '',
    face_ident_text: '', face_image_path: '',
    first_timestamp: t,
    last_timestamp: t + 2 + Math.floor(r('dur') * 6),
    confidence: Math.round((0.7 + r('conf') * 0.29) * 100) / 100,
    is_manual_update: false,
    collection_name: 'mock',
  };

  if (objectType === 'pedestrian' && cam.face && r('hasface') < 0.8) {
    ev.face_image_path = `faces/${objectId}.jpg`;
    // known = registered person; empty = stranger. Blacklist shows up rarely (~1 in 150 faces).
    ev.face_ident_text = knownIdent(r('bl'), r('known'), r('who'));
  }
  if (objectType !== 'pedestrian' && objectType !== 'bicycle') {
    ev.lp_text = knownPlate(r('bl'), r('lpknown'), r('lp')) || pick(SAMPLE_PLATES.filter((p) => !state.plates[p]?.is_blacklist), r('lp2'));
    ev.lp_ident = state.plates[ev.lp_text]?.ident || '';
    ev.lp_type = r('lptype') < 0.85 ? 'white_lp' : 'yellow_lp';
    ev.lp_image_path = `plates/${objectId}.jpg`;
  }
  return ev;
}

/** Pick a registered identity: rBl < BL_RATE → blacklisted; rKnown < pKnown → normal person; otherwise '' (stranger). */
const BL_RATE = 0.007;
function pickFrom(store, rBl, rKnown, rWho, pKnown) {
  const keys = Object.keys(store);
  const bl = keys.filter((k) => store[k].is_blacklist);
  const ok = keys.filter((k) => !store[k].is_blacklist);
  if (bl.length && rBl < BL_RATE) return pick(bl, rWho);
  if (ok.length && rKnown < pKnown) return pick(ok, rWho);
  return '';
}
const knownIdent = (rBl, rKnown, rWho) => pickFrom(state.faces, rBl, rKnown, rWho, 0.75);
const knownPlate = (rBl, rKnown, rWho) => pickFrom(state.plates, rBl, rKnown, rWho, 0.6);

function historyRange(from, to) {
  [from, to] = clampRange(from, to, 7 * DAY);
  const out = [];
  const first = Math.ceil(from / HISTORY_STEP) * HISTORY_STEP;
  for (let t = Math.min(to, nowSec()) - (Math.min(to, nowSec()) % HISTORY_STEP); t >= first; t -= HISTORY_STEP) {
    const ev = historyAt(t);
    if (ev) out.push(ev);
  }
  return out; // newest first
}

// ─────────────────────────── Generated data: counting lines ───────────────────────────

/** In/out flow per hour (VN time) by line type. Returns { in, out } people per minute. */
function baseRate(kind, h) {
  const peaks = {
    gate: { in: [0, 0, 0, 0, 0, 0, 2, 9, 6, 2, 1, 1, 4, 5, 2, 1, 1, 2, 1, 1, 0, 0, 0, 0], out: [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 6, 4, 1, 1, 2, 5, 9, 4, 2, 1, 0, 0, 0] },
    hall: { in: [0, 0, 0, 0, 0, 0, 1, 5, 3, 1, 0.5, 0.3, 0.5, 3, 1, 0.5, 0.3, 0, 0, 0, 0, 0, 0, 0], out: [0, 0, 0, 0, 0, 0, 0, 0.2, 0.5, 0.6, 1, 4, 3, 0.5, 0.6, 1, 4, 2, 0.5, 0, 0, 0, 0, 0] },
    room: { in: [0, 0, 0, 0, 0, 0, 0.2, 1.5, 0.5, 0.3, 0.2, 0.1, 0.3, 1.2, 0.4, 0.2, 0.1, 0, 0, 0, 0, 0, 0, 0], out: [0, 0, 0, 0, 0, 0, 0, 0.1, 0.2, 0.3, 0.4, 1.2, 0.5, 0.2, 0.3, 0.4, 1.2, 0.3, 0.1, 0, 0, 0, 0, 0] },
  };
  const p = peaks[kind === 'gate' ? 'gate' : kind === 'room' ? 'room' : 'hall'];
  return { in: p.in[h], out: p.out[h] };
}

/** Number of IN/OUT crossings (in the line's own direction) during minute m (epoch seconds). */
function lineMinute(line, m) {
  const cam = CAM_BY_NAME.get(line.camera);
  if (!camOnline(cam, m)) return { in: 0, out: 0 };
  const h = vnHour(m);
  const b = baseRate(line.kind, h);
  const enterHall = b.in * (line.kind.startsWith('hall') ? CROWD_BOOST : 1);
  const leaveHall = b.out;
  // hall_rev: the line's IN direction LEAVES the hall, so swap
  const rIn = line.kind === 'hall_rev' ? leaveHall * 0.6 : enterHall;
  const rOut = line.kind === 'hall_rev' ? enterHall * 0.4 : leaveHall;
  const jitter = (rate, k) => {
    const x = rate * (0.6 + rnd('cl', line.line_id, m, k) * 0.8);
    return Math.floor(x) + (rnd('cl2', line.line_id, m, k) < x - Math.floor(x) ? 1 : 0);
  };
  return { in: jitter(rIn, 'in'), out: jitter(rOut, 'out') };
}

function lineTotals(line, from, to) {
  [from, to] = clampRange(from, Math.min(to, nowSec()), 31 * DAY);
  let tin = 0, tout = 0;
  const by = {};
  for (let m = Math.ceil(from / 60) * 60; m < to; m += 60) {
    const c = lineMinute(line, m);
    tin += c.in; tout += c.out;
    if (c.in || c.out) {
      for (const [dir, n] of [['in', c.in], ['out', c.out]]) {
        for (let k = 0; k < n; k++) {
          const type = crossingType(line, m, dir, k);
          by[type] ??= { in_count: 0, out_count: 0 };
          by[type][`${dir}_count`]++;
        }
      }
    }
  }
  return { in_count: tin, out_count: tout, by_object_type: by };
}

function crossingType(line, m, dir, k) {
  if (line.kind !== 'gate') return 'pedestrian';
  const r = rnd('ct', line.line_id, m, dir, k);
  return r < 0.55 ? 'pedestrian' : r < 0.88 ? 'motorbike' : r < 0.97 ? 'car' : 'bicycle';
}

function lineEvents(line, from, to) {
  [from, to] = clampRange(from, Math.min(to, nowSec()), 7 * DAY);
  const events = [];
  for (let m = Math.floor((to - 1) / 60) * 60; m >= from; m -= 60) {
    const c = lineMinute(line, m);
    for (const [dir, n] of [['in', c.in], ['out', c.out]]) {
      for (let k = n - 1; k >= 0; k--) {
        const r = (x) => rnd('ce', line.line_id, m, dir, k, x);
        const type = crossingType(line, m, dir, k);
        const ts = m + Math.floor(r('s') * 60);
        const objectId = `cl_${line.line_id}_${m}_${dir}_${k}`;
        const vehicle = type === 'car' || type === 'motorbike';
        const face = vehicle ? '' : pickFrom(state.faces, r('bl'), r('f'), r('w'), 0.6);
        events.push({
          camera_id: line.camera,
          object_id: objectId,
          object_type: type,
          direction: dir === 'in' ? 1 : -1,
          timestamp: ts,
          object_image_path: `events/${objectId}.jpg`,
          lp_text: vehicle ? pickFrom(state.plates, r('blp'), r('p'), r('pp'), 0.6) || pick(SAMPLE_PLATES.filter((p) => !state.plates[p]?.is_blacklist), r('ps')) : '',
          lp_image_path: vehicle ? `plates/${objectId}.jpg` : '',
          lp_type: vehicle ? 'white_lp' : '',
          face_ident_text: face,
          face_image_path: !vehicle && r('fi') < 0.8 ? `faces/${objectId}.jpg` : '',
          first_timestamp: ts,
          last_timestamp: ts + 3,
        });
      }
    }
  }
  return events.sort((a, b) => b.timestamp - a.timestamp);
}

// ─────────────────────────── Generated data: health, recordings ───────────────────────────

function camHealth(cam) {
  const t = nowSec();
  const online = camOnline(cam, t);
  const fpsExpected = cam.weak ? 15 : 25;
  let disconnects = 0;
  let prev = camOnline(cam, t - DAY);
  for (let m = t - DAY; m <= t; m += 60) {
    const cur = camOnline(cam, m);
    if (prev && !cur) disconnects++;
    prev = cur;
  }
  let since = t;
  while (since > t - DAY && camOnline(cam, since - 60) === online) since -= 60;
  const jitter = rnd('fps', cam.name, Math.floor(t / 10));
  const fps = !online ? 0 : cam.weak ? 10 + Math.round(jitter * 4) : 24 + Math.round(jitter);
  const level = !online ? 'offline' : cam.weak ? 'weak' : 'good';
  return {
    camera_index: cam.index,
    camera_name: cam.name,
    camera_id: cam.id,
    level,
    reasons: !online ? ['Không nhận được luồng video'] : cam.weak ? ['FPS thấp hơn cấu hình', 'Độ trễ mạng cao'] : [],
    notes: [],
    fps_available: online,
    fps,
    fps_expected: fpsExpected,
    bitrate_kbps: !online ? 0 : cam.weak ? 900 + Math.round(jitter * 300) : 2800 + Math.round(jitter * 600),
    latency_ms: !online ? null : cam.weak ? 110 + Math.round(jitter * 40) : 30 + Math.round(jitter * 20),
    reachable: online,
    stream_ready: online,
    connected_since_ms: online ? since * 1000 : null,
    disconnects_24h: disconnects,
    updated_ms: Date.now(),
  };
}

function camLogs(cam) {
  const t = nowSec();
  const items = [];
  let prev = camOnline(cam, t - DAY);
  for (let m = t - DAY; m <= t; m += 60) {
    const cur = camOnline(cam, m);
    if (cur !== prev) {
      items.push({
        id: m,
        timestamp_ms: m * 1000,
        level: cur ? 'info' : 'error',
        event: cur ? 'connected' : 'disconnected',
        message: cur ? 'Kết nối lại camera thành công' : 'Mất kết nối tới camera',
        detail: cur ? '' : `rtsp://${cam.ip}:554 timeout`,
      });
    }
    prev = cur;
  }
  return items.reverse();
}

/** Time ranges with recordings (ms). The camera must have recording on and be online. */
function recordingIntervals(cam, from, to) {
  [from, to] = clampRange(from, Math.min(to, nowSec()), 7 * DAY);
  if (!cam.rec) return [];
  const out = [];
  let cur = null;
  for (let m = Math.floor(from / 60) * 60; m < to; m += 60) {
    if (camOnline(cam, m)) {
      if (!cur) cur = { start: Math.max(m, from), end: Math.min(m + 60, to) };
      else cur.end = Math.min(m + 60, to);
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.map((i) => ({ start_ms: i.start * 1000, end_ms: i.end * 1000 }));
}

// ─────────────────────────── Notifications (blacklist) ───────────────────────────

function notifications(limit = 50) {
  const t = nowSec();
  const list = [];
  for (const ev of historyRange(t - DAY, t)) {
    const face = ev.face_ident_text && state.faces[ev.face_ident_text];
    const plate = ev.lp_text && state.plates[ev.lp_text];
    if (face?.is_blacklist || plate?.is_blacklist) {
      const id = ev.first_timestamp;
      list.push({
        id,
        type: face?.is_blacklist ? 'face_blacklist' : 'lp_blacklist',
        title: face?.is_blacklist ? 'Phát hiện khuôn mặt trong danh sách đen' : 'Phát hiện biển số trong danh sách đen',
        message: face?.is_blacklist
          ? `${ev.face_ident_text} xuất hiện tại ${ev.camera_id}`
          : `Xe ${ev.lp_text} xuất hiện tại ${ev.camera_id}`,
        camera_id: ev.camera_id,
        object_image_path: ev.object_image_path,
        ident_image_path: face?.is_blacklist ? face.images[0]?.path || '' : '',
        ident_text: face?.is_blacklist ? ev.face_ident_text : plate?.ident || '',
        lp_text: ev.lp_text,
        timestamp: ev.first_timestamp,
        is_read: state.readNotifications.includes(id),
        is_blacklist: 1,
        object_class: ev.object_type,
      });
    }
  }
  return {
    unread_count: list.filter((n) => !n.is_read).length,
    data: list.slice(0, limit),
  };
}

// ─────────────────────────── Dashboard ───────────────────────────

function typeCounts(events) {
  const c = Object.fromEntries(OBJECT_TYPES.map((k) => [k, 0]));
  for (const e of events) c[e.object_type] = (c[e.object_type] || 0) + 1;
  return c;
}
function slotHours(rangeSec) {
  return rangeSec <= 2 * DAY ? 1 : rangeSec <= 7 * DAY ? 3 : rangeSec <= 30 * DAY ? 6 : 24;
}
function flows(events, from, to) {
  const slot = slotHours(to - from);
  const traffic = new Map();
  const detection = new Map();
  for (const e of events) {
    const key = Math.floor((e.first_timestamp + VN_OFFSET) / (slot * 3600)) * slot * 3600 - VN_OFFSET;
    if (!traffic.has(key)) traffic.set(key, { hour: key, ...Object.fromEntries(OBJECT_TYPES.map((k) => [k, 0])) });
    traffic.get(key)[e.object_type]++;
    if (!detection.has(key)) detection.set(key, { hour: key, face: 0, lp: 0 });
    if (e.face_ident_text) detection.get(key).face++;
    if (e.lp_text) detection.get(key).lp++;
  }
  const sort = (m) => [...m.values()].sort((a, b) => a.hour - b.hour).slice(-200);
  return {
    traffic_flow: { slot_hours: slot, types: OBJECT_TYPES, data: sort(traffic) },
    detection_flow: { slot_hours: slot, data: sort(detection) },
  };
}
function dashboardStats() {
  const t = nowSec();
  return {
    total_cameras: CAMERAS.length,
    active_cameras: CAMERAS.filter((c) => camOnline(c, t)).length,
    today_events: historyRange(startOfVnDay(t), t).length,
    total_faces: Object.keys(state.faces).length,
    total_lp_idents: Object.keys(state.plates).length,
    total_users: 3,
  };
}
function resources() {
  const t = nowSec();
  const wave = (p, k) => (Math.sin(t / p) + 1) / 2 * k;
  const memTotal = 64 * 1024 ** 3;
  const diskTotal = 1.8 * 1024 ** 4;
  const gpuTotal = 24 * 1024 ** 3;
  const memPct = 52 + wave(300, 12);
  const gpuPct = 48 + wave(120, 15);
  return {
    cpu: { percent: Math.round((35 + wave(60, 25)) * 10) / 10 },
    memory: { percent: Math.round(memPct * 10) / 10, used: Math.round(memTotal * memPct / 100), total: memTotal },
    disk: { percent: DISK_PERCENT, used: Math.round(diskTotal * DISK_PERCENT / 100), total: Math.round(diskTotal) },
    gpu: { memory_percent: Math.round(gpuPct * 10) / 10, memory_used: Math.round(gpuTotal * gpuPct / 100), memory_total: gpuTotal, utilization: Math.round((40 + wave(45, 35)) * 10) / 10 },
  };
}

// ─────────────────────────── Identities: faces & license plates ───────────────────────────

function faceView(ident) {
  const f = state.faces[ident];
  return {
    face_ident: ident,
    face_count: f.images.length,
    face_infor: f.face_infor || '',
    is_blacklist: f.is_blacklist ? 1 : 0,
    faces: f.images.map((i) => ({ face_id: i.id, face_crop_path: i.path })),
  };
}
/** "Quality check": an image is too small (<2KB) or not JPEG/PNG → counts as no face found. */
function looksLikeFace(buf) {
  if (!buf || buf.length < 2048) return false;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8;
  const png = buf[0] === 0x89 && buf[1] === 0x50;
  return jpg || png;
}
function storeFaceImage(ident, buf, ext = 'jpg') {
  const id = crypto.randomUUID();
  const rel = `faces/registered/${encodeURIComponent(ident)}/${id}.${ext}`;
  const abs = path.join(STATE_DIR, 'images', rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  const sha = crypto.createHash('sha1').update(buf).digest('hex');
  state.faces[ident].images.push({ id, path: rel, sha });
}
function plateView(lp) {
  const p = state.plates[lp];
  return { license_plate: lp, ident: p.ident || '', lp_infor: p.lp_infor || '', is_blacklist: p.is_blacklist ? 1 : 0, visible_to: p.visible_to || 'all' };
}
function paginate(items, q) {
  const page = Math.max(1, Number(q.get('page') || 1));
  const pageSize = Math.min(500, Math.max(1, Number(q.get('page_size') || 20)));
  return { total: items.length, page, page_size: pageSize, data: items.slice((page - 1) * pageSize, page * pageSize) };
}

// ─────────────────────────── HTTP helpers ───────────────────────────

const tokens = new Map(); // token -> { exp, scopes }

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    ...headers,
  });
  res.end(payload);
}
const err = (res, status, message, extra = {}) => send(res, status, { error: message, ...extra });

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

/** Minimal multipart/form-data parser: returns { fields: {k: [string]}, files: {k: [{filename, type, data}]} } */
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const out = { fields: {}, files: {} };
  if (!m) return out;
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    const part = buf.slice(start + 2, next - 2); // skip \r\n ... \r\n
    const sep = part.indexOf('\r\n\r\n');
    const head = part.slice(0, sep).toString();
    const data = part.slice(sep + 4);
    const name = /name="([^"]*)"/i.exec(head)?.[1];
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1];
    if (name) {
      if (filename !== undefined) (out.files[name] ??= []).push({ filename, type, data });
      else (out.fields[name] ??= []).push(data.toString('utf8'));
    }
    pos = next;
  }
  return out;
}

async function readForm(req) {
  const buf = await readBody(req);
  const ct = req.headers['content-type'] || '';
  if (ct.startsWith('multipart/form-data')) return parseMultipart(buf, ct);
  if (ct.includes('application/x-www-form-urlencoded')) {
    const p = new URLSearchParams(buf.toString());
    return { fields: Object.fromEntries([...p.keys()].map((k) => [k, p.getAll(k)])), files: {} };
  }
  try {
    const j = buf.length ? JSON.parse(buf.toString()) : {};
    return { fields: Object.fromEntries(Object.entries(j).map(([k, v]) => [k, [v]])), files: {}, json: j };
  } catch {
    return { fields: {}, files: {}, json: {} };
  }
}
const field = (form, k) => form.fields[k]?.[0];
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

function mediaFile(name) {
  const p = path.join(MEDIA_DIR, name);
  return fs.existsSync(p) ? p : null;
}
// 1x1 grey JPEG used when no sample image was generated
const FALLBACK_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

function sendFile(req, res, file, type) {
  const stat = fs.statSync(file);
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : stat.size - 1;
    res.writeHead(206, {
      'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(file).pipe(res);
}
function sendImage(req, res, relPath) {
  const registered = path.join(STATE_DIR, 'images', relPath);
  if (relPath && fs.existsSync(registered) && registered.startsWith(path.join(STATE_DIR, 'images'))) {
    return sendFile(req, res, registered, relPath.endsWith('.png') ? 'image/png' : 'image/jpeg');
  }
  const sample = mediaFile('sample.jpg');
  if (sample) return sendFile(req, res, sample, 'image/jpeg');
  return send(res, 200, FALLBACK_JPEG, { 'Content-Type': 'image/jpeg' });
}
function sendVideo(req, res) {
  const sample = mediaFile('sample.mp4');
  if (!sample) return err(res, 404, 'Chưa có video mẫu – chạy: npm run hgvision:mock:media');
  return sendFile(req, res, sample, 'video/mp4');
}

// ─────────────────────────── Routes ───────────────────────────

const routes = [];
/** scope = null → public endpoint (playback/recording, same as the real server today). */
const route = (method, pattern, scope, handler) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/\{(\w+)\}/g, (_, k) => (keys.push(k), k === 'rest' ? '(.+)' : '([^/]+)'))}$`);
  routes.push({ method, re, keys, scope, handler });
};

// Authentication
route('POST', '/api/oauth/token', null, async (req, res) => {
  const form = await readForm(req);
  let id = field(form, 'client_id');
  let secret = field(form, 'client_secret');
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (basic) [id, secret] = Buffer.from(basic[1], 'base64').toString().split(':');
  if (field(form, 'grant_type') !== 'client_credentials') return send(res, 400, { error: 'unsupported_grant_type' });
  if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return send(res, 401, { error: 'invalid_client' });
  const wanted = (field(form, 'scope') || '').split(/\s+/).filter(Boolean);
  const scopes = wanted.length ? wanted.filter((s) => GRANTED.includes(s)) : GRANTED;
  const token = `mock.${crypto.randomBytes(18).toString('hex')}`;
  tokens.set(token, { exp: Date.now() + 3600_000, scopes });
  send(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600, scope: scopes.join(' ') });
});

// 2.1 Cameras
const cameraFull = (c) => ({
  camera_name: c.name, camera_id: c.id, live_hls_path: `/live/${encodeURIComponent(c.name)}/index.m3u8`,
  camera_url: `rtsp://${c.ip}:554/Streaming/Channels/101`, url_playback: `rtsp://${c.ip}:554/Streaming/tracks/101`,
  camera_index: c.index, status: camOnline(c, nowSec()) ? 'Online' : 'Connecting', using_ai: c.ai,
  using_face_recognition: c.face, using_lp_recognition: c.lp, using_record: c.rec, is_showing: true,
  index_showing: c.index, main_image_path: `cameras/${c.index}.jpg`, avatar_path: `cameras/${c.index}.jpg`,
  polygon_str: '', fps: camHealth(c).fps, camera_group: c.group, protocol_type: 'rtsp', ip_address: c.ip,
  port: '554', username: 'admin', password: 'mock-camera-password', main_url: `rtsp://${c.ip}:554/main`,
  sub_url: `rtsp://${c.ip}:554/sub`, playback_url: '', latitude: c.lat, longitude: c.lng,
});
route('GET', '/api/cameras', 'cameras:read', (req, res, p, q) => {
  const g = q.get('group');
  send(res, 200, CAMERAS.filter((c) => !g || c.group === g).map(cameraFull));
});
route('GET', '/api/cameras/statuses', 'cameras:read', (req, res) => {
  send(res, 200, CAMERAS.map((c) => ({
    camera_index: c.index, status: camStatus(c), fps: camHealth(c).fps, camera_name: c.name, camera_id: c.id,
    live_hls_path: `/live/${encodeURIComponent(c.name)}/index.m3u8`, using_ai: c.ai, camera_group: c.group,
  })));
});
route('GET', '/api/cameras/health', 'cameras:read', (req, res) => send(res, 200, { items: CAMERAS.map(camHealth) }));
route('GET', '/api/cameras/{name}', 'cameras:read', (req, res, p) => {
  const c = camOf(p.name);
  return c ? send(res, 200, cameraFull(c)) : err(res, 404, 'Camera không tồn tại');
});
route('GET', '/api/cameras/{name}/health', 'cameras:read', (req, res, p) => {
  const c = camOf(p.name);
  if (!c) return err(res, 404, 'Camera không tồn tại');
  const t = nowSec();
  const history = [];
  for (let s = t - 3600; s <= t; s += 60) {
    const on = camOnline(c, s);
    const j = rnd('hh', c.name, s);
    history.push({ t: s * 1000, fps: on ? (c.weak ? 10 + Math.round(j * 4) : 24 + Math.round(j)) : 0, bitrate_kbps: on ? (c.weak ? 900 : 2800) + Math.round(j * 400) : 0, latency_ms: on ? (c.weak ? 110 : 30) + Math.round(j * 30) : null });
  }
  send(res, 200, { ...camHealth(c), host: c.ip, port: 554, history });
});
route('GET', '/api/cameras/{name}/logs', 'cameras:read', (req, res, p, q) => {
  const c = camOf(p.name);
  if (!c) return err(res, 404, 'Camera không tồn tại');
  let items = camLogs(c);
  const before = Number(q.get('before_id') || 0);
  if (before) items = items.filter((i) => i.id < before);
  if (q.get('level')) items = items.filter((i) => i.level === q.get('level'));
  const limit = Number(q.get('limit') || 50);
  send(res, 200, { items: items.slice(0, limit), has_more: items.length > limit });
});
route('GET', '/api/groups', 'cameras:read', (req, res) => {
  send(res, 200, GROUPS.map((g) => ({ ...g, camera_count: CAMERAS.filter((c) => c.group === g.GROUP_NAME).length })));
});
route('GET', '/api/groups/{group}/cameras', 'cameras:read', (req, res, p) => {
  if (!GROUPS.some((g) => g.GROUP_NAME === p.group)) return err(res, 404, 'Nhóm không tồn tại');
  send(res, 200, CAMERAS.filter((c) => c.group === p.group).map((c) => c.name));
});
route('GET', '/api/shapes', 'cameras:read', (req, res, p, q) => {
  const cam = q.get('camera_name');
  send(res, 200, SHAPES.filter((s) => !cam || s.camera_name === cam).map((s) => ({ ...s, camera_width: 1280, camera_height: 720 })));
});

// History
function historyQuery(q) {
  const t = nowSec();
  const end = toSec(q.get('end_time'), t);
  const start = toSec(q.get('start_time'), end - DAY);
  let items = historyRange(start, end);
  const list = (k) => (q.get(k) || '').split(',').map((s) => s.trim()).filter(Boolean);
  const cams = list('camera_id').map((k) => camOf(k)?.name || k);
  if (cams.length) items = items.filter((e) => cams.includes(e.camera_id));
  const types = list('object_type');
  if (types.length) items = items.filter((e) => types.includes(e.object_type));
  const idents = list('face_ident');
  if (idents.length) items = items.filter((e) => idents.includes(e.face_ident_text));
  const lp = (q.get('lp_text') || '').toUpperCase();
  if (lp) items = items.filter((e) => e.lp_text.includes(lp));
  const lpTypes = list('lp_type');
  if (lpTypes.length) items = items.filter((e) => lpTypes.includes(e.lp_type));
  if (truthy(q.get('has_face'))) items = items.filter((e) => e.face_image_path);
  const ids = list('face_object_ids');
  if (ids.length) items = items.filter((e) => ids.includes(e.object_id));
  return items;
}
for (const p of ['/api/history', '/api/history/objects']) {
  route('GET', p, 'history:read', (req, res, _p, q) => send(res, 200, paginate(historyQuery(q), q)));
}
route('GET', '/api/history/statistics', 'history:read', (req, res, p, q) => send(res, 200, { total: historyQuery(q).length }));

// Recording & playback (public, same as the real server)
route('GET', '/api/playback/recordings', null, (req, res, p, q) => {
  const c = camOf(q.get('camera_id') || '');
  if (!c) return err(res, 404, 'Camera không tồn tại');
  const end = toSec(q.get('end_time'), nowSec());
  const start = toSec(q.get('start_time'), end - DAY);
  const host = `http://${req.headers.host}`;
  send(res, 200, recordingIntervals(c, start, end).map((i) => ({
    ...i, url: `${host}/api/playback/video?camera_id=${encodeURIComponent(c.name)}&start_time=${i.start_ms}&end_time=${i.end_ms}`,
  })));
});
route('GET', '/api/recording/segments', null, (req, res, p, q) => {
  const c = camOf(q.get('camera_id') || '');
  if (!c) return err(res, 404, 'Camera không tồn tại');
  const end = toSec(q.get('end_time'), nowSec());
  const start = toSec(q.get('start_time'), end - 3600 * 3);
  const host = `http://${req.headers.host}`;
  const segs = [];
  for (const i of recordingIntervals(c, start, end)) {
    for (let s = i.start_ms; s < i.end_ms; s += 600_000) {
      const e = Math.min(s + 600_000, i.end_ms);
      const file = `${encodeURIComponent(c.name)}/${s}.mp4`;
      segs.push({ start_ms: s, end_ms: e, thumb_url: `${host}/api/recording/thumb/${file.replace('.mp4', '.jpg')}`, file_url: `${host}/api/recording/video/${file}` });
    }
  }
  send(res, 200, segs);
});
route('GET', '/api/playback/playlist', null, (req, res, p, q) => {
  const c = camOf(q.get('camera_id') || '');
  if (!c) return err(res, 404, 'Camera không tồn tại');
  const hls = mediaFile('hls/index.m3u8');
  if (!hls) return err(res, 404, 'Chưa có HLS mẫu – chạy: npm run hgvision:mock:media');
  const base = truthy(q.get('absolute')) ? `http://${req.headers.host}` : '';
  const body = fs.readFileSync(hls, 'utf8').replace(/^(?!#)(.+\.ts)$/gm, `${base}/media/hls/$1`);
  send(res, 200, body, { 'Content-Type': 'application/vnd.apple.mpegurl' });
});
route('GET', '/api/playback/video', null, (req, res) => sendVideo(req, res));
route('GET', '/api/playback/download', null, (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="playback.mp4"');
  sendVideo(req, res);
});
route('GET', '/api/recording/video/{rest}', null, (req, res) => sendVideo(req, res));
route('GET', '/api/recording/thumb/{rest}', null, (req, res) => sendImage(req, res, ''));
route('GET', '/api/media/images/{rest}', 'history:read', (req, res, p) => sendImage(req, res, decodeURIComponent(p.rest)));

// Live HLS (mock: every camera plays the same sample stream)
route('GET', '/live/{cam}/index.m3u8', null, (req, res, p) => {
  const c = camOf(decodeURIComponent(p.cam));
  if (!c) return err(res, 404, 'Camera không tồn tại');
  if (!camOnline(c, nowSec())) return err(res, 404, 'Camera đang mất tín hiệu');
  const hls = mediaFile('hls/index.m3u8');
  if (!hls) return err(res, 404, 'Chưa có HLS mẫu – chạy: npm run hgvision:mock:media');
  const body = fs.readFileSync(hls, 'utf8').replace(/^(?!#)(.+\.ts)$/gm, '/media/hls/$1');
  send(res, 200, body, { 'Content-Type': 'application/vnd.apple.mpegurl' });
});
route('GET', '/media/hls/{file}', null, (req, res, p) => {
  const f = mediaFile(path.join('hls', path.basename(p.file)));
  return f ? sendFile(req, res, f, 'video/mp2t') : err(res, 404, 'Không có segment');
});

// 2.5 Counting lines
route('GET', '/api/counting-lines', 'counting:read', (req, res, p, q) => {
  const cam = q.get('camera_name');
  const t = nowSec();
  send(res, 200, LINES.filter((l) => !cam || l.camera === cam).map((l) => {
    const tot = lineTotals(l, startOfVnDay(t), t);
    return {
      line_id: l.line_id, line_name: l.line_name, camera_name: l.camera, camera_width: 1280, camera_height: 720,
      x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, normal_x: l.nx, normal_y: l.ny,
      in_count: tot.in_count, out_count: tot.out_count,
      object_types: l.kind === 'gate' ? ['pedestrian', 'motorbike', 'car', 'bicycle'] : ['pedestrian'],
    };
  }));
});
const lineOr404 = (res, id) => LINE_BY_ID.get(id) || (err(res, 404, 'Vạch đếm không tồn tại'), null);
route('GET', '/api/counting-lines/{id}/counts', 'counting:read', (req, res, p, q) => {
  const l = lineOr404(res, p.id);
  if (l) send(res, 200, lineTotals(l, toSec(q.get('from'), 0), toSec(q.get('to'), nowSec())));
});
route('GET', '/api/counting-lines/{id}/timeseries', 'counting:read', (req, res, p, q) => {
  const l = lineOr404(res, p.id);
  if (!l) return;
  const to = Math.min(toSec(q.get('to'), nowSec()), nowSec());
  const from = Math.max(toSec(q.get('from'), startOfVnDay(to)), to - 31 * DAY);
  const bucket = Math.max(60, Number(q.get('bucket') || 3600));
  const out = [];
  for (let b = Math.floor(from / bucket) * bucket; b < to; b += bucket) {
    const tot = lineTotals(l, Math.max(b, from), Math.min(b + bucket, to));
    out.push({ bucket_start: b, in_count: tot.in_count, out_count: tot.out_count });
  }
  send(res, 200, out);
});
route('GET', '/api/counting-lines/{id}/events', 'counting:read', (req, res, p, q) => {
  const l = lineOr404(res, p.id);
  if (!l) return;
  const to = toSec(q.get('to'), nowSec());
  const from = toSec(q.get('from'), to - 3600);
  const pg = paginate(lineEvents(l, from, to), q);
  send(res, 200, { total: pg.total, page: pg.page, page_size: pg.page_size, events: pg.data });
});
route('GET', '/api/counting-objects/{id}/trajectory', 'counting:read', (req, res, p) => {
  const pts = Array.from({ length: 12 }, (_, i) => ({ x: 200 + i * 70 + Math.round(rnd('tr', p.id, i) * 20), y: 650 - i * 35, t: Date.now() - (12 - i) * 250 }));
  send(res, 200, { object_id: p.id, points: pts });
});

// 2.10 Dashboard
route('GET', '/api/dashboard/stats', 'dashboard:read', (req, res) => send(res, 200, dashboardStats()));
route('GET', '/api/stats', 'dashboard:read', (req, res) => send(res, 200, dashboardStats()));
route('GET', '/api/dashboard/resources', 'dashboard:read', (req, res) => send(res, 200, resources()));
route('GET', '/api/dashboard/activity', 'dashboard:read', (req, res, p, q) => {
  const hours = Math.min(168, Number(q.get('hours') || 24));
  const t = nowSec();
  const ev = historyRange(t - hours * 3600, t);
  const data = [];
  for (let i = hours - 1; i >= 0; i--) {
    const hs = Math.floor(t / 3600) * 3600 - i * 3600;
    data.push({ hour: vnHour(hs), events: ev.filter((e) => e.first_timestamp >= hs && e.first_timestamp < hs + 3600).length });
  }
  send(res, 200, { hours: data.map((d) => d.hour), data });
});
route('GET', '/api/dashboard/recent-events', 'dashboard:read', (req, res) => {
  const t = nowSec();
  send(res, 200, historyRange(startOfVnDay(t), t).slice(0, 20).map((e) => ({
    object_id: e.object_id, object_type: e.object_type, camera_id: e.camera_id, object_image_path: e.object_image_path,
    face_ident_text: e.face_ident_text, face_image_path: e.face_image_path, lp_text: e.lp_text, lp_image_path: e.lp_image_path,
    first_timestamp: e.first_timestamp,
  })));
});
function rangeEvents(q) {
  const t = nowSec();
  const to = toSec(q.get('end_time'), t);
  const from = toSec(q.get('start_time'), startOfVnDay(t));
  let ev = historyRange(from, to);
  const cam = q.get('camera_id');
  if (cam) ev = ev.filter((e) => e.camera_id === (camOf(cam)?.name || cam));
  return { ev, from, to };
}
route('GET', '/api/dashboard/object-type-stats', 'dashboard:read', (req, res, p, q) => send(res, 200, typeCounts(rangeEvents(q).ev)));
route('GET', '/api/dashboard/traffic-flow', 'dashboard:read', (req, res, p, q) => {
  const { ev, from, to } = rangeEvents(q);
  send(res, 200, flows(ev, from, to).traffic_flow);
});
route('GET', '/api/dashboard/detection-flow', 'dashboard:read', (req, res, p, q) => {
  const { ev, from, to } = rangeEvents(q);
  send(res, 200, flows(ev, from, to).detection_flow);
});
route('GET', '/api/dashboard/overview', 'dashboard:read', (req, res, p, q) => {
  const { ev, from, to } = rangeEvents(q);
  send(res, 200, { stats: dashboardStats(), object_type_stats: typeCounts(ev), ...flows(ev, from, to) });
});

// 2.9 Notifications
route('GET', '/api/notifications', 'notifications:read', (req, res, p, q) => send(res, 200, notifications(Number(q.get('limit') || 50))));
route('GET', '/api/notifications/unread-count', 'notifications:read', (req, res) => send(res, 200, { unread_count: notifications(10000).unread_count }));
route('PUT', '/api/notifications/read-all', 'notifications:write', (req, res) => {
  state.readNotifications = notifications(10000).data.map((n) => n.id);
  saveState();
  send(res, 200, { message: 'ok' });
});
route('PUT', '/api/notifications/{id}', 'notifications:write', (req, res, p) => {
  state.readNotifications.push(Number(p.id));
  saveState();
  send(res, 200, { message: 'ok' });
});

// 2.2 Faces
route('GET', '/api/identification/faces', 'faces:read', (req, res, p, q) => {
  const s = (q.get('search') || '').toLowerCase();
  const bl = q.get('is_blacklist');
  const items = Object.keys(state.faces)
    .filter((k) => !s || k.toLowerCase().includes(s) || (state.faces[k].face_infor || '').toLowerCase().includes(s))
    .filter((k) => bl === null || bl === '' || Number(!!state.faces[k].is_blacklist) === Number(bl))
    .map(faceView);
  send(res, 200, paginate(items, q));
});
route('POST', '/api/identification/faces', 'faces:write', async (req, res) => {
  const form = await readForm(req);
  const ident = (field(form, 'face_ident') || '').trim();
  if (!ident) return err(res, 400, 'Thiếu face_ident');
  if (state.faces[ident]) return err(res, 400, `Định danh ${ident} đã tồn tại – dùng POST /api/identification/faces/{face_ident}/images để thêm ảnh`);
  const files = [...(form.files.file || []), ...(form.files.image || [])];
  if (!files.length) return err(res, 400, 'Thiếu ảnh (trường file)');
  const skip = truthy(field(form, 'skip_quality_check'));
  const ok = files.filter((f) => skip || looksLikeFace(f.data));
  if (!ok.length) return err(res, 422, 'Không phát hiện được khuôn mặt trong ảnh', { registered: 0, failed: files.length });
  state.faces[ident] = { face_infor: field(form, 'face_infor') || '', is_blacklist: truthy(field(form, 'is_blacklist')) ? 1 : 0, visible_to: field(form, 'visible_to') || 'admin_only', images: [] };
  for (const f of ok) storeFaceImage(ident, f.data, f.type?.includes('png') ? 'png' : 'jpg');
  saveState();
  send(res, 201, { message: 'Face registered', registered: ok.length, failed: files.length - ok.length });
});
route('POST', '/api/identification/faces/search', 'faces:read', async (req, res) => {
  const form = await readForm(req);
  const file = (form.files.file || form.files.image || [])[0];
  if (!file) return err(res, 400, 'Thiếu ảnh');
  const topK = Number(field(form, 'top_k') || 5);
  const sha = crypto.createHash('sha1').update(file.data).digest('hex');
  const matches = [];
  for (const [ident, f] of Object.entries(state.faces)) {
    const img = f.images.find((i) => i.sha === sha);
    if (img) matches.push({ face_ident: ident, face_infor: f.face_infor, score: 0.97, face_image_path: img.path, is_blacklist: f.is_blacklist });
  }
  const forced = env.MOCK_SEARCH_IDENT;
  if (!matches.length && forced && state.faces[forced]) {
    matches.push({ face_ident: forced, face_infor: state.faces[forced].face_infor, score: 0.82, face_image_path: state.faces[forced].images[0]?.path || '', is_blacklist: state.faces[forced].is_blacklist });
  }
  send(res, 200, { total_faces: 1, faces: [{ face_index: 0, face_image: '', matches: matches.slice(0, topK) }] });
});
const faceOr404 = (res, id) => (state.faces[id] ? id : (err(res, 404, 'Định danh không tồn tại'), null));
route('GET', '/api/identification/faces/{id}', 'faces:read', (req, res, p) => {
  const id = faceOr404(res, decodeURIComponent(p.id));
  if (id) send(res, 200, faceView(id));
});
route('PUT', '/api/identification/faces/{id}', 'faces:write', async (req, res, p) => {
  const id = faceOr404(res, decodeURIComponent(p.id));
  if (!id) return;
  const { json = {} } = await readForm(req);
  const f = state.faces[id];
  if (json.FACE_INFOR !== undefined) f.face_infor = json.FACE_INFOR;
  if (json.is_blacklist !== undefined) f.is_blacklist = truthy(json.is_blacklist) ? 1 : 0;
  let finalId = id;
  if (json.new_name && json.new_name !== id) {
    if (state.faces[json.new_name]) return err(res, 400, 'Tên mới đã tồn tại');
    state.faces[json.new_name] = f;
    delete state.faces[id];
    finalId = json.new_name;
  }
  saveState();
  send(res, 200, faceView(finalId));
});
route('PATCH', '/api/identification/faces/{id}', 'faces:write', async (req, res, p) => {
  const id = faceOr404(res, decodeURIComponent(p.id));
  if (!id) return;
  const { json = {} } = await readForm(req);
  state.faces[id].is_blacklist = truthy(json.is_blacklist) ? 1 : 0;
  saveState();
  send(res, 200, faceView(id));
});
route('DELETE', '/api/identification/faces/{id}', 'faces:write', (req, res, p) => {
  const id = faceOr404(res, decodeURIComponent(p.id));
  if (!id) return;
  delete state.faces[id];
  fs.rmSync(path.join(STATE_DIR, 'images', 'faces', 'registered', encodeURIComponent(id)), { recursive: true, force: true });
  saveState();
  send(res, 200, { message: 'Deleted' });
});
route('POST', '/api/identification/faces/{id}/images', 'faces:write', async (req, res, p) => {
  const id = faceOr404(res, decodeURIComponent(p.id));
  if (!id) return;
  const form = await readForm(req);
  const files = [...(form.files.file || []), ...(form.files.image || [])];
  const ok = files.filter((f) => looksLikeFace(f.data));
  if (!ok.length) return err(res, 422, 'Không phát hiện được khuôn mặt trong ảnh', { registered: 0, failed: files.length });
  for (const f of ok) storeFaceImage(id, f.data, f.type?.includes('png') ? 'png' : 'jpg');
  saveState();
  send(res, 201, { message: 'Face image added', registered: ok.length, failed: files.length - ok.length });
});
route('DELETE', '/api/identification/faces/{id}/images/{faceId}', 'faces:write', (req, res, p) => {
  const id = faceOr404(res, decodeURIComponent(p.id));
  if (!id) return;
  const f = state.faces[id];
  const before = f.images.length;
  f.images = f.images.filter((i) => i.id !== p.faceId);
  if (f.images.length === before) return err(res, 404, 'Ảnh không tồn tại');
  saveState();
  send(res, 200, { message: 'Deleted' });
});

// 2.3 License plates
const normPlate = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
route('GET', '/api/identification/license-plates', 'plates:read', (req, res, p, q) => {
  const s = normPlate(q.get('search'));
  const bl = q.get('is_blacklist');
  const items = Object.keys(state.plates)
    .filter((k) => !s || k.includes(s) || normPlate(state.plates[k].ident).includes(s))
    .filter((k) => bl === null || bl === '' || Number(!!state.plates[k].is_blacklist) === Number(bl))
    .map(plateView);
  send(res, 200, paginate(items, q));
});
route('POST', '/api/identification/license-plates', 'plates:write', async (req, res) => {
  const { json = {} } = await readForm(req);
  const lp = normPlate(json.license_plate);
  if (!lp || !json.ident) return err(res, 400, 'Thiếu license_plate hoặc ident');
  if (state.plates[lp]) return err(res, 400, `Biển số ${lp} đã tồn tại`);
  state.plates[lp] = { ident: json.ident, lp_infor: json.lp_infor || '', visible_to: json.visible_to || 'all', is_blacklist: truthy(json.is_blacklist) ? 1 : 0 };
  saveState();
  send(res, 201, plateView(lp));
});
route('POST', '/api/identification/license-plates/read-from-image', 'plates:read', async (req, res) => {
  const form = await readForm(req);
  const files = form.files.file || [];
  const plate = env.MOCK_PLATE || pick(Object.keys(state.plates).length ? Object.keys(state.plates) : SAMPLE_PLATES, Math.random());
  send(res, 200, { results: files.map((f) => ({ filename: f.filename, plates: [{ plate, score: 0.93, det_score: 0.96, type: 'white_lp', crop_image: '' }] })) });
});
const plateOr404 = (res, lp) => (state.plates[lp] ? lp : (err(res, 404, 'Biển số không tồn tại'), null));
route('PUT', '/api/identification/license-plates/{lp}', 'plates:write', async (req, res, p) => {
  const lp = plateOr404(res, normPlate(decodeURIComponent(p.lp)));
  if (!lp) return;
  const { json = {} } = await readForm(req);
  Object.assign(state.plates[lp], Object.fromEntries(Object.entries({ ident: json.ident, lp_infor: json.lp_infor, visible_to: json.visible_to }).filter(([, v]) => v !== undefined)));
  if (json.is_blacklist !== undefined) state.plates[lp].is_blacklist = truthy(json.is_blacklist) ? 1 : 0;
  saveState();
  send(res, 200, plateView(lp));
});
route('PATCH', '/api/identification/license-plates/{lp}', 'plates:write', async (req, res, p) => {
  const lp = plateOr404(res, normPlate(decodeURIComponent(p.lp)));
  if (!lp) return;
  const { json = {} } = await readForm(req);
  state.plates[lp].is_blacklist = truthy(json.is_blacklist) ? 1 : 0;
  saveState();
  send(res, 200, plateView(lp));
});
route('DELETE', '/api/identification/license-plates/{lp}', 'plates:write', (req, res, p) => {
  const lp = plateOr404(res, normPlate(decodeURIComponent(p.lp)));
  if (!lp) return;
  delete state.plates[lp];
  saveState();
  send(res, 200, { message: 'Deleted' });
});

// Dev helpers (do not exist on the real server)
route('GET', '/__mock/state', null, (req, res) => send(res, 200, state));
route('POST', '/__mock/reset', null, (req, res) => {
  state = structuredClone(DEFAULT_STATE);
  historyCache.clear();
  fs.rmSync(path.join(STATE_DIR, 'images'), { recursive: true, force: true });
  saveState();
  send(res, 200, { message: 'Đã reset state về mặc định' });
});

// ─────────────────────────── Server ───────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const started = Date.now();
  res.on('finish', () => {
    if (LOG) console.log(`${req.method} ${url.pathname}${url.search} → ${res.statusCode} (${Date.now() - started}ms)`);
  });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
    return res.end();
  }
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  // Specific routes take priority over generic ones: try the routes in declaration order,
  // but /api/cameras/statuses and /health must come before /api/cameras/{name}.
  const candidates = routes.filter((r) => r.method === req.method && r.re.test(pathname));
  const literal = candidates.find((r) => !r.keys.length) || candidates.sort((a, b) => a.keys.length - b.keys.length)[0];
  if (!literal) return err(res, 404, `Không có endpoint ${req.method} ${pathname} trên mock`);
  const m = literal.re.exec(pathname);
  const params = Object.fromEntries(literal.keys.map((k, i) => [k, m[i + 1]]));

  if (literal.scope) {
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
    const tok = bearer && tokens.get(bearer);
    if (!tok || tok.exp < Date.now()) return err(res, 401, 'Token thiếu, sai hoặc đã hết hạn');
    if (!tok.scopes.includes(literal.scope)) return send(res, 403, { error: 'insufficient_scope', required_scope: literal.scope });
  }
  try {
    await literal.handler(req, res, params, url.searchParams);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) err(res, 500, String(e?.message || e));
  }
});

server.listen(PORT, () => {
  console.log(`HGVision MOCK listening at http://localhost:${PORT}`);
  console.log(`  client_id=${CLIENT_ID}  client_secret=${CLIENT_SECRET}`);
  console.log(`  ${CAMERAS.length} cameras · ${LINES.length} counting lines · ${Object.keys(state.faces).length} faces · ${Object.keys(state.plates).length} plates`);
  console.log(`  sample media: ${mediaFile('sample.mp4') ? 'available' : 'not generated yet (npm run hgvision:mock:media)'}`);
});
