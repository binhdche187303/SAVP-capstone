import * as path from 'path';
import * as readline from 'readline';
import { execFileSync } from 'child_process';
import {
  REGISTRY,
  db,
  deleteCascade,
  ensureRegistry,
  partSeeded,
  trackedIds,
  withDb,
} from './lib';
import { seedPart1 } from './part1-foundation';
import { seedPart2 } from './part2-movement';
import { seedPart3 } from './part3-vehicles';
import { seedPart4 } from './part4-security';
import { seedPart5 } from './part5-meetings';
import { seedPart6 } from './part6-misc';
import { seedPart7 } from './part7-images';
import { DEMO_FOLDER, deleteDemoFile, removeDemoFolder } from './storage';

/**
 * Seed dữ liệu demo theo từng phần + xoá sạch 1 lần sau demo.
 *
 *   npm run demo:seed -- part1        # chạy 1 phần (chạy lại → bỏ qua nếu đã có)
 *   npm run demo:seed -- status       # đếm dòng demo theo phần/bảng
 *   npm run demo:seed -- purge        # xoá TOÀN BỘ dữ liệu demo (hỏi xác nhận; --yes để bỏ hỏi)
 */

const log = (m: string) => console.log(m);

const PARTS: Record<
  string,
  { desc: string; needs?: string; run: () => Promise<void> }
> = {
  part1: {
    desc: 'Nền: phòng ban, người dùng, zone, phòng, thiết bị',
    run: () => seedPart1(log),
  },
  part2: {
    desc: 'Di chuyển: lưu lượng zone, ra/vào phòng, hành trình (cần part5)',
    needs: 'part5',
    run: () => seedPart2(log),
  },
  part5: {
    desc: 'Họp: cuộc họp đủ trạng thái, đặt phòng, yêu cầu duyệt, điểm danh, biên bản',
    needs: 'part1',
    run: () => seedPart5(log),
  },
  part3: {
    desc: 'Phương tiện: đăng ký xe, danh sách kiểm soát biển số, lượt xe ANPR',
    needs: 'part1',
    run: () => seedPart3(log),
  },
  part4: {
    desc: 'An ninh: quy tắc, danh sách kiểm soát người, cảnh báo đủ loại/trạng thái (cần part3)',
    needs: 'part3',
    run: () => seedPart4(log),
  },
  part6: {
    desc: 'Còn lại: thiết bị phòng họp, sự kiện điểm danh, thông báo, nhật ký audit (cần part4)',
    needs: 'part4',
    run: () => seedPart6(log),
  },
  part7: {
    desc: 'Ảnh: khuôn mặt, biển số, đám đông cho sự kiện/cảnh báo/hành trình (cần part6 + thư mục images)',
    needs: 'part6',
    run: () => seedPart7(log),
  },
};

/** Thứ tự chạy `all` (theo phụ thuộc). */
const ALL_ORDER = [
  'part1',
  'part5',
  'part2',
  'part3',
  'part4',
  'part6',
  'part7',
];

async function runPart(name: string) {
  const p = PARTS[name];
  await withDb(async () => {
    await ensureRegistry();
    if (await partSeeded(name)) {
      log(
        `• ${name} đã có dữ liệu — bỏ qua (purge rồi chạy lại nếu muốn làm mới).`,
      );
      return;
    }
    if (p.needs && !(await partSeeded(p.needs))) {
      throw new Error(`${name} cần chạy ${p.needs} trước.`);
    }
    log(`▶ ${name}: ${p.desc}`);
    await p.run();
    log(`Xong ${name}.`);
  });
}

async function registryExists(): Promise<boolean> {
  const [row]: Array<{ t: string | null }> = await db.query(
    `SELECT to_regclass($1) AS t`,
    [REGISTRY],
  );
  return row.t !== null;
}

async function status() {
  await withDb(async () => {
    if (!(await registryExists())) return log('Chưa có dữ liệu demo.');
    const rows: Array<{ part: string; table_name: string; n: string }> =
      await db.query(
        `SELECT part, table_name, count(*) AS n FROM ${REGISTRY}
         GROUP BY part, table_name ORDER BY part, min(seq)`,
      );
    if (rows.length === 0) return log('Chưa có dữ liệu demo.');
    for (const r of rows)
      log(`  ${r.part.padEnd(7)} ${r.table_name.padEnd(28)} ${r.n}`);
  });
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((res) => rl.question(question, res));
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

async function purge(skipConfirm: boolean) {
  const target = `${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}`;
  if (
    !skipConfirm &&
    !(await confirm(`Xoá TOÀN BỘ dữ liệu demo trong DB ${target}? Gõ "yes": `))
  ) {
    return log('Huỷ.');
  }

  // Dữ liệu của script camera (channel 901–904, cảnh báo/sự kiện realtime lúc demo)
  log('▶ Dọn dữ liệu script camera…');
  execFileSync(
    'npx',
    [
      'tsx',
      path.join(__dirname, '../demo-camera-mock/demo-camera-mock.ts'),
      'cleanup',
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );

  await withDb(async () => {
    if (!(await registryExists())) return log('Không có dữ liệu seed.');
    // Bảng tổng hợp xe (id bigint, zone_id nullable → không vào registry): xoá theo zone demo
    const zones = await trackedIds('zones');
    for (const t of ['kpi_vehicle_hourly', 'kpi_vehicle_plate_hourly']) {
      await db.query(`DELETE FROM ${t} WHERE zone_id = ANY($1::uuid[])`, [
        zones,
      ]);
    }
    // File ảnh trong storage (part7) — xoá trước khi mất bản ghi media_files
    const media: Array<{ storage_key: string }> = await db.query(
      `SELECT storage_key FROM media_files WHERE id = ANY($1::uuid[])`,
      [await trackedIds('media_files')],
    );
    for (const m of media) await deleteDemoFile(m.storage_key);
    removeDemoFolder();
    if (media.length) log(`  ✖ file ảnh trong storage: ${media.length}`);
    // Xoá theo thứ tự NGƯỢC lúc thêm (bảng con trước bảng cha)
    const tables: Array<{ table_name: string }> = await db.query(
      `SELECT table_name FROM ${REGISTRY} GROUP BY table_name ORDER BY max(seq) DESC`,
    );
    for (const { table_name } of tables) {
      const ids: Array<{ row_id: string }> = await db.query(
        `SELECT row_id FROM ${REGISTRY} WHERE table_name = $1`,
        [table_name],
      );
      log(`  ✖ ${table_name}: ${ids.length}`);
      await deleteCascade(
        table_name,
        ids.map((r) => r.row_id),
        log,
      );
    }
    await db.query(`DROP TABLE ${REGISTRY}`);
    await verifyClean();
  });
}

/** Kiểm tra sau purge: không còn bản ghi mang mã DEMO-. */
async function verifyClean() {
  const checks: Array<[string, string]> = [
    ['departments', `department_code LIKE 'DEMO-%'`],
    ['users', `employee_code LIKE 'DEMO-%'`],
    ['zones', `zone_code LIKE 'DEMO-%' AND deleted_at IS NULL`],
    ['rooms', `room_code LIKE 'DEMO-%'`],
    ['iot_devices', `device_code LIKE 'DEMO-%'`],
    ['meetings', `meeting_code LIKE 'DEMO-MTG-%'`],
    ['room_bookings', `booking_code LIKE 'DEMO-BK-%'`],
    ['meeting_requests', `request_code LIKE 'DEMO-REQ-%'`],
    ['iot_device_events', `payload_json->>'demo' = 'true'`],
    ['security_alerts', `payload_json->>'demo' = 'true'`],
    ['equipments', `equipment_code LIKE 'DEMO-EQ-%'`],
    ['notifications', `notification_code LIKE 'DEMO-NTF-%'`],
    ['audit_logs', `metadata_json->>'demo' = 'true'`],
    ['media_files', `storage_key LIKE '${DEMO_FOLDER}/%'`],
  ];
  let left = 0;
  for (const [table, where] of checks) {
    const [row]: Array<{ n: string }> = await db.query(
      `SELECT count(*) AS n FROM ${table} WHERE ${where}`,
    );
    if (Number(row.n) > 0) log(`  ⚠ ${table} còn ${row.n} dòng DEMO-`);
    left += Number(row.n);
  }
  log(
    left === 0 ? '✔ Sạch: không còn dữ liệu demo.' : `⚠ Còn ${left} dòng demo.`,
  );
}

function usage() {
  log(`Cách dùng: npm run demo:seed -- <lệnh>
${Object.entries(PARTS)
  .map(([n, p]) => `  ${n.padEnd(14)}${p.desc}`)
  .join('\n')}
  all           Chạy mọi phần theo thứ tự (${ALL_ORDER.join(' → ')})
  status        Đếm dữ liệu demo
  purge [--yes] Xoá toàn bộ dữ liệu demo`);
}

async function main() {
  const [cmd, flag] = process.argv.slice(2);
  if (cmd === 'status') return status();
  if (cmd === 'purge') return purge(flag === '--yes');
  if (cmd === 'all') {
    for (const name of ALL_ORDER) await runPart(name);
    return;
  }
  if (cmd && PARTS[cmd]) return runPart(cmd);
  usage();
}

main().catch((e) => {
  console.error(`✖ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
