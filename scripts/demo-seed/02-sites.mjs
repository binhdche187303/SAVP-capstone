// Giai đoạn A2 — phòng, zone, thiết bị IoT, thiết bị cơ sở vật chất, xe, danh sách theo dõi,
// ánh xạ khuôn mặt ↔ thiết bị, cấu hình hệ thống.
import { asset, did, insert, vnTime, addMin } from './lib.mjs';

// ---------- Phòng mới (phòng cũ giữ nguyên) ----------
const ROOMS = [
  ['ACD-R101', 'Phòng học R101', 'Tòa Học vụ', 'Tầng 1', 40, 'training_room', true],
  ['ACD-R102', 'Phòng học R102', 'Tòa Học vụ', 'Tầng 1', 40, 'training_room', true],
  ['ACD-R103', 'Phòng học R103', 'Tòa Học vụ', 'Tầng 2', 40, 'training_room', true],
  ['RM-B303', 'Phòng họp B303', 'Tòa B', 'Tầng 3', 10, 'meeting_room', true],
  ['RM-H01', 'Hội trường H1', 'Tòa A', 'Tầng 1', 120, 'training_room', true],
];

// ---------- Zone khuôn viên ----------
// [code, name, type, building, floor, lat, lng, description]
const ZONES = [
  ['GATE-MAIN', 'Cổng chính', 'gate', 'Khuôn viên', 'G', 21.01362, 105.52531, 'Cổng ra vào chính cho người đi bộ và xe'],
  ['GATE-EAST', 'Cổng phụ phía Đông', 'gate', 'Khuôn viên', 'G', 21.01291, 105.52703, 'Cổng phụ, chủ yếu xe máy và giao nhận'],
  ['PARK-CAR', 'Bãi xe ô tô', 'parking', 'Khuôn viên', 'G', 21.01335, 105.52588, 'Bãi đỗ ô tô, sức chứa 60 xe'],
  ['PARK-BIKE', 'Bãi xe máy', 'parking', 'Khuôn viên', 'G', 21.01318, 105.52624, 'Bãi giữ xe máy, sức chứa 300 xe'],
  ['LOBBY-A', 'Sảnh Tòa A', 'lobby', 'Tòa A', '1', 21.01398, 105.52552, 'Sảnh chính, quầy lễ tân'],
  ['CORR-A2', 'Hành lang tầng 2 Tòa A', 'corridor', 'Tòa A', '2', 21.01401, 105.52557, 'Khu phòng họp tầng 2'],
  ['ROOM-A201', 'Phòng đào tạo A201', 'room', 'Tòa A', '2', 21.01404, 105.52561, 'Phòng đào tạo 20 chỗ'],
  ['SERVER-B3', 'Phòng máy chủ B3', 'room', 'Tòa B', '3', 21.01426, 105.52598, 'Khu vực hạn chế — chỉ nhân sự IT được phép'],
  ['LOBBY-B', 'Sảnh căng tin Tòa B', 'lobby', 'Tòa B', '1', 21.01419, 105.52588, 'Căng tin và khu nghỉ'],
];

// ---------- Thiết bị IoT ----------
// [code, name, type, zoneCode|null, roomCode|null, status, health, ip]
const DEVICES = [
  ['DEMO-FACE-GATE-MAIN', 'Máy nhận diện khuôn mặt - Cổng chính', 'face_server', 'GATE-MAIN', null, 'online', 'healthy', '10.20.1.11'],
  ['DEMO-FACE-GATE-EAST', 'Máy nhận diện khuôn mặt - Cổng phụ', 'face_server', 'GATE-EAST', null, 'online', 'healthy', '10.20.1.12'],
  ['DEMO-FACE-LOBBY-A', 'Máy nhận diện khuôn mặt - Sảnh Tòa A', 'face_server', 'LOBBY-A', null, 'online', 'healthy', '10.20.1.21'],
  ['DEMO-FACE-SERVER-B3', 'Camera cửa - Phòng máy chủ B3', 'door_camera', 'SERVER-B3', null, 'online', 'warning', '10.20.1.31'],
  ['DEMO-FACE-LOBBY-B', 'Máy nhận diện khuôn mặt - Căng tin B', 'face_server', 'LOBBY-B', null, 'offline', 'faulty', '10.20.1.41'],
  ['DEMO-ANPR-GATE-MAIN', 'Camera biển số - Cổng chính', 'anpr_camera', 'GATE-MAIN', null, 'online', 'healthy', '10.20.2.11'],
  ['DEMO-ANPR-GATE-EAST', 'Camera biển số - Cổng phụ', 'anpr_camera', 'GATE-EAST', null, 'online', 'healthy', '10.20.2.12'],
  ['DEMO-ANPR-PARK-CAR', 'Camera biển số - Bãi xe ô tô', 'anpr_camera', 'PARK-CAR', null, 'online', 'healthy', '10.20.2.21'],
  ['DEMO-CAM-PARK-BIKE', 'Camera giám sát - Bãi xe máy', 'ip_camera', 'PARK-BIKE', null, 'online', 'healthy', '10.20.3.11'],
  ['DEMO-CAM-CORR-A2', 'Camera hành lang tầng 2', 'room_camera', 'CORR-A2', null, 'online', 'healthy', '10.20.3.21'],
  ['DEMO-CAM-ROOM-A201', 'Camera phòng A201', 'room_camera', 'ROOM-A201', 'RM-A201', 'online', 'healthy', '10.20.3.31'],
  ['DEMO-CAM-ACD-R101', 'Camera phòng học R101', 'room_camera', null, 'ACD-R101', 'online', 'healthy', '10.20.4.11'],
  ['DEMO-CAM-ACD-R102', 'Camera phòng học R102', 'room_camera', null, 'ACD-R102', 'online', 'warning', '10.20.4.12'],
  ['DEMO-CAM-ACD-R103', 'Camera phòng học R103', 'room_camera', null, 'ACD-R103', 'maintenance', 'warning', '10.20.4.13'],
  ['DEMO-CAM-RM-B303', 'Camera phòng họp B303', 'room_camera', null, 'RM-B303', 'online', 'healthy', '10.20.4.21'],
  ['DEMO-CAM-RM-H01', 'Camera Hội trường H1', 'room_camera', null, 'RM-H01', 'online', 'healthy', '10.20.4.31'],
  ['DEMO-AGENT-B303', 'Capture Agent phòng B303', 'capture_agent', null, 'RM-B303', 'online', 'healthy', '10.20.5.21'],
  ['DEMO-AGENT-H01', 'Capture Agent Hội trường H1', 'capture_agent', null, 'RM-H01', 'offline', 'faulty', '10.20.5.31'],
  ['DEMO-SENSOR-A201', 'Cảm biến hiện diện A201', 'occupancy_sensor', 'ROOM-A201', 'RM-A201', 'online', 'healthy', '10.20.6.11'],
];

// ---------- Thiết bị cơ sở vật chất ----------
// [code, name, type, brand, model, assetStatus, health, roomCode, note]
const EQUIP = [
  ['EQ-DEMO-001', 'Màn hình họp 65" B303', 'display', 'Samsung', 'QM65B', 'assigned', 'healthy', 'RM-B303'],
  ['EQ-DEMO-002', 'Micro hội nghị B303', 'microphone', 'Shure', 'MXA310', 'assigned', 'healthy', 'RM-B303'],
  ['EQ-DEMO-003', 'Camera phòng B303', 'camera', 'Hikvision', 'DS-2CD2143G2', 'assigned', 'healthy', 'RM-B303'],
  ['EQ-DEMO-004', 'Màn hình Hội trường H1', 'display', 'LG', 'LAEC015', 'assigned', 'healthy', 'RM-H01'],
  ['EQ-DEMO-005', 'Loa hội trường H1', 'speaker', 'JBL', 'PRX815W', 'assigned', 'warning', 'RM-H01'],
  ['EQ-DEMO-006', 'Micro không dây H1', 'microphone', 'Shure', 'SLXD24', 'assigned', 'healthy', 'RM-H01'],
  ['EQ-DEMO-007', 'Camera phòng R101', 'camera', 'Hikvision', 'DS-2CD2347G2', 'assigned', 'healthy', 'ACD-R101'],
  ['EQ-DEMO-008', 'Máy chiếu R102', 'display', 'Epson', 'EB-X49', 'assigned', 'faulty', 'ACD-R102'],
  ['EQ-DEMO-009', 'Camera phòng R103', 'camera', 'Hikvision', 'DS-2CD2347G2', 'maintenance', 'warning', 'ACD-R103'],
  ['EQ-DEMO-010', 'Micro dự phòng', 'microphone', 'Shure', 'MXA310', 'available', 'healthy', null],
  ['EQ-DEMO-011', 'Màn hình dự phòng 55"', 'display', 'Samsung', 'QM55B', 'available', 'healthy', null],
  ['EQ-DEMO-012', 'Camera cũ phòng A102', 'camera', 'Dahua', 'IPC-HDW1230T', 'retired', 'unknown', null],
  ['EQ-DEMO-013', 'Loa di động', 'speaker', 'Bose', 'S1 Pro', 'lost', 'unknown', null],
  ['EQ-DEMO-014', 'Cảm biến hiện diện A201', 'sensor', 'Milesight', 'VS121', 'assigned', 'healthy', 'RM-A201'],
];

const EMP_PLATES = {
  cars: { 'vinh.tq': '30K51234', 'ha.ntt': '29A87621', 'thanh.pd': '30G24567', 'anh.ltp': '51H33789',
          'hieu.dv': '29C19045', 'tam.nm': '30F67812', 'nhung.vth': '29B34590', 'loc.cv': '30E90123',
          'ngan.ptk': '51G45678', 'yen.dth': '88A12399' },
  bikes: ['dung.tv', 'bao.lq', 'lananh.ht', 'mai.btn', 'tam.dtt', 'phuong.ltb', 'trang.mtt', 'khanh.tq'],
  studentBikes: ['he190001', 'he190007', 'he190009'],
  // biển xe máy theo thứ tự trong plates.json
};

export async function seedSites(ctx) {
  const { c, ref, out, now, snap } = ctx;
  const n = {};
  const plates = asset('plates.json');
  const faces = asset('faces.json');
  const adminId = ref.user['sysadmin'];

  // --- Rooms ---
  const roomRows = ROOMS.map(([code, name, site, area, cap, type, rec], i) => ({
    id: did('rooms', i + 1), room_code: code, room_name: name, site_name: site, area_name: area,
    capacity: cap, room_type: type, current_status: 'available', administrative_status: 'available',
    has_camera: true, has_microphone: true, has_display: true, allow_recording: rec, is_active: true,
    created_by: adminId, created_at: vnTime(-60, 9, 0, now), updated_at: vnTime(-5, 9, 0, now),
  }));
  n.rooms = await insert(c, 'rooms', roomRows);
  const roomId = { ...ref.room };
  roomRows.forEach((r) => (roomId[r.room_code] = r.id));
  out.room = roomId;

  // --- Zones ---
  const zoneId = {};
  const zoneRows = ZONES.map(([code, name, type, building, floor, lat, lng, desc], i) => {
    zoneId[code] = did('zones', i + 1);
    return {
      id: zoneId[code], zone_code: code, zone_name: name, zone_type: type, building, floor,
      description: desc, latitude: lat, longitude: lng, status: 'active',
      metadata_json: { seed: 'DEMO-2026-10', restricted: code === 'SERVER-B3' },
      created_at: vnTime(-60, 9, 0, now), updated_at: vnTime(-5, 9, 0, now),
    };
  });
  n.zones = await insert(c, 'zones', zoneRows);
  out.zone = zoneId;

  // --- IoT devices ---
  const deviceId = {};
  const devRows = DEVICES.map(([code, name, type, zoneCode, roomCode, status, health, ip], i) => {
    deviceId[code] = did('iot_devices', i + 1);
    const online = status === 'online';
    return {
      id: deviceId[code], device_code: code, device_name: name, device_type: type,
      room_id: roomCode ? roomId[roomCode] : null, zone_id: zoneCode ? zoneId[zoneCode] : null,
      network_identifier: `net-${i + 1}`, ip_address: ip,
      mac_address: `AC:CC:8E:${(10 + i).toString(16).toUpperCase()}:${(40 + i * 3).toString(16).toUpperCase()}:${(90 + i).toString(16).toUpperCase()}`,
      stream_url: type.includes('camera') ? `rtsp://${ip}:554/Streaming/Channels/101` : null,
      mqtt_topic: `savp/demo/${code.toLowerCase()}`, agent_version: '2.4.1', firmware_version: 'V5.7.12',
      status, health_status: health,
      last_seen_at: online ? addMin(now, -(1 + (i % 4))) : vnTime(-2, 22, 15, now),
      metadata_json: { seed: 'DEMO-2026-10' },
      created_at: vnTime(-50, 9, 0, now), updated_at: now,
    };
  });
  n.iot_devices = await insert(c, 'iot_devices', devRows);
  out.device = deviceId;

  // --- Equipment ---
  const eqRows = EQUIP.map(([code, name, type, brand, model, asset_status, health, roomCode], i) => ({
    id: did('equipments', i + 1), equipment_code: code, equipment_name: name, equipment_type: type,
    serial_number: `SN${20260000 + i * 37}`, brand, model, purchase_date: '2026-03-15',
    asset_status, health_status: health, current_room_id: roomCode ? roomId[roomCode] : null,
    assigned_by: roomCode ? adminId : null, assigned_at: roomCode ? vnTime(-40, 10, 0, now) : null,
    installed_at: roomCode ? vnTime(-39, 10, 0, now) : null,
    last_maintenance_at: asset_status === 'maintenance' ? vnTime(-2, 9, 0, now) : vnTime(-30, 9, 0, now),
    last_issue_reported_at: health === 'faulty' || health === 'warning' ? vnTime(-1, 15, 0, now) : null,
    last_issue_note: health === 'faulty' ? 'Không lên hình, đã báo bảo trì' : health === 'warning' ? 'Hoạt động chập chờn' : null,
    specification_json: { seed: 'DEMO-2026-10' },
    created_at: vnTime(-60, 9, 0, now), updated_at: now,
  }));
  n.equipments = await insert(c, 'equipments', eqRows);

  // --- Xe đăng ký ---
  const staff = out.staff;
  const students = out.students;
  const userByName = (u) => staff.find((s) => s.username === u) ?? students.find((s) => s.username === u);
  const carPlates = Object.keys(plates).filter((k) => plates[k].group === 'staff' && plates[k].type === 'car');
  const bikePlates = Object.keys(plates).filter((k) => plates[k].group === 'staff' && plates[k].type === 'motorbike');
  const owners = [];
  Object.keys(EMP_PLATES.cars).forEach((u, i) => owners.push({ u, plate: carPlates[i], type: 'car' }));
  [...EMP_PLATES.bikes, ...EMP_PLATES.studentBikes].forEach((u, i) => owners.push({ u, plate: bikePlates[i], type: 'motorbike' }));
  // đồng bộ biển với danh sách thực tế trong plates.json
  const vehRows = owners.map((o, i) => {
    const owner = userByName(o.u);
    const disabled = o.u === 'khanh.tq' || o.u === 'he190009';
    return {
      id: did('vehicle_registrations', i + 1), user_id: owner.id, plate_number: o.plate,
      plate_raw: plates[o.plate].raw, vehicle_type: o.type,
      note: disabled ? 'Tạm ngưng — chờ cập nhật giấy tờ xe' : null,
      status: disabled ? 'disabled' : 'active',
      created_at: vnTime(-35, 9, 0, now), updated_at: vnTime(-35, 9, 0, now),
    };
  });
  n.vehicle_registrations = await insert(c, 'vehicle_registrations', vehRows);
  out.vehicles = vehRows.map((v, i) => ({ ...v, ownerUsername: owners[i].u, owner: userByName(owners[i].u) }));

  // --- Danh sách theo dõi xe ---
  const vclRows = [
    ['30H11122', 'blocklist', 'Xe vi phạm nội quy bãi đỗ nhiều lần'],
    ['51F44455', 'blocklist', 'Xe bị phản ánh đỗ chắn lối PCCC'],
    ['29E77788', 'watchlist', 'Xe taxi ra vào nhiều lần bất thường'],
    ['36A22211', 'watchlist', 'Biển số đã bị nhà cung cấp cảnh báo'],
  ].map(([p, t, r], i) => ({
    id: did('vehicle_control_list', i + 1), plate_number: p, plate_raw: plates[p]?.raw ?? p,
    list_type: t, reason: r, active: true, created_by: ref.user['guard.demo'] ?? adminId,
    created_at: vnTime(-14 + i, 9, 0, now), updated_at: vnTime(-14 + i, 9, 0, now),
  }));
  n.vehicle_control_list = await insert(c, 'vehicle_control_list', vclRows);

  // --- Media cho người lạ / khách (ảnh trong danh sách theo dõi + snapshot cảnh báo) ---
  let nM = out.mediaCounter ?? 0;
  const mk = (group, idx, entity, code) => {
    nM++;
    const f = faces[group][idx];
    return {
      row: {
        id: did('media_files', nM), file_code: code, related_entity_type: entity,
        uploaded_by: adminId, file_name: `${code}.jpg`, file_type: 'image', mime_type: 'image/jpeg',
        storage_provider: 'local', storage_key: `demo-seed/${entity}/${code}.jpg`, file_url: f.uri,
        file_size_bytes: Math.round(f.uri.length * 0.75), version_no: 1, visibility_level: 'internal',
        is_active: true, uploaded_at: vnTime(-10, 10, 0, now), metadata_json: { seed: 'DEMO-2026-10' },
      },
      uri: f.uri, id: did('media_files', nM),
    };
  };
  const strangers = [];
  const strangerEntry = (group, i, code) => {
    const real = snap.get(`S-${group}-${i}`);
    if (real) return { row: null, uri: faces[group][i].uri, id: real }; // ảnh thật đã có trên storage
    return mk(group, i, 'camera_face_event', code);
  };
  faces.strangerM.forEach((_, i) => strangers.push(strangerEntry('strangerM', i, `STR-M${i + 1}`)));
  faces.strangerF.forEach((_, i) => strangers.push(strangerEntry('strangerF', i, `STR-F${i + 1}`)));
  const guests = [];
  faces.guestM.forEach((_, i) => guests.push(mk('guestM', i, 'person_control_list', `GST-M${i + 1}`)));
  faces.guestF.forEach((_, i) => guests.push(mk('guestF', i, 'person_control_list', `GST-F${i + 1}`)));
  n.media_files = await insert(c, 'media_files', [...strangers, ...guests].map((x) => x.row).filter(Boolean));
  out.mediaCounter = nM;
  out.strangers = strangers; // [{id, uri}]

  // --- Danh sách theo dõi người ---
  const pcl = [
    [guests[0], 'Đối tượng cấm vào khuôn viên', 'blocklist', 'critical', 'Từng gây rối, có quyết định cấm vào'],
    [guests[1], 'Người lạ đi theo xe ra vào cổng', 'blocklist', 'high', 'Nhiều lần bám theo xe vào bãi đỗ'],
    [guests[2], 'Khách cần theo dõi', 'watchlist', 'medium', 'Khách thương mại lưu trú dài ngày'],
    [guests[3], 'Cựu nhân viên đã nghỉ việc', 'watchlist', 'low', 'Đã nghỉ việc, chưa trả thẻ truy cập'],
    [guests[4], 'Đối tượng phát tờ rơi', 'watchlist', 'low', 'Phát tờ rơi trái phép trước cổng'],
    [guests[5], 'Người bị cấm từ vụ việc tháng 9', 'blocklist', 'high', 'Vụ mất cắp tại sảnh Tòa A'],
  ].map(([g, name, type, prio, reason], i) => ({
    id: did('person_control_list', i + 1), display_name: name, photo_media_file_id: g.id,
    list_type: type, reason, priority: prio, active: i !== 3, created_by: adminId,
    created_at: vnTime(-12 + i, 9, 0, now), updated_at: vnTime(-12 + i, 9, 0, now),
  }));
  n.person_control_list = await insert(c, 'person_control_list', pcl);

  // --- Ánh xạ khuôn mặt nhân sự ↔ thiết bị nhận diện ---
  const faceDevices = ['DEMO-FACE-GATE-MAIN', 'DEMO-FACE-LOBBY-A'];
  const dum = [];
  let k = 0;
  for (const s of [...staff, ...out.teachers]) {
    if (!s._faceProfileId) continue;
    if (!['active', 'revoked', 'disabled'].includes(s._faceStatus)) continue;
    for (const dev of faceDevices) {
      k++;
      const synced = !(s._faceStatus !== 'active') && k % 11 !== 0;
      dum.push({
        id: did('device_user_mappings', k), device_id: deviceId[dev], user_id: s.id,
        face_profile_id: s._faceProfileId, device_person_id: `FACE-${s.employee_code ?? s.code}`,
        device_person_code: `FACE-${s.employee_code ?? s.code}`, device_person_name: s.name ?? s.full_name,
        face_registered: synced, registered_at: synced ? vnTime(-28, 11, 0, now) : null, registered_by: adminId,
        sync_status: synced ? 'synced' : s._faceStatus === 'active' ? 'failed' : 'pending',
        last_synced_at: synced ? vnTime(-1, 3, 0, now) : null,
        last_sync_error: !synced && s._faceStatus === 'active' ? 'Thiết bị từ chối ảnh: chất lượng thấp' : null,
        created_at: vnTime(-28, 11, 0, now), updated_at: vnTime(-1, 3, 0, now),
      });
    }
  }
  n.device_user_mappings = await insert(c, 'device_user_mappings', dum);

  // --- Cấu hình hệ thống cho demo (xóa cùng dữ liệu demo) ---
  n.system_configs = await insert(c, 'system_configs', [{
    id: did('system_configs', 1),
    config_key: 'campus_dashboard.occupancy_staleness_minutes',
    config_value: '1440', value_type: 'number', config_group: 'campus_dashboard',
    description: 'DEMO: nới ngưỡng "dữ liệu cũ" để số liệu hiện diện luôn hiển thị',
    version_no: 1, is_sensitive: false, is_active: true, updated_by: adminId, updated_at: now,
  }], { onConflict: 'DO NOTHING' });
  return n;
}
