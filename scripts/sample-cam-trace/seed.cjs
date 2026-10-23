/**
 * DỮ LIỆU TEST TỔNG HỢP — Truy vết camera, Heatmap, Nhóm camera, Nhật ký phòng, Hành trình, Người lạ.
 * Chạy:  node scripts/sample-cam-trace/seed.cjs
 * Xoá:   node scripts/sample-cam-trace/purge.cjs
 *
 * Mọi bản ghi đều đánh dấu `sample = 'cam-trace-demo'` (payload_json / metadata_json) hoặc mã bắt đầu bằng
 * `DEMO-CT-` (nhóm camera, cuộc họp) để purge.cjs xoá đúng, không đụng dữ liệu thật.
 * Thời gian tính theo thời điểm chạy (3 ngày gần nhất + dòng "vừa xảy ra" trong 90 phút qua), nên chạy lại
 * (purge → seed) mỗi khi cần dữ liệu mới. Xem KỊCH BẢN KIỂM THỬ ở cuối khi chạy xong.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const MARK = 'cam-trace-demo';
const CODE = 'DEMO-CT-';
const DIR = 'sample-cam-trace';

// ---------- tiện ích ----------
let seedState = 20261023;
const rnd = () => {
  seedState |= 0; seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a, b) => a + rnd() * (b - a);
const int = (a, b) => Math.floor(between(a, b + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const MIN = 60000;
const NOW = new Date();

const vnParts = (d) => {
  const [y, m, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d).split('-').map(Number);
  return { y, m, d: dd };
};
const TODAY = vnParts(NOW);
/** Thời điểm hh:mm GIỜ VN của (hôm nay - off) ngày. */
const vn = (off, hh, mm = 0) => new Date(Date.UTC(TODAY.y, TODAY.m - 1, TODAY.d - off, hh - 7, mm));
const ago = (min) => new Date(NOW.getTime() - min * MIN);
const past = (d) => d.getTime() <= NOW.getTime() - MIN;

// 1x1 PNG xám — dùng khi không tải được ảnh chân dung (không có mạng).
const FALLBACK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO8/OfPfwAIvAPhVQ0pmQAAAABJRU5ErkJggg==', 'base64');

const PEOPLE = [
  { code: 'EMP003', img: 'men/32', plate: '51H-123.45' },
  { code: 'EMP004', img: 'men/45', plate: '59C-233.44' },
  { code: 'EMP005', img: 'women/44', plate: null },
  { code: 'EMP006', img: 'men/76', plate: '30F-555.66' },
  { code: 'EMP007', img: 'men/12', plate: '51F-888.99' },
  { code: 'EMP008', img: 'women/68', plate: null },
  { code: 'EMP009', img: 'women/21', plate: '59A-246.80' },
  { code: 'EMP010', img: 'men/53', plate: null },
  { code: 'EMP011', img: 'women/33', plate: null },
  { code: 'EMP012', img: 'men/64', plate: '51G-135.79' },
  { code: 'EMP013', img: 'women/57', plate: null },
  { code: 'EMP014', img: 'men/91', plate: null },
];
const STRANGER_IMGS = ['men/18', 'women/76', 'men/85', 'women/9', 'men/27', 'women/90', 'men/3'];

const jsonb = (v) => JSON.stringify(v);

(async () => {
  const db = new Client({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE,
  });
  await db.connect();
  const q = async (sql, params) => (await db.query(sql, params)).rows;

  const exists = await q(`SELECT 1 FROM camera_groups WHERE group_code LIKE $1 LIMIT 1`, [`${CODE}%`]);
  if (exists.length) {
    console.log('Đã có dữ liệu mẫu — chạy purge.cjs trước nếu muốn tạo lại.');
    return db.end();
  }

  /** INSERT nhiều dòng một lần. types: kiểu ép cho từng cột (vd 'jsonb', 'uuid'); null = để mặc định. */
  const bulk = async (table, cols, types, rows) => {
    const CHUNK = Math.max(1, Math.floor(60000 / cols.length));
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const params = [];
      const tuples = part.map((r) => `(${r.map((v, ci) => {
        params.push(types[ci] === 'jsonb' && v !== null ? jsonb(v) : v);
        return types[ci] ? `$${params.length}::${types[ci]}` : `$${params.length}`;
      }).join(',')})`);
      await db.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')}`, params);
    }
  };

  // ---------- tham chiếu có sẵn ----------
  const users = Object.fromEntries((await q(`SELECT id, employee_code, full_name FROM users WHERE deleted_at IS NULL`)).map((u) => [u.employee_code, u]));
  const admin = users.EMP001;
  if (!admin) throw new Error('Thiếu tài khoản EMP001 (SYSTEM_ADMIN).');
  const zones = Object.fromEntries((await q(`SELECT id, zone_code, zone_name FROM zones WHERE deleted_at IS NULL`)).map((z) => [z.zone_code, z]));
  const devRows = await q(`SELECT d.id, d.device_code, d.device_type, d.zone_id, d.room_id, z.zone_code
                             FROM iot_devices d LEFT JOIN zones z ON z.id = d.zone_id`);
  const dev = Object.fromEntries(devRows.map((d) => [d.device_code, d]));
  const camsOfZone = (zoneCode) => devRows.filter((d) => d.zone_code === zoneCode && d.device_type === 'ip_camera');
  const rooms = Object.fromEntries((await q(`SELECT id, room_code, room_name FROM rooms WHERE deleted_at IS NULL`)).map((r) => [r.room_code, r]));
  const bridge = devRows.find((d) => d.device_type === 'ivss_bridge');
  if (!bridge) throw new Error('Thiếu thiết bị ivss_bridge.');
  const people = PEOPLE.map((p) => ({ ...p, user: users[p.code] })).filter((p) => p.user);
  if (people.length < 8) throw new Error('Thiếu nhân sự EMP003–EMP014 để tạo dữ liệu.');
  const byCode = Object.fromEntries(people.map((p) => [p.code, p]));

  // ---------- ảnh ----------
  const root = path.resolve(process.env.STORAGE_LOCAL_PATH || './uploads', DIR);
  fs.mkdirSync(root, { recursive: true });
  let offline = false;
  const fetchImg = async (img) => {
    if (!offline) {
      try {
        const res = await fetch(`https://randomuser.me/api/portraits/${img}.jpg`, { signal: AbortSignal.timeout(8000) });
        if (res.ok) return { buf: Buffer.from(await res.arrayBuffer()), mime: 'image/jpeg', ext: 'jpg' };
      } catch { offline = true; }
    }
    return { buf: FALLBACK_PNG, mime: 'image/png', ext: 'png' };
  };
  let fileSeq = 0;
  const addFile = async ({ buf, mime, ext }, label, at) => {
    fileSeq += 1;
    const name = `${label}-${fileSeq}.${ext}`;
    fs.writeFileSync(path.join(root, name), buf);
    const [row] = await q(
      `INSERT INTO media_files (file_code, related_entity_type, file_name, file_type, mime_type, storage_provider, storage_key,
                                file_size_bytes, checksum, version_no, visibility_level, is_active, uploaded_at, metadata_json)
       VALUES ($1,'iot_device_event',$2,'image',$3,'local',$4,$5,$6,1,'private',true,$7,$8::jsonb) RETURNING id`,
      [`${MARK}-${fileSeq}`, name, mime, `${DIR}/${name}`, buf.length, crypto.createHash('sha256').update(buf).digest('hex'), at, jsonb({ sample: MARK })]);
    return row.id;
  };
  console.log('Đang tải ảnh chân dung mẫu…');
  for (const p of people) p.photo = await addFile(await fetchImg(p.img), p.code, ago(60 * 24 * 3));
  const strangerImgs = [];
  for (const img of STRANGER_IMGS) strangerImgs.push(await fetchImg(img));
  const unknownPhoto = [];
  for (let i = 0; i < 4; i += 1) unknownPhoto.push(await addFile(strangerImgs[i % strangerImgs.length], `unk${i}`, ago(60 * 24)));
  if (offline) console.log('  (!) Không có mạng — dùng ảnh xám thay ảnh chân dung.');

  // ---------- 1. NHÓM CAMERA ----------
  const groupDefs = [
    { code: 'A1', name: '[Demo] Tòa A1 – Tầng trệt', zone: 'KTL-A1-G', purpose: 'Truy vết mất đồ', desc: 'Toàn bộ camera sảnh A1 — tra khi mất đồ ở khu vực này.', members: camsOfZone('KTL-A1-G') },
    { code: 'CONG1', name: '[Demo] Cổng 1 – Ra vào', zone: 'KTL-CONG1', purpose: 'Cổng ra vào', desc: 'Camera cổng 1: người và xe vào/ra.', members: camsOfZone('KTL-CONG1') },
    { code: 'B1', name: '[Demo] Nhà xe B1', zone: 'KTL-B1-G', purpose: 'Nhà xe', desc: 'Camera khu B1 / nhà xe.', members: camsOfZone('KTL-B1-G') },
    { code: 'HALL', name: '[Demo] Hành lang A1-L1 + Hội trường', zone: 'KTL-A1-1', purpose: 'Hành lang', desc: 'Hành lang lầu 1 và hội trường.', members: [...camsOfZone('KTL-A1-1'), ...camsOfZone('KTL-A2-1')] },
    { code: 'MEET', name: '[Demo] Phòng họp A101 / A201 / B301', zone: null, purpose: 'Phòng họp', desc: 'Camera phòng họp — đối soát điểm danh.', members: [dev['IOT-ROOMCAM-A101'], dev['IOT-ROOMCAM-A201'], dev['IOT-ROOMCAM-B301']].filter(Boolean) },
  ];
  for (const g of groupDefs) {
    const [row] = await q(
      `INSERT INTO camera_groups (group_code, group_name, description, created_by, zone_id, purpose)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [`${CODE}${g.code}`, g.name, g.desc, admin.id, g.zone ? zones[g.zone]?.id ?? null : null, g.purpose]);
    g.id = row.id;
    if (g.members.length) await bulk('camera_group_members', ['group_id', 'device_id'], ['uuid', 'uuid'], g.members.map((m) => [g.id, m.id]));
  }
  console.log(`✔ ${groupDefs.length} nhóm camera (có khu vực phụ trách + mục đích)`);

  // ---------- 2. HEATMAP: số người theo camera đếm ----------
  const countCams = ['KTL-A1-G-AI01', 'KTL-A1-1-AI01', 'KTL-A2-1-AI01', 'KTL-B1-G-AI01', 'KTL-CONG1-AN01', 'KTL-CONG2-CU-AN01', 'KTL-CONG2-MOI-AN01', 'KTL-CONG3-AI01']
    .map((c) => dev[c]).filter(Boolean);
  // Hệ số "đông" theo khu vực (A1 sảnh và cổng 1 đông nhất) để bản đồ nhiệt có đỏ/vàng/xanh.
  const busy = { 'KTL-A1-G': 1.0, 'KTL-CONG1': 0.85, 'KTL-A2-1': 0.6, 'KTL-B1-G': 0.45, 'KTL-A1-1': 0.4, 'KTL-CONG2-MOI': 0.3, 'KTL-CONG2-CU': 0.25, 'KTL-CONG3': 0.15 };
  const dayCurve = (h) => Math.max(0.05, Math.exp(-((h - 9.5) ** 2) / 4) + 0.8 * Math.exp(-((h - 13.5) ** 2) / 3) + 0.5 * Math.exp(-((h - 17) ** 2) / 2));
  const countRows = [];
  const pushCount = (cam, t) => {
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false }).format(t)) + t.getUTCMinutes() / 60;
    const occ = Math.max(0, Math.round(dayCurve(h) * (busy[cam.zone_code] ?? 0.3) * 38 + between(-2, 3)));
    countRows.push([cam.zone_id, cam.id, 'count', occ, between(0.86, 0.99).toFixed(4), t, 'ai_camera', { sample: MARK }]);
  };
  for (const cam of countCams) {
    const floorTo = (ms, step) => new Date(Math.floor(ms / step) * step);
    for (let t = floorTo(NOW.getTime() - 2 * 60 * MIN, MIN).getTime(); t <= NOW.getTime() - MIN; t += MIN) pushCount(cam, new Date(t)); // 2h gần nhất: 1 phút/mẫu
    for (let t = floorTo(NOW.getTime() - 24 * 60 * MIN, 5 * MIN).getTime(); t < NOW.getTime() - 2 * 60 * MIN; t += 5 * MIN) pushCount(cam, new Date(t)); // 24h: 5 phút
    for (let t = floorTo(NOW.getTime() - 7 * 24 * 60 * MIN, 15 * MIN).getTime(); t < NOW.getTime() - 24 * 60 * MIN; t += 15 * MIN) pushCount(cam, new Date(t)); // 7 ngày: 15 phút
  }
  await bulk('zone_presence_events', ['zone_id', 'device_id', 'event_type', 'occupancy_count', 'confidence_score', 'event_time', 'source_type', 'metadata_json'],
    ['uuid', 'uuid', null, 'int', 'numeric', 'timestamptz', null, 'jsonb'], countRows);
  console.log(`✔ ${countRows.length} mẫu đếm người (1 phút/2h gần nhất · 5 phút/24h · 15 phút/7 ngày) cho ${countCams.length} camera`);

  // ---------- 3. HÀNH TRÌNH: cổng + khu vực + (ảnh bằng chứng) ----------
  const zpe = []; // zone_presence_events (appear/disappear)
  const gate = [];
  const zonesPath = ['KTL-A1-G', 'KTL-A1-1', 'KTL-A2-1', 'KTL-B1-G'];
  const gateCams = camsOfZone('KTL-CONG1');
  const bridgeEvent = async ({ zone, time, userId, name, photo, matched }) => {
    const [row] = await q(
      `INSERT INTO iot_device_events (device_id, zone_id, event_type, event_time, source_protocol, severity, payload_json, processed_status, snapshot_file_id, created_at)
       VALUES ($1,$2,'ivss_face_event',$3,'ivss','info',$4::jsonb,$5,$6,$3) RETURNING id`,
      [bridge.id, zone, time, jsonb({
        sample: MARK, szUid: userId ? `DEMO-${userId.slice(0, 8)}` : `DEMO-UNK-${int(100, 999)}`, userId: userId || null,
        channelId: int(1, 8), direction: 'seen', matchState: matched ? 'matched' : 'unmatched_identity',
        similarity: matched ? int(86, 99) : int(28, 52), name: name || null, utc: time.toISOString(), receivedAt: time.toISOString(), presenceSkipped: null,
      }), matched ? 'processed' : 'unmatched', photo]);
    return row.id;
  };
  const visit = async ({ p, unknown, zoneCode, cam, start, dwellMin, evidenceChance = 0.55 }) => {
    const zone = zones[zoneCode].id;
    const uid = p ? p.user.id : null;
    let src = null;
    if (past(start) && (unknown || rnd() < evidenceChance)) {
      src = await bridgeEvent({ zone, time: start, userId: uid, name: p?.user.full_name, photo: p ? p.photo : pick(unknownPhoto), matched: !unknown });
    }
    zpe.push([zone, cam.id, uid, 'appear', 1, between(0.88, 0.99).toFixed(4), start, 'ai_camera', { sample: MARK, ...(src ? { sourceEventId: src } : {}) }]);
    const end = new Date(start.getTime() + dwellMin * MIN);
    if (past(end)) zpe.push([zone, cam.id, uid, 'disappear', 1, between(0.88, 0.99).toFixed(4), end, 'ai_camera', { sample: MARK }]);
    return end;
  };

  for (const p of people) {
    for (let off = 0; off <= 2; off += 1) {
      let t = vn(off, 7, int(10, 55));
      // vào cổng
      if (past(t)) {
        const gc = pick(gateCams);
        if (p.plate) gate.push([zones['KTL-CONG1'].id, gc.id, p.user.id, p.plate, 'enter', t, { sample: MARK, source: 'anpr' }]);
        t = await visit({ p, zoneCode: 'KTL-CONG1', cam: gc, start: t, dwellMin: int(1, 3), evidenceChance: 0.8 });
      }
      const stops = int(4, 7);
      for (let s = 0; s < stops; s += 1) {
        t = new Date(t.getTime() + int(2, 14) * MIN);
        if (!past(t)) break;
        const zc = pick(zonesPath);
        const cams = camsOfZone(zc);
        if (!cams.length) continue;
        // đi qua 1-2 camera trong cùng khu vực
        for (let c = 0; c < int(1, 2); c += 1) {
          if (!past(t)) break;
          t = await visit({ p, zoneCode: zc, cam: pick(cams), start: t, dwellMin: int(3, 35) });
          t = new Date(t.getTime() + int(1, 4) * MIN);
        }
        if (s === Math.floor(stops / 2)) t = new Date(t.getTime() + int(30, 60) * MIN); // nghỉ trưa
      }
      // ra cổng
      const out = vn(off, 17, int(0, 55));
      if (past(out)) {
        const gc = pick(gateCams);
        if (p.plate) gate.push([zones['KTL-CONG1'].id, gc.id, p.user.id, p.plate, 'leave', out, { sample: MARK, source: 'anpr' }]);
        await visit({ p, zoneCode: 'KTL-CONG1', cam: gc, start: out, dwellMin: 1, evidenceChance: 0.6 });
      }
    }
  }
  // "Vừa xảy ra": hoạt động dày trong 90 phút qua → mốc 1 giờ / 3 giờ qua luôn có dữ liệu.
  for (const p of people.slice(0, 9)) {
    let t = ago(int(70, 88));
    for (let s = 0; s < int(3, 5); s += 1) {
      const zc = pick(zonesPath);
      const cams = camsOfZone(zc);
      if (!past(t) || !cams.length) break;
      t = await visit({ p, zoneCode: zc, cam: pick(cams), start: t, dwellMin: int(4, 14), evidenceChance: 0.7 });
      t = new Date(t.getTime() + int(1, 6) * MIN);
    }
  }
  // Người lạ đi trong khuôn viên (không nhận diện được) — để thấy dòng đỏ "Không nhận diện được".
  for (let u = 0; u < 5; u += 1) {
    for (let off = 0; off <= 2; off += 1) {
      for (let s = 0; s < int(1, 3); s += 1) {
        const zc = pick(zonesPath);
        const cams = camsOfZone(zc);
        const start = off === 0 ? ago(int(8, 160)) : vn(off, int(8, 16), int(0, 59));
        if (!past(start) || !cams.length) continue;
        await visit({ unknown: true, zoneCode: zc, cam: pick(cams), start, dwellMin: int(2, 9) });
      }
    }
  }
  // Xe lạ (biển số chưa đăng ký) ở cổng 1.
  for (const [plate, off, hh] of [['51K-999.00', 0, null], ['29A-001.23', 1, 10], ['43B-777.77', 2, 15]]) {
    const t = off === 0 ? ago(35) : vn(off, hh, int(0, 40));
    if (past(t)) gate.push([zones['KTL-CONG1'].id, pick(gateCams).id, null, plate, 'enter', t, { sample: MARK, source: 'anpr', unregistered: true }]);
  }
  await bulk('zone_presence_events', ['zone_id', 'device_id', 'user_id', 'event_type', 'occupancy_count', 'confidence_score', 'event_time', 'source_type', 'metadata_json'],
    ['uuid', 'uuid', 'uuid', null, 'int', 'numeric', 'timestamptz', null, 'jsonb'], zpe);
  await bulk('gate_access_logs', ['zone_id', 'device_id', 'user_id', 'plate_number', 'direction', 'access_time', 'metadata_json'],
    ['uuid', 'uuid', 'uuid', null, null, 'timestamptz', 'jsonb'], gate);
  console.log(`✔ ${zpe.length} sự kiện khu vực (có ảnh bằng chứng) · ${gate.length} lượt cổng (xe)`);

  // ---------- 4. CUỘC HỌP + NHẬT KÝ PHÒNG + ĐIỂM DANH ----------
  const meetingDefs = [
    { code: 'M1', title: '[Demo] Họp giao ban tuần', room: 'RM-A101', start: ago(110), end: ago(50), host: 'EMP004',
      parts: ['EMP007', 'EMP008', 'EMP009', 'EMP010', 'EMP011'], missed: 'EMP011', outsider: 'EMP013', status: 'completed' },
    { code: 'M2', title: '[Demo] Đào tạo quy trình an ninh', room: 'RM-A201', start: vn(1, 14, 0), end: vn(1, 16, 0), host: 'EMP005',
      parts: ['EMP012', 'EMP013', 'EMP014', 'EMP006'], missed: 'EMP014', outsider: 'EMP003', status: 'completed' },
    { code: 'M3', title: '[Demo] Họp Ban Giám đốc', room: 'RM-B301', start: vn(2, 9, 0), end: vn(2, 10, 30), host: 'EMP006',
      parts: ['EMP003', 'EMP004', 'EMP007'], missed: null, outsider: null, status: 'completed' },
    { code: 'M4', title: '[Demo] Họp kế hoạch quý (sắp tới)', room: 'RM-A101', start: new Date(NOW.getTime() + 3 * 60 * MIN), end: new Date(NOW.getTime() + 4 * 60 * MIN), host: 'EMP004',
      parts: ['EMP007', 'EMP008'], missed: null, outsider: null, status: 'scheduled' },
  ];
  const roomEvents = [];
  const attendance = [];
  for (const m of meetingDefs) {
    const room = rooms[m.room];
    const hostU = byCode[m.host].user;
    const [row] = await q(
      `INSERT INTO meetings (meeting_code, title, organizer_id, host_id, room_id, meeting_type, meeting_mode, status, start_time, end_time,
                             actual_start_time, actual_end_time, attendance_enabled, created_by)
       VALUES ($1,$2,$3,$3,$4,'internal','offline',$5,$6,$7,$8,$9,true,$3) RETURNING id`,
      [`${CODE}${m.code}`, m.title, hostU.id, room.id, m.status, m.start, m.end,
        m.status === 'completed' ? m.start : null, m.status === 'completed' ? m.end : null]);
    m.id = row.id;
    const roomCam = dev[`IOT-ROOMCAM-${m.room.replace('RM-', '')}`] || dev['IOT-ROOMCAM-A101'];
    const everyone = [m.host, ...m.parts];
    await bulk('meeting_participants', ['meeting_id', 'user_id', 'participant_role', 'invitation_status', 'attendance_status'], [null, null, null, null, null],
      everyone.map((c) => [m.id, byCode[c].user.id, c === m.host ? 'host' : 'attendee', 'accepted', c === m.missed || m.status !== 'completed' ? 'not_checked_in' : 'present']));
    if (m.status !== 'completed') continue;

    const ev = (c, time, direction, matchState = 'matched', extra = {}) => {
      const p = byCode[c];
      roomEvents.push([roomCam.id, room.id, m.id, time, {
        sample: MARK, szUid: `DEMO-${p.user.id.slice(0, 8)}`, userId: matchState === 'unmatched_identity' ? null : p.user.id, roomId: room.id, meetingId: m.id,
        channelId: 1, direction, matchState, similarity: matchState === 'unmatched_identity' ? int(30, 55) : int(88, 99), name: p.user.full_name,
        utc: time.toISOString(), receivedAt: time.toISOString(), ...extra,
      }, matchState === 'matched' ? 'processed' : 'unmatched', matchState === 'unmatched_identity' ? pick(unknownPhoto) : p.photo]);
    };
    const sameMinute = new Date(m.start.getTime() + 2 * MIN);
    everyone.filter((c) => c !== m.missed).forEach((c, i) => {
      // 3 người đầu vào cùng phút → test "nhiều người cùng lúc"; người sau vào muộn
      const enter = i < 3 ? new Date(sameMinute.getTime() + i * 5000) : new Date(m.start.getTime() + int(6, 18) * MIN);
      ev(c, enter, 'enter');
      ev(c, new Date(enter.getTime() + int(10, 25) * MIN), 'seen');
      ev(c, new Date(enter.getTime() + int(30, 45) * MIN), 'seen');
      ev(c, new Date(m.end.getTime() + int(-3, 6) * MIN), 'leave');
      attendance.push([m.id, byCode[c].user.id, enter, i >= 3, i >= 3 ? Math.round((enter - m.start) / MIN) : 0]);
    });
    // AI nhận sai người "missed": camera chỉ thấy là người lạ (không userId) → màn Người lạ để "Là ai?"
    if (m.missed) {
      ev(m.missed, new Date(m.start.getTime() + 4 * MIN), 'enter', 'unmatched_identity');
      ev(m.missed, new Date(m.start.getTime() + 25 * MIN), 'seen', 'unmatched_identity');
      ev(m.missed, new Date(m.end.getTime() - 2 * MIN), 'leave', 'unmatched_identity');
    }
    // Người không thuộc cuộc họp xuất hiện trong phòng → unmatched_location
    if (m.outsider) ev(m.outsider, new Date(m.start.getTime() + 20 * MIN), 'seen', 'unmatched_location');
  }
  await bulk('iot_device_events', ['device_id', 'room_id', 'meeting_id', 'event_type', 'event_time', 'source_protocol', 'severity', 'payload_json', 'processed_status', 'snapshot_file_id', 'created_at'],
    ['uuid', 'uuid', 'uuid', null, 'timestamptz', null, null, 'jsonb', null, 'uuid', 'timestamptz'],
    roomEvents.map((r) => [r[0], r[1], r[2], 'ivss_face_event', r[3], 'ivss', 'info', r[4], r[5], r[6], r[3]]));
  await bulk('attendance_records', ['meeting_id', 'user_id', 'check_in_method', 'attendance_source', 'check_in_time', 'is_present', 'is_late', 'late_minutes', 'attendance_status'],
    ['uuid', 'uuid', null, null, 'timestamptz', null, null, 'int', null],
    attendance.map((a) => [a[0], a[1], 'system', 'mixed', a[2], true, a[3], a[4], a[3] ? 'late' : 'present']));
  console.log(`✔ ${meetingDefs.length} cuộc họp · ${roomEvents.length} lượt ra/vào phòng · ${attendance.length} bản ghi điểm danh`);

  // ---------- 5. NGƯỜI LẠ ----------
  const strangerDefs = [
    // pending — khớp cuộc họp M1/M2 để thử "Là ai?" + gán điểm danh
    { id: 'CT-STR-01', dev: 'IOT-FACE-A101', room: 'RM-A101', img: 0, times: [ago(106), ago(86), ago(52)], sim: 41, state: 'pending' },
    { id: 'CT-STR-02', dev: 'IOT-FACE-A201', room: 'RM-A201', img: 1, times: [vn(1, 14, 5), vn(1, 15, 20)], sim: 37, state: 'pending' },
    // pending — nghi vấn: xuất hiện nhiều lần nhiều ngày
    { id: 'CT-STR-03', dev: 'IOT-FACE-B301', room: 'RM-B301', img: 2, times: [ago(40), vn(1, 11, 10), vn(1, 16, 45), vn(2, 13, 0), vn(2, 18, 30)], sim: 29, state: 'pending' },
    { id: null, dev: 'IOT-FACE-B301', room: 'RM-B301', img: 3, times: [ago(15)], sim: 33, state: 'pending' },
    // đã đóng cảnh báo (3 lý do)
    { id: 'CT-STR-05', dev: 'IOT-FACE-A101', room: 'RM-A101', img: 4, times: [vn(1, 9, 30), vn(1, 9, 45)], sim: 45, state: 'dismissed', reason: 'legit_visitor', note: 'Đối tác đã đăng ký với lễ tân sảnh A.' },
    { id: 'CT-STR-06', dev: 'IOT-FACE-A201', room: 'RM-A201', img: 5, times: [vn(2, 10, 5)], sim: 22, state: 'dismissed', reason: 'ai_false_positive', note: null },
    { id: 'CT-STR-07', dev: 'IOT-FACE-B301', room: 'RM-B301', img: 6, times: [vn(2, 8, 20), vn(2, 8, 50)], sim: 39, state: 'dismissed', reason: 'other', note: 'Nhà thầu sửa điều hòa, bảo vệ đã kiểm tra thẻ.' },
    // đã hậu kiểm "là ai" → không hiện ở cả 2 tab
    { id: 'CT-STR-08', dev: 'IOT-FACE-A201', room: 'RM-A201', img: 0, times: [vn(1, 15, 40), vn(1, 15, 55)], sim: 47, state: 'reviewed' },
  ];
  let strangerCount = 0;
  for (const s of strangerDefs) {
    const d = dev[s.dev];
    if (!d) continue;
    for (const [i, t] of s.times.entries()) {
      if (!past(t)) continue;
      const file = await addFile(strangerImgs[s.img % strangerImgs.length], `str${s.img}`, t);
      const payload = { sample: MARK, extracted_fields: { ...(s.id ? { stranger_id: s.id } : {}), similarity: String(s.sim + i), event_result: 'stranger' } };
      if (s.state === 'dismissed') Object.assign(payload, { dismissedAt: new Date(t.getTime() + 20 * MIN).toISOString(), dismissedBy: admin.id, dismissReason: s.reason, dismissNote: s.note });
      if (s.state === 'reviewed') Object.assign(payload, { reviewedAt: new Date(t.getTime() + 30 * MIN).toISOString(), reviewedBy: admin.id, reviewedUserId: (byCode.EMP012 || people[0]).user.id, reviewNote: 'Đeo khẩu trang nên camera không nhận ra' });
      await q(
        `INSERT INTO iot_device_events (device_id, room_id, zone_id, event_type, event_time, source_protocol, severity, payload_json, processed_status, snapshot_file_id, created_at)
         VALUES ($1,$2,$3,'face_stranger',$4,'http','warning',$5::jsonb,'processed',$6,$4)`,
        [d.id, rooms[s.room]?.id ?? d.room_id, d.zone_id, t, jsonb(payload), file]);
      strangerCount += 1;
    }
  }
  console.log(`✔ ${strangerCount} lượt người lạ (chờ xử lý · đã đóng 3 lý do · đã hậu kiểm)`);

  await db.end();
  console.log(`
═══════════ KỊCH BẢN KIỂM THỬ ═══════════
Đăng nhập SYSTEM_ADMIN (EMP001). Thời điểm tạo: ${NOW.toLocaleString('vi-VN')}.

1) Nhóm camera  (/system-admin/camera-groups)
   5 nhóm "[Demo] …" có khu vực phụ trách + mục đích; nút "Truy vết" mở trang truy vết với nhóm đó.
2) Truy vết    (/system-admin/camera-trace)
   - Nhóm "[Demo] Tòa A1 – Tầng trệt", 3 giờ qua → có người quen + dòng đỏ "Không nhận diện được".
   - Thử sort từng cột (Thời gian/Người/Sự kiện/Camera/Khu vực), lọc loại "Khu vực", gõ "Long" hoặc "EMP007", sang trang 2.
   - Nhóm "[Demo] Cổng 1" → có lượt xe (biển số) + xe lạ 51K-999.00.  Nhóm "[Demo] Phòng họp" → loại "Phòng họp".
   - Xuất báo cáo: PDF / Excel / Word.
3) Heatmap     (/system-admin/zone-traffic)
   Mốc 5/10/30 phút, 1 giờ, 24 giờ, tuần; lọc nhóm camera; bật/tắt tự làm mới; A1 tầng trệt và Cổng 1 đỏ nhất.
4) Nhật ký phòng (/system-admin/room-access-logs)
   Hôm nay: "[Demo] Họp giao ban tuần" (RM-A101) · hôm qua: "[Demo] Đào tạo quy trình an ninh" (RM-A201) · 2 ngày trước: "Họp Ban Giám đốc" (RM-B301).
   Có nhóm "nhiều người cùng lúc", người lạ (không nhận diện), và "chưa khớp vị trí".
5) Hành trình  (/system-admin/user-journey) — chọn Phạm Minh Đức (EMP003) / Bùi Văn Long (EMP007): đủ cổng + khu vực + phòng họp, có camera/nhóm camera.
6) Người lạ    (/system-admin/strangers)
   - Chờ xử lý: CT-STR-01 (3 lượt, trùng họp giao ban) → "Là ai?" chọn Trịnh Thị Thu (EMP011) + gán họp "[Demo] Họp giao ban tuần".
                CT-STR-02 → "Là ai?" chọn Đặng Văn Kiên (EMP014). CT-STR-03 (5 lượt/3 ngày) → "Theo dõi".
   - Thử "Đóng" (bắt buộc lý do; "Lý do khác" bắt buộc ghi chú), rồi vào tab "Đã đóng" → "Mở lại".
   - Tab "Đã đóng" có sẵn 3 mục (khách hợp lệ · AI nhận nhầm · lý do khác).
Xoá toàn bộ dữ liệu demo: node scripts/sample-cam-trace/purge.cjs`);
})().catch((e) => {
  console.error('LỖI:', e.message);
  process.exit(1);
});
