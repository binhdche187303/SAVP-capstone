/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- script dev: kết quả query thô */
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AppDataSource } from '../src/database/data-source.js';

/**
 * [UI TEST] Dữ liệu GIẢ để test màn Người lạ + Danh sách giám sát trên MÁY CÁ NHÂN.
 * Không chạy trên máy chủ dùng chung.
 *
 * Tạo (mọi bản ghi đều gắn dấu để xóa sạch):
 *   - ảnh giả  : uploads/ui-test/strangers/*.jpg, media_files.related_entity_type = 'ui_test_stranger'
 *   - sự kiện  : iot_device_events.payload_json.uiTest = true (face_stranger, trong 24h gần nhất)
 *   - giám sát : person_control_list có reason chứa '[UI TEST]'
 *
 * Tạo:  npm run uitest:strangers
 * Xóa:  npm run uitest:strangers -- --remove
 */

const REMOVE = process.argv.includes('--remove');
const COUNT = Number(
  process.argv.find((a) => a.startsWith('--count='))?.split('=')[1] ?? 300,
);
const FOLDER = 'ui-test/strangers';
const LOCAL_ROOT = process.env.STORAGE_LOCAL_PATH ?? './uploads';
const IMAGE_VARIANTS = 24;
const DEVICE_CODES = [
  'IOT-FACE-A101',
  'IOT-FACE-A201',
  'IOT-FACE-B301',
  'IOT-ROOMCAM-A101',
  'IOT-ROOMCAM-A201',
  'IOT-ROOMCAM-B301',
];
const DISMISS_REASONS = [
  'legit_visitor',
  'ai_false_positive',
  'handled_offline',
];

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(xs: T[]): T => xs[rand(xs.length)];

/** Ảnh chân dung giả (nền màu + khối đầu/vai) bằng ffmpeg, không cần font. */
function makeImage(i: number, dir: string): { key: string; size: number } {
  const hue = (i * 47) % 360;
  const bg = hslHex(hue, 35, 78);
  const body = hslHex((hue + 180) % 360, 30, 35);
  const skin = pick(['0xE8C4A0', '0xD9A77E', '0xC68B5E', '0xF1D3B5']);
  const file = `uitest-${String(i).padStart(2, '0')}.jpg`;
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${bg}:s=320x400`,
    '-vf',
    [
      `drawbox=x=60:y=270:w=200:h=130:color=${body}:t=fill`,
      `drawbox=x=110:y=90:w=100:h=130:color=${skin}:t=fill`,
      `drawbox=x=105:y=75:w=110:h=35:color=0x2B2118:t=fill`,
      `drawbox=x=135:y=140:w=12:h=8:color=0x222222:t=fill`,
      `drawbox=x=173:y=140:w=12:h=8:color=0x222222:t=fill`,
      `drawbox=x=0:y=0:w=320:h=400:color=0xFFFFFF@0.6:t=6`,
    ].join(','),
    '-frames:v',
    '1',
    join(dir, file),
  ]);
  return { key: `${FOLDER}/${file}`, size: statSync(join(dir, file)).size };
}

function hslHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `0x${f(0)}${f(8)}${f(4)}`;
}

async function remove(): Promise<void> {
  const ev = await AppDataSource.query(
    `DELETE FROM iot_device_events WHERE payload_json->>'uiTest' = 'true'`,
  );
  const pcl = await AppDataSource.query(
    `DELETE FROM person_control_list WHERE reason LIKE '%[UI TEST]%'`,
  );
  const mf = await AppDataSource.query(
    `DELETE FROM media_files WHERE related_entity_type = 'ui_test_stranger'`,
  );
  rmSync(join(LOCAL_ROOT, FOLDER), { recursive: true, force: true });
  console.log(
    `Đã xóa: ${ev[1]} sự kiện, ${pcl[1]} mục giám sát, ${mf[1]} file ảnh [UI TEST].`,
  );
}

async function seed(): Promise<void> {
  const devices = await AppDataSource.query(
    `SELECT id, device_code, room_id, zone_id FROM iot_devices
      WHERE device_code = ANY($1)`,
    [DEVICE_CODES],
  );
  if (!devices.length)
    throw new Error(
      'Không tìm thấy thiết bị IOT-FACE-*/IOT-ROOMCAM-* (dữ liệu demo).',
    );
  const [admin] = await AppDataSource.query(
    `SELECT id FROM users ORDER BY created_at LIMIT 1`,
  );

  const dir = join(LOCAL_ROOT, FOLDER);
  mkdirSync(dir, { recursive: true });
  const images = Array.from({ length: IMAGE_VARIANTS }, (_, i) =>
    makeImage(i, dir),
  );

  const now = Date.now();
  const HOURS = 22;
  let events = 0;
  let dismissed = 0;
  const snapshotIds: string[] = [];

  await AppDataSource.transaction(async (m) => {
    for (let s = 0; s < COUNT; s++) {
      const img = images[s % images.length];
      const [{ id: fileId }] = await m.query(
        `INSERT INTO media_files (file_name, file_type, mime_type, storage_provider,
                                  storage_key, file_size_bytes, related_entity_type)
         VALUES ($1, 'image', 'image/jpeg', 'local', $2, $3, 'ui_test_stranger')
         RETURNING id`,
        [img.key.split('/').pop(), img.key, String(img.size)],
      );
      snapshotIds.push(fileId);

      // Giờ cao điểm 7-9h và 16-18h đông hơn, giống thực tế cổng trường.
      const ageMin = Math.pow(Math.random(), 1.4) * HOURS * 60;
      const lastAt = now - ageMin * 60_000;
      const device = pick(
        devices as Array<{
          id: string;
          room_id: string | null;
          zone_id: string | null;
        }>,
      );
      // ~8% là cùng 1 người lạ xuất hiện nhiều lần (có stranger_id ổn định).
      const multi = Math.random() < 0.08;
      const hits = multi ? 2 + rand(5) : 1;
      const strangerId = multi
        ? `UITEST-STR-${String(s).padStart(4, '0')}`
        : null;
      const isDismissed = Math.random() < 0.1;
      const dismissExtra = isDismissed
        ? {
            dismissedAt: new Date(lastAt + 10 * 60_000).toISOString(),
            dismissedBy: admin?.id ?? null,
            dismissReason: pick(DISMISS_REASONS),
            dismissNote: '[UI TEST] đóng tự động',
          }
        : {};
      if (isDismissed) dismissed++;

      for (let h = 0; h < hits; h++) {
        const at = new Date(lastAt - h * (3 + rand(25)) * 60_000);
        await m.query(
          `INSERT INTO iot_device_events (device_id, room_id, zone_id, event_type, event_time,
                                          source_protocol, severity, payload_json,
                                          processed_status, snapshot_file_id, created_at)
           VALUES ($1, $2, $3, 'face_stranger', $4, 'http', 'warning', $5, 'processed', $6, $4)`,
          [
            device.id,
            device.room_id,
            device.zone_id,
            at.toISOString(),
            JSON.stringify({
              uiTest: true,
              capturedAt: at.toISOString(),
              extracted_fields: {
                ...(strangerId ? { stranger_id: strangerId } : {}),
                similarity: (0.2 + Math.random() * 0.35).toFixed(2),
              },
              ...dismissExtra,
            }),
            fileId,
          ],
        );
        events++;
      }
    }

    // Danh sách giám sát: vài mục kiểu CŨ (tên chứa mã snapshot, lý do 1 dòng có dấu phẩy)
    // và vài mục kiểu MỚI (lý do nhiều dòng) để so sánh hiển thị.
    const rooms = ['Phòng A101', 'Phòng A201', 'Phòng B301', 'Cổng chính'];
    const pcl: Array<[string, string, string, string, string | null]> = [];
    for (let i = 0; i < 5; i++) {
      pcl.push([
        `Người lạ snapshot:${snapshotIds[i]}`,
        'watchlist',
        `Người lạ xuất hiện ${1 + rand(4)} lần tại ${pick(rooms)}, lần cuối 13:57 02-11; [UI TEST]`,
        pick(['medium', 'high']),
        snapshotIds[i],
      ]);
    }
    pcl.push(
      [
        'Người lạ · Phòng A101 · 18/11 07:42',
        'watchlist',
        'Xuất hiện 4 lần tại Phòng A101\nLần cuối: 18/11 07:42\n[UI TEST]',
        'high',
        snapshotIds[5],
      ],
      [
        'Người lạ · Cổng chính · 18/11 08:15',
        'blocklist',
        'Cố vào khu vực hạn chế · Không xuất trình giấy tờ · [UI TEST]',
        'critical',
        snapshotIds[6],
      ],
      [
        'Nguyễn Văn Test',
        'blocklist',
        'Từng gây rối tại sảnh; Đã cảnh cáo 1 lần; [UI TEST]',
        'critical',
        null,
      ],
      [
        'Trần Thị Mẫu',
        'watchlist',
        'Khách thường xuyên của phòng B301 [UI TEST]',
        'low',
        null,
      ],
    );
    for (const [name, type, reason, priority, photo] of pcl) {
      await m.query(
        `INSERT INTO person_control_list (display_name, list_type, reason, priority, active,
                                          photo_media_file_id, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, $5, $6, now(), now())`,
        [name, type, reason, priority, photo, admin?.id ?? null],
      );
    }
  });

  console.log(
    `✅ [UI TEST] Đã tạo ${COUNT} người lạ (${events} lượt, ${dismissed} đã đóng) trong ${HOURS}h gần nhất + 9 mục giám sát.`,
  );
  console.log('   Xóa bằng: npm run uitest:strangers -- --remove');
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
    if (REMOVE) await remove();
    else {
      await remove(); // chạy lại không bị nhân đôi
      await seed();
    }
  } catch (e) {
    console.error('❌ Lỗi:', e);
    process.exitCode = 1;
  } finally {
    await AppDataSource.destroy();
  }
}

void main();
