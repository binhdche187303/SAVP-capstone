import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source.js';

/**
 * [UI TEST] Dữ liệu GIẢ cho màn Trực cổng (bảo vệ) + Trung tâm cảnh báo an ninh trên MÁY CÁ NHÂN.
 * Không chạy trên máy chủ dùng chung.
 *
 *  - security_alerts: đủ loại × đủ trạng thái (Mới / Đã tiếp nhận / Đã xử lý), hôm nay.
 *    Đánh dấu payload_json.uiTest = true, dedupe_key bắt đầu 'uitest-'.
 *  - gate_access_logs: lượt vào/ra cổng hôm nay (người + xe). Đánh dấu metadata_json.uiTest = true.
 *
 * Tạo:  npm run uitest:guard
 * Xóa:  npm run uitest:guard -- --remove
 */

const REMOVE = process.argv.includes('--remove');

type Status = 'new' | 'acknowledged' | 'resolved';
interface AlertSeed {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  payload: Record<string, unknown>;
}

const ALERTS: AlertSeed[] = [
  {
    type: 'stranger',
    severity: 'medium',
    payload: { deviceCode: 'CAM-GATE-01' },
  },
  {
    type: 'unknown_vehicle',
    severity: 'medium',
    payload: { plateNumber: '51A12345' },
  },
  {
    type: 'vehicle_control_match',
    severity: 'high',
    payload: {
      plateNumber: '88B351455',
      reason: 'Xe trong danh sách theo dõi',
    },
  },
  {
    type: 'vehicle_unauthorized',
    severity: 'medium',
    payload: { plateNumber: '30F67890' },
  },
  {
    type: 'person_watchlist_match',
    severity: 'critical',
    payload: { fullName: 'Đối tượng theo dõi (giả)' },
  },
  {
    type: 'device_error',
    severity: 'low',
    payload: {
      reason: 'offline',
      deviceName: 'Camera cổng phụ',
      deviceCode: 'CAM-GATE-02',
    },
  },
  {
    type: 'device_error',
    severity: 'medium',
    payload: {
      reason: 'offline',
      deviceName: 'Camera cổng chính 01',
      deviceCode: 'CAM-GATE-01',
      offlineDevices: [
        { deviceName: 'Camera cổng chính 01', deviceCode: 'CAM-GATE-01' },
        { deviceName: 'Camera cổng chính 02', deviceCode: 'CAM-GATE-03' },
        { deviceName: 'Camera bãi xe', deviceCode: 'CAM-PARK-01' },
      ],
    },
  },
  {
    type: 'crowd',
    severity: 'high',
    payload: { occupancyCount: 42, threshold: 30 },
  },
  { type: 'intrusion', severity: 'high', payload: { fullName: null } },
  {
    type: 'visitor_overstay',
    severity: 'medium',
    payload: { fullName: 'Khách Nguyễn Văn A' },
  },
  {
    type: 'visitor_zone_violation',
    severity: 'high',
    payload: { fullName: 'Khách Trần Thị B' },
  },
  {
    type: 'device_maintenance',
    severity: 'low',
    payload: { deviceName: 'Camera thang máy', deviceCode: 'CAM-ELV-01' },
  },
];
const STATUSES: Status[] = ['new', 'acknowledged', 'resolved'];
const PLATES = [
  '51A12345',
  '30F67890',
  '29H11122',
  '43C55566',
  '59X99887',
  '77Z34586',
];

async function remove(): Promise<void> {
  const a: unknown = await AppDataSource.query(
    `DELETE FROM security_alerts WHERE payload_json->>'uiTest' = 'true' AND dedupe_key LIKE 'uitest-%'`,
  );
  const g: unknown = await AppDataSource.query(
    `DELETE FROM gate_access_logs WHERE metadata_json->>'uiTest' = 'true'`,
  );
  console.log(
    `Đã xóa ${(a as [unknown, number])[1]} cảnh báo, ${(g as [unknown, number])[1]} lượt ra/vào [UI TEST].`,
  );
}

async function seed(): Promise<void> {
  const zones: Array<{ id: string }> = await AppDataSource.query(
    `SELECT id FROM zones WHERE deleted_at IS NULL AND zone_type = 'gate' ORDER BY zone_code`,
  );
  const users: Array<{ id: string }> = await AppDataSource.query(
    `SELECT id FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 10`,
  );
  if (!zones.length || !users.length)
    throw new Error('Cần ít nhất 1 khu vực loại cổng và 1 tài khoản.');
  const actor = users[0].id;

  const [{ start }]: Array<{ start: Date }> = await AppDataSource.query(
    `SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '6 hours')
              AT TIME ZONE 'Asia/Ho_Chi_Minh' AS start`,
  );
  const from = new Date(start).getTime();
  const span = Math.max(Date.now() - from, 60 * 60_000);
  const at = () => new Date(from + Math.random() * span);

  let alerts = 0;
  let logs = 0;
  await AppDataSource.transaction(async (m) => {
    // Mỗi loại cảnh báo × mỗi trạng thái → đủ "Mới / Đã tiếp nhận / Đã xử lý".
    for (const [i, a] of ALERTS.entries()) {
      for (const [j, status] of STATUSES.entries()) {
        const t = at();
        const ack =
          status !== 'new' ? new Date(t.getTime() + 3 * 60_000) : null;
        const res =
          status === 'resolved' ? new Date(t.getTime() + 15 * 60_000) : null;
        await m.query(
          `INSERT INTO security_alerts (alert_type, severity, zone_id, status, triggered_at, last_seen_at,
                                        occurrence_count, payload_json, acknowledged_by, acknowledged_at,
                                        resolved_by, resolved_at, resolution_note, dedupe_key)
           VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            a.type,
            a.severity,
            zones[(i + j) % zones.length].id,
            status,
            t.toISOString(),
            1 + ((i + j) % 3),
            JSON.stringify({
              ...a.payload,
              uiTest: true,
              occurredAt: t.toISOString(),
            }),
            ack ? actor : null,
            ack?.toISOString() ?? null,
            res ? actor : null,
            res?.toISOString() ?? null,
            res ? '[UI TEST] Đã kiểm tra và xử lý tại hiện trường' : null,
            `uitest-${i}-${status}`,
          ],
        );
        alerts++;
      }
    }

    // Lượt ra/vào cổng hôm nay: người (có tài khoản) và xe (biển số), đủ chiều vào/ra.
    for (let k = 0; k < 24; k++) {
      const isVehicle = k % 3 === 0;
      await m.query(
        `INSERT INTO gate_access_logs (zone_id, user_id, plate_number, direction, access_time, metadata_json)
         VALUES ($1, $2, $3, $4, $5, '{"uiTest": true}'::jsonb)`,
        [
          zones[k % zones.length].id,
          isVehicle ? null : users[k % users.length].id,
          isVehicle ? PLATES[k % PLATES.length] : null,
          k % 2 === 0 ? 'enter' : 'leave',
          new Date(at().getTime() + k).toISOString(),
        ],
      );
      logs++;
    }
  });
  console.log(
    `✅ [UI TEST] Đã tạo ${alerts} cảnh báo (${ALERTS.length} loại × Mới/Đã tiếp nhận/Đã xử lý) + ${logs} lượt ra/vào cổng hôm nay.`,
  );
  console.log('   Xóa bằng: npm run uitest:guard -- --remove');
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const noop = () => undefined;
  AppDataSource.logger = {
    logQuery: noop,
    logQueryError: noop,
    logQuerySlow: noop,
    logSchemaBuild: noop,
    logMigration: noop,
    log: noop,
  };
  try {
    await remove();
    if (!REMOVE) await seed();
  } catch (e) {
    console.error('❌ Lỗi:', e);
    process.exitCode = 1;
  } finally {
    await AppDataSource.destroy();
  }
}

void main();
