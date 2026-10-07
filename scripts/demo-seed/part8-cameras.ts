import { db, insertTracked, pick, randInt, trackedIds } from './lib';

/**
 * Part 8 — Camera AI (phân hệ 2.2):
 *  - 4 camera biển số (device_type 'anpr_camera' — BE enum CHƯA có, DB varchar nhận được;
 *    FE hiển thị, tạo/sửa qua form sẽ bị BE từ chối cho tới khi thêm enum)
 *  - lịch sử online/offline 30 ngày cho mọi camera demo (audit_logs auto_offline/auto_online,
 *    đúng dạng probe IOT-014 ghi → GET /iot-devices/:id/connection-history đọc được ngay)
 *  - cảnh báo device_error khớp các lần mất kết nối của camera có zone
 *  - đặt camera demo về online (trừ 1 đang mất kết nối + 1 bảo trì)
 *
 * Probe offline sẽ đánh camera demo offline lại (IP giả) → tắt DEVICE_OFFLINE_DETECT_ENABLED
 * trong .env khi demo.
 */

const PART = 'part8';
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

/** Camera đang mất kết nối lúc demo (sự cố đang mở). */
const ONGOING_OFFLINE = 'DEMO-CAM-A-COR-2';

const ANPR = [
  [
    'DEMO-ANPR-GATE-MAIN-IN',
    'Camera biển số Cổng chính — làn vào',
    'DEMO-A-GATE-MAIN',
    'in',
    1,
  ],
  [
    'DEMO-ANPR-GATE-MAIN-OUT',
    'Camera biển số Cổng chính — làn ra',
    'DEMO-A-GATE-MAIN',
    'out',
    2,
  ],
  [
    'DEMO-ANPR-GATE-SIDE',
    'Camera biển số Cổng phụ',
    'DEMO-A-GATE-SIDE',
    'both',
    1,
  ],
  ['DEMO-ANPR-PARKING', 'Camera biển số Bãi đỗ xe', 'DEMO-PARKING', 'in', 1],
] as const;

interface Cam {
  id: string;
  device_code: string;
  device_name: string;
  zone_id: string | null;
}

export async function seedPart8(log: (m: string) => void) {
  const zoneRows: Array<{ id: string; zone_code: string }> = await db.query(
    `SELECT id, zone_code FROM zones WHERE id = ANY($1::uuid[])`,
    [await trackedIds('zones')],
  );
  const zoneId = (code: string) => {
    const z = zoneRows.find((r) => r.zone_code === code);
    if (!z) throw new Error(`Thiếu zone ${code} (chạy part1 trước).`);
    return z.id;
  };

  // ── 1. Camera biển số ───────────────────────────────────────────────────
  const now = new Date();
  await insertTracked(
    PART,
    'iot_devices',
    ANPR.map(([code, name, zone, lane, laneNo], i) => ({
      device_code: code,
      device_name: name,
      device_type: 'anpr_camera',
      zone_id: zoneId(zone),
      ip_address: `10.20.4.${11 + i}`,
      status: 'online',
      health_status: 'healthy',
      last_seen_at: now,
      firmware_version: 'ANPR-2.4.1',
      metadata_json: {
        demo: true,
        anpr: { lane_direction: lane, lane_no: laneNo },
      },
    })),
  );
  log(`  ✔ ${ANPR.length} camera biển số (anpr_camera)`);

  // ── 2. Lịch sử kết nối 30 ngày ─────────────────────────────────────────
  const cams: Cam[] = await db.query(
    `SELECT id, device_code, device_name, zone_id FROM iot_devices
      WHERE id = ANY($1::uuid[])
        AND device_type IN ('ip_camera', 'room_camera', 'anpr_camera')
      ORDER BY device_code`,
    [await trackedIds('iot_devices')],
  );
  const camIds = cams.map((c) => c.id);

  // Bản ghi probe thật đã ghi khi đánh camera demo offline (IP giả) — làm lệch lịch sử.
  const removed: Array<{ id: string }> = await db.query(
    `DELETE FROM audit_logs
      WHERE entity_type = 'iot_devices' AND entity_id = ANY($1::uuid[])
        AND action_type IN ('auto_offline', 'auto_online')
        AND (metadata_json->>'demo') IS NULL
      RETURNING id`,
    [camIds],
  );
  if (removed.length)
    log(`  ✖ ${removed.length} bản ghi probe cũ trên camera demo`);

  const start = now.getTime() - 30 * DAY_MS;
  const audits: Record<string, unknown>[] = [];
  const incidents: Array<{ cam: Cam; from: Date; to: Date | null }> = [];
  const change = (cam: Cam, at: Date, old: string, next: string) =>
    audits.push({
      action_type: next === 'offline' ? 'auto_offline' : 'auto_online',
      entity_type: 'iot_devices',
      entity_id: cam.id,
      severity: next === 'offline' ? 'warning' : 'info',
      created_at: at,
      metadata_json: {
        changed_fields: { status: { old, new: next } },
        demo: true,
      },
    });

  for (const cam of cams) {
    // Phần lớn ổn định (0–2 sự cố), vài camera "hay rớt" (4–7) để có chênh lệch uptime.
    const flaky = ['DEMO-CAM-PARKING', 'DEMO-CAM-B-COR-3'].includes(
      cam.device_code,
    );
    const count = flaky ? randInt(4, 7) : randInt(0, 2);
    const outages = Array.from({ length: count }, () => {
      const from = start + randInt(1, 29 * 24 * 60 - 1) * MIN_MS;
      const minutes = pick([4, 8, 15, 25, 40, 75, 140, 300]);
      return { from, to: from + minutes * MIN_MS };
    })
      .sort((a, b) => a.from - b.from)
      .filter((o, i, all) => i === 0 || o.from > all[i - 1].to + 30 * MIN_MS);
    for (const o of outages) {
      change(cam, new Date(o.from), 'online', 'offline');
      change(cam, new Date(o.to), 'offline', 'online');
      incidents.push({ cam, from: new Date(o.from), to: new Date(o.to) });
    }
    if (cam.device_code === ONGOING_OFFLINE) {
      const from = new Date(now.getTime() - 42 * MIN_MS);
      change(cam, from, 'online', 'offline');
      incidents.push({ cam, from, to: null });
    }
  }
  const auditIds = await insertTracked(PART, 'audit_logs', audits);
  log(
    `  ✔ ${auditIds.length} lần đổi trạng thái (${incidents.length} sự cố, 30 ngày)`,
  );

  // ── 3. Cảnh báo device_error cho sự cố của camera có zone ───────────────
  const admins: Array<{ id: string }> = await db.query(
    `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE r.role_code = 'SYSTEM_ADMIN' AND u.id = ANY($1::uuid[])`,
    [await trackedIds('users')],
  );
  const alerts = incidents
    .filter(
      (i) =>
        i.cam.zone_id &&
        (!i.to || i.to.getTime() - i.from.getTime() >= 10 * MIN_MS),
    )
    .map((i, k) => {
      const at = new Date(i.from.getTime() + 2 * MIN_MS);
      const handler = admins.length ? pick(admins).id : null;
      const open = i.to === null;
      return {
        alert_type: 'device_error',
        severity: open ? 'high' : 'medium',
        zone_id: i.cam.zone_id,
        status: open ? 'new' : 'resolved',
        triggered_at: at,
        last_seen_at: i.to ?? now,
        occurrence_count: 1,
        payload_json: {
          reason: 'offline',
          deviceId: i.cam.id,
          deviceCode: i.cam.device_code,
          deviceName: i.cam.device_name,
          offlineDevices: open
            ? [
                {
                  deviceId: i.cam.id,
                  deviceCode: i.cam.device_code,
                  deviceName: i.cam.device_name,
                },
              ]
            : [],
          demo: true,
        },
        acknowledged_by: open ? null : handler,
        acknowledged_at: open ? null : at,
        resolved_by: open ? null : handler,
        resolved_at: i.to,
        resolution_note: open ? null : 'Camera kết nối lại, tự đóng cảnh báo.',
        dedupe_key: `demo-conn-${i.cam.id}-${k}`,
        created_at: at,
        updated_at: i.to ?? at,
      };
    });
  const alertIds = await insertTracked(PART, 'security_alerts', alerts);
  log(`  ✔ ${alertIds.length} cảnh báo mất kết nối camera`);

  // ── 4. Trạng thái hiện tại khớp lịch sử ────────────────────────────────
  await db.query(
    `UPDATE iot_devices
        SET status = CASE WHEN device_code = $2 THEN 'offline' ELSE 'online' END,
            health_status = CASE WHEN device_code = $2 THEN 'faulty' ELSE 'healthy' END,
            last_seen_at = CASE WHEN device_code = $2 THEN $3::timestamptz ELSE now() END
      WHERE id = ANY($1::uuid[]) AND status <> 'maintenance'`,
    [camIds, ONGOING_OFFLINE, new Date(now.getTime() - 42 * MIN_MS)],
  );
  log(`  ✔ camera demo về online (${ONGOING_OFFLINE} đang mất kết nối)`);
}
