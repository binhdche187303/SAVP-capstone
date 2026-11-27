import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as dotenv from 'dotenv';
import { AppDataSource } from '../../src/database/data-source';
import { BLOCKED_PLATE, UNKNOWN_PLATES, WATCH_PLATE } from './demo-plates';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * MOCK CAMERA ĐỂ DEMO — giả lập camera gửi sự kiện (kèm ảnh) vào CÁC WEBHOOK THẬT
 * của backend. Không sửa code server: backend xử lý y như camera thật
 * (lưu ảnh, tạo cảnh báo, đẩy realtime lên FE). Hướng dẫn: README.md cùng thư mục.
 *
 *   npx tsx scripts/demo-camera-mock/demo-camera-mock.ts <lệnh>
 *
 * Dữ liệu demo tách riêng: channel 901–904 + zone mã DEMO-* + biển số DEMO —
 * lệnh `cleanup` xoá sạch, KHÔNG đụng channel/zone thật.
 */

const API_URL = (
  process.env.DEMO_API_URL ??
  `http://localhost:${process.env.APP_PORT ?? 3000}/api/v1`
).replace(/\/$/, '');
const TOKEN = process.env.IVSS_BRIDGE_TOKEN ?? '';
const IMAGES_DIR = path.resolve(
  process.env.DEMO_IMAGES_DIR ?? path.join(__dirname, 'images'),
);

const BRIDGE_DEVICE_CODE = 'IVSS-BRIDGE';
const DEMO_UID_PREFIX = 'DEMO-UID-';

const CH = {
  corridor: 901,
  restricted: 902,
  lobby: 903,
  gate: 904,
} as const;
const DEMO_CHANNELS = Object.values(CH).map(String);

const ZONES = [
  { code: 'DEMO-CORRIDOR', name: 'DEMO - Hành lang tầng 1', type: 'corridor' },
  {
    code: 'DEMO-RESTRICTED',
    name: 'DEMO - Phòng máy chủ (khu cấm)',
    type: 'corridor',
  },
  { code: 'DEMO-LOBBY', name: 'DEMO - Sảnh chính', type: 'lobby' },
  { code: 'DEMO-GATE', name: 'DEMO - Cổng xe', type: 'gate' },
] as const;

const CROWD_THRESHOLD = 5;

// ---------------------------------------------------------------- helpers

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

type ImageKind = 'faces' | 'plates' | 'crowd';

function loadImages(sub: ImageKind): string[] {
  const dir = path.join(IMAGES_DIR, sub);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .map((f) => path.join(dir, f));
}

function toDataUrl(file: string): string {
  const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

/** Ảnh ngẫu nhiên trong images/<sub>/; `preferName` (vd biển số) → dùng đúng file đó nếu có. */
function randomImageBase64(
  sub: ImageKind,
  preferName?: string,
): string | undefined {
  const files = loadImages(sub);
  const exact = preferName
    ? files.find((f) => path.parse(f).name === preferName)
    : undefined;
  if (exact) return toDataUrl(exact);
  if (files.length === 0) {
    console.warn(
      `  ⚠ Không có ảnh trong ${path.join(IMAGES_DIR, sub)} — gửi sự kiện KHÔNG kèm ảnh.`,
    );
    return undefined;
  }
  return toDataUrl(pick(files));
}

async function post(route: string, body: Record<string, unknown>) {
  if (!TOKEN) throw new Error('Thiếu IVSS_BRIDGE_TOKEN trong .env');
  const res = await fetch(`${API_URL}/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': TOKEN },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route} → HTTP ${res.status}: ${text}`);
  const { imageBase64: _omit, ...shown } = body;
  console.log(`  ✔ ${route} ${JSON.stringify(shown)}${_omit ? ' +ảnh' : ''}`);
}

async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  AppDataSource.setOptions({ logging: false, logger: 'advanced-console' });
  await AppDataSource.initialize();
  try {
    return await fn();
  } finally {
    await AppDataSource.destroy();
  }
}

async function demoUids(): Promise<string[]> {
  return withDb(async () => {
    const rows: Array<{ device_person_id: string }> = await AppDataSource.query(
      `SELECT device_person_id FROM device_user_mappings
       WHERE device_person_id LIKE $1 AND deleted_at IS NULL`,
      [`${DEMO_UID_PREFIX}%`],
    );
    return rows.map((r) => r.device_person_id);
  });
}

// ---------------------------------------------------------------- setup / cleanup

async function mergeChannelMap(key: string, entries: Record<string, string>) {
  const rows: Array<{ id: string }> = await AppDataSource.query(
    `SELECT id FROM system_configs WHERE config_key = $1 AND is_active = true LIMIT 1`,
    [key],
  );
  if (rows[0]) {
    await AppDataSource.query(
      `UPDATE system_configs SET config_json = COALESCE(config_json, '{}'::jsonb) || $2::jsonb,
         updated_at = now() WHERE id = $1`,
      [rows[0].id, JSON.stringify(entries)],
    );
  } else {
    await AppDataSource.query(
      `INSERT INTO system_configs (config_key, config_group, config_json, value_type, is_active)
       VALUES ($1, 'ivss', $2::jsonb, 'json', true)`,
      [key, JSON.stringify(entries)],
    );
  }
}

async function setup(userCount: number) {
  await withDb(async () => {
    console.log('Thiết bị bridge…');
    let [bridge]: Array<{ id: string }> = await AppDataSource.query(
      `SELECT id FROM iot_devices WHERE device_code = $1 AND device_type = 'ivss_bridge' LIMIT 1`,
      [BRIDGE_DEVICE_CODE],
    );
    if (!bridge) {
      [bridge] = await AppDataSource.query(
        `INSERT INTO iot_devices (device_code, device_name, device_type, status)
         VALUES ($1, 'IVSS Bridge (demo)', 'ivss_bridge', 'online') RETURNING id`,
        [BRIDGE_DEVICE_CODE],
      );
    }

    console.log('Zone demo…');
    const zoneId: Record<string, string> = {};
    for (const z of ZONES) {
      let [row]: Array<{ id: string }> = await AppDataSource.query(
        `SELECT id FROM zones WHERE zone_code = $1 AND deleted_at IS NULL LIMIT 1`,
        [z.code],
      );
      if (!row) {
        [row] = await AppDataSource.query(
          `INSERT INTO zones (zone_code, zone_name, zone_type, status)
           VALUES ($1, $2, $3, 'active') RETURNING id`,
          [z.code, z.name, z.type],
        );
      }
      zoneId[z.code] = row.id;
    }

    console.log('Gán channel → zone…');
    await mergeChannelMap('ivss.channel_presence_zone_map', {
      [CH.corridor]: zoneId['DEMO-CORRIDOR'],
      [CH.restricted]: zoneId['DEMO-RESTRICTED'],
      [CH.lobby]: zoneId['DEMO-LOBBY'],
    });
    await mergeChannelMap('ivss.channel_zone_map', {
      [CH.gate]: zoneId['DEMO-GATE'],
    });

    console.log('Luật cảnh báo (xâm nhập + đám đông)…');
    const rules = [
      { type: 'intrusion', zone: zoneId['DEMO-RESTRICTED'], threshold: null },
      { type: 'crowd', zone: zoneId['DEMO-LOBBY'], threshold: CROWD_THRESHOLD },
    ];
    for (const r of rules) {
      const [exists]: Array<{ id: string }> = await AppDataSource.query(
        `SELECT id FROM alert_rules WHERE alert_type = $1 AND zone_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [r.type, r.zone],
      );
      if (!exists) {
        await AppDataSource.query(
          `INSERT INTO alert_rules (alert_type, zone_id, threshold, enabled, allowed_person_ids_json)
           VALUES ($1, $2, $3, true, '[]'::jsonb)`,
          [r.type, r.zone, r.threshold],
        );
      }
    }

    console.log('Danh sách kiểm soát xe…');
    for (const [plate, listType, reason] of [
      [BLOCKED_PLATE, 'blocklist', 'DEMO - xe bị cấm vào'],
      [WATCH_PLATE, 'watchlist', 'DEMO - xe cần theo dõi'],
    ]) {
      const [exists]: Array<{ id: string }> = await AppDataSource.query(
        `SELECT id FROM vehicle_control_list WHERE plate_number = $1 AND deleted_at IS NULL LIMIT 1`,
        [plate],
      );
      if (!exists) {
        await AppDataSource.query(
          `INSERT INTO vehicle_control_list (plate_number, plate_raw, list_type, reason, active)
           VALUES ($1, $1, $2, $3, true)`,
          [plate, listType, reason],
        );
      }
    }

    console.log(`Gán mã nhận diện demo cho ${userCount} người dùng…`);
    const users: Array<{ id: string; full_name: string }> =
      await AppDataSource.query(
        `SELECT u.id, u.full_name FROM users u
         WHERE u.deleted_at IS NULL AND NOT EXISTS (
           SELECT 1 FROM device_user_mappings m
           WHERE m.user_id = u.id AND m.device_person_id LIKE $1 AND m.deleted_at IS NULL)
         ORDER BY u.created_at LIMIT $2`,
        [`${DEMO_UID_PREFIX}%`, userCount],
      );
    const [{ n }]: Array<{ n: string }> = await AppDataSource.query(
      `SELECT count(*) AS n FROM device_user_mappings WHERE device_person_id LIKE $1`,
      [`${DEMO_UID_PREFIX}%`],
    );
    let next = Number(n) + 1;
    for (const u of users) {
      await AppDataSource.query(
        `INSERT INTO device_user_mappings
           (device_id, user_id, device_person_id, device_person_name, face_registered, sync_status, metadata_json, last_synced_at)
         VALUES ($1, $2, $3, $4, true, 'synced', '{"source":"portrait","demo":true}'::jsonb, now())`,
        [bridge.id, u.id, `${DEMO_UID_PREFIX}${next++}`, u.full_name],
      );
      console.log(`  + ${u.full_name}`);
    }
  });
  console.log(
    '\nXong setup. Thử: npx tsx scripts/demo-camera-mock/demo-camera-mock.ts all',
  );
}

async function cleanup() {
  await withDb(async () => {
    const zones: Array<{ id: string }> = await AppDataSource.query(
      // Chỉ zone của script camera — KHÔNG dùng LIKE 'DEMO-%' (trùng zone của demo-seed)
      `SELECT id FROM zones WHERE zone_code = ANY($1)`,
      [ZONES.map((z) => z.code)],
    );
    const ids = zones.map((z) => z.id);
    const steps: Array<[string, string, unknown[]]> = [
      [
        'cảnh báo',
        `DELETE FROM security_alerts WHERE zone_id = ANY($1) OR dedupe_key = ANY($2)`,
        [ids, [BLOCKED_PLATE, WATCH_PLATE]],
      ],
      ['luật', `DELETE FROM alert_rules WHERE zone_id = ANY($1)`, [ids]],
      [
        'log cổng',
        `DELETE FROM gate_access_logs WHERE zone_id = ANY($1)`,
        [ids],
      ],
      [
        'bắt gặp',
        `DELETE FROM zone_presence_events WHERE zone_id = ANY($1)`,
        [ids],
      ],
      [
        'sự kiện',
        `DELETE FROM iot_device_events WHERE zone_id = ANY($1) OR payload_json->>'channelId' = ANY($2)`,
        [ids, DEMO_CHANNELS],
      ],
      [
        'xe kiểm soát',
        `DELETE FROM vehicle_control_list WHERE plate_number = ANY($1)`,
        [[BLOCKED_PLATE, WATCH_PLATE]],
      ],
      [
        'mã nhận diện',
        `DELETE FROM device_user_mappings WHERE device_person_id LIKE $1`,
        [`${DEMO_UID_PREFIX}%`],
      ],
      [
        'zone',
        `UPDATE zones SET deleted_at = now(), status = 'inactive' WHERE id = ANY($1) AND deleted_at IS NULL`,
        [ids],
      ],
    ];
    for (const [label, sql, params] of steps) {
      try {
        await AppDataSource.query(sql, params);
        console.log(`  ✔ xoá ${label}`);
      } catch (e) {
        console.warn(`  ⚠ ${label}: ${e instanceof Error ? e.message : e}`);
      }
    }
    for (const key of [
      'ivss.channel_presence_zone_map',
      'ivss.channel_zone_map',
    ]) {
      await AppDataSource.query(
        `UPDATE system_configs SET config_json = config_json - $2::text[], updated_at = now()
         WHERE config_key = $1`,
        [key, DEMO_CHANNELS],
      );
    }
    console.log('  ✔ gỡ channel demo khỏi cấu hình');
  });
  console.log(
    '\nĐã dọn dữ liệu demo. (Lưu ý: thiết bị IVSS-BRIDGE và file ảnh trong uploads/ được giữ lại.)',
  );
}

// ---------------------------------------------------------------- kịch bản

const now = () => new Date().toISOString();

async function faceEvent(channelId: number, personUid?: string) {
  await post('internal/ivss/events', {
    type: 'face_recognition',
    channelId,
    utc: now(),
    eventAction: 'seen',
    ...(personUid ? { personUid, similarity: 92 } : {}),
    imageBase64: randomImageBase64('faces'),
  });
}

async function vehicleEvent(plateNumber: string, eventAction = 'enter') {
  await post('internal/ivss/vehicle-events', {
    plateNumber,
    channelId: CH.gate,
    utc: now(),
    eventAction,
    vehicleType: pick(['car', 'motorbike']),
    vehicleColor: pick(['white', 'black', 'red', 'blue']),
    imageBase64: randomImageBase64('plates', plateNumber),
  });
}

/** Biển lạ lấy từ danh sách cố định để luôn có ảnh khớp biển (generate-images.ts). */
function randomPlate(): string {
  return pick(UNKNOWN_PLATES);
}

/**
 * Bridge GIẢ — BE tự gọi `POST /api/ivss/snapshot?channelId=` để chụp ảnh khi có cảnh báo
 * đám đông. Trả ảnh ngẫu nhiên trong images/crowd/. Cần BE có
 * IVSS_BRIDGE_BASE_URL=http://localhost:<port> (đặt TRƯỚC khi khởi động BE).
 */
function bridge(port: number) {
  http
    .createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.headers['x-internal-token'] !== TOKEN) {
        return reply(401, { success: false, message: 'invalid token' });
      }
      if (req.method === 'POST' && url.pathname === '/api/ivss/snapshot') {
        const img = randomImageBase64('crowd');
        console.log(
          `  ✔ snapshot channel=${url.searchParams.get('channelId')}${img ? ' +ảnh' : ' (không có ảnh)'}`,
        );
        return img
          ? reply(200, { success: true, data: img.replace(/^data:[^,]+,/, '') })
          : reply(200, { success: false, message: 'no demo image' });
      }
      console.log(`  · bỏ qua ${req.method} ${url.pathname} (bridge giả)`);
      reply(404, { success: false, message: 'not supported by demo bridge' });
    })
    .listen(port, () =>
      console.log(
        `Bridge giả chạy tại http://localhost:${port} (Ctrl+C để dừng)\n` +
          `BE cần IVSS_BRIDGE_BASE_URL=http://localhost:${port} trong .env rồi khởi động lại.`,
      ),
    );
}

const scenarios: Record<
  string,
  { desc: string; run: (uids: string[]) => Promise<void> }
> = {
  person: {
    desc: 'Người quen đi qua hành lang (bắt gặp + ảnh)',
    run: async (uids) => {
      if (!uids.length)
        throw new Error('Chưa có mã nhận diện demo — chạy `setup` trước.');
      await faceEvent(CH.corridor, pick(uids));
    },
  },
  stranger: {
    desc: 'Người lạ (không nhận diện được) ở hành lang',
    run: () => faceEvent(CH.corridor),
  },
  intrusion: {
    desc: 'Người lạ đi vào khu cấm → cảnh báo xâm nhập',
    run: () => faceEvent(CH.restricted),
  },
  'intrusion-known': {
    desc: 'Người quen KHÔNG có quyền vào khu cấm → cảnh báo xâm nhập',
    run: async (uids) => {
      if (!uids.length)
        throw new Error('Chưa có mã nhận diện demo — chạy `setup` trước.');
      await faceEvent(CH.restricted, pick(uids));
    },
  },
  crowd: {
    desc: `Sảnh đông người (vượt ngưỡng ${CROWD_THRESHOLD}) → cảnh báo đám đông`,
    run: async () => {
      for (const number of [3, 6, CROWD_THRESHOLD + 7]) {
        await post('internal/ivss/occupancy-events', {
          type: 'people_counting',
          channelId: CH.lobby,
          number,
          utc: now(),
        });
        await sleep(1000);
      }
    },
  },
  'vehicle-unknown': {
    desc: 'Xe biển lạ vào cổng → cảnh báo xe không xác định',
    run: () => vehicleEvent(randomPlate()),
  },
  'vehicle-blocked': {
    desc: `Xe trong danh sách chặn (${BLOCKED_PLATE}) → cảnh báo mức cao`,
    run: () => vehicleEvent(BLOCKED_PLATE),
  },
  'vehicle-watch': {
    desc: `Xe cần theo dõi (${WATCH_PLATE}) → cảnh báo mức trung bình`,
    run: () => vehicleEvent(WATCH_PLATE),
  },
};

async function runAll(uids: string[]) {
  for (const [name, s] of Object.entries(scenarios)) {
    if (!uids.length && name.endsWith('known')) continue;
    if (!uids.length && name === 'person') continue;
    console.log(`\n▶ ${name}: ${s.desc}`);
    await s.run(uids);
    await sleep(1500);
  }
}

async function loop(uids: string[], seconds: number) {
  console.log(`Gửi sự kiện ngẫu nhiên mỗi ~${seconds}s (Ctrl+C để dừng)…`);
  const names = Object.keys(scenarios).filter(
    (n) => uids.length || (n !== 'person' && !n.endsWith('known')),
  );
  // Trọng số: sự kiện bình thường nhiều hơn cảnh báo, giống thực tế.
  const weighted = names.flatMap((n) =>
    n === 'person' || n === 'vehicle-unknown' ? [n, n, n] : [n],
  );
  for (;;) {
    const name = pick(weighted);
    console.log(`\n▶ ${name}`);
    try {
      await scenarios[name].run(uids);
    } catch (e) {
      console.error(`  ✖ ${e instanceof Error ? e.message : e}`);
    }
    await sleep(seconds * 1000 * (0.5 + Math.random()));
  }
}

function usage() {
  console.log(`Cách dùng: npx tsx scripts/demo-camera-mock/demo-camera-mock.ts <lệnh>

  setup [sốNgười=5]   Tạo dữ liệu nền demo (zone, channel, luật, biển số, mã nhận diện)
  cleanup             Xoá toàn bộ dữ liệu demo
  all                 Chạy lần lượt mọi kịch bản
  loop [giây=8]       Gửi sự kiện ngẫu nhiên liên tục (cho màn hình "sống")
  bridge [cổng=8099]  Bridge giả trả ảnh chụp cho cảnh báo đám đông (chạy ở terminal riêng)
${Object.entries(scenarios)
  .map(([n, s]) => `  ${n.padEnd(20)}${s.desc}`)
  .join('\n')}

API: ${API_URL}   Ảnh: ${IMAGES_DIR}/{faces,plates,crowd}`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd || cmd === 'help') return usage();
  if (cmd === 'setup') return setup(Number(arg ?? 5));
  if (cmd === 'cleanup') return cleanup();
  if (cmd === 'bridge') return bridge(Number(arg ?? 8099));

  const uids = await demoUids();
  if (cmd === 'all') return runAll(uids);
  if (cmd === 'loop') return loop(uids, Number(arg ?? 8));
  const s = scenarios[cmd];
  if (!s) return usage();
  console.log(`▶ ${cmd}: ${s.desc}`);
  await s.run(uids);
}

main().catch((e) => {
  console.error(`✖ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
