import { insertTracked, pick, randInt, trackedIds } from './lib';

/**
 * PHẦN 5 — họp: ~300 cuộc họp từ 30 ngày trước tới 14 ngày tới, đủ 6 trạng thái, kèm người tham
 * dự, đặt phòng, yêu cầu duyệt (duyệt/từ chối được thật trên web), sự kiện, điểm danh, sử dụng
 * phòng, no-show, ghi chú, biên bản. KHÔNG tạo ghi âm/transcript (cần file audio thật).
 *
 * Luật khớp BE (meeting-request-review.service):
 * - Chờ duyệt TẠO họp: meeting pending_approval + booking pending + request create_meeting pending.
 * - Chờ duyệt ĐỔI GIỜ: meeting pending_approval + booking approved (giữ slot cũ) + request update_time.
 * - Quản lý chỉ thấy yêu cầu của nhân viên phòng mình → người gửi là nhân viên, người duyệt là trưởng phòng.
 * - Booking approved/active không được trùng giờ cùng phòng (ex_room_bookings_no_overlap) → xếp slot cố định.
 */

export const PART = 'part5';

const DAYS_BACK = 30;
const DAYS_AHEAD = 14;

/** Khung giờ cố định trong ngày (giờ VN) — không chồng nhau nên không vi phạm ràng buộc trùng phòng. */
const SLOTS: Array<[string, string]> = [
  ['08:00', '09:00'],
  ['09:30', '11:00'],
  ['13:30', '14:30'],
  ['15:00', '16:30'],
];
/** Slot trống cuối ngày — đích của yêu cầu đổi giờ (duyệt trên web không bị xung đột). */
const UPDATE_TARGET_SLOT: [string, string] = ['17:45', '18:30'];

const TITLES = [
  'Giao ban tuần',
  'Họp kế hoạch quý',
  'Review tiến độ dự án',
  'Họp với đối tác',
  'Đào tạo quy trình mới',
  'Phỏng vấn ứng viên',
  'Báo cáo doanh số tháng',
  'Họp chiến lược Marketing',
  'Rà soát ngân sách',
  'Họp khẩn xử lý sự cố',
  'Demo sản phẩm cho khách hàng',
  'Họp 1-1 với quản lý',
  'Họp nội bộ phòng ban',
  'Họp tổng kết sprint',
  'Lên kế hoạch sự kiện',
];

const TYPE_BY_TITLE: Record<string, string> = {
  'Đào tạo quy trình mới': 'training',
  'Phỏng vấn ứng viên': 'interview',
  'Họp khẩn xử lý sự cố': 'emergency',
};

const CANCEL_REASONS = [
  'Người chủ trì bận đột xuất',
  'Dời sang tuần sau theo yêu cầu đối tác',
  'Nội dung đã được xử lý qua email',
  'Trùng lịch với cuộc họp cấp cao hơn',
];

const REJECT_REASONS = [
  'Trùng lịch với cuộc họp quan trọng của phòng, đề nghị chọn khung giờ khác',
  'Phòng đã được ưu tiên cho buổi tiếp khách',
  'Chưa đủ thông tin nội dung cuộc họp',
];

const MINUTES_TEMPLATE = (title: string, people: number) =>
  `1. Thành phần tham dự\n${people} người tham dự theo danh sách điểm danh.\n\n` +
  `2. Nội dung cuộc họp\n- Rà soát kết quả thực hiện kỳ trước.\n- Thảo luận nội dung chính: ${title.toLowerCase()}.\n- Ghi nhận các khó khăn, vướng mắc.\n\n` +
  `3. Kết luận\n- Thống nhất phương án triển khai.\n- Các phòng ban phối hợp theo kế hoạch.\n\n` +
  `4. Đầu việc (Action items)\n- Cập nhật kế hoạch chi tiết trước thứ Sáu.\n- Báo cáo tiến độ trong buổi họp kế tiếp.`;

type Status =
  | 'draft'
  | 'pending_approval'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

interface Plan {
  code: string;
  roomIdx: number | null;
  start: Date;
  end: Date;
  status: Status;
  organizer: number; // index user
  noShow: boolean;
  pendingKind: 'create' | 'update' | null;
  rejected: boolean;
}

/** yyyy-mm-dd theo giờ VN, lệch `offset` ngày so với hôm nay. */
function vnDate(offset: number): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function at(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00+07:00`);
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00+07:00`).getUTCDay();
  return day === 0 || day === 6;
}

const minutes = (ms: number) => Math.round(ms / 60_000);
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

function weighted<T>(items: Array<[T, number]>): T {
  let r = Math.random() * items.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

export async function seedPart5(log: (m: string) => void): Promise<void> {
  const users = await trackedIds('users');
  const allRooms = await trackedIds('rooms');
  // Phòng cuối (DEMO-R303) đang bảo trì → không xếp lịch
  const rooms = allRooms.slice(0, 7);
  const now = new Date();

  // Theo part1: user i thuộc phòng i % 5; 0-4 trưởng phòng; 7+ nhân viên
  const managerOf = (u: number) => u % 5;
  const employees = users.map((_, i) => i).filter((i) => i >= 7);

  // ── 1. Lập kế hoạch cuộc họp ────────────────────────────────────────────
  const plans: Plan[] = [];
  let seq = 0;
  const nextCode = () => `DEMO-MTG-${String(++seq).padStart(4, '0')}`;

  // 2 cuộc đang diễn ra ngay lúc seed (phòng 0 và 1)
  const liveStart = addMin(now, -30);
  const liveEnd = addMin(now, 45);
  for (const roomIdx of [0, 1]) {
    plans.push({
      code: nextCode(),
      roomIdx,
      start: liveStart,
      end: liveEnd,
      status: 'in_progress',
      organizer: pick([0, 1, 2, 3, 4]),
      noShow: false,
      pendingKind: null,
      rejected: false,
    });
  }

  for (let offset = -DAYS_BACK; offset <= DAYS_AHEAD; offset++) {
    const date = vnDate(offset);
    if (isWeekend(date)) continue;
    rooms.forEach((_, roomIdx) => {
      for (const [s, e] of SLOTS) {
        if (Math.random() > 0.38) continue;
        const start = at(date, s);
        const end = at(date, e);
        // Không chồng lên cuộc họp đang diễn ra ở phòng 0/1
        if (roomIdx <= 1 && start < liveEnd && end > liveStart) continue;

        let status: Status;
        let noShow = false;
        let rejected = false;
        if (end <= now) {
          status = weighted<Status>([
            ['completed', 84],
            ['cancelled', 16],
          ]);
          if (status === 'completed' && Math.random() < 0.06) noShow = true;
          if (status === 'cancelled' && Math.random() < 0.4) rejected = true;
        } else if (start <= now) {
          status = 'in_progress';
        } else {
          status = weighted<Status>([
            ['scheduled', 62],
            ['pending_approval', 18],
            ['draft', 10],
            ['cancelled', 10],
          ]);
          if (status === 'cancelled' && Math.random() < 0.5) rejected = true;
        }
        const pendingKind =
          status === 'pending_approval'
            ? Math.random() < 0.75
              ? 'create'
              : 'update'
            : null;
        // Người gửi yêu cầu (chờ duyệt/bị từ chối) là nhân viên → trưởng phòng duyệt được
        const organizer =
          pendingKind || rejected
            ? pick(employees)
            : weighted<number>([
                [pick([0, 1, 2, 3, 4]), 45],
                [pick(employees), 55],
              ]);
        plans.push({
          code: nextCode(),
          roomIdx,
          start,
          end,
          status,
          organizer,
          noShow,
          pendingKind,
          rejected,
        });
      }
    });
  }

  // Vài cuộc họp online (không phòng) ở trạng thái nháp/đã lên lịch
  for (let i = 0; i < 8; i++) {
    const date = vnDate(randInt(1, DAYS_AHEAD));
    plans.push({
      code: nextCode(),
      roomIdx: null,
      start: at(date, '19:00'),
      end: at(date, '20:00'),
      status: i < 3 ? 'draft' : 'scheduled',
      organizer: pick([0, 1, 2, 3, 4]),
      noShow: false,
      pendingKind: null,
      rejected: false,
    });
  }

  // ── 2. meetings ─────────────────────────────────────────────────────────
  const meetingRows = plans.map((p) => {
    const title = pick(TITLES);
    const createdAt = new Date(
      Math.min(
        now.getTime() - 60_000,
        p.start.getTime() - randInt(1, 7) * 86_400_000,
      ),
    );
    const started = p.status === 'completed' || p.status === 'in_progress';
    const actualStart = started ? addMin(p.start, randInt(0, 8)) : null;
    const actualEnd =
      p.status === 'completed' ? addMin(p.end, randInt(-10, 10)) : null;
    return {
      meeting_code: p.code,
      title,
      description: `Cuộc họp demo: ${title.toLowerCase()}.`,
      organizer_id: users[p.organizer],
      host_id: users[p.organizer],
      room_id: p.roomIdx === null ? null : rooms[p.roomIdx],
      meeting_type: TYPE_BY_TITLE[title] ?? 'normal',
      meeting_mode:
        p.roomIdx === null
          ? 'online'
          : weighted([
              ['offline', 75],
              ['hybrid', 25],
            ]),
      priority: weighted([
        ['normal', 70],
        ['high', 18],
        ['low', 8],
        ['urgent', 4],
      ]),
      status: p.noShow ? 'cancelled' : p.status,
      visibility_level: weighted([
        ['internal', 70],
        ['department', 20],
        ['private', 10],
      ]),
      start_time: p.start,
      end_time: p.end,
      actual_start_time: p.noShow ? null : actualStart,
      actual_end_time: p.noShow ? null : actualEnd,
      cancellation_reason: p.noShow
        ? 'Tự động giải phóng phòng do không có người tham dự'
        : p.status === 'cancelled'
          ? p.rejected
            ? 'Yêu cầu đặt lịch bị từ chối'
            : pick(CANCEL_REASONS)
          : null,
      created_by: users[p.organizer],
      created_at: createdAt,
      updated_at: createdAt,
    };
  });
  const meetingIds = await insertTracked(PART, 'meetings', meetingRows);
  log(`  ✔ ${meetingIds.length} cuộc họp`);

  // ── 3. Người tham dự + điểm danh ────────────────────────────────────────
  const participantRows: Record<string, unknown>[] = [];
  const attendanceRows: Record<string, unknown>[] = [];
  const presentCount = new Map<number, number>();
  plans.forEach((p, mi) => {
    const others = users
      .map((_, i) => i)
      .filter((i) => i !== p.organizer)
      .sort(() => Math.random() - 0.5)
      .slice(0, randInt(2, 7));
    const members: Array<[number, string]> = [
      [p.organizer, 'host'],
      ...others.map((u, k): [number, string] => [
        u,
        k === 0 && Math.random() < 0.4 ? 'note_taker' : 'attendee',
      ]),
    ];
    const past = p.status === 'completed' || p.status === 'in_progress';
    let present = 0;
    for (const [u, role] of members) {
      const invitation =
        role === 'host'
          ? 'accepted'
          : p.status === 'draft'
            ? 'pending'
            : past || p.status === 'cancelled'
              ? weighted([
                  ['accepted', 85],
                  ['declined', 10],
                  ['tentative', 5],
                ])
              : weighted([
                  ['accepted', 50],
                  ['pending', 30],
                  ['tentative', 10],
                  ['declined', 10],
                ]);
      let attendance = 'not_checked_in';
      let joinedAt: Date | null = null;
      let leftAt: Date | null = null;
      if (past && !p.noShow) {
        attendance =
          invitation === 'declined'
            ? 'absent'
            : p.status === 'in_progress'
              ? weighted([
                  ['present', 70],
                  ['late', 15],
                  ['not_checked_in', 15],
                ])
              : weighted([
                  ['present', 70],
                  ['late', 15],
                  ['left_early', 7],
                  ['absent', 8],
                ]);
        if (['present', 'late', 'left_early'].includes(attendance)) {
          present++;
          joinedAt = addMin(
            p.start,
            attendance === 'late' ? randInt(10, 25) : randInt(-5, 3),
          );
          leftAt =
            p.status === 'completed'
              ? addMin(
                  p.end,
                  attendance === 'left_early'
                    ? -randInt(15, 30)
                    : randInt(-3, 5),
                )
              : null;
        }
      }
      participantRows.push({
        meeting_id: meetingIds[mi],
        user_id: users[u],
        participant_role: role,
        invitation_status: invitation,
        response_at:
          invitation === 'pending'
            ? null
            : addMin(meetingRows[mi].created_at, randInt(30, 600)),
        attendance_status: attendance,
        joined_at: joinedAt,
        left_at: leftAt,
        invited_by: users[p.organizer],
      });
      if (past && !p.noShow && attendance !== 'not_checked_in') {
        const isPresent = attendance !== 'absent';
        attendanceRows.push({
          meeting_id: meetingIds[mi],
          user_id: users[u],
          check_in_method: isPresent
            ? weighted([
                ['room_camera', 60],
                ['door_camera', 20],
                ['qr', 12],
                ['manual', 8],
              ])
            : 'system',
          attendance_source: isPresent ? 'camera' : 'manual',
          check_in_time: joinedAt,
          check_out_time: leftAt,
          first_detected_at: joinedAt,
          last_detected_at: leftAt ?? (isPresent ? now : null),
          is_present: isPresent,
          is_late: attendance === 'late',
          left_early: attendance === 'left_early',
          late_minutes:
            attendance === 'late' && joinedAt
              ? minutes(joinedAt.getTime() - p.start.getTime())
              : 0,
          presence_duration_minutes:
            joinedAt && leftAt
              ? minutes(leftAt.getTime() - joinedAt.getTime())
              : 0,
          confidence_score: isPresent
            ? (0.82 + Math.random() * 0.17).toFixed(2)
            : null,
          attendance_status: attendance,
        });
      }
    }
    presentCount.set(mi, present);
  });
  // expected_attendee_count = số người được mời
  const participantIds = await insertTracked(
    PART,
    'meeting_participants',
    participantRows,
  );
  log(`  ✔ ${participantIds.length} người tham dự`);
  const attendanceIds = await insertTracked(
    PART,
    'attendance_records',
    attendanceRows,
  );
  log(`  ✔ ${attendanceIds.length} bản ghi điểm danh`);

  // ── 4. Đặt phòng ────────────────────────────────────────────────────────
  const bookingStatus = (p: Plan): string =>
    p.noShow
      ? 'released'
      : p.pendingKind === 'create'
        ? 'pending'
        : p.pendingKind === 'update'
          ? 'approved'
          : ((
              {
                draft: 'pending',
                scheduled: 'approved',
                in_progress: 'active',
                completed: 'completed',
                cancelled: 'cancelled',
              } as Record<string, string>
            )[p.status] ?? 'pending');

  const bookedPlans = plans
    .map((p, mi) => ({ p, mi }))
    .filter(({ p }) => p.roomIdx !== null && p.status !== 'draft');
  const bookingRows = bookedPlans.map(({ p, mi }, k) => {
    const status = bookingStatus(p);
    const approved = ['approved', 'active', 'completed', 'released'].includes(
      status,
    );
    return {
      booking_code: `DEMO-BK-${String(k + 1).padStart(4, '0')}`,
      meeting_id: meetingIds[mi],
      room_id: rooms[p.roomIdx!],
      booking_type: 'scheduled',
      reserved_start_time: p.start,
      reserved_end_time: p.end,
      status,
      booked_by: users[p.organizer],
      approved_by: approved ? users[managerOf(p.organizer)] : null,
      approved_at: approved
        ? addMin(meetingRows[mi].created_at, randInt(20, 240))
        : null,
      cancellation_reason:
        status === 'cancelled' ? meetingRows[mi].cancellation_reason : null,
      created_at: meetingRows[mi].created_at,
    };
  });
  const bookingIds = await insertTracked(PART, 'room_bookings', bookingRows);
  log(`  ✔ ${bookingIds.length} lượt đặt phòng`);

  // ── 5. Yêu cầu duyệt ────────────────────────────────────────────────────
  const requestRows: Record<string, unknown>[] = [];
  plans.forEach((p, mi) => {
    const m = meetingRows[mi];
    const approver = users[managerOf(p.organizer)];
    const base = {
      meeting_id: meetingIds[mi],
      requested_by: users[p.organizer],
      requested_at: m.created_at,
      target_room_id: m.room_id,
      requested_start_time: p.start,
      requested_end_time: p.end,
      approval_mode: 'manual',
      conflict_check_status: 'clear',
      conflict_checked_at: m.created_at,
      request_payload_json: { title: m.title, roomId: m.room_id },
    };
    if (p.pendingKind === 'create') {
      requestRows.push({
        ...base,
        request_type: 'create_meeting',
        approval_status: 'pending',
        notes: `Đề nghị duyệt lịch: ${m.title}`,
      });
    } else if (p.pendingKind === 'update') {
      // Cùng ngày cuộc họp (luôn ở tương lai), dời sang slot trống cuối ngày
      const date = p.start.toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      requestRows.push({
        ...base,
        request_type: 'update_time',
        approval_status: 'pending',
        requested_start_time: at(date, UPDATE_TARGET_SLOT[0]),
        requested_end_time: at(date, UPDATE_TARGET_SLOT[1]),
        notes: 'Đề nghị dời cuộc họp sang cuối ngày',
      });
    } else if (p.rejected) {
      requestRows.push({
        ...base,
        request_type: 'create_meeting',
        approval_status: 'rejected',
        decision_by: approver,
        decision_at: addMin(m.created_at, randInt(30, 300)),
        rejection_reason: pick(REJECT_REASONS),
        notes: `Đề nghị duyệt lịch: ${m.title}`,
      });
    } else if (
      m.organizer_id !== approver &&
      ['scheduled', 'completed', 'in_progress'].includes(p.status) &&
      Math.random() < 0.5
    ) {
      const decisionAt = addMin(m.created_at, randInt(20, 240));
      requestRows.push({
        ...base,
        request_type: 'create_meeting',
        approval_status: 'approved',
        decision_by: approver,
        decision_at: decisionAt,
        applied_at: decisionAt,
        notes: `Đề nghị duyệt lịch: ${m.title}`,
      });
    }
  });
  requestRows.forEach((r, i) => {
    r.request_code = `DEMO-REQ-${String(i + 1).padStart(4, '0')}`;
  });
  const requestIds = await insertTracked(PART, 'meeting_requests', requestRows);
  log(`  ✔ ${requestIds.length} yêu cầu duyệt`);

  // ── 6. Sự kiện cuộc họp ─────────────────────────────────────────────────
  const eventRows: Record<string, unknown>[] = [];
  plans.forEach((p, mi) => {
    const m = meetingRows[mi];
    const ev = (
      event_type: string,
      event_time: Date | null,
      description: string,
      extra = {},
    ) =>
      eventRows.push({
        meeting_id: meetingIds[mi],
        event_type,
        event_time,
        actor_user_id: m.organizer_id,
        source_type: 'manual',
        description,
        ...extra,
      });
    if (m.actual_start_time)
      ev('meeting_started', m.actual_start_time, 'Cuộc họp bắt đầu');
    if (m.actual_end_time)
      ev('meeting_ended', m.actual_end_time, 'Cuộc họp kết thúc');
    if (m.status === 'cancelled') {
      ev(
        'status_changed',
        addMin(m.created_at, 60),
        `Cuộc họp bị huỷ: ${m.cancellation_reason}`,
        {
          old_value_json: { status: 'scheduled' },
          new_value_json: { status: 'cancelled' },
        },
      );
    }
  });
  const eventIds = await insertTracked(PART, 'meeting_events', eventRows);
  log(`  ✔ ${eventIds.length} sự kiện cuộc họp`);

  // ── 7. Sử dụng phòng + no-show ─────────────────────────────────────────
  const usageRows: Record<string, unknown>[] = [];
  const noShowRows: Record<string, unknown>[] = [];
  bookedPlans.forEach(({ p, mi }, k) => {
    if (!['completed', 'in_progress'].includes(p.status)) return;
    const m = meetingRows[mi];
    const base = {
      booking_id: bookingIds[k],
      meeting_id: meetingIds[mi],
      room_id: rooms[p.roomIdx!],
      reserved_start_time: p.start,
      reserved_end_time: p.end,
      occupancy_source: 'camera',
    };
    if (p.noShow) {
      const releasedAt = addMin(p.start, 15);
      usageRows.push({
        ...base,
        usage_status: 'no_show',
        auto_released: true,
        released_at: releasedAt,
        release_reason: 'Không phát hiện người trong phòng sau 15 phút',
      });
      noShowRows.push({
        booking_id: bookingIds[k],
        meeting_id: meetingIds[mi],
        room_id: rooms[p.roomIdx!],
        detection_status: 'released',
        detected_at: addMin(p.start, 10),
        warning_sent_at: addMin(p.start, 10),
        warning_deadline_at: addMin(p.start, 15),
        auto_release_eligible_at: addMin(p.start, 15),
        released_at: releasedAt,
        resolution_status: 'released',
        note: 'Tự động giải phóng phòng (demo)',
      });
      return;
    }
    const early = p.status === 'completed' && Math.random() < 0.1;
    usageRows.push({
      ...base,
      actual_start_time: m.actual_start_time,
      actual_end_time: m.actual_end_time,
      first_presence_at: m.actual_start_time,
      last_presence_at: early ? addMin(p.end, -25) : (m.actual_end_time ?? now),
      usage_status:
        p.status === 'in_progress'
          ? 'in_use'
          : early
            ? 'early_empty'
            : 'completed',
      occupancy_confidence: (0.85 + Math.random() * 0.14).toFixed(2),
      auto_released: false,
    });
  });
  const usageIds = await insertTracked(PART, 'room_booking_usages', usageRows);
  const noShowIds = await insertTracked(PART, 'no_show_cases', noShowRows);
  log(
    `  ✔ ${usageIds.length} lượt sử dụng phòng, ${noShowIds.length} ca vắng mặt (no-show)`,
  );

  // ── 8. Ghi chú + biên bản ───────────────────────────────────────────────
  const noteRows: Record<string, unknown>[] = [];
  const minutesRows: Record<string, unknown>[] = [];
  plans.forEach((p, mi) => {
    if (p.status !== 'completed' || p.noShow) return;
    const m = meetingRows[mi];
    if (Math.random() < 0.3) {
      noteRows.push({
        meeting_id: meetingIds[mi],
        author_id: m.organizer_id,
        note_type: 'in_meeting',
        content: pick([
          'Cần chốt ngân sách trước cuối tuần.',
          'Mời thêm phòng Kỹ thuật vào buổi sau.',
          'Khách hàng phản hồi tích cực về bản demo.',
          'Theo dõi tiến độ các đầu việc đã giao.',
        ]),
        pinned: Math.random() < 0.3,
        created_at: m.actual_start_time,
      });
    }
    if (Math.random() < 0.6) {
      const published = Math.random() < 0.7;
      minutesRows.push({
        meeting_id: meetingIds[mi],
        title: `Biên bản: ${m.title}`,
        status: published ? 'published' : 'draft',
        source: 'manual',
        minutes_content: MINUTES_TEMPLATE(m.title, presentCount.get(mi) ?? 0),
        prepared_by: m.organizer_id,
        issued_by: published ? m.organizer_id : null,
        issued_at: published ? m.actual_end_time : null,
        approved_by: published ? m.organizer_id : null,
        approved_at: published ? m.actual_end_time : null,
        created_at: m.actual_end_time,
        updated_at: m.actual_end_time,
      });
    }
  });
  const noteIds = await insertTracked(PART, 'meeting_notes', noteRows);
  const minutesIds = await insertTracked(PART, 'meeting_minutes', minutesRows);
  log(`  ✔ ${noteIds.length} ghi chú, ${minutesIds.length} biên bản`);

  // Thống kê trạng thái
  const byStatus = meetingRows.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {});
  log(
    `  ↳ trạng thái: ${Object.entries(byStatus)
      .map(([s, n]) => `${s}=${n}`)
      .join(', ')}`,
  );
}
