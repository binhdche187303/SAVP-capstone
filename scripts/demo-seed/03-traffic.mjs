// Giai đoạn B — lưu lượng ra/vào 30 ngày (người + xe), sự kiện camera, hiện diện theo zone,
// cảnh báo an ninh, luật cảnh báo, KPI giờ.
import { asset, did, insert, rng, vnTime, addMin } from './lib.mjs';

const DAYS_BACK = 30;
// Giờ VN của 1 ngày tương đối so với hôm nay (0 = hôm nay). Trả về { dow (0=CN), date }.
function vnDow(dayOffset, now) {
  const d = vnTime(dayOffset, 12, 0, now);
  return new Date(d.getTime() + 7 * 3600 * 1000).getUTCDay();
}

export async function seedTraffic(ctx) {
  const { c, ref, out, now, snap } = ctx;
  const n = {};
  const plates = asset('plates.json');
  const faces = asset('faces.json');
  const Z = out.zone;
  const D = out.device;
  const adminId = ref.user['sysadmin'];

  // Mốc "đến giờ" của hôm nay: mặc định max(giờ hiện tại, 11:00 VN) để dashboard luôn có dữ liệu.
  const argUntil = process.argv.find((a) => a.startsWith('--today-until='))?.split('=')[1];
  let cutoff = vnTime(0, 11, 0, now);
  if (now > cutoff) cutoff = now;
  if (argUntil) { const [h, m] = argUntil.split(':').map(Number); cutoff = vnTime(0, h, m ?? 0, now); }
  out.cutoff = cutoff;

  // ---------- Người & xe ----------
  const people = [
    ...out.staff.map((s) => ({ ...s, kind: s.role === 'GUARD' ? 'guard' : 'staff' })),
    ...out.teachers.map((t) => ({ ...t, kind: 'teacher' })),
    ...out.students.map((s) => ({ ...s, kind: 'student' })),
  ];
  const vehicleOf = new Map(
    out.vehicles.filter((v) => v.status === 'active').map((v) => [v.user_id, v]),
  );

  // Media ảnh biển số (mỗi biển 1 dòng, các sự kiện cùng biển dùng chung ảnh snapshot)
  let nMedia = out.mediaCounter ?? 0;
  const plateMedia = {};
  const plateMediaRows = Object.entries(plates).flatMap(([key, p]) => {
    const real = snap.get(`P-${key}`);
    if (real) { plateMedia[key] = real; return []; } // ảnh thật đã có trên storage backend
    nMedia++;
    plateMedia[key] = did('media_files', nMedia);
    return [{
      id: plateMedia[key], file_code: `PLT-${key}`, related_entity_type: 'anpr_device_event', uploaded_by: adminId,
      file_name: `plate-${key}.jpg`, file_type: 'image', mime_type: 'image/jpeg', storage_provider: 'local',
      storage_key: `demo-seed/anpr_device_event/${key}.jpg`, file_url: p.uri, file_size_bytes: Math.round(p.uri.length * 0.75),
      version_no: 1, visibility_level: 'internal', is_active: true, uploaded_at: vnTime(-30, 8, 0, now), metadata_json: { seed: 'DEMO-2026-10' },
    }];
  });
  out.mediaCounter = nMedia;

  const logs = [];          // gate_access_logs
  const events = [];        // iot_device_events
  const pairs = [];         // [enterLog, leaveLog] để ghép cặp
  let nLog = 0, nEvt = 0;

  const newEvent = ({ deviceCode, zoneCode, type, time, severity = 'info', payload, snapshotId = null }) => {
    nEvt++;
    const id = did('iot_device_events', nEvt);
    events.push({
      id, device_id: D[deviceCode], zone_id: Z[zoneCode], event_type: type, event_time: time,
      source_protocol: type === 'ivss_vehicle_event' ? 'ivss' : 'http', severity,
      payload_json: payload, processed_status: 'processed', snapshot_file_id: snapshotId, created_at: time,
    });
    return id;
  };
  const newLog = (row) => {
    nLog++;
    const id = did('gate_access_logs', nLog);
    logs.push({ id, created_at: row.access_time, ...row });
    return logs[logs.length - 1];
  };

  const jitter = (R, base, spread) => base + R.int(-spread, spread);

  // Một chuyến vào/ra bằng xe (ANPR) cho chủ xe hoặc khách.
  const vehicleTrip = (R, day, plateKey, vehicle, user, enterMin, leaveMin, zoneCode, devCode, track) => {
    const p = plates[plateKey];
    const type = p.type === 'motorbike' ? 'motorbike' : 'car';
    const uri = day >= -7 ? p.uri : null;
    const mk = (dir, minute) => {
      const time = vnTime(day, 0, 0, now); time.setUTCMinutes(time.getUTCMinutes() + minute, R.int(0, 59));
      if (time > cutoff) return null;
      const matched = !!user;
      const evId = newEvent({
        deviceCode: devCode, zoneCode, type: 'ivss_vehicle_event', time, snapshotId: plateMedia[plateKey],
        severity: matched ? 'info' : 'warning',
        payload: {
          utc: time.toISOString(), source: 'ivss_anpr', userId: user?.id ?? null, plateRaw: p.raw,
          rawReads: [plateKey], channelId: dir === 'enter' ? 9101 : 9102, direction: dir,
          matchState: matched ? 'matched' : 'unmatched', plateColor: ['29E77788', '14A33366'].includes(plateKey) ? 'yellow' : 'white',
          receivedAt: time.toISOString(), plateNumber: plateKey, vehicleType: type, vehicleColor: 'unknown',
          gateDirection: dir, eventActionRaw: dir, gateLogSkipped: null,
        },
      });
      return newLog({
        zone_id: Z[zoneCode], device_id: D[devCode], event_id: evId, user_id: user?.id ?? null,
        vehicle_registration_id: vehicle?.id ?? null, plate_number: plateKey, direction: dir, access_time: time,
        metadata_json: { seed: 'DEMO-2026-10', source: 'anpr', vehicleType: type, ...(uri ? { imageUrl: uri } : {}) },
      });
    };
    const a = mk('enter', enterMin);
    if (!a) return;
    const b = leaveMin != null ? mk('leave', leaveMin) : null;
    if (b) pairs.push([a, b]);
    track?.push(a, b);
  };

  const faceLog = (R, day, user, zoneCode, devCode, dir, minute, sim) => {
    const time = vnTime(day, 0, 0, now); time.setUTCMinutes(time.getUTCMinutes() + minute, R.int(0, 59));
    if (time > cutoff) return null;
    return newLog({
      zone_id: Z[zoneCode], device_id: D[devCode], user_id: user.id, direction: dir, access_time: time,
      metadata_json: { seed: 'DEMO-2026-10', source: 'face', similarity: sim ?? +(0.86 + R.next() * 0.12).toFixed(2) },
    });
  };

  // ---------- Sinh dữ liệu theo ngày ----------
  for (let day = -DAYS_BACK; day <= 0; day++) {
    const R = rng(20261008 + (day + 100) * 7919);
    const dow = vnDow(day, now);
    const weekend = dow === 0 || dow === 6;
    // phút kể từ 00:00 VN: vnTime(day,0) = 00:00 VN → cộng phút
    for (const P of people) {
      let enterAt, leaveAt, lunch = false;
      if (P.kind === 'guard') {
        if (weekend && R.chance(0.5)) continue;
        const early = P.username === 'dung.tv';
        enterAt = early ? 5 * 60 + 50 + R.int(0, 8) : 13 * 60 + 40 + R.int(0, 12);
        leaveAt = early ? 14 * 60 + 5 + R.int(0, 10) : 22 * 60 + R.int(0, 12);
      } else if (weekend) continue;
      else if (P.kind === 'student') {
        if (R.chance(0.25)) continue;
        enterAt = jitter(R, 7 * 60 + 25, 35); leaveAt = jitter(R, 15 * 60 + 40, 100);
      } else if (P.kind === 'teacher') {
        if (R.chance(0.2)) continue;
        enterAt = jitter(R, 7 * 60 + 15, 25); leaveAt = jitter(R, 15 * 60, 90);
      } else {
        if (R.chance(day === 0 ? 0.04 : 0.07)) continue; // vắng / nghỉ phép
        enterAt = jitter(R, 8 * 60 + 5, 38); if (R.chance(0.12)) enterAt = 8 * 60 + 40 + R.int(0, 55); // đi muộn
        leaveAt = jitter(R, 17 * 60 + 40, 55); lunch = R.chance(0.3);
      }
      enterAt = Math.max(5 * 60 + 40, enterAt);
      const v = vehicleOf.get(P.id);
      const gateZone = P.kind === 'student' || (v && v.vehicle_type === 'motorbike' && R.chance(0.7)) ? 'GATE-EAST' : 'GATE-MAIN';
      const gateFace = gateZone === 'GATE-EAST' ? 'DEMO-FACE-GATE-EAST' : 'DEMO-FACE-GATE-MAIN';
      const gateAnpr = gateZone === 'GATE-EAST' ? 'DEMO-ANPR-GATE-EAST' : 'DEMO-ANPR-GATE-MAIN';

      if (v) {
        vehicleTrip(R, day, v.plate_number, v, P, enterAt, leaveAt, gateZone, gateAnpr);
        // vào sảnh Tòa A sau 3-8 phút, ra trước 3-6 phút (nếu là nhân sự/giảng viên)
        if (P.kind !== 'student') {
          const a = faceLog(R, day, P, 'LOBBY-A', 'DEMO-FACE-LOBBY-A', 'enter', enterAt + R.int(4, 9));
          const b = a ? faceLog(R, day, P, 'LOBBY-A', 'DEMO-FACE-LOBBY-A', 'leave', leaveAt - R.int(3, 7)) : null;
          if (a && b) pairs.push([a, b]);
        }
      } else {
        const a = faceLog(R, day, P, gateZone, gateFace, 'enter', enterAt);
        let b = null;
        if (lunch && a) {
          const out1 = faceLog(R, day, P, gateZone, gateFace, 'leave', 11 * 60 + 50 + R.int(0, 25));
          const in1 = out1 ? faceLog(R, day, P, gateZone, gateFace, 'enter', 12 * 60 + 45 + R.int(0, 25)) : null;
          if (out1) pairs.push([a, out1]);
          if (out1 && in1) { const last = faceLog(R, day, P, gateZone, gateFace, 'leave', leaveAt); if (last) pairs.push([in1, last]); }
          continue;
        }
        if (a) b = faceLog(R, day, P, gateZone, gateFace, 'leave', leaveAt);
        if (a && b) pairs.push([a, b]);
      }
    }

    // Khách đi xe (không đăng ký) — chủ yếu ngày làm việc
    if (!weekend) {
      const control = ['30H11122', '51F44455', '29E77788', '36A22211'];
      const visitors = Object.keys(plates).filter((k) => plates[k].group === 'visitor' && !control.includes(k));
      const count = day === 0 ? 5 : R.int(3, 8);
      for (let i = 0; i < count; i++) {
        // xe trong danh sách theo dõi hiếm khi xuất hiện (~1 lượt/4 ngày)
        const key = R.chance(0.045) ? R.pick(control) : R.pick(visitors);
        const t = 8 * 60 + 30 + R.int(0, 8 * 60);
        vehicleTrip(R, day, key, null, null, t, t + R.int(25, 190), R.chance(0.75) ? 'GATE-MAIN' : 'GATE-EAST',
          R.chance(0.75) ? 'DEMO-ANPR-GATE-MAIN' : 'DEMO-ANPR-GATE-EAST');
      }
    }
  }

  // ---------- Hôm nay: luôn có xe trong danh sách theo dõi (để widget cảnh báo có số) ----------
  {
    const R0 = rng(31337);
    const midnight = vnTime(0, 0, 0, now);
    const minsAgo = (m) => Math.round((cutoff - midnight) / 60000) - m;
    if (minsAgo(130) > 0) vehicleTrip(R0, 0, '30H11122', null, null, minsAgo(130), null, 'GATE-MAIN', 'DEMO-ANPR-GATE-MAIN');
    if (minsAgo(70) > 0) vehicleTrip(R0, 0, '29E77788', null, null, minsAgo(70), minsAgo(25), 'GATE-EAST', 'DEMO-ANPR-GATE-EAST');
  }

  // ---------- Người lạ (khuôn mặt không khớp) ----------
  const strangerEvents = [];
  const strangerSlots = [
    [-26, 10, 20, 'LOBBY-A'], [-22, 14, 5, 'GATE-MAIN'], [-19, 9, 45, 'LOBBY-A'], [-15, 16, 10, 'GATE-EAST'],
    [-12, 11, 30, 'LOBBY-B'], [-9, 13, 15, 'LOBBY-A'], [-6, 9, 5, 'GATE-MAIN'], [-4, 15, 40, 'LOBBY-A'],
    [-3, 10, 50, 'GATE-EAST'], [-2, 12, 25, 'LOBBY-B'], [-1, 9, 35, 'LOBBY-A'], [-1, 14, 20, 'GATE-MAIN'],
    [0, 8, 50, 'LOBBY-A'], [0, 9, 40, 'GATE-MAIN'],
  ];
  const devFaceByZone = { 'LOBBY-A': 'DEMO-FACE-LOBBY-A', 'GATE-MAIN': 'DEMO-FACE-GATE-MAIN', 'GATE-EAST': 'DEMO-FACE-GATE-EAST', 'LOBBY-B': 'DEMO-FACE-LOBBY-B' };
  strangerSlots.forEach(([day, h, m, zone], i) => {
    const time = vnTime(day, h, m, now);
    if (time > cutoff) return;
    const s = out.strangers[i % out.strangers.length];
    const evId = newEvent({
      deviceCode: devFaceByZone[zone], zoneCode: zone, type: 'camera_face_event', time, severity: 'warning',
      snapshotId: s.id,
      payload: { reason: 'NO_ACTIVE_FACE_PROFILE_MATCH', source: 'camera_api', userId: null, direction: 'seen',
        matchState: 'unmatched_faceid', similarity: +(0.22 + (i % 6) * 0.04).toFixed(2), hasSnapshot: true,
        cameraDeviceCode: devFaceByZone[zone] },
    });
    strangerEvents.push({ evId, time, zone, media: s, idx: i });
  });

  // ---------- Ghép cặp (hai chiều) — cập nhật SAU khi chèn log (khoá ngoại tự tham chiếu) ----------
  const pairUpdates = [];
  for (const [a, b] of pairs) {
    const secs = Math.max(0, Math.round((b.access_time - a.access_time) / 1000));
    pairUpdates.push([a.id, b.id, secs], [b.id, a.id, secs]);
  }
  for (const l of logs) { l.paired_log_id = null; l.duration_seconds = null; }

  // ---------- Hiện diện theo zone (count mỗi giờ trong quá khứ, mỗi 10 phút hôm nay) ----------
  const profile = {
    'GATE-MAIN': (h) => (h >= 7 && h < 9 ? 9 : h >= 17 && h < 19 ? 7 : h >= 6 && h < 20 ? 2 : 0),
    'GATE-EAST': (h) => (h >= 7 && h < 9 ? 6 : h >= 16 && h < 18 ? 5 : h >= 6 && h < 20 ? 1 : 0),
    'PARK-CAR': (h) => (h < 6 ? 2 : h < 8 ? 6 : h < 17 ? 11 : h < 19 ? 7 : 3),
    'PARK-BIKE': (h) => (h < 6 ? 5 : h < 8 ? 24 : h < 17 ? 38 : h < 19 ? 22 : 8),
    'LOBBY-A': (h) => (h >= 7 && h < 9 ? 14 : h >= 12 && h < 13 ? 12 : h >= 17 && h < 19 ? 10 : h >= 8 && h < 18 ? 5 : 1),
    'CORR-A2': (h) => (h >= 9 && h < 12 ? 6 : h >= 13 && h < 17 ? 7 : h >= 8 && h < 18 ? 3 : 0),
    'ROOM-A201': (h) => (h >= 9 && h < 11 ? 14 : h >= 14 && h < 16 ? 12 : 0),
    'SERVER-B3': (h) => (h >= 9 && h < 17 ? 1 : 0),
    'LOBBY-B': (h) => (h >= 11 && h < 13 ? 27 : h >= 8 && h < 18 ? 8 : 1),
  };
  const zoneEvents = [];
  let nZ = 0;
  const addCount = (zoneCode, time, count, devCode) => {
    nZ++;
    zoneEvents.push({
      id: did('zone_presence_events', nZ), zone_id: Z[zoneCode], device_id: devCode ? D[devCode] : null,
      event_type: 'count', occupancy_count: count, confidence_score: +(0.9 + (nZ % 9) / 100).toFixed(2),
      event_time: time, source_type: 'camera', metadata_json: { seed: 'DEMO-2026-10' }, created_at: time,
    });
  };
  const zoneDev = { 'GATE-MAIN': 'DEMO-FACE-GATE-MAIN', 'GATE-EAST': 'DEMO-FACE-GATE-EAST', 'LOBBY-A': 'DEMO-FACE-LOBBY-A',
    'CORR-A2': 'DEMO-CAM-CORR-A2', 'ROOM-A201': 'DEMO-CAM-ROOM-A201', 'PARK-CAR': 'DEMO-ANPR-PARK-CAR', 'PARK-BIKE': 'DEMO-CAM-PARK-BIKE',
    'SERVER-B3': 'DEMO-FACE-SERVER-B3', 'LOBBY-B': 'DEMO-FACE-LOBBY-B' };
  for (let day = -DAYS_BACK; day <= 0; day++) {
    const R = rng(777 + day * 31);
    const dow = vnDow(day, now);
    const weekend = dow === 0 || dow === 6;
    const step = day === 0 ? 10 : 60;
    for (let mins = 6 * 60; mins <= 20 * 60; mins += step) {
      const time = vnTime(day, 0, 0, now); time.setUTCMinutes(time.getUTCMinutes() + mins);
      if (time > cutoff) continue;
      for (const [zoneCode, fn] of Object.entries(profile)) {
        if (zoneCode === 'LOBBY-B' && day === 0 && mins > 0 && false) continue;
        let cnt = fn(Math.floor(mins / 60));
        if (weekend) cnt = Math.round(cnt * 0.15);
        cnt = Math.max(0, cnt + R.int(-1, 2));
        if (cnt === 0 && R.chance(0.5)) continue;
        addCount(zoneCode, time, cnt, zoneDev[zoneCode]);
      }
    }
  }
  // sự kiện xuất hiện/biến mất của nhân sự (timeline) — hôm nay & hôm qua, từ log sảnh
  let nAp = 0;
  const apRows = [];
  for (const l of logs) {
    if (l.zone_id !== Z['LOBBY-A'] || !l.user_id) continue;
    if (l.access_time < vnTime(-1, 0, 0, now)) continue;
    nAp++;
    apRows.push({
      id: did('zone_presence_events', 100000 + nAp), zone_id: l.zone_id, device_id: l.device_id, user_id: l.user_id,
      event_type: l.direction === 'enter' ? 'appear' : 'disappear', occupancy_count: null,
      confidence_score: l.metadata_json.similarity ?? 0.93, event_time: l.access_time, source_type: 'camera',
      metadata_json: { seed: 'DEMO-2026-10' }, created_at: l.access_time,
    });
  }

  // ---------- Luật cảnh báo + cảnh báo ----------
  const itIds = out.staff.filter((s) => s.dept === 'IT').map((s) => s.id);
  const rules = [
    ['stranger', 'LOBBY-A', 1, ['in_app', 'email'], null],
    ['stranger', 'GATE-MAIN', 1, ['in_app'], null],
    ['crowd', 'LOBBY-B', 25, ['in_app'], null],
    ['intrusion', 'SERVER-B3', 1, ['in_app', 'email'], { allowed: itIds }],
    ['device_error', null, 1, ['in_app'], null],
  ];
  const ruleIds = {};
  const ruleRows = rules.map(([type, zone, thr, ch, extra], i) => {
    const id = did('alert_rules', i + 1);
    ruleIds[`${type}:${zone}`] = id;
    return {
      id, alert_type: type, zone_id: zone ? Z[zone] : null, threshold: thr, channels: ch, enabled: true,
      restricted_hours_json: type === 'intrusion' ? [{ from: '18:00', to: '07:00' }, { from: '00:00', to: '23:59', weekdays: [0, 6] }] : null,
      allowed_person_ids_json: extra?.allowed ?? null, created_by: adminId, updated_by: adminId,
      created_at: vnTime(-30, 9, 0, now), updated_at: vnTime(-30, 9, 0, now),
    };
  });
  n.alert_rules = await insert(c, 'alert_rules', ruleRows);

  const alerts = [];
  let nA = 0;
  const addAlert = ({ type, sev, zone, time, status, payload, rule, ack, res, note, count = 1 }) => {
    if (time > cutoff) return;
    nA++;
    const ackAt = status !== 'new' ? addMin(time, 4 + (nA % 20)) : null;
    const resAt = status === 'resolved' ? addMin(ackAt, 15 + (nA % 90)) : null;
    alerts.push({
      id: did('security_alerts', nA), alert_type: type, severity: sev, zone_id: zone ? Z[zone] : null,
      dedupe_key: `demo:${type}:${zone ?? 'all'}:${nA}`, status, triggered_at: time, last_seen_at: addMin(time, count > 1 ? 12 : 0),
      occurrence_count: count, rule_id: rule ? ruleIds[rule] : null, payload_json: { seed: 'DEMO-2026-10', ...payload },
      acknowledged_by: ackAt ? ack ?? ref.user['guard.demo'] : null, acknowledged_at: ackAt,
      resolved_by: resAt ? res ?? ref.user['guard.demo'] : null, resolved_at: resAt,
      resolution_note: resAt ? note ?? 'Đã kiểm tra, xử lý xong' : null, created_at: time, updated_at: resAt ?? ackAt ?? time,
    });
  };
  const guards = out.staff.filter((s) => s.role === 'GUARD');
  // stranger — từ sự kiện camera
  strangerEvents.forEach((s, i) => {
    const sev = i % 5 === 4 ? 'high' : 'medium';
    const status = s.time < vnTime(-2, 0, 0, now) ? 'resolved' : i % 3 === 0 ? 'new' : 'acknowledged';
    addAlert({ type: 'stranger', sev, zone: s.zone, time: s.time, status, rule: s.zone === 'GATE-MAIN' ? 'stranger:GATE-MAIN' : 'stranger:LOBBY-A',
      ack: guards[i % 2].id, res: guards[i % 2].id, note: 'Đã xác minh: khách chưa đăng ký, đã hướng dẫn làm thủ tục',
      payload: { imageUrl: s.media.uri, sourceEventId: s.evId, mediaFileId: s.media.id, similarity: 0.3, deviceCode: devFaceByZone[s.zone] } });
  });
  // vehicle_control_match / unknown_vehicle — từ log khách
  const plateLogs = logs.filter((l) => l.plate_number && !l.user_id && l.direction === 'enter');
  const blockPlates = new Set(['30H11122', '51F44455']);
  const watchPlates = new Set(['29E77788', '36A22211']);
  let ucount = 0;
  for (const l of plateLogs) {
    if (blockPlates.has(l.plate_number) || watchPlates.has(l.plate_number)) {
      const blk = blockPlates.has(l.plate_number);
      const old = l.access_time < vnTime(-2, 0, 0, now);
      addAlert({ type: 'vehicle_control_match', sev: blk ? 'critical' : 'high', zone: l.zone_id === Z['GATE-EAST'] ? 'GATE-EAST' : 'GATE-MAIN',
        time: l.access_time, status: old ? 'resolved' : ++ucount % 2 ? 'new' : 'acknowledged', rule: null,
        payload: { plateNumber: l.plate_number, plateRaw: plates[l.plate_number].raw, listType: blk ? 'blocklist' : 'watchlist', imageUrl: plates[l.plate_number].uri, sourceEventId: l.event_id },
        note: blk ? 'Đã từ chối xe vào, lập biên bản' : 'Đã kiểm tra giấy tờ, cho phép vào' });
    } else if (ucount++ % 9 === 0) {
      const old = l.access_time < vnTime(-2, 0, 0, now);
      addAlert({ type: 'unknown_vehicle', sev: 'low', zone: l.zone_id === Z['GATE-EAST'] ? 'GATE-EAST' : 'GATE-MAIN', time: l.access_time,
        status: old ? 'resolved' : 'new', rule: null,
        payload: { plateNumber: l.plate_number, plateRaw: plates[l.plate_number].raw, imageUrl: plates[l.plate_number].uri, sourceEventId: l.event_id },
        note: 'Xe khách, đã đăng ký tại quầy bảo vệ' });
    }
  }
  // crowd — căng tin giờ trưa
  for (const day of [-24, -17, -10, -8, -3, -1, 0]) {
    addAlert({ type: 'crowd', sev: day > -4 ? 'high' : 'medium', zone: 'LOBBY-B', time: vnTime(day, 12, 10 + (day % 7), now), status: day < -2 ? 'resolved' : day === 0 ? 'new' : 'acknowledged',
      rule: 'crowd:LOBBY-B', count: 3, payload: { occupancyCount: 27 + (-day % 5), threshold: 25 }, note: 'Mật độ giảm sau 20 phút, không cần can thiệp' });
  }
  // intrusion — phòng máy chủ ngoài giờ
  [[-21, 19, 40], [-13, 22, 5], [-6, 20, 15], [-1, 18, 55], [0, 7, 5]].forEach(([day, h, m], i) => {
    const who = out.staff.filter((s) => s.dept !== 'IT' && s.role === 'EMPLOYEE')[i % 5];
    addAlert({ type: 'intrusion', sev: i === 1 ? 'critical' : 'high', zone: 'SERVER-B3', time: vnTime(day, h, m, now),
      status: day < -3 ? 'resolved' : day === 0 ? 'new' : 'acknowledged', rule: 'intrusion:SERVER-B3',
      payload: { userId: who.id, userName: who.name, reason: 'out_of_allowed_hours' }, note: 'Đã liên hệ, nhân sự xin phép trực hệ thống' });
  });
  // device_error — thiết bị mất kết nối
  [[-18, 'DEMO-FACE-LOBBY-B', 'Mất kết nối > 15 phút', 'LOBBY-B', 'medium'], [-9, 'DEMO-CAM-ACD-R102', 'Hình ảnh nhiễu', null, 'low'],
   [-5, 'DEMO-AGENT-H01', 'Capture Agent không phản hồi', null, 'medium'], [-1, 'DEMO-FACE-LOBBY-B', 'Mất kết nối > 15 phút', 'LOBBY-B', 'high'],
   [0, 'DEMO-CAM-ACD-R103', 'Đang bảo trì', null, 'low']].forEach(([day, dev, msg, zone, sev], i) => {
    addAlert({ type: 'device_error', sev, zone, time: vnTime(day, 6 + i, 20, now), status: day < -6 ? 'resolved' : day === 0 ? 'new' : 'acknowledged',
      payload: { deviceCode: dev, message: msg }, rule: 'device_error:null', ack: adminId, res: adminId, note: 'Đã cử kỹ thuật kiểm tra' });
  });

  // ---------- Ghi DB ----------
  n.plate_media = await insert(c, 'media_files', plateMediaRows);
  n.iot_device_events = await insert(c, 'iot_device_events', events);
  n.gate_access_logs = await insert(c, 'gate_access_logs', logs);
  for (let i = 0; i < pairUpdates.length; i += 2000) {
    const part = pairUpdates.slice(i, i + 2000);
    await c.query(
      `UPDATE public.gate_access_logs g SET paired_log_id = v.p, duration_seconds = v.d
       FROM unnest($1::uuid[], $2::uuid[], $3::int[]) AS v(id, p, d) WHERE g.id = v.id`,
      [part.map((x) => x[0]), part.map((x) => x[1]), part.map((x) => x[2])],
    );
  }
  n.gate_pairs = pairUpdates.length / 2;
  n.zone_presence_events = await insert(c, 'zone_presence_events', [...zoneEvents, ...apRows]);
  n.security_alerts = await insert(c, 'security_alerts', alerts);

  // ---------- KPI giờ (giống KPI rollup, giới hạn trên dữ liệu demo) ----------
  const prefix = 'de0de0de-%';
  const r1 = await c.query(
    `WITH src AS (
       SELECT zone_id, event_time, occupancy_count, date_trunc('hour', event_time, 'UTC') AS bucket_hour
       FROM public.zone_presence_events WHERE event_type='count' AND id::text LIKE $1
     ), agg AS (
       SELECT bucket_hour, zone_id, COUNT(*) AS event_count, COUNT(occupancy_count) AS sample_count,
              COALESCE(SUM(occupancy_count),0) AS occupancy_sum, MAX(occupancy_count) AS occupancy_peak
       FROM src GROUP BY bucket_hour, zone_id
     ), peak AS (
       SELECT DISTINCT ON (zone_id, bucket_hour) zone_id, bucket_hour, event_time AS peak_at FROM src
       ORDER BY zone_id, bucket_hour, occupancy_count DESC NULLS LAST, event_time DESC
     )
     INSERT INTO public.kpi_zone_hourly (bucket_hour, zone_id, event_count, sample_count, occupancy_sum, occupancy_peak, peak_at)
     SELECT a.bucket_hour, a.zone_id, a.event_count, a.sample_count, a.occupancy_sum, a.occupancy_peak, p.peak_at
     FROM agg a JOIN peak p USING (zone_id, bucket_hour)
     ON CONFLICT DO NOTHING`, [prefix]);
  n.kpi_zone_hourly = r1.rowCount;
  const r2 = await c.query(
    `INSERT INTO public.kpi_vehicle_hourly (bucket_hour, zone_id, vehicle_type, direction, match_state, event_count)
     SELECT date_trunc('hour', event_time,'UTC'), zone_id, payload_json->>'vehicleType', payload_json->>'direction',
            payload_json->>'matchState', COUNT(*)
     FROM public.iot_device_events WHERE event_type='ivss_vehicle_event' AND id::text LIKE $1 GROUP BY 1,2,3,4,5`, [prefix]);
  n.kpi_vehicle_hourly = r2.rowCount;
  const r3 = await c.query(
    `INSERT INTO public.kpi_vehicle_plate_hourly (bucket_hour, zone_id, vehicle_type, plate_number)
     SELECT DISTINCT date_trunc('hour', event_time,'UTC'), zone_id, payload_json->>'vehicleType', payload_json->>'plateNumber'
     FROM public.iot_device_events WHERE event_type='ivss_vehicle_event' AND id::text LIKE $1 AND payload_json->>'plateNumber' IS NOT NULL`, [prefix]);
  n.kpi_vehicle_plate_hourly = r3.rowCount;
  return n;
}
