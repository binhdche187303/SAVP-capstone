import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source.js';

/**
 * [UI TEST] Thiết bị GIẢ để test thẻ "Offline / Lỗi" và cột "Camera online" ở dashboard
 * System Admin trên MÁY CÁ NHÂN. Không chạy trên máy chủ dùng chung.
 *
 * Mọi thiết bị có device_code bắt đầu 'UITEST-' và metadata_json.uiTest = true.
 * Tạo:  npm run uitest:devices
 * Xóa:  npm run uitest:devices -- --remove
 */

const REMOVE = process.argv.includes('--remove');

// [mã, tên, loại, trạng thái, mã khu vực gắn vào (null = không gắn)]
const DEVICES: Array<[string, string, string, string, string | null]> = [
  [
    'UITEST-CAM-GATE-01',
    'Camera cổng chính 01',
    'ip_camera',
    'online',
    'GATE_MAIN',
  ],
  [
    'UITEST-CAM-GATE-02',
    'Camera cổng chính 02',
    'ip_camera',
    'offline',
    'GATE_MAIN',
  ],
  [
    'UITEST-CAM-GATE-03',
    'Camera cổng phụ',
    'ip_camera',
    'offline',
    'GATE_SIDE',
  ],
  [
    'UITEST-CAM-SEED-01',
    'Camera cổng test',
    'ip_camera',
    'online',
    'TEST-GATE-01',
  ],
  [
    'UITEST-FACE-C201',
    'Face Server phòng C201',
    'face_server',
    'offline',
    null,
  ],
  [
    'UITEST-FACE-C202',
    'Face Server phòng C202',
    'face_server',
    'maintenance',
    null,
  ],
  ['UITEST-AGENT-D101', 'Capture Agent D101', 'capture_agent', 'offline', null],
  [
    'UITEST-ANPR-02',
    'Camera biển số cổng sau',
    'anpr_camera',
    'disabled',
    null,
  ],
  [
    'UITEST-CAM-PARK-01',
    'Camera bãi xe tầng hầm có tên rất dài để thử cắt chữ',
    'ip_camera',
    'offline',
    null,
  ],
];

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
    const del: unknown = await AppDataSource.query(
      `DELETE FROM iot_devices WHERE device_code LIKE 'UITEST-%' AND metadata_json->>'uiTest' = 'true'`,
    );
    if (REMOVE) {
      console.log(
        `Đã xóa ${(del as [unknown, number])[1]} thiết bị [UI TEST].`,
      );
      return;
    }
    for (const [code, name, type, status, zoneCode] of DEVICES) {
      await AppDataSource.query(
        `INSERT INTO iot_devices (device_code, device_name, device_type, status, health_status,
                                  zone_id, last_seen_at, metadata_json)
         VALUES ($1, $2, $3, $4::text, $5,
                 (SELECT id FROM zones WHERE zone_code = $6 AND deleted_at IS NULL LIMIT 1),
                 now() - (CASE WHEN $4::text = 'online' THEN interval '1 minute' ELSE interval '3 hours' END),
                 '{"uiTest": true}'::jsonb)`,
        [
          code,
          `[UI TEST] ${name}`,
          type,
          status,
          status === 'online' ? 'healthy' : 'unknown',
          zoneCode,
        ],
      );
    }
    const off = DEVICES.filter((d) => d[3] !== 'online').length;
    console.log(
      `✅ [UI TEST] Đã tạo ${DEVICES.length} thiết bị (${off} offline/lỗi, 4 camera gắn khu vực).`,
    );
    console.log('   Xóa bằng: npm run uitest:devices -- --remove');
  } catch (e) {
    console.error('❌ Lỗi:', e);
    process.exitCode = 1;
  } finally {
    await AppDataSource.destroy();
  }
}

void main();
