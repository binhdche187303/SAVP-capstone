// Phase 08 — khách ra vào (visitors / visitor_visits / zones / events).
// Mỗi khách = 1 dòng visitors + 1 user "ẩn" (giống UsersService.createVisitorShadowUser).
// Mã lượt dùng dải VS-YYMMDD-9NNN để không đụng bộ đếm thật (bắt đầu từ 0001).
import { did, insert, vnTime, addMin } from './lib.mjs';

const VISITOR_DEPT = '8d4f3a2b-5c7b-4a3f-8e9d-2b3c4d5e6f70';

const PEOPLE = [
  ['Nguyễn Văn Hùng', '001089012345', '0912345601', 'Công ty TNHH Minh Phát'],
  ['Trần Thị Mỹ Linh', '001190023456', '0912345602', 'Ngân hàng ACB'],
  ['Lê Hoàng Nam', '036088034567', '0912345603', 'FPT Software'],
  ['Phạm Thị Hồng Nhung', null, '0912345604', 'Giao hàng Tiết Kiệm'],
  ['Đỗ Minh Quân', '001092045678', '0912345605', 'Viettel Solutions'],
  ['Vũ Thị Thanh Hương', '001195056789', '0912345606', 'Báo Tuổi Trẻ'],
  ['Hoàng Đức Anh', '038091067890', '0912345607', 'Công ty CP Xây dựng Hòa Bình'],
  ['Bùi Thị Kim Oanh', null, '0912345608', 'Ứng viên tuyển dụng'],
  ['Ngô Quang Huy', '001087078901', '0912345609', 'Samsung Electronics VN'],
  ['Đặng Thị Thu Thảo', '001193089012', '0912345610', 'Đại học Bách khoa HN'],
  ['Trịnh Văn Long', '034090090123', '0912345611', 'Điện lực Hòa Lạc'],
  ['Phan Thị Ngọc Ánh', null, '0912345612', 'Phụ huynh sinh viên'],
  ['Lý Minh Tuấn', '001086101234', '0912345613', 'KPMG Việt Nam'],
  ['Cao Thị Lan', '001194112345', '0912345614', 'Công ty TNHH Sao Mai'],
  ['Mai Văn Phúc', '037089123456', '0912345615', 'Thang máy Mitsubishi'],
  ['Dương Thị Hoa', null, '0912345616', 'Ứng viên tuyển dụng'],
];

// [người, kênh, status, host, mục đích, ngày lệch, giờ từ, giờ đến, zones, extra]
const VISITS = [
  // --- Chờ duyệt (host là nhân viên demo) ---
  [0, 'online', 'pending_approval', 'lananh.ht', 'Trao đổi tích hợp API thanh toán', 0, 14, 16, ['GATE-MAIN', 'LOBBY-A', 'CORR-A2']],
  [1, 'online', 'pending_approval', 'ngan.ptk', 'Ký phụ lục hợp đồng dịch vụ', 1, 9, 11, ['GATE-MAIN', 'LOBBY-A']],
  [7, 'online', 'pending_approval', 'tam.dtt', 'Phỏng vấn vị trí Kiểm thử', 1, 14, 15, ['GATE-MAIN', 'LOBBY-A']],
  [12, 'host_invite', 'pending_approval', 'anh.ltp', 'Kiểm toán nội bộ quý 3', 2, 8, 17, ['GATE-MAIN', 'LOBBY-A', 'CORR-A2']],
  // --- Đã duyệt, chờ đến hôm nay ---
  [2, 'host_invite', 'approved', 'tam.nm', 'Demo giải pháp camera AI', 0, 15, 17, ['GATE-MAIN', 'LOBBY-A', 'ROOM-A201']],
  [4, 'online', 'approved', 'loc.cv', 'Khảo sát hạ tầng mạng', 0, 16, 18, ['GATE-MAIN', 'LOBBY-A']],
  [9, 'host_invite', 'approved', 'gam.nth', 'Thỉnh giảng môn Kỹ thuật phần mềm', 1, 7, 11, ['GATE-MAIN', 'LOBBY-A', 'ROOM-A201']],
  // --- Đang trong khuôn viên ---
  [5, 'online', 'checked_in', 'yen.dth', 'Phỏng vấn về chuyển đổi số', 0, 9, 12, ['GATE-MAIN', 'LOBBY-A', 'LOBBY-B'], { inAt: [9, 5], zone: 'LOBBY-B', score: 0.94 }],
  [8, 'host_invite', 'checked_in', 'hieu.dv', 'Bảo trì thiết bị màn hình phòng họp', 0, 8, 17, ['GATE-MAIN', 'LOBBY-A', 'CORR-A2', 'ROOM-A201'], { inAt: [8, 12], zone: 'CORR-A2', score: 0.91, plate: '30H-456.78' }],
  [14, 'walk_in', 'checked_in', 'khanh.tq', 'Kiểm tra thang máy định kỳ', 0, 8, 12, ['GATE-EAST', 'LOBBY-B'], { inAt: [8, 40], zone: 'LOBBY-B', score: 0.88, guard: 'bao.lq' }],
  // --- Quá giờ, yêu cầu rời ---
  [10, 'walk_in', 'must_leave', 'khanh.tq', 'Sửa chữa tủ điện tầng 1', 0, 7, 9, ['GATE-EAST', 'LOBBY-B'], { inAt: [7, 15], zone: 'LOBBY-B', score: 0.86, guard: 'dung.tv', overstay: [9, 15] }],
  // --- Đã ra về ---
  [3, 'walk_in', 'checked_out', 'trang.mtt', 'Giao tài liệu hợp đồng', 0, 8, 9, ['GATE-MAIN', 'LOBBY-A'], { inAt: [8, 2], outAt: [8, 25], score: 0.9, guard: 'dung.tv' }],
  [6, 'host_invite', 'checked_out', 'hieu.dv', 'Nghiệm thu cải tạo sảnh', -1, 9, 12, ['GATE-MAIN', 'LOBBY-A', 'LOBBY-B'], { inAt: [9, 3], outAt: [11, 40], score: 0.93 }],
  [13, 'online', 'checked_out', 'nhung.vth', 'Đàm phán hợp đồng phân phối', -1, 14, 16, ['GATE-MAIN', 'LOBBY-A', 'CORR-A2'], { inAt: [14, 5], outAt: [15, 50], score: 0.95 }],
  [0, 'online', 'checked_out', 'lananh.ht', 'Kick-off dự án tích hợp', -3, 9, 11, ['GATE-MAIN', 'LOBBY-A', 'CORR-A2'], { inAt: [9, 0], outAt: [10, 55], score: 0.92 }],
  [11, 'walk_in', 'checked_out', 'tam.dtt', 'Nộp hồ sơ nhập học cho con', -2, 10, 11, ['GATE-MAIN', 'LOBBY-A'], { inAt: [10, 10], outAt: [10, 45], score: 0.87, guard: 'dung.tv' }],
  [15, 'online', 'checked_out', 'tam.dtt', 'Phỏng vấn vị trí Nhân sự', -4, 14, 15, ['GATE-MAIN', 'LOBBY-A'], { inAt: [13, 55], outAt: [14, 50], score: 0.9 }],
  [2, 'host_invite', 'exit_unrecorded', 'tam.nm', 'Khảo sát yêu cầu camera', -5, 9, 12, ['GATE-MAIN', 'LOBBY-A'], { inAt: [9, 10], score: 0.89 }],
  // --- Từ chối / huỷ / hết hạn ---
  [4, 'online', 'rejected', 'loc.cv', 'Xin vào phòng máy chủ', -1, 10, 12, ['GATE-MAIN', 'SERVER-B3'], { reason: 'Khu vực hạn chế — cần quyết định của Trưởng nhóm IT' }],
  [7, 'online', 'rejected', 'ngan.ptk', 'Giới thiệu sản phẩm bảo hiểm', -2, 15, 16, ['GATE-MAIN', 'LOBBY-A'], { reason: 'Không có nhu cầu' }],
  [1, 'online', 'expired', 'ngan.ptk', 'Họp rà soát hạn mức tín dụng', -2, 9, 10, ['GATE-MAIN', 'LOBBY-A'], { note: 'Quá giờ hẹn mà chưa được duyệt' }],
  [9, 'host_invite', 'cancelled', 'gam.nth', 'Hội đồng chấm đồ án', -3, 13, 17, ['GATE-MAIN', 'ROOM-A201'], { reason: 'Hội đồng dời lịch' }],
  [12, 'online', 'expired', 'anh.ltp', 'Kiểm toán sơ bộ', -6, 8, 11, ['GATE-MAIN', 'LOBBY-A'], { note: 'Hết hạn lượt đã duyệt nhưng khách không đến' }],
  [3, 'walk_in', 'revoked', 'trang.mtt', 'Giao hàng văn phòng phẩm', -1, 15, 16, ['GATE-EAST'], { reason: 'Khách đổi người giao', guard: 'bao.lq' }],
];

export async function seedVisitors(ctx) {
  const { c, now, out } = ctx;
  const userId = Object.fromEntries((await c.query(
    `SELECT username, id, department_id FROM public.users WHERE id::text LIKE 'de0de0de-%'`,
  )).rows.map((r) => [r.username, r]));
  const z = out.zone;
  const cutoff = out.cutoff ?? now;
  const at = (day, [h, m]) => vnTime(day, h, m, now);

  const users = [];
  const visitors = PEOPLE.map(([name, idNo, phone, org], i) => {
    const vid = did('visitors', i + 1);
    const uid = did('users', 900 + i);
    const short = vid.replace(/-/g, '').slice(0, 12) + String(i).padStart(2, '0');
    users.push({
      id: uid, employee_code: `VIS-${short}`, username: `visitor_${short}`, email: `${vid}@visitor.invalid`,
      password_hash: '!', full_name: name, department_id: VISITOR_DEPT,
      account_status: 'active', employment_status: 'active',
    });
    return {
      id: vid, user_id: uid, full_name: name, id_number: idNo, phone_number: phone,
      email: null, organization: org, created_at: vnTime(-10, 9, 0, now),
    };
  });

  const visits = [];
  const zones = [];
  const events = [];
  let ev = 0;
  const seq = {};
  const pushEv = (visit_id, event_type, event_time, extra = {}) =>
    events.push({ id: did('visitor_visit_events', ++ev), visit_id, event_type, event_time, zone_id: null, score: null, actor_user_id: null, note: null, ...extra });

  VISITS.forEach(([p, channel, status, hostName, purpose, day, hFrom, hTo, zoneCodes, x = {}], i) => {
    const host = userId[hostName];
    if (!host) throw new Error(`Thiếu host demo ${hostName}`);
    const guard = x.guard ? userId[x.guard] : null;
    const id = did('visitor_visits', i + 1);
    const from = vnTime(day, hFrom, 0, now);
    const to = vnTime(day, hTo, 0, now);
    const dKey = from.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(2).replace(/-/g, '');
    seq[dKey] = (seq[dKey] ?? 0) + 1;
    const createdBy = channel === 'walk_in' ? guard?.id : channel === 'host_invite' ? host.id : visitors[p].user_id;
    const createdAt = channel === 'walk_in' ? addMin(from, -10) : vnTime(day - 2, 10, i, now);
    const approved = ['approved', 'checked_in', 'checked_out', 'must_leave', 'exit_unrecorded', 'revoked'].includes(status)
      || (status === 'expired' && !x.note?.startsWith('Quá giờ hẹn'));
    let inAt = x.inAt ? at(day, x.inAt) : null;
    let outAt = x.outAt ? at(day, x.outAt) : null;
    // Không sinh sự kiện "tương lai" so với mốc dữ liệu hôm nay.
    if (inAt && inAt > cutoff) inAt = addMin(cutoff, -20);
    if (outAt && outAt > cutoff) outAt = addMin(cutoff, -5);

    visits.push({
      id, visit_code: `VS-${dKey}-${9000 + seq[dKey]}`, visitor_id: visitors[p].id, channel, status,
      host_user_id: host.id, department_id: host.department_id, purpose,
      companions: channel === 'host_invite' && i % 3 === 0 ? 1 : 0, plate_number: x.plate ?? null,
      scheduled_from: from, scheduled_to: to, valid_from: addMin(from, -30), valid_to: addMin(to, 30),
      check_in_at: inAt, check_out_at: outAt, face_score: x.score ?? null,
      reject_reason: x.reason ?? null,
      revoked_at: status === 'revoked' ? addMin(from, -5) : null,
      manual_exit: false, not_found: false,
      overstay_notified_at: x.overstay ? at(day, x.overstay) : null, overstay_escalated_at: null,
      last_seen_at: status === 'checked_in' || status === 'must_leave' ? addMin(cutoff, -3) : outAt,
      last_seen_zone_id: x.zone ? z[x.zone] : null,
      consent_at: createdAt, created_by: createdBy ?? host.id,
      approved_by: approved ? host.id : null, approved_at: approved ? addMin(createdAt, 25) : null,
      created_at: createdAt, updated_at: outAt ?? inAt ?? createdAt,
    });
    zoneCodes.forEach((code) => zones.push({ visit_id: id, zone_id: z[code] }));

    pushEv(id, 'registered', createdAt, { actor_user_id: createdBy ?? host.id });
    if (channel !== 'walk_in' || status !== 'pending_approval') pushEv(id, 'host_notified', addMin(createdAt, 1));
    if (approved) pushEv(id, 'approved', addMin(createdAt, 25), { actor_user_id: host.id });
    if (status === 'rejected') pushEv(id, 'rejected', addMin(createdAt, 40), { actor_user_id: host.id, note: x.reason });
    if (status === 'cancelled') pushEv(id, 'cancelled', addMin(createdAt, 60), { actor_user_id: host.id, note: x.reason });
    if (status === 'revoked') pushEv(id, 'revoked', addMin(from, -5), { actor_user_id: guard?.id, note: x.reason });
    if (inAt) {
      pushEv(id, 'face_verified', addMin(inAt, -1), { zone_id: z[zoneCodes[0]], score: x.score });
      pushEv(id, 'check_in', inAt, { zone_id: z[zoneCodes[0]], actor_user_id: guard?.id ?? null });
    }
    if (x.overstay) pushEv(id, 'security_notified', at(day, x.overstay), { note: 'Khách quá giờ hẹn, chưa rời khuôn viên' });
    if (outAt) pushEv(id, 'check_out', outAt, { zone_id: z[zoneCodes[0]] });
    if (status === 'exit_unrecorded') pushEv(id, 'exit_unrecorded', vnTime(day, 23, 59, now), { note: 'Không ghi nhận lượt ra trong ngày' });
    if (status === 'expired') pushEv(id, 'expired', addMin(to, 30), { note: x.note });
  });

  const n = {};
  n.users = await insert(c, 'users', users);
  n.visitors = await insert(c, 'visitors', visitors);
  n.visitor_visits = await insert(c, 'visitor_visits', visits);
  n.visitor_visit_zones = await insert(c, 'visitor_visit_zones', zones);
  n.visitor_visit_events = await insert(c, 'visitor_visit_events', events);
  return n;
}
