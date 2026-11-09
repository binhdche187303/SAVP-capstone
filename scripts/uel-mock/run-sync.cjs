#!/usr/bin/env node
/**
 * Chạy UelSyncService (bản build trong dist/) với DB + API chỉ định, in kết quả từng bước.
 * Dùng để kiểm tra đồng bộ với API giả lập trước khi có API key thật.
 *
 *   npx nest build
 *   node scripts/uel-mock/server.mjs &                          # API giả lập
 *   DB_DATABASE=capstone_uel_check node scripts/uel-mock/run-sync.cjs \
 *     --nam-hoc 2026-2027 --hoc-ky 1 --from 2026-11-02 --to 2026-11-22 [--steps a,b] [--seed-periods]
 *
 * --seed-periods: nạp bảng giờ tiết GIẢ ĐỊNH nếu study_periods đang trống (chỉ dùng cho DB thử).
 * Mặc định UEL_API_BASE_URL=http://localhost:4010, UEL_API_KEY=mock-key nếu chưa đặt.
 */
require('reflect-metadata');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const { AppDataSource } = require('../../dist/database/data-source.js');
const { UelApiClient } = require('../../dist/modules/uel-sync/uel-api.client.js');
const { UelSyncService } = require('../../dist/modules/uel-sync/uel-sync.service.js');

/** Bảng giờ tiết giả định (50 phút/tiết) — KHÔNG phải lịch tiết thật của UEL. */
const ASSUMED_PERIODS = [
  [1, '07:00', '07:50'], [2, '07:50', '08:40'], [3, '08:50', '09:40'],
  [4, '09:40', '10:30'], [5, '10:40', '11:30'], [6, '11:30', '12:20'],
  [7, '12:30', '13:20'], [8, '13:20', '14:10'], [9, '14:20', '15:10'],
  [10, '15:10', '16:00'], [11, '16:10', '17:00'], [12, '17:00', '17:50'],
  [13, '18:00', '18:50'], [14, '18:50', '19:40'], [15, '19:50', '20:40'],
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  await AppDataSource.initialize();
  try {
    if (process.argv.includes('--seed-periods')) {
      const [{ n }] = await AppDataSource.query('SELECT count(*)::int AS n FROM study_periods');
      if (n === 0) {
        for (const [no, s, e] of ASSUMED_PERIODS) {
          await AppDataSource.query(
            'INSERT INTO study_periods (period_no, start_time, end_time) VALUES ($1, $2, $3)',
            [no, s, e],
          );
        }
        console.log(`Đã nạp ${ASSUMED_PERIODS.length} tiết giả định vào study_periods.`);
      }
    }

    const client = new UelApiClient({
      baseUrl: process.env.UEL_API_BASE_URL || 'http://localhost:4010',
      projectCode: process.env.UEL_API_PROJECT_CODE || 'uelapi',
      apiKey: process.env.UEL_API_KEY || 'mock-key',
      timeoutMs: 30000,
    });
    const service = new UelSyncService(client, AppDataSource);
    const steps = arg('steps')?.split(',').filter(Boolean);
    const t0 = Date.now();
    const run = await service.start({
      steps,
      namHoc: arg('nam-hoc'),
      hocKy: arg('hoc-ky'),
      fromDate: arg('from'),
      toDate: arg('to'),
    });
    console.table(
      run.results.map((r) => ({
        step: r.step,
        fetched: r.fetched,
        upserted: r.upserted,
        skipped: r.skipped,
        deactivated: r.deactivated,
        warnings: r.warnings.length,
        error: r.error ?? '',
      })),
    );
    for (const r of run.results) {
      for (const w of r.warnings) console.log(`  [${r.step}] ${w}`);
    }
    console.log(`Xong sau ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
    if (run.results.some((r) => r.error)) process.exitCode = 1;
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
