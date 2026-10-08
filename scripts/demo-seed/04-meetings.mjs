// Giai đoạn C1 — meeting (đủ trạng thái), người tham dự, nội dung, yêu cầu, đặt phòng, điểm danh,
// presence, sự kiện phòng, no-show.
import { did, insert, rng, vnTime, addMin } from './lib.mjs';

// [tiêu đề, loại, hình thức, thời lượng(phút), số người [min,max], phòng ban chủ trì, ghi hình?, chương trình, quyết định, hành động]
export const TOPICS = [
  ['Họp giao ban tuần phòng IT', 'normal', 'offline', 60, [5, 8], 'IT', true,
    ['Rà soát công việc tuần trước', 'Kế hoạch tuần này', 'Vấn đề phát sinh'],
    ['Chốt phát hành bản vá vào thứ Sáu', 'Ưu tiên xử lý lỗi đồng bộ khuôn mặt'],
    [['Hoàn thiện bản vá đồng bộ thiết bị', 3], ['Cập nhật tài liệu hướng dẫn vận hành', 5]]],
  ['Review Sprint 24 - Hệ thống điểm danh', 'normal', 'offline', 90, [6, 9], 'IT', true,
    ['Demo tính năng mới', 'Đánh giá chỉ số chất lượng', 'Retrospective'],
    ['Nghiệm thu module điểm danh bằng khuôn mặt', 'Giảm ngưỡng cảnh báo trễ xuống 5 phút'],
    [['Viết kịch bản kiểm thử hồi quy', 4], ['Tối ưu truy vấn báo cáo chuyên cần', 7]]],
  ['Họp chiến lược kinh doanh Quý 4', 'normal', 'hybrid', 90, [6, 10], 'SALES', true,
    ['Kết quả kinh doanh Quý 3', 'Mục tiêu Quý 4', 'Kế hoạch chăm sóc khách hàng lớn'],
    ['Tăng 15% chỉ tiêu doanh thu nhóm khách hàng doanh nghiệp', 'Mở thêm 2 kênh đối tác phân phối'],
    [['Lập danh sách 20 khách hàng mục tiêu', 6], ['Chuẩn bị báo giá gói AI Camera', 8]]],
  ['Đào tạo an toàn thông tin cho nhân viên mới', 'training', 'offline', 120, [12, 18], 'HR', true,
    ['Giới thiệu chính sách bảo mật', 'Nhận diện email lừa đảo', 'Thực hành đặt mật khẩu an toàn'],
    ['Bắt buộc bật xác thực 2 lớp cho mọi tài khoản'],
    [['Hoàn thành bài kiểm tra sau đào tạo', 7]]],
  ['Phỏng vấn ứng viên Backend Developer', 'interview', 'offline', 45, [3, 4], 'HR', false,
    ['Giới thiệu bản thân', 'Câu hỏi kỹ thuật', 'Thảo luận mức lương'],
    ['Mời ứng viên vào vòng phỏng vấn cuối'], [['Gửi phản hồi cho ứng viên', 2]]],
  ['Họp khách hàng - Dự án SmartCampus', 'normal', 'hybrid', 75, [6, 9], 'SALES', true,
    ['Giới thiệu giải pháp', 'Phạm vi triển khai giai đoạn 1', 'Lịch khảo sát hiện trường'],
    ['Thống nhất phạm vi pilot tại Tòa A', 'Khảo sát hiện trường tuần sau'],
    [['Gửi biên bản và đề xuất kỹ thuật', 2], ['Lên lịch khảo sát hiện trường', 4]]],
  ['Họp Ban giám đốc tháng', 'normal', 'offline', 120, [5, 7], 'BOD', true,
    ['Báo cáo tài chính tháng', 'Tiến độ các dự án trọng điểm', 'Nhân sự và ngân sách'],
    ['Phê duyệt ngân sách mua sắm camera đợt 2', 'Tăng cường nhân sự vận hành ca tối'],
    [['Hoàn tất hồ sơ mua sắm camera', 10], ['Đề xuất phương án nhân sự ca tối', 7]]],
  ['Họp triển khai AI Camera giai đoạn 2', 'normal', 'offline', 60, [7, 10], 'IT', true,
    ['Hiện trạng lắp đặt', 'Rủi ro và phương án', 'Phân công triển khai'],
    ['Lắp bổ sung 6 camera khu vực bãi xe', 'Cấu hình lại vùng quan sát cổng phụ'],
    [['Chốt vị trí lắp camera bãi xe', 3], ['Kiểm tra băng thông mạng khu B', 5]]],
  ['Họp khẩn: sự cố mạng khu vực Tòa B', 'emergency', 'offline', 30, [4, 6], 'IT', false,
    ['Mô tả sự cố', 'Phương án khắc phục tạm thời', 'Phân công theo dõi'],
    ['Chuyển lưu lượng sang đường truyền dự phòng'], [['Viết báo cáo sự cố', 2]]],
  ['Họp kế hoạch tuyển dụng Quý 4', 'normal', 'offline', 60, [4, 6], 'HR', true,
    ['Nhu cầu nhân sự các phòng', 'Ngân sách tuyển dụng', 'Kênh tuyển dụng'],
    ['Tuyển 5 vị trí kỹ thuật và 2 vị trí kinh doanh'], [['Đăng tin tuyển dụng lên 3 kênh', 3]]],
  ['Họp ngân sách và mua sắm thiết bị', 'normal', 'offline', 60, [4, 6], 'FAC', true,
    ['Rà soát thiết bị hỏng', 'Đề xuất mua sắm', 'So sánh báo giá'],
    ['Thay thế 2 máy chiếu phòng học R102', 'Mua thêm micro hội nghị dự phòng'],
    [['Yêu cầu báo giá 3 nhà cung cấp', 4]]],
  ['Đào tạo sử dụng hệ thống điểm danh thông minh', 'training', 'hybrid', 90, [10, 16], 'ADM', true,
    ['Đăng ký khuôn mặt', 'Đăng ký phương tiện', 'Xem lịch sử ra vào cá nhân'],
    ['Mỗi nhân sự tự đăng ký khuôn mặt trong tuần'], [['Rà soát danh sách chưa đăng ký', 5]]],
];

const EXTERNALS = [
  ['Nguyễn Hải Đăng', 'dang.nh@vingroup-smart.vn', 'Tập đoàn Vingroup', 'Giám đốc công nghệ'],
  ['Mr. Kenji Tanaka', 'k.tanaka@rakuten-vn.com', 'Rakuten Việt Nam', 'Trưởng nhóm dự án'],
  ['Ms. Sarah Collins', 's.collins@deloitte.com', 'Deloitte Vietnam', 'Tư vấn cao cấp'],
  ['Phạm Quốc Thịnh', 'thinh.pq@fpt-is.com', 'FPT IS', 'Kiến trúc sư giải pháp'],
  ['Trần Thị Bảo Ngọc', 'ngoc.ttb@viettel.com.vn', 'Viettel Solutions', 'Quản lý sản phẩm'],
  ['Lê Quang Vũ', 'vu.lq@candidate.mail', 'Ứng viên', 'Ứng viên Backend'],
];

const NOTE_TEXT = [
  'Cần chốt lại mốc bàn giao trước thứ Sáu.', 'Khách hàng đề nghị bổ sung báo cáo theo tuần.',
  'Rủi ro: thiết bị chưa về đủ, cần phương án thay thế.', 'Đề xuất họp ngắn 15 phút để đồng bộ vào đầu tuần sau.',
  'Ghi nhận ý kiến: ưu tiên tính ổn định hơn tính năng mới.', 'Đã gửi tài liệu tham khảo vào nhóm.',
];

export async function seedMeetings(ctx) {
  const { c, ref, out, now } = ctx;
  const R = rng(4242);
  const cutoff = out.cutoff;
  const n = {};
  const cnt = {};
  const id = (t) => did(t, (cnt[t] = (cnt[t] ?? 0) + 1));
  const adminId = ref.user['sysadmin'];

  // ----- Nhóm người -----
  const ex = (names) => names.map((u) => ref.user[u]).filter(Boolean);
  const byDept = {
    IT: [...out.staff.filter((s) => s.dept === 'IT').map((s) => s.id), ...ex(['manager.it', 'emp.it1', 'emp.it2', 'bizadmin.it'])],
    HR: [...out.staff.filter((s) => s.dept === 'HR').map((s) => s.id), ...ex(['manager.hr', 'emp.hr1', 'emp.hr2', 'bizadmin.hr'])],
    SALES: [...out.staff.filter((s) => s.dept === 'SALES').map((s) => s.id), ...ex(['manager.sales', 'emp.sales1', 'emp.sales2'])],
    ADM: [...out.staff.filter((s) => s.dept === 'ADM').map((s) => s.id), ...ex(['emp.admin1'])],
    FAC: [...out.staff.filter((s) => s.dept === 'FAC' && s.role !== 'GUARD').map((s) => s.id), ...ex(['emp.facility1'])],
    BOD: [adminId, ...out.staff.filter((s) => s.role === 'MANAGER' || s.role === 'BUSINESS_ADMIN' || s.role === 'SYSTEM_ADMIN').map((s) => s.id), ...ex(['manager.it', 'manager.sales', 'manager.hr'])],
  };
  const everyone = [...new Set(Object.values(byDept).flat())];
  const faceMedia = new Map(out.staff.map((s) => [s.id, s._faceMediaId]));
  const hostOf = {
    IT: out.managerOf.IT, HR: out.managerOf.HR, SALES: out.managerOf.SALES, ADM: out.managerOf.ADM, FAC: out.managerOf.FAC,
    BOD: adminId,
  };

  // ----- Phòng họp dùng cho meeting -----
  const R_ = out.room;
  const meetingRooms = [
    ['RM-A101', 8], ['RM-A102', 4], ['RM-A201', 20], ['RM-B301', 12], ['RM-B302', 6], ['RM-B303', 10], ['RM-H01', 120],
  ].filter(([code]) => R_[code]);
  const busy = {};
  const isFree = (room, s, e) => !(busy[room] ?? []).some(([bs, be]) => s < be && e > bs);
  const reserve = (room, s, e) => (busy[room] ??= []).push([s, e]);
  const pickRoom = (size, s, e, prefer) => {
    const cands = meetingRooms.filter(([code, cap]) => cap >= size && isFree(code, s, e) && (!prefer || code === prefer));
    const pool = cands.length ? cands : meetingRooms.filter(([code, cap]) => cap >= size && isFree(code, s, e));
    if (!pool.length) return null;
    const pickd = pool.sort((a, b) => a[1] - b[1])[R.int(0, Math.min(1, pool.length - 1))];
    reserve(pickd[0], s, e);
    return pickd[0];
  };

  // ----- Danh sách lịch họp -----
  const plan = [];
  const slots = [[8, 30], [9, 30], [10, 30], [13, 30], [14, 30], [15, 30], [16, 0]];
  let topicCursor = 0;
  for (let day = -28; day <= 9; day++) {
    const dow = new Date(vnTime(day, 12, 0, now).getTime() + 7 * 3600000).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (day === 0) continue; // hôm nay dựng riêng
    const per = day >= -10 && day < 0 ? (R.chance(0.45) ? 3 : 2) : R.chance(0.35) ? 2 : 1;
    const used = new Set();
    for (let k = 0; k < per; k++) {
      let si; do { si = R.int(0, slots.length - 1); } while (used.has(si)); used.add(si);
      const ti = topicCursor++ % TOPICS.length;
      plan.push({ day, h: slots[si][0], m: slots[si][1], ti });
    }
  }
  // Hôm nay (theo mốc cutoff)
  const todayPlan = [
    { ti: 0, start: addMin(cutoff, -190), room: 'RM-A101', tag: 'completed' },
    { ti: 7, start: addMin(cutoff, -25), room: 'RM-B303', tag: 'in_progress' },
    { ti: 10, start: addMin(cutoff, -12), room: 'RM-A102', tag: 'noshow_risk' },
    { ti: 2, start: addMin(cutoff, 95), room: 'RM-B301', tag: 'scheduled' },
    { ti: 11, start: addMin(cutoff, 190), room: 'RM-A201', tag: 'scheduled' },
  ];

  const meetings = [], parts = [], agendas = [], notes = [], bookings = [], usages = [], requests = [],
    mEvents = [], roomEvents = [], attRecords = [], attEvents = [], snapshots = [], externals = [], noShows = [];
  const mCtx = [];
  let seq = 100;

  const makeMeeting = ({ start, ti, room: roomForce, tag, day }) => {
    const T = TOPICS[ti];
    const [title, type, mode, dur, [smin, smax], dept, rec, agenda, decisions, actions] = T;
    const end = addMin(start, dur);
    const size = R.int(smin, smax);
    const host = hostOf[dept] ?? adminId;
    const pool = (byDept[dept] ?? everyone).filter((u) => u !== host);
    const others = R.shuffle([...pool, ...R.shuffle(everyone).slice(0, 4)].filter((u, i, a) => a.indexOf(u) === i && u !== host));
    const plist = [host, ...others.slice(0, Math.max(1, size - 1))];
    const organizer = R.chance(0.6) ? host : plist[Math.min(1, plist.length - 1)];
    const roomCode = roomForce ?? pickRoom(plist.length + (type === 'training' ? 0 : 0), +start, +end);
    if (!roomCode) return null;
    if (roomForce) reserve(roomCode, +start, +end);
    const meetingId = id('meetings');
    seq++;
    // trạng thái
    let status;
    if (tag === 'in_progress') status = 'in_progress';
    else if (tag === 'noshow_risk') status = 'scheduled';
    else if (tag === 'completed') status = 'completed';
    else if (+end <= +cutoff) status = R.chance(0.1) ? 'cancelled' : 'completed';
    else if (+start <= +cutoff) status = 'in_progress';
    else status = 'scheduled';
    // một vài lịch tương lai ở trạng thái đặc biệt
    if (status === 'scheduled' && day != null && day > 0) {
      const r = R.next();
      if (r < 0.1) status = 'pending_approval'; else if (r < 0.16) status = 'draft'; else if (r < 0.22) status = 'cancelled';
    }
    const startedActual = status === 'completed' ? addMin(start, R.int(0, 6)) : status === 'in_progress' ? addMin(start, R.int(0, 4)) : null;
    const endedActual = status === 'completed' ? addMin(end, R.int(-12, 15)) : null;
    const cancelled = status === 'cancelled';
    meetings.push({
      id: meetingId, meeting_code: `MTG-2026-${seq}`, title, description: `${title} — nội dung theo chương trình đính kèm.`,
      organizer_id: organizer, host_id: host, room_id: R_[roomCode], meeting_type: type, meeting_mode: mode,
      priority: type === 'emergency' ? 'urgent' : type === 'interview' ? 'high' : R.pick(['normal', 'normal', 'high', 'low']),
      status, visibility_level: dept === 'BOD' ? 'private' : 'internal', start_time: start, end_time: end,
      actual_start_time: startedActual, actual_end_time: endedActual, timezone: 'Asia/Ho_Chi_Minh',
      expected_attendee_count: plist.length, cancellation_reason: cancelled ? R.pick(['Trùng lịch công tác', 'Chủ trì bận đột xuất', 'Dời sang tuần sau']) : null,
      created_by: organizer, updated_by: organizer, created_at: addMin(start, -60 * R.int(24, 120)), updated_at: addMin(start, -30),
    });
    const m = { id: meetingId, title, ti, type, status, start, end, dept, host, organizer, room: roomCode, parts: plist, rec, actions, decisions, agenda, startedActual, endedActual, seq };
    // participants
    const noteTaker = plist[Math.min(2, plist.length - 1)];
    const partInfo = [];
    plist.forEach((uid, i) => {
      const declined = i > 0 && R.chance(0.07) && status !== 'completed';
      const inv = i === 0 ? 'accepted' : declined ? 'declined' : status === 'scheduled' || status === 'pending_approval' || status === 'draft'
        ? R.pick(['accepted', 'accepted', 'pending', 'tentative']) : 'accepted';
      partInfo.push({ uid, i, inv });
      parts.push({
        id: id('meeting_participants'), meeting_id: meetingId, user_id: uid,
        participant_role: i === 0 ? 'host' : uid === noteTaker ? 'note_taker' : 'attendee',
        is_required: i < 3, attendance_required: true, invitation_status: inv,
        response_at: inv === 'pending' ? null : addMin(start, -60 * R.int(2, 40)),
        attendance_status: 'not_checked_in', invited_by: organizer,
        created_at: addMin(start, -60 * 48), updated_at: addMin(start, -60 * 3),
      });
    });
    m.partInfo = partInfo;
    m.partRowStart = parts.length - plist.length;
    // chương trình
    agenda.forEach((a, i) => {
      const per = Math.round(dur / agenda.length);
      let st = status === 'completed' ? 'done' : status === 'in_progress' ? (i === 0 ? 'done' : i === 1 ? 'in_progress' : 'planned') : 'planned';
      if (cancelled) st = 'skipped';
      agendas.push({
        id: id('meeting_agendas'), meeting_id: meetingId, agenda_order: i + 1, title: a, description: null,
        owner_id: plist[Math.min(i, plist.length - 1)], planned_duration_minutes: per,
        actual_duration_minutes: st === 'done' ? per + R.int(-5, 8) : null,
        result_note: st === 'done' ? decisions[Math.min(i, decisions.length - 1)] : null, status: st,
        created_by: organizer, updated_by: organizer, created_at: addMin(start, -60 * 40), updated_at: addMin(start, -60 * 3),
      });
    });
    // ghi chú
    if (status === 'completed' || status === 'in_progress') {
      const nn = R.int(1, 3);
      for (let i = 0; i < nn; i++) {
        notes.push({
          id: id('meeting_notes'), meeting_id: meetingId, author_id: i === 0 ? noteTaker : plist[Math.min(i, plist.length - 1)],
          note_type: R.pick(['in_meeting', 'host_note', 'in_meeting']), content: R.pick(NOTE_TEXT), pinned: i === 0,
          visibility_level: 'participants', created_at: addMin(start, 10 + i * 15), updated_at: addMin(start, 10 + i * 15),
        });
      }
    }
    // khách ngoài
    if (ti === 5 || ti === 2) {
      EXTERNALS.slice(0, ti === 5 ? 3 : 2).forEach(([name, email, org, role], i) => externals.push({
        id: id('meeting_external_participants'), meeting_id: meetingId, full_name: name, email, phone_number: `09${R.int(10000000, 99999999)}`,
        organization_name: org, participant_role: 'attendee',
        invitation_status: R.pick(['accepted', 'accepted', 'pending']), response_at: addMin(start, -60 * 20),
        notes: role, created_at: addMin(start, -60 * 72),
      }));
    }
    if (ti === 4) externals.push({
      id: id('meeting_external_participants'), meeting_id: meetingId, full_name: EXTERNALS[5][0], email: EXTERNALS[5][1],
      phone_number: '0912345678', organization_name: 'Ứng viên', participant_role: 'attendee', invitation_status: 'accepted',
      response_at: addMin(start, -60 * 30), notes: EXTERNALS[5][3], created_at: addMin(start, -60 * 72),
    });
    // đặt phòng
    const bookingId = id('room_bookings');
    const bStatus = cancelled ? 'cancelled' : status === 'completed' ? 'completed' : status === 'in_progress' ? 'active'
      : status === 'pending_approval' ? 'pending' : status === 'draft' ? 'pending' : 'approved';
    bookings.push({
      id: bookingId, booking_code: `BK-2026-${seq}`, meeting_id: meetingId, room_id: R_[roomCode], booking_type: 'scheduled',
      reserved_start_time: start, reserved_end_time: end, status: bStatus, booked_by: organizer,
      approved_by: bStatus === 'pending' ? null : hostOf[dept] ?? adminId, approved_at: bStatus === 'pending' ? null : addMin(start, -60 * 36),
      cancellation_reason: cancelled ? 'Meeting bị hủy' : null, created_at: addMin(start, -60 * 48), updated_at: addMin(start, -60 * 3),
    });
    m.bookingId = bookingId;
    // yêu cầu tạo meeting
    const reqId = id('meeting_requests');
    const rStatus = status === 'pending_approval' ? 'pending' : status === 'draft' ? 'cancelled' : 'applied';
    requests.push({
      id: reqId, request_code: `REQ-2026-${seq}`, meeting_id: meetingId, request_type: 'create_meeting', requested_by: organizer,
      requested_at: addMin(start, -60 * 48), target_room_id: R_[roomCode], requested_start_time: start, requested_end_time: end,
      approval_mode: dept === 'BOD' || type === 'emergency' ? 'manual' : 'auto', approval_status: rStatus,
      conflict_check_status: 'clear', conflict_checked_at: addMin(start, -60 * 48),
      decision_by: rStatus === 'pending' ? null : hostOf[dept] ?? adminId, decision_at: rStatus === 'pending' ? null : addMin(start, -60 * 47),
      applied_at: rStatus === 'applied' ? addMin(start, -60 * 47) : null, notes: null,
    });
    // sự kiện meeting
    const ev = (type_, time, desc, src = 'manual', actor = organizer) => mEvents.push({
      id: id('meeting_events'), meeting_id: meetingId, event_type: type_, event_time: time, actor_user_id: actor, source_type: src, description: desc,
    });
    ev('meeting_request_created', addMin(start, -60 * 48), 'Yêu cầu tạo cuộc họp được gửi');
    if (rStatus !== 'pending') ev('meeting_request_approved', addMin(start, -60 * 47), 'Yêu cầu được duyệt', 'system', hostOf[dept] ?? adminId);
    if (!['draft', 'pending_approval'].includes(status)) ev('status_changed', addMin(start, -60 * 47), 'Trạng thái: scheduled', 'system');
    if (status !== 'draft' && status !== 'pending_approval' && !cancelled) ev('warning_scheduled', addMin(start, -30), 'Đã lên lịch cảnh báo hết giờ', 'scheduler');
    if (cancelled) ev('status_changed', addMin(start, -60 * 5), 'Cuộc họp bị hủy', 'manual');
    mCtx.push(m);
    return m;
  };

  // lịch thường
  for (const p of plan) makeMeeting({ start: vnTime(p.day, p.h, p.m, now), ti: p.ti, day: p.day });
  // hôm nay
  for (const p of todayPlan) makeMeeting({ start: p.start, ti: p.ti, room: p.room, tag: p.tag, day: 0 });

  // ----- Điểm danh, presence, sự kiện phòng, usage, no-show -----
  const noShowRoomsDone = new Set();
  for (const m of mCtx) {
    const live = m.status === 'completed' || m.status === 'in_progress';
    const isRisk = m.title.includes('ngân sách') && +m.start > +addMin(cutoff, -20) && +m.start <= +cutoff && m.status === 'scheduled';
    const base = { meeting_id: m.id, room_id: out.room[m.room] };
    const bk = bookings.find((b) => b.id === m.bookingId);
    const usage = {
      id: id('room_booking_usages'), booking_id: m.bookingId, meeting_id: m.id, room_id: out.room[m.room],
      reserved_start_time: m.start, reserved_end_time: m.end, actual_start_time: null, actual_end_time: null,
      first_presence_at: null, last_presence_at: null, usage_status: 'not_started', occupancy_source: 'camera',
      occupancy_confidence: null, auto_released: false,
    };
    if (m.status === 'cancelled' || m.status === 'draft' || m.status === 'pending_approval') { /* chưa dùng */ }
    if (live) {
      let present = 0;
      const inProg = m.status === 'in_progress';
      m.partInfo.forEach(({ uid, i, inv }) => {
        if (inv === 'declined') return;
        const row = parts[m.partRowStart + i];
        const r = i === 0 ? 0.0 : R.next();
        let st = r < 0.72 ? 'present' : r < 0.86 ? 'late' : r < 0.94 ? 'absent' : 'left_early';
        if (inProg && i > 0 && R.chance(0.3)) { st = 'not_checked_in'; }
        if (st === 'not_checked_in') return;
        const late = st === 'late';
        const ciMin = late ? R.int(4, 24) : R.int(-9, 2);
        const method = st === 'absent' ? 'manual' : R.pick(['door_camera', 'room_camera', 'door_camera', 'room_camera', 'qr', 'manual']);
        const conf = method.includes('camera') ? +(0.86 + R.next() * 0.13).toFixed(2) : null;
        const absent = st === 'absent';
        const checkIn = absent ? null : addMin(m.start, ciMin);
        const checkOut = absent || inProg ? null : st === 'left_early' ? addMin(m.end, -R.int(12, 35)) : addMin(m.endedActual ?? m.end, R.int(-2, 4));
        const pending = !absent && conf != null && conf < 0.9 && R.chance(0.6);
        const recStatus = pending ? 'pending_review' : st;
        if (!absent) present++;
        const recId = id('attendance_records');
        attRecords.push({
          id: recId, meeting_id: m.id, participant_id: row.id, user_id: uid, check_in_method: method,
          attendance_source: method === 'manual' ? 'manual' : method === 'qr' ? 'mixed' : 'camera',
          check_in_time: checkIn, check_out_time: checkOut, first_detected_at: checkIn, last_detected_at: checkOut ?? (inProg ? cutoff : null),
          is_present: !absent, is_late: late, left_early: st === 'left_early', late_minutes: late ? ciMin : null,
          presence_duration_minutes: absent || !checkIn ? null : Math.max(0, Math.round(((checkOut ?? cutoff) - checkIn) / 60000)),
          confidence_score: conf, attendance_status: recStatus, verified_by: pending || method !== 'manual' ? null : m.host,
          verified_at: pending || method !== 'manual' ? null : addMin(m.start, 30), note: absent ? 'Vắng không phép' : null,
          created_at: m.start, updated_at: addMin(m.start, 5),
        });
        row.attendance_status = absent ? 'absent' : st;
        row.joined_at = checkIn; row.left_at = checkOut;
        if (!absent) {
          attEvents.push({
            id: id('attendance_events'), meeting_id: m.id, attendance_record_id: recId, user_id: uid, room_id: out.room[m.room],
            event_type: 'check_in', event_time: checkIn, source_type: method.includes('camera') ? 'camera' : method === 'qr' ? 'qr' : 'manual',
            confidence_score: conf, evidence_media_file_id: method.includes('camera') ? faceMedia.get(uid) ?? null : null,
            review_status: pending ? 'pending' : conf ? 'approved' : null, reviewed_by: null, reviewed_at: null,
            metadata_json: { seed: 'DEMO-2026-10', method },
          });
          if (late) mEvents.push({ id: id('meeting_events'), meeting_id: m.id, event_type: 'attendance_checkin_alert_sent', event_time: addMin(m.start, 6), actor_user_id: null, source_type: 'scheduler', description: 'Cảnh báo chưa điểm danh đã gửi cho chủ trì' });
        }
        if (checkOut && st === 'left_early') attEvents.push({
          id: id('attendance_events'), meeting_id: m.id, attendance_record_id: recId, user_id: uid, room_id: out.room[m.room],
          event_type: 'check_out', event_time: checkOut, source_type: 'camera', confidence_score: conf, metadata_json: { seed: 'DEMO-2026-10' },
        });
      });
      // presence snapshot mỗi 15 phút
      const until = inProg ? cutoff : m.end;
      for (let t = addMin(m.start, 5); +t <= +until; t = addMin(t, 15)) {
        const occ = Math.max(1, Math.round(present * (0.85 + R.next() * 0.15)));
        snapshots.push({ id: id('presence_snapshots'), ...base, presence_status: 'present', occupancy_count: occ, snapshot_time: t,
          source_type: 'camera', confidence_score: +(0.9 + R.next() * 0.08).toFixed(2), metadata_json: { seed: 'DEMO-2026-10' } });
      }
      usage.actual_start_time = m.startedActual; usage.actual_end_time = m.endedActual;
      usage.first_presence_at = addMin(m.start, -3); usage.last_presence_at = inProg ? cutoff : addMin(m.end, -R.int(0, 12));
      usage.usage_status = inProg ? 'in_use' : R.chance(0.12) ? 'early_empty' : 'completed';
      usage.occupancy_confidence = +(0.9 + R.next() * 0.08).toFixed(2);
      // sự kiện phòng
      roomEvents.push({ id: id('room_events'), room_id: out.room[m.room], meeting_id: m.id, booking_id: m.bookingId, event_type: 'occupancy_detected',
        event_time: addMin(m.start, -2), source_type: 'camera', old_status: 'available', new_status: 'occupied', occupancy_count: Math.max(1, present),
        confidence_score: 0.94, description: 'Phát hiện người trong phòng' });
      mEvents.push({ id: id('meeting_events'), meeting_id: m.id, event_type: 'meeting_started', event_time: m.startedActual, actor_user_id: m.host, source_type: 'manual', description: 'Cuộc họp bắt đầu' });
      if (!inProg) {
        roomEvents.push({ id: id('room_events'), room_id: out.room[m.room], meeting_id: m.id, booking_id: m.bookingId, event_type: 'room_released_on_end',
          event_time: m.endedActual, source_type: 'system', old_status: 'occupied', new_status: 'available', description: 'Phòng được giải phóng khi kết thúc' });
        mEvents.push({ id: id('meeting_events'), meeting_id: m.id, event_type: 'meeting_ended', event_time: m.endedActual, actor_user_id: m.host, source_type: 'manual', description: 'Cuộc họp kết thúc' });
        mEvents.push({ id: id('meeting_events'), meeting_id: m.id, event_type: 'warning_sent', event_time: addMin(m.end, -10), actor_user_id: null, source_type: 'scheduler', description: 'Nhắc sắp hết giờ họp' });
      }
    } else if (isRisk) {
      usage.usage_status = 'not_started';
      noShows.push({
        id: id('no_show_cases'), booking_id: m.bookingId, meeting_id: m.id, room_id: out.room[m.room], detection_status: 'warning_sent',
        detected_at: addMin(m.start, 8), warning_sent_at: addMin(m.start, 10), warning_deadline_at: addMin(m.start, 20),
        auto_release_eligible_at: addMin(m.start, 20), evidence_json: { seed: 'DEMO-2026-10', occupancy: 0, checkedIn: 0 },
      });
    }
    if (m.status === 'cancelled' || m.status === 'completed' || m.status === 'in_progress' || m.status === 'scheduled') usages.push(usage);
  }
  // 4 ca no-show quá khứ: meeting đã diễn ra nhưng không ai tới → phòng bị giải phóng
  const noShowSources = mCtx.filter((m) => m.status === 'cancelled' && +m.end < +cutoff).slice(0, 4);
  noShowSources.forEach((m, i) => {
    const u = usages.find((x) => x.meeting_id === m.id);
    if (u) { u.usage_status = i === 3 ? 'released' : 'no_show'; u.auto_released = true; u.released_at = addMin(m.start, 20); u.release_reason = 'Không có người tham dự sau 20 phút'; }
    const bk = bookings.find((b) => b.id === m.bookingId);
    if (bk) { bk.status = 'released'; bk.cancellation_reason = 'Tự động giải phóng do no-show'; }
    const det = ['resolved', 'released', 'dismissed', 'confirmed'][i];
    const res = ['manual_override', 'released', 'false_positive', null][i];
    noShows.push({
      id: id('no_show_cases'), booking_id: m.bookingId, meeting_id: m.id, room_id: out.room[m.room], detection_status: det,
      detected_at: addMin(m.start, 8), warning_sent_at: addMin(m.start, 10), warning_deadline_at: addMin(m.start, 20),
      auto_release_eligible_at: addMin(m.start, 20), released_at: det === 'released' || det === 'confirmed' ? addMin(m.start, 21) : null,
      resolved_by: res ? m.host : null, resolution_status: res, note: det === 'dismissed' ? 'Họp trực tuyến, camera không ghi nhận' : null,
      evidence_json: { seed: 'DEMO-2026-10', occupancy: 0 },
    });
  });

  // ----- Yêu cầu bổ sung cho màn hình duyệt -----
  const empOf = (u) => out.staff.find((s) => s.username === u)?.id;
  const futureMeet = mCtx.filter((m) => m.status === 'scheduled' && +m.start > +cutoff);
  const ongoing = mCtx.find((m) => m.status === 'in_progress');
  const extra = [
    ['update_time', 'pending', 'lananh.ht', futureMeet[0], null, 'Đề nghị dời sang chiều do trùng lịch khách hàng'],
    ['book_room', 'pending', 'ngan.ptk', null, 'RM-B301', 'Đặt phòng B301 cho buổi gặp khách hàng chiều thứ Sáu'],
    ['extend_meeting', 'pending', 'mai.btn', ongoing, null, 'Xin kéo dài thêm 30 phút để chốt phương án'],
    ['cancel_meeting', 'pending', 'phuong.ltb', futureMeet[1], null, 'Nội dung đã được xử lý qua email'],
    ['book_room', 'pending', 'khanh.tq', null, 'RM-H01', 'Đặt Hội trường H1 cho buổi đào tạo an toàn lao động'],
    ['create_meeting', 'rejected', 'loc.cv', null, 'RM-A101', 'Trùng lịch phòng với họp Ban giám đốc'],
    ['update_room', 'approved', 'trang.mtt', futureMeet[2], 'RM-A102', null],
    ['create_meeting', 'expired', 'yen.dth', null, 'RM-B302', 'Quá hạn xử lý'],
    ['extend_meeting', 'rejected', 'tam.dtt', mCtx.find((m) => m.status === 'completed'), null, 'Phòng đã có lịch tiếp theo'],
    ['create_meeting', 'cancelled', 'mai.btn', null, 'RM-B302', 'Người yêu cầu tự hủy'],
  ];
  extra.forEach(([type, st, who, meet, roomCode, note], i) => {
    const u = empOf(who);
    if (!u) return;
    const when = st === 'pending' ? addMin(cutoff, -60 * R.int(1, 30)) : addMin(cutoff, -60 * 24 * R.int(2, 12));
    requests.push({
      id: id('meeting_requests'), request_code: `REQ-2026-${200 + i}`, meeting_id: meet?.id ?? null, request_type: type, requested_by: u,
      requested_at: when, target_room_id: roomCode ? out.room[roomCode] : meet ? out.room[meet.room] : null,
      requested_start_time: meet ? meet.start : addMin(when, 60 * 24 * 3), requested_end_time: meet ? addMin(meet.end, type === 'extend_meeting' ? 30 : 0) : addMin(when, 60 * 24 * 3 + 90),
      approval_mode: 'manual', approval_status: st, conflict_check_status: st === 'rejected' ? 'blocked' : 'clear', conflict_checked_at: when,
      decision_by: st === 'pending' || st === 'cancelled' ? null : adminId, decision_at: st === 'pending' || st === 'cancelled' ? null : addMin(when, 120),
      rejection_reason: st === 'rejected' ? note : null, notes: st === 'rejected' ? null : note,
    });
  });

  // ----- Ghi DB -----
  const recurRows = [
    { id: id('meeting_recurrence_rules'), recurrence_type: 'weekly', interval_value: 1, days_of_week: 'TU', start_date: '2026-09-08', end_date: '2026-12-29', timezone: 'Asia/Ho_Chi_Minh', created_by: out.managerOf.IT, created_at: vnTime(-35, 9, 0, now), updated_at: vnTime(-35, 9, 0, now) },
    { id: id('meeting_recurrence_rules'), recurrence_type: 'monthly', interval_value: 1, day_of_month: 28, start_date: '2026-07-28', end_date: '2027-06-28', timezone: 'Asia/Ho_Chi_Minh', created_by: adminId, created_at: vnTime(-60, 9, 0, now), updated_at: vnTime(-60, 9, 0, now) },
  ];
  n.meeting_recurrence_rules = await insert(c, 'meeting_recurrence_rules', recurRows);
  const firstIT = meetings.find((m) => m.title.startsWith('Họp giao ban'));
  meetings.forEach((m) => {
    if (m.title.startsWith('Họp giao ban')) { m.recurrence_rule_id = recurRows[0].id; if (m !== firstIT) m.parent_meeting_id = firstIT.id; }
    else if (m.title.startsWith('Họp Ban giám đốc')) m.recurrence_rule_id = recurRows[1].id;
    m.recurrence_rule_id ??= null; m.parent_meeting_id ??= null;
  });
  // Phòng B303 đang có họp → trạng thái "đang sử dụng" (phòng demo)
  if (ongoing) await c.query(`UPDATE public.rooms SET current_status='occupied' WHERE id = $1 AND id::text LIKE 'de0de0de-%'`, [out.room[ongoing.room]]);

  n.meetings = await insert(c, 'meetings', meetings);
  n.meeting_participants = await insert(c, 'meeting_participants', parts);
  n.meeting_agendas = await insert(c, 'meeting_agendas', agendas);
  n.meeting_notes = await insert(c, 'meeting_notes', notes);
  n.meeting_external_participants = await insert(c, 'meeting_external_participants', externals);
  n.meeting_requests = await insert(c, 'meeting_requests', requests.map((r) => ({ rejection_reason: null, notes: null, applied_at: null, ...r })));
  n.room_bookings = await insert(c, 'room_bookings', bookings);
  n.room_booking_usages = await insert(c, 'room_booking_usages', usages.map((u) => ({ released_at: null, release_reason: null, ...u })));
  n.no_show_cases = await insert(c, 'no_show_cases', noShows.map((x) => ({ released_at: null, resolved_by: null, resolution_status: null, note: null, ...x })));
  n.room_events = await insert(c, 'room_events', roomEvents.map((e) => ({ booking_id: null, ...e })));
  n.meeting_events = await insert(c, 'meeting_events', mEvents);
  n.attendance_records = await insert(c, 'attendance_records', attRecords);
  n.attendance_events = await insert(c, 'attendance_events', attEvents.map((e) => ({ evidence_media_file_id: null, review_status: null, reviewed_by: null, reviewed_at: null, ...e })));
  n.presence_snapshots = await insert(c, 'presence_snapshots', snapshots);

  // cập nhật trạng thái tham dự trong meeting_participants (đã tính ở bộ nhớ)
  const partUpd = parts.filter((p) => p.attendance_status !== 'not_checked_in');
  for (let i = 0; i < partUpd.length; i += 500) {
    const part = partUpd.slice(i, i + 500);
    await c.query(
      `UPDATE public.meeting_participants mp SET attendance_status=v.s, joined_at=v.j, left_at=v.l
       FROM unnest($1::uuid[], $2::text[], $3::timestamptz[], $4::timestamptz[]) AS v(id,s,j,l) WHERE mp.id=v.id`,
      [part.map((p) => p.id), part.map((p) => p.attendance_status), part.map((p) => p.joined_at ?? null), part.map((p) => p.left_at ?? null)],
    );
  }
  out.meetings = mCtx;
  return n;
}
