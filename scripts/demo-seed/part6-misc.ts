import { db, insertTracked, pick, randInt, trackedIds } from './lib';

/**
 * PHẦN 6 — còn lại: thiết bị phòng họp (equipments), sự kiện điểm danh (attendance_events, từ
 * điểm danh part5), thông báo in-app, nhật ký audit. Trang phân tích đúng giờ đọc
 * attendance_records (đã có ở part5).
 *
 * Thông báo gửi cho user demo + các tài khoản SYSTEM_ADMIN/BUSINESS_ADMIN thật đang có → đăng
 * nhập admin thật vẫn thấy. Trạng thái "đã đọc" nằm ở Redis → mọi thông báo seed là chưa đọc.
 */

export const PART = 'part6';

const DAYS = 14;

const EQUIPMENT_TYPES: Array<[string, string, string[]]> = [
  [
    'camera',
    'Camera hội nghị',
    ['Logitech Rally', 'Poly Studio', 'Jabra PanaCast'],
  ],
  [
    'microphone',
    'Micro hội nghị',
    ['Shure MXA310', 'Sennheiser TCC2', 'Yamaha YVC-1000'],
  ],
  [
    'display',
    'Màn hình trình chiếu',
    ['Samsung QM65', 'LG 75UH5', 'Sony Bravia 65'],
  ],
  ['speaker', 'Loa hội nghị', ['Bose Videobar', 'JBL Control 25']],
  [
    'capture_agent',
    'Máy thu ghi hình',
    ['Intel NUC 12', 'Dell OptiPlex Micro'],
  ],
  ['sensor', 'Cảm biến môi trường', ['Xiaomi Aqara', 'Netatmo Pro']],
  ['other', 'Bộ chia HDMI', ['Ugreen 4K', 'Orico HS4']],
];

const AUDIT_ACTIONS: Array<[string, string, number]> = [
  ['login', 'users', 30],
  ['logout', 'users', 12],
  ['create', 'meeting_request', 10],
  ['approve', 'meeting_request', 7],
  ['reject', 'meeting_request', 2],
  ['start_meeting', 'meeting', 5],
  ['end_meeting', 'meeting', 5],
  ['update_requested', 'meeting', 3],
  ['view_detail', 'users', 4],
  ['update', 'zones', 2],
  ['update', 'rooms', 2],
  ['auto_offline', 'iot_devices', 3],
  ['auto_online', 'iot_devices', 2],
  ['read_analytics_room_dashboard', 'rooms', 4],
  ['read_analytics_on_time_rate', 'attendance_records', 4],
  ['read_analytics_security_alerts_daily_trend', 'security_alerts', 3],
  ['resolve', 'security_alerts', 3],
  ['acknowledge', 'security_alerts', 3],
  ['export_vehicle_report', 'background_jobs', 1],
  ['login_failed', 'users', 2],
];

const BROWSERS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0',
];

const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

function weighted<T>(items: Array<[T, number]>): T {
  let r = Math.random() * items.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

export async function seedPart6(log: (m: string) => void): Promise<void> {
  const users = await trackedIds('users');
  const rooms = await trackedIds('rooms');
  const devices = await trackedIds('iot_devices');
  const now = new Date();
  const ago = () => new Date(now.getTime() - Math.random() * DAYS * 86_400_000);

  // ── 1. Thiết bị phòng họp ──────────────────────────────────────────────
  const eqRows: Record<string, unknown>[] = [];
  let n = 0;
  rooms.forEach((roomId, r) => {
    for (const [type, label, models] of EQUIPMENT_TYPES) {
      if (type === 'other' && r % 2) continue;
      if (type === 'capture_agent' && r > 4) continue;
      n++;
      const [brand, ...rest] = pick(models).split(' ');
      const assetStatus =
        r === 7
          ? 'maintenance'
          : weighted([
              ['assigned', 88],
              ['maintenance', 7],
              ['retired', 5],
            ]);
      const health =
        assetStatus === 'maintenance'
          ? pick(['faulty', 'warning'])
          : weighted([
              ['healthy', 80],
              ['warning', 10],
              ['offline', 5],
              ['unknown', 5],
            ]);
      const installed = new Date(now.getTime() - randInt(60, 700) * 86_400_000);
      eqRows.push({
        equipment_code: `DEMO-EQ-${String(n).padStart(3, '0')}`,
        equipment_name: `${label} ${r + 1}`,
        equipment_type: type,
        serial_number: `SN${randInt(100000, 999999)}${n}`,
        brand,
        model: rest.join(' '),
        purchase_date: installed.toISOString().slice(0, 10),
        asset_status: assetStatus,
        health_status: health,
        current_room_id: assetStatus === 'retired' ? null : roomId,
        assigned_by: users[5],
        assigned_at: assetStatus === 'retired' ? null : installed,
        installed_at: assetStatus === 'retired' ? null : installed,
        iot_device_id:
          type === 'camera'
            ? devices[10 + r * 2]
            : type === 'sensor'
              ? devices[11 + r * 2]
              : null,
        last_maintenance_at: addMin(now, -randInt(5, 90) * 1440),
        last_issue_reported_at: health === 'healthy' ? null : ago(),
        last_issue_note:
          health === 'healthy'
            ? null
            : pick([
                'Hình ảnh bị nhiễu khi bật đèn',
                'Mất kết nối mạng chập chờn',
                'Âm thanh rè ở mức âm lượng cao',
                'Không nhận tín hiệu HDMI',
              ]),
        specification_json: { demo: true, warrantyMonths: pick([12, 24, 36]) },
      });
    }
  });
  // Kho: vài thiết bị chưa gán phòng / thất lạc
  for (let i = 0; i < 6; i++) {
    const [type, label, models] = pick(EQUIPMENT_TYPES);
    const [brand, ...rest] = pick(models).split(' ');
    n++;
    eqRows.push({
      equipment_code: `DEMO-EQ-${String(n).padStart(3, '0')}`,
      equipment_name: `${label} dự phòng ${i + 1}`,
      equipment_type: type,
      serial_number: `SN${randInt(100000, 999999)}${n}`,
      brand,
      model: rest.join(' '),
      purchase_date: '2025-03-15',
      asset_status: i === 5 ? 'lost' : 'available',
      health_status: i === 5 ? 'unknown' : 'healthy',
      current_room_id: null,
      assigned_by: null,
      assigned_at: null,
      installed_at: null,
      iot_device_id: null,
      last_maintenance_at: null,
      last_issue_reported_at: null,
      last_issue_note: i === 5 ? 'Không tìm thấy khi kiểm kê quý 3' : null,
      specification_json: { demo: true, warrantyMonths: 12 },
    });
  }
  const eqIds = await insertTracked(PART, 'equipments', eqRows);
  log(`  ✔ ${eqIds.length} thiết bị phòng họp`);

  // ── 2. Sự kiện điểm danh (từ attendance_records part5) ────────────────
  const recs: Array<{
    id: string;
    meeting_id: string;
    user_id: string;
    room_id: string | null;
    check_in_time: Date | null;
    check_out_time: Date | null;
    check_in_method: string;
    confidence_score: string | null;
    is_present: boolean;
  }> = await db.query(
    `SELECT a.id, a.meeting_id, a.user_id, m.room_id, a.check_in_time, a.check_out_time,
            a.check_in_method, a.confidence_score, a.is_present
       FROM attendance_records a JOIN meetings m ON m.id = a.meeting_id
      WHERE a.id = ANY($1::uuid[])`,
    [await trackedIds('attendance_records')],
  );
  const roomCam = new Map(rooms.map((r, i) => [r, devices[10 + i * 2]]));
  const aeRows: Record<string, unknown>[] = [];
  for (const a of recs) {
    if (!a.is_present || !a.check_in_time) continue;
    const camera = a.check_in_method.includes('camera');
    const base = {
      meeting_id: a.meeting_id,
      attendance_record_id: a.id,
      user_id: a.user_id,
      room_id: a.room_id,
      device_id: camera && a.room_id ? roomCam.get(a.room_id) : null,
      source_type: camera
        ? 'camera'
        : a.check_in_method === 'qr'
          ? 'qr'
          : 'manual',
      confidence_score:
        camera && a.confidence_score ? Number(a.confidence_score) * 100 : null,
      metadata_json: { demo: true },
    };
    aeRows.push({
      ...base,
      event_type: 'check_in',
      event_time: a.check_in_time,
    });
    if (a.check_out_time)
      aeRows.push({
        ...base,
        event_type: 'check_out',
        event_time: a.check_out_time,
      });
  }
  const aeIds = await insertTracked(PART, 'attendance_events', aeRows);
  log(`  ✔ ${aeIds.length} sự kiện điểm danh`);

  // ── 3. Thông báo in-app ────────────────────────────────────────────────
  const admins: Array<{ id: string }> = await db.query(
    `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE r.role_code IN ('SYSTEM_ADMIN', 'BUSINESS_ADMIN') AND u.deleted_at IS NULL`,
  );
  const adminIds = admins.map((a) => a.id);
  const notif: Record<string, unknown>[] = [];
  const push = (
    type: string,
    subject: string,
    content: string,
    recipients: string[],
    createdAt: Date,
    entityType: string | null,
    entityId: string | null,
    priority = 'normal',
    payload: Record<string, unknown> = {},
  ) =>
    notif.push({
      notification_type: type,
      channel: 'in_app',
      subject,
      content,
      related_entity_type: entityType,
      related_entity_id: entityId,
      recipient_scope: 'user_list',
      recipient_user_ids_json: [...new Set(recipients)],
      priority,
      sent_at: createdAt,
      delivery_status: 'sent',
      created_at: createdAt,
      payload_json: { ...payload, demo: true },
    });

  // Họp: mời, yêu cầu duyệt, duyệt/từ chối
  const meetings: Array<{
    id: string;
    title: string;
    organizer_id: string;
    start_time: Date;
    created_at: Date;
    room_name: string | null;
    members: string[];
  }> = await db.query(
    `SELECT m.id, m.title, m.organizer_id, m.start_time, m.created_at, r.room_name,
              array_agg(p.user_id) AS members
         FROM meetings m LEFT JOIN rooms r ON r.id = m.room_id
         JOIN meeting_participants p ON p.meeting_id = m.id
        WHERE m.id = ANY($1::uuid[]) AND m.created_at > now() - interval '${DAYS} days'
        GROUP BY m.id, r.room_name`,
    [await trackedIds('meetings')],
  );
  const fmt = (d: Date) =>
    new Date(d).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    });
  for (const m of meetings) {
    push(
      'meeting_invite',
      `Lời mời họp: ${m.title}`,
      `Bạn được mời tham dự "${m.title}" lúc ${fmt(m.start_time)}${m.room_name ? ` tại ${m.room_name}` : ''}.`,
      m.members.filter((u) => u !== m.organizer_id),
      new Date(m.created_at),
      'meeting',
      m.id,
    );
  }
  const requests: Array<{
    id: string;
    approval_status: string;
    requested_by: string;
    decision_by: string | null;
    requested_at: Date;
    decision_at: Date | null;
    rejection_reason: string | null;
    title: string;
  }> = await db.query(
    `SELECT q.id, q.approval_status, q.requested_by, q.decision_by, q.requested_at, q.decision_at,
              q.rejection_reason, m.title
         FROM meeting_requests q JOIN meetings m ON m.id = q.meeting_id
        WHERE q.id = ANY($1::uuid[])`,
    [await trackedIds('meeting_requests')],
  );
  for (const q of requests) {
    const manager: Array<{ manager: string }> = await db.query(
      `SELECT COALESCE(u.direct_manager_id, d.manager_user_id) AS manager
         FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`,
      [q.requested_by],
    );
    if (manager[0]?.manager)
      push(
        'meeting_request_created',
        'Yêu cầu duyệt lịch họp mới',
        `Có yêu cầu duyệt cuộc họp "${q.title}" đang chờ bạn xử lý.`,
        [manager[0].manager],
        new Date(q.requested_at),
        'meeting_request',
        q.id,
        'high',
      );
    if (q.approval_status === 'approved' && q.decision_at)
      push(
        'meeting_request_approved',
        'Yêu cầu đã được duyệt',
        `Cuộc họp "${q.title}" đã được duyệt.`,
        [q.requested_by],
        new Date(q.decision_at),
        'meeting_request',
        q.id,
      );
    if (q.approval_status === 'rejected' && q.decision_at)
      push(
        'meeting_request_rejected',
        'Yêu cầu bị từ chối',
        `Cuộc họp "${q.title}" bị từ chối: ${q.rejection_reason ?? ''}`,
        [q.requested_by],
        new Date(q.decision_at),
        'meeting_request',
        q.id,
        'high',
      );
  }
  // Đi muộn
  const late: Array<{
    meeting_id: string;
    user_id: string;
    late_minutes: number;
    check_in_time: Date;
    title: string;
  }> = await db.query(
    `SELECT a.meeting_id, a.user_id, a.late_minutes, a.check_in_time, m.title
         FROM attendance_records a JOIN meetings m ON m.id = a.meeting_id
        WHERE a.id = ANY($1::uuid[]) AND a.is_late AND a.check_in_time > now() - interval '${DAYS} days'`,
    [await trackedIds('attendance_records')],
  );
  for (const l of late)
    push(
      'late_checkin_alert',
      'Bạn đã vào họp muộn',
      `Bạn vào cuộc họp "${l.title}" muộn ${l.late_minutes} phút.`,
      [l.user_id],
      new Date(l.check_in_time),
      'meeting',
      l.meeting_id,
    );
  // An ninh: mỗi cảnh báo part4 → admin
  const alerts: Array<{
    id: string;
    alert_type: string;
    severity: string;
    triggered_at: Date;
    payload_json: Record<string, unknown>;
  }> = await db.query(
    `SELECT id, alert_type, severity, triggered_at, payload_json FROM security_alerts WHERE id = ANY($1::uuid[])`,
    [await trackedIds('security_alerts')],
  );
  const ALERT_NOTIF: Record<
    string,
    [string, (p: Record<string, unknown>) => string]
  > = {
    unknown_vehicle: [
      'unknown_vehicle_alert',
      (p) => `Phát hiện xe lạ biển số ${String(p.plateNumber)} tại cổng.`,
    ],
    vehicle_control_match: [
      'vehicle_control_list_match',
      (p) =>
        `Xe ${String(p.plateNumber)} thuộc danh sách ${p.listType === 'blocklist' ? 'chặn' : 'theo dõi'}: ${String(p.reason)}.`,
    ],
    person_watchlist_match: [
      'person_watchlist_match',
      (p) =>
        `Phát hiện ${String(p.displayName)} (${p.listType === 'blocklist' ? 'danh sách chặn' : 'danh sách theo dõi'}).`,
    ],
    stranger: [
      'unknown_face_alert',
      (p) => `Phát hiện người lạ tại ${String(p.roomName)}.`,
    ],
    device_error: [
      'device_offline_alert',
      (p) => `Thiết bị ${String(p.deviceName)} mất kết nối.`,
    ],
    crowd: [
      'security_alert',
      (p) =>
        `Mật độ đông người vượt ngưỡng (${String(p.occupancyCount)}/${String(p.threshold)}).`,
    ],
    intrusion: [
      'security_alert',
      () => 'Có người ra vào phòng máy chủ ngoài giờ cho phép.',
    ],
  };
  for (const a of alerts) {
    const [type, text] = ALERT_NOTIF[a.alert_type];
    push(
      type,
      'Cảnh báo an ninh',
      text(a.payload_json),
      [...adminIds, users[5], users[6]],
      new Date(a.triggered_at),
      'security_alert',
      a.id,
      a.severity === 'critical' || a.severity === 'high' ? 'high' : 'normal',
      { alertId: a.id },
    );
  }
  // Nhắc lịch họp sắp tới
  const upcoming: Array<{
    id: string;
    title: string;
    start_time: Date;
    members: string[];
  }> = await db.query(
    `SELECT m.id, m.title, m.start_time, array_agg(p.user_id) AS members
       FROM meetings m JOIN meeting_participants p ON p.meeting_id = m.id
      WHERE m.id = ANY($1::uuid[]) AND m.status = 'scheduled'
        AND m.start_time BETWEEN now() AND now() + interval '1 day'
      GROUP BY m.id`,
    [await trackedIds('meetings')],
  );
  for (const m of upcoming)
    push(
      'reminder',
      `Sắp diễn ra: ${m.title}`,
      `Cuộc họp "${m.title}" bắt đầu lúc ${fmt(m.start_time)}.`,
      m.members,
      addMin(now, -randInt(5, 60)),
      'meeting',
      m.id,
    );
  notif.forEach((x, i) => {
    x.notification_code = `DEMO-NTF-${String(i + 1).padStart(5, '0')}`;
  });
  const notifIds = await insertTracked(PART, 'notifications', notif);
  log(`  ✔ ${notifIds.length} thông báo`);

  // ── 4. Nhật ký audit ───────────────────────────────────────────────────
  const auditRows: Record<string, unknown>[] = [];
  const actors = [...users, ...adminIds];
  for (let d = DAYS; d >= 0; d--) {
    const count = randInt(60, 110);
    for (let k = 0; k < count; k++) {
      const [action, entity] = weighted(
        AUDIT_ACTIONS.map(([a, e, w]) => [[a, e] as const, w]),
      );
      const t = new Date(
        now.getTime() -
          d * 86_400_000 -
          randInt(0, 10 * 60) * 60_000 -
          7 * 3_600_000 +
          8 * 3_600_000,
      );
      if (t > now) continue;
      const actor =
        action === 'approve' || action === 'reject'
          ? users[randInt(0, 4)]
          : action.startsWith('auto_')
            ? null
            : pick(actors);
      const entityId =
        entity === 'users'
          ? actor
          : entity === 'zones'
            ? pick(await trackedIds('zones'))
            : entity === 'rooms'
              ? pick(rooms)
              : entity === 'iot_devices'
                ? pick(devices)
                : entity === 'meeting' && meetings.length
                  ? pick(meetings).id
                  : entity === 'meeting_request' && requests.length
                    ? pick(requests).id
                    : entity === 'security_alerts' && alerts.length
                      ? pick(alerts).id
                      : null;
      auditRows.push({
        user_id: actor,
        action_type: action,
        entity_type: entity,
        entity_id: entityId,
        old_value_json:
          action === 'approve' || action === 'reject'
            ? { approvalStatus: 'pending' }
            : action === 'auto_offline'
              ? { status: 'online' }
              : null,
        new_value_json:
          action === 'approve'
            ? { approvalStatus: 'approved' }
            : action === 'reject'
              ? { approvalStatus: 'rejected' }
              : action === 'auto_offline'
                ? { status: 'offline' }
                : action === 'auto_online'
                  ? { status: 'online' }
                  : null,
        ip_address: actor
          ? `10.20.${randInt(10, 30)}.${randInt(2, 250)}`
          : null,
        user_agent: actor ? pick(BROWSERS) : 'system-scheduler',
        request_id: `demo-${Math.random().toString(36).slice(2, 12)}`,
        severity: action === 'login_failed' ? 'warning' : 'info',
        created_at: t,
        metadata_json: { demo: true },
      });
    }
  }
  const auditIds = await insertTracked(PART, 'audit_logs', auditRows);
  log(`  ✔ ${auditIds.length} nhật ký audit`);
}
