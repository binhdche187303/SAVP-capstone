import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AppDataSource } from '../src/database/data-source.js';

/**
 * [UI TEST] Nhật ký ra/vào GIẢ cho trang Quản lý khu vực (test phân trang + lọc
 * Người quen / Người lạ) trên MÁY CÁ NHÂN. Không chạy trên máy chủ dùng chung.
 *
 * Mỗi khu vực (chưa xóa) nhận PER_ZONE lượt nhận diện hôm nay (giờ VN), ~30% người quen.
 * Đánh dấu: payload_json.uiTestZoneLog = true; ảnh ở uploads/ui-test/zone-log,
 * media_files.related_entity_type = 'ui_test_zone_log'.
 *
 * Kèm dòng thời gian hiện diện (zone_presence_events.source_type = 'ui_test') 60 ngày gần nhất.
 *
 * Tạo:  npm run uitest:zonelog            (mặc định 20 lượt/khu ≈ 3 trang × 9)
 *       npm run uitest:zonelog -- --per-zone=40
 * Xóa:  npm run uitest:zonelog -- --remove
 */

const REMOVE = process.argv.includes('--remove');
const PER_ZONE = Number(
  process.argv.find((a) => a.startsWith('--per-zone='))?.split('=')[1] ?? 20,
);
const FOLDER = 'ui-test/zone-log';
/** zone_presence_events.source_type của dữ liệu giả (dòng thời gian hiện diện). */
const PRESENCE_SOURCE = 'ui_test';
const PRESENCE_DAYS = 60;
const DAY_MS = 86_400_000;
const LOCAL_ROOT = process.env.STORAGE_LOCAL_PATH ?? './uploads';
const COLORS = [
  '0xB8D8E8',
  '0xE8D5B8',
  '0xC8E6C9',
  '0xF3C6C6',
  '0xD7CCE8',
  '0xE0E0E0',
];

function makeImage(i: number, dir: string): { key: string; size: number } {
  const file = `zone-${i}.jpg`;
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${COLORS[i % COLORS.length]}:s=480x270`,
    '-vf',
    [
      'drawbox=x=200:y=150:w=80:h=120:color=0x37474F:t=fill',
      'drawbox=x=212:y=70:w=56:h=70:color=0xE8C4A0:t=fill',
      'drawbox=x=208:y=62:w=64:h=18:color=0x2B2118:t=fill',
    ].join(','),
    '-frames:v',
    '1',
    join(dir, file),
  ]);
  return { key: `${FOLDER}/${file}`, size: statSync(join(dir, file)).size };
}

async function remove(): Promise<void> {
  const ev: unknown = await AppDataSource.query(
    `DELETE FROM iot_device_events WHERE payload_json->>'uiTestZoneLog' = 'true'`,
  );
  const mf: unknown = await AppDataSource.query(
    `DELETE FROM media_files WHERE related_entity_type = 'ui_test_zone_log'`,
  );
  const pe: unknown = await AppDataSource.query(
    `DELETE FROM zone_presence_events WHERE source_type = '${PRESENCE_SOURCE}'`,
  );
  rmSync(join(LOCAL_ROOT, FOLDER), { recursive: true, force: true });
  console.log(
    `Đã xóa ${(ev as [unknown, number])[1]} lượt nhật ký, ${(mf as [unknown, number])[1]} ảnh, ${(pe as [unknown, number])[1]} sự kiện dòng thời gian [UI TEST].`,
  );
}

async function seed(): Promise<void> {
  const zones: Array<{ id: string; zone_name: string }> =
    await AppDataSource.query(
      `SELECT id, zone_name FROM zones WHERE deleted_at IS NULL ORDER BY zone_name`,
    );
  const users: Array<{ id: string }> = await AppDataSource.query(
    `SELECT id FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 12`,
  );
  const [fallback]: Array<{ id: string }> = await AppDataSource.query(
    `SELECT id FROM iot_devices ORDER BY created_at LIMIT 1`,
  );
  if (!zones.length || !fallback)
    throw new Error('Cần có ít nhất 1 khu vực và 1 thiết bị.');

  const dir = join(LOCAL_ROOT, FOLDER);
  mkdirSync(dir, { recursive: true });
  const images = COLORS.map((_, i) => makeImage(i, dir));

  // Mốc 00:00 hôm nay theo giờ VN → rải sự kiện từ 07:00 tới hiện tại.
  const [{ start }]: Array<{ start: Date }> = await AppDataSource.query(
    `SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '7 hours')
              AT TIME ZONE 'Asia/Ho_Chi_Minh' AS start`,
  );
  const from = new Date(start).getTime();
  const span = Math.max(Date.now() - from, 60 * 60_000);
  let n = 0;
  let presence = 0;

  await AppDataSource.transaction(async (m) => {
    for (const zone of zones) {
      const [dev]: Array<{ id: string }> = await m.query(
        `SELECT id FROM iot_devices WHERE zone_id = $1 ORDER BY created_at LIMIT 1`,
        [zone.id],
      );
      for (let i = 0; i < PER_ZONE; i++) {
        const img = images[(n + i) % images.length];
        const [{ id: fileId }]: Array<{ id: string }> = await m.query(
          `INSERT INTO media_files (file_name, file_type, mime_type, storage_provider,
                                    storage_key, file_size_bytes, related_entity_type)
           VALUES ($1, 'image', 'image/jpeg', 'local', $2, $3, 'ui_test_zone_log') RETURNING id`,
          [img.key.split('/').pop(), img.key, String(img.size)],
        );
        const known = users.length > 0 && i % 3 === 0;
        const at = new Date(from + Math.random() * span);
        await m.query(
          `INSERT INTO iot_device_events (device_id, zone_id, event_type, event_time, source_protocol,
                                          severity, payload_json, processed_status, snapshot_file_id, created_at)
           VALUES ($1, $2, 'ivss_face_event', $3, 'http', 'info', $4, 'processed', $5, $3)`,
          [
            dev?.id ?? fallback.id,
            zone.id,
            at.toISOString(),
            JSON.stringify({
              uiTestZoneLog: true,
              userId: known ? users[i % users.length].id : null,
              matchState: known ? 'matched' : 'unmatched_both',
              direction: ['enter', 'leave', null][i % 3],
              similarity: known
                ? (0.82 + Math.random() * 0.15).toFixed(2)
                : null,
            }),
            fileId,
          ],
        );
      }
      n += PER_ZONE;

      // Dòng thời gian hiện diện: PRESENCE_DAYS ngày gần nhất (để Ngày/Tuần/Tháng/Năm khác nhau),
      // giờ hành chính 07:00–18:00 VN; hôm nay đông hơn và chỉ tới hiện tại.
      const rows: Array<Record<string, unknown>> = [];
      const today7h = from; // 07:00 hôm nay (VN)
      for (let d = 0; d < PRESENCE_DAYS; d++) {
        const dayStart = today7h - d * DAY_MS;
        const dayEnd = Math.min(dayStart + 11 * 60 * 60_000, Date.now());
        if (dayEnd <= dayStart) continue;
        const count = d === 0 ? 40 : 8 + Math.floor(Math.random() * 18);
        for (let k = 0; k < count; k++) {
          const r = Math.random();
          const type = r < 0.5 ? 'appear' : r < 0.8 ? 'disappear' : 'count';
          const known =
            type !== 'count' && users.length > 0 && Math.random() < 0.35;
          rows.push({
            zone_id: zone.id,
            device_id: dev?.id ?? null,
            user_id: known ? users[k % users.length].id : null,
            event_type: type,
            occupancy_count:
              type === 'count' ? Math.floor(Math.random() * 15) : null,
            confidence_score: known
              ? (0.8 + Math.random() * 0.19).toFixed(4)
              : null,
            event_time: new Date(
              dayStart + Math.random() * (dayEnd - dayStart),
            ).toISOString(),
          });
        }
      }
      await m.query(
        `INSERT INTO zone_presence_events (zone_id, device_id, user_id, event_type, occupancy_count,
                                           confidence_score, event_time, source_type, metadata_json)
         SELECT x.zone_id, x.device_id, x.user_id, x.event_type, x.occupancy_count,
                x.confidence_score, x.event_time, $2, '{"uiTest": true}'::jsonb
           FROM jsonb_to_recordset($1::jsonb) AS x(zone_id uuid, device_id uuid, user_id uuid,
                event_type text, occupancy_count int, confidence_score numeric, event_time timestamptz)`,
        [JSON.stringify(rows), PRESENCE_SOURCE],
      );
      presence += rows.length;
      console.log(
        `  • ${zone.zone_name}: ${PER_ZONE} lượt nhật ký hôm nay, ${rows.length} sự kiện dòng thời gian (${PRESENCE_DAYS} ngày)`,
      );
    }
  });
  console.log(
    `✅ [UI TEST] Đã tạo ${n} lượt nhật ký hôm nay + ${presence} sự kiện dòng thời gian cho ${zones.length} khu vực.`,
  );
  console.log('   Xóa bằng: npm run uitest:zonelog -- --remove');
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
