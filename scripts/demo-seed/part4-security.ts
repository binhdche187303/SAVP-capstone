import { db, insertTracked, pick, randInt, trackedIds } from './lib';

/**
 * PHẦN 4 — an ninh: quy tắc cảnh báo theo zone demo, danh sách kiểm soát người
 * (watchlist/blocklist), cảnh báo an ninh đủ 7 loại × 3 trạng thái (new/acknowledged/resolved)
 * trong 14 ngày. Payload giống BE sinh thật; cảnh báo xe trỏ về lượt xe part3 (source_event_id).
 *
 * Ràng buộc: cảnh báo CHƯA resolved phải duy nhất theo (alert_type, zone_id, dedupe_key) → theo
 * dõi khoá đang mở, trùng thì cho cảnh báo cũ về resolved.
 */

export const PART = 'part4';

const DAYS = 14;
/** Theo part1. */
const Z = {
  gateMain: 0,
  gateSide: 1,
  lobbyA: 2,
  cor2: 4,
  server: 5,
  lobbyB: 6,
  parking: 9,
};

const RESOLUTION_NOTES = [
  'Đã xác minh, là khách có hẹn trước',
  'Bảo vệ đã kiểm tra hiện trường, không có bất thường',
  'Thiết bị đã được khởi động lại, hoạt động bình thường',
  'Đã liên hệ chủ xe, xe giao hàng hợp lệ',
  'Báo động giả do camera nhận diện sai',
  'Đã mời người không phận sự ra khỏi khu vực',
];

const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

export async function seedPart4(log: (m: string) => void): Promise<void> {
  const users = await trackedIds('users');
  const zones = await trackedIds('zones');
  const rooms = await trackedIds('rooms');
  const devices = await trackedIds('iot_devices');
  const now = new Date();
  const admins = [users[5], users[6]]; // business admin part1

  // ── 1. Quy tắc cảnh báo theo zone ──────────────────────────────────────
  const ruleDefs: Array<
    [string, number | null, number | null, string[], unknown, boolean]
  > = [
    [
      'intrusion',
      Z.server,
      null,
      ['in_app', 'email'],
      { allow_from: '08:00', allow_to: '18:00' },
      true,
    ],
    ['crowd', Z.lobbyA, 25, ['in_app', 'email'], null, true],
    ['crowd', Z.lobbyB, 20, ['in_app'], null, true],
    ['crowd', Z.gateMain, 30, ['in_app'], null, false],
    ['stranger', Z.cor2, null, ['in_app'], null, true],
    ['unknown_vehicle', Z.parking, 1, ['in_app'], null, true],
    ['vehicle_control_match', Z.gateMain, 1, ['in_app', 'email'], null, true],
    ['person_watchlist_match', Z.lobbyA, null, ['in_app', 'email'], null, true],
    ['device_error', null, null, ['in_app', 'email'], null, true],
  ];
  const ruleIds = await insertTracked(
    PART,
    'alert_rules',
    ruleDefs.map(([type, z, threshold, channels, hours, enabled]) => ({
      alert_type: type,
      zone_id: z === null ? null : zones[z],
      threshold,
      channels,
      enabled,
      restricted_hours_json: hours,
      allowed_person_ids_json:
        type === 'intrusion' ? [users[1], users[6]] : null,
      created_by: admins[0],
      updated_by: admins[0],
    })),
  );
  const ruleFor = (type: string, z: number | null) => {
    const i = ruleDefs.findIndex(([t, rz]) => t === type && rz === z);
    return i >= 0 ? ruleIds[i] : null;
  };
  log(`  ✔ ${ruleIds.length} quy tắc cảnh báo`);

  // ── 2. Danh sách kiểm soát người ───────────────────────────────────────
  const persons: Array<{
    user: number | null;
    name: string;
    type: string;
    reason: string;
    priority: string;
  }> = [
    {
      user: null,
      name: 'Nguyễn Văn Tâm (cựu nhân viên)',
      type: 'blocklist',
      reason: 'Đã nghỉ việc, không được vào',
      priority: 'high',
    },
    {
      user: null,
      name: 'Trần Quốc Bảo',
      type: 'blocklist',
      reason: 'Từng gây rối tại sảnh',
      priority: 'critical',
    },
    {
      user: null,
      name: 'Lê Thị Hoa (nhà thầu)',
      type: 'watchlist',
      reason: 'Nhà thầu — chỉ được vào khu thi công',
      priority: 'medium',
    },
    {
      user: 12,
      name: '',
      type: 'watchlist',
      reason: 'Đang trong thời gian thử việc, theo dõi ra vào khu hạn chế',
      priority: 'low',
    },
    {
      user: 21,
      name: '',
      type: 'watchlist',
      reason: 'Yêu cầu theo dõi từ phòng Nhân sự',
      priority: 'medium',
    },
    {
      user: null,
      name: 'Phạm Đức Anh (khách VIP)',
      type: 'watchlist',
      reason: 'Khách VIP — báo lễ tân khi đến',
      priority: 'low',
    },
  ];
  const names: Array<{ full_name: string }> = await db.query(
    `SELECT full_name FROM users WHERE id = ANY($1::uuid[]) ORDER BY array_position($1::uuid[], id)`,
    [
      persons
        .map((p) => (p.user === null ? null : users[p.user]))
        .filter(Boolean),
    ],
  );
  let ni = 0;
  for (const p of persons) if (p.user !== null) p.name = names[ni++].full_name;
  const pclIds = await insertTracked(
    PART,
    'person_control_list',
    persons.map((p, i) => ({
      user_id: p.user === null ? null : users[p.user],
      display_name: p.name,
      list_type: p.type,
      reason: p.reason,
      priority: p.priority,
      active: i !== 5,
      created_by: admins[i % 2],
    })),
  );
  log(`  ✔ ${pclIds.length} người trong danh sách kiểm soát`);

  // ── 3. Cảnh báo an ninh ────────────────────────────────────────────────
  // Lượt xe part3: lạ (unmatched) + thuộc danh sách kiểm soát
  const vehicleEvents: Array<{
    id: string;
    event_time: Date;
    zone_id: string;
    plate: string;
    direction: string;
    list_type: string | null;
    reason: string | null;
    cl_id: string | null;
  }> = await db.query(
    `SELECT e.id, e.event_time, e.zone_id, e.payload_json->>'plateNumber' AS plate,
              e.payload_json->>'direction' AS direction, c.list_type, c.reason, c.id AS cl_id
         FROM iot_device_events e
         LEFT JOIN vehicle_control_list c ON c.plate_number = e.payload_json->>'plateNumber' AND c.active
        WHERE e.id = ANY($1::uuid[]) AND e.payload_json->>'matchState' = 'unmatched'
          AND e.payload_json->>'direction' = 'enter'
        ORDER BY e.event_time`,
    [await trackedIds('iot_device_events')],
  );

  interface AlertDraft {
    type: string;
    severity: string;
    z: number | null;
    at: Date;
    dedupe: string;
    payload: Record<string, unknown>;
    sourceEventId?: string | null;
    count?: number;
  }
  const drafts: AlertDraft[] = [];
  const randomTime = () => {
    const t = new Date(now.getTime() - Math.random() * DAYS * 86_400_000);
    return t;
  };

  for (const e of vehicleEvents) {
    const zIdx = zones.indexOf(e.zone_id);
    if (e.list_type) {
      drafts.push({
        type: 'vehicle_control_match',
        severity: e.list_type === 'blocklist' ? 'high' : 'medium',
        z: zIdx,
        at: new Date(e.event_time),
        dedupe: e.plate,
        sourceEventId: e.id,
        payload: {
          plateNumber: e.plate,
          channelId: 801,
          direction: e.direction,
          listType: e.list_type,
          reason: e.reason,
          controlListEntryId: e.cl_id,
        },
      });
    } else if (Math.random() < 0.3) {
      const time = new Date(e.event_time);
      drafts.push({
        type: 'unknown_vehicle',
        severity: 'medium',
        z: zIdx,
        at: time,
        dedupe: e.plate,
        sourceEventId: e.id,
        payload: {
          channelId: 801,
          direction: 'enter',
          plateNumber: e.plate,
          occurrences: [
            {
              userId: null,
              occurredAt: time.toISOString(),
              sourceEventId: e.id,
            },
          ],
        },
      });
    }
  }

  const roomCamIdx = (r: number) => 10 + r * 2;
  const roomNames: Array<{ room_name: string }> = await db.query(
    `SELECT room_name FROM rooms WHERE id = ANY($1::uuid[]) ORDER BY array_position($1::uuid[], id)`,
    [rooms],
  );
  for (let i = 0; i < 18; i++) {
    const r = randInt(0, 6);
    const t = randomTime();
    drafts.push({
      type: 'stranger',
      severity: 'medium',
      z: pick([Z.lobbyA, Z.lobbyB, Z.cor2, null]),
      at: t,
      dedupe: `demo-stranger-${i}`,
      payload: {
        roomId: rooms[r],
        deviceId: devices[roomCamIdx(r)],
        roomName: roomNames[r].room_name,
        capturedAt: t.toISOString(),
        deviceCode: `DEMO-RCAM-${r}`,
        similarity: null,
        strangerId: null,
      },
    });
  }
  for (let i = 0; i < 14; i++) {
    const z = pick([Z.lobbyA, Z.lobbyB, Z.gateMain]);
    const t = randomTime();
    const threshold = z === Z.lobbyB ? 20 : z === Z.lobbyA ? 25 : 30;
    drafts.push({
      type: 'crowd',
      severity: 'high',
      z,
      at: t,
      dedupe: '',
      count: randInt(1, 6),
      payload: {
        threshold,
        occurredAt: t.toISOString(),
        occupancyCount: threshold + randInt(2, 15),
      },
    });
  }
  for (let i = 0; i < 10; i++) {
    const known = Math.random() < 0.5;
    const u = randInt(7, 29);
    const [row]: Array<{ full_name: string }> = known
      ? await db.query(`SELECT full_name FROM users WHERE id = $1`, [users[u]])
      : [{ full_name: null as unknown as string }];
    drafts.push({
      type: 'intrusion',
      severity: 'critical',
      z: Z.server,
      at: new Date(randomTime().setUTCHours(randInt(12, 22))),
      dedupe: known ? users[u] : `demo-unknown-${i}`,
      payload: {
        userId: known ? users[u] : null,
        isKnownPerson: known,
        fullName: row.full_name,
        reason: 'outside_restricted_hours',
        note: 'Ra vào phòng máy chủ ngoài giờ cho phép',
      },
    });
  }
  persons.forEach((p, pi) => {
    if (pi === 5) return;
    for (let k = 0; k < randInt(1, 3); k++) {
      const t = randomTime();
      const r = randInt(0, 6);
      drafts.push({
        type: 'person_watchlist_match',
        severity: p.priority,
        z: pick([Z.lobbyA, Z.gateMain, Z.lobbyB]),
        at: t,
        dedupe: pclIds[pi],
        payload: {
          reason: p.reason,
          roomId: rooms[r],
          userId: p.user === null ? null : users[p.user],
          deviceId: devices[roomCamIdx(r)],
          listType: p.type,
          roomName: roomNames[r].room_name,
          displayName: p.name,
          controlListEntryId: pclIds[pi],
          occurrences: [
            {
              userId: p.user === null ? null : users[p.user],
              occurredAt: t.toISOString(),
            },
          ],
        },
      });
    }
  });
  const offline: Array<{
    id: string;
    device_code: string;
    device_name: string;
  }> = await db.query(
    `SELECT id, device_code, device_name FROM iot_devices WHERE id = ANY($1::uuid[]) AND status <> 'online'`,
    [devices],
  );
  offline.forEach((d, i) => {
    for (let k = 0; k < 3; k++) {
      drafts.push({
        type: 'device_error',
        severity: k === 0 ? 'medium' : 'low',
        z: null,
        at: randomTime(),
        dedupe: `demo-${d.id}-${k}`,
        payload: {
          reason: i % 2 ? 'offline' : 'heartbeat_timeout',
          deviceId: d.id,
          deviceCode: d.device_code,
          deviceName: d.device_name,
          offlineDevices: [
            {
              deviceId: d.id,
              deviceCode: d.device_code,
              deviceName: d.device_name,
            },
          ],
        },
      });
    }
  });

  // Trạng thái: cũ hơn 2 ngày → phần lớn đã xử lý; gần đây → còn mới/đang xử lý.
  // Cảnh báo đang mở trùng khoá → cái cũ hơn chuyển resolved.
  drafts.sort((a, b) => b.at.getTime() - a.at.getTime());
  const openKeys = new Set<string>();
  const rows = drafts.map((d) => {
    const ageH = (now.getTime() - d.at.getTime()) / 3_600_000;
    let status =
      ageH < 48
        ? pick(['new', 'new', 'acknowledged', 'resolved'])
        : pick(['resolved', 'resolved', 'resolved', 'acknowledged', 'new']);
    const key = `${d.type}|${d.z}|${d.dedupe}`;
    if (status !== 'resolved') {
      if (openKeys.has(key)) status = 'resolved';
      else openKeys.add(key);
    }
    const handler = pick(admins);
    const ackAt = addMin(d.at, randInt(3, 40));
    const resolvedAt = addMin(ackAt, randInt(10, 240));
    const count = d.count ?? 1;
    return {
      alert_type: d.type,
      severity: d.severity,
      zone_id: d.z === null || d.z < 0 ? null : zones[d.z],
      status,
      triggered_at: d.at,
      last_seen_at: addMin(d.at, (count - 1) * randInt(2, 10)),
      occurrence_count: count,
      source_event_id: d.sourceEventId ?? null,
      rule_id: ruleFor(d.type, d.z) ?? ruleFor(d.type, null),
      payload_json: { ...d.payload, demo: true },
      acknowledged_by: status === 'new' ? null : handler,
      acknowledged_at: status === 'new' ? null : ackAt,
      resolved_by: status === 'resolved' ? handler : null,
      resolved_at: status === 'resolved' ? resolvedAt : null,
      resolution_note: status === 'resolved' ? pick(RESOLUTION_NOTES) : null,
      dedupe_key: d.dedupe,
      created_at: d.at,
      updated_at: status === 'resolved' ? resolvedAt : d.at,
    };
  });
  const alertIds = await insertTracked(PART, 'security_alerts', rows);
  const stat = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const types = new Set(rows.map((r) => r.alert_type));
  log(
    `  ✔ ${alertIds.length} cảnh báo an ninh (${types.size} loại; ${Object.entries(
      stat,
    )
      .map(([s, n]) => `${s}=${n}`)
      .join(', ')})`,
  );
}
