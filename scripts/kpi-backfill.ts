import { AppDataSource } from '../src/database/data-source.js';
import {
  ROLLUP_NAMES,
  type RollupName,
} from '../src/modules/kpi-rollup/kpi-rollup.constants.js';
import { KpiWatermarkRepository } from '../src/modules/kpi-rollup/repositories/kpi-watermark.repository.js';
import { ZoneHourlyRollupService } from '../src/modules/kpi-rollup/services/zone-hourly-rollup.service.js';
import { VehicleHourlyRollupService } from '../src/modules/kpi-rollup/services/vehicle-hourly-rollup.service.js';
import { KpiRollupJobService } from '../src/modules/kpi-rollup/services/kpi-rollup-job.service.js';
import { floorHour } from '../src/modules/kpi-rollup/utils/hour.util.js';
import { planBackfillChunks } from '../src/modules/kpi-rollup/utils/rollup-window.util.js';

/**
 * KPI-001 — nạp lịch sử cho bảng tổng hợp. Lùi từng ngày từ `--to` (mặc định covered_from
 * hiện tại, hoặc giờ tròn hiện tại nếu chưa có watermark) về `--from` (mặc định event raw
 * sớm nhất). Mỗi ngày 1 transaction, idempotent — chạy lại an toàn.
 * Thực thi: npx tsx scripts/kpi-backfill.ts [--from=ISO] [--to=ISO] [--only=zone_hourly|vehicle_hourly]
 */
const SOURCE_MIN_SQL: Record<RollupName, string> = {
  zone_hourly: `SELECT MIN(event_time) AS t FROM zone_presence_events WHERE event_type = 'count'`,
  vehicle_hourly: `SELECT MIN(event_time) AS t FROM iot_device_events WHERE event_type = 'ivss_vehicle_event'`,
};

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

async function main(): Promise<void> {
  const only = arg('only');
  if (
    only !== undefined &&
    !(ROLLUP_NAMES as readonly string[]).includes(only)
  ) {
    console.error(
      `--only không hợp lệ: "${only}". Giá trị hợp lệ: ${ROLLUP_NAMES.join(', ')}`,
    );
    process.exit(1);
  }
  for (const key of ['from', 'to']) {
    const v = arg(key);
    if (v !== undefined && Number.isNaN(new Date(v).getTime())) {
      console.error(`--${key} không hợp lệ: "${v}" (cần ISO 8601)`);
      process.exit(1);
    }
  }
  await AppDataSource.initialize();
  const watermarkRepo = new KpiWatermarkRepository(AppDataSource);
  const job = new KpiRollupJobService(
    AppDataSource,
    watermarkRepo,
    new ZoneHourlyRollupService(),
    new VehicleHourlyRollupService(),
  );
  const names = only ? [only as RollupName] : ROLLUP_NAMES;
  try {
    for (const name of names) {
      const wm = await watermarkRepo.get(name);
      const nowHour = floorHour(new Date());
      let to = arg('to')
        ? floorHour(new Date(arg('to')!))
        : (wm?.coveredFrom ?? nowHour);
      if (to.getTime() > nowHour.getTime()) {
        console.log(
          `  (--to vượt giờ tròn hiện tại — cắt về ${nowHour.toISOString()})`,
        );
        to = nowHour;
      }
      const [row] = await AppDataSource.query<Array<{ t: Date | null }>>(
        SOURCE_MIN_SQL[name],
      );
      const fromArg = arg('from');
      const from = fromArg
        ? new Date(fromArg)
        : row?.t
          ? new Date(row.t)
          : null;
      if (!from || from.getTime() >= to.getTime()) {
        console.log(`• ${name}: không có gì để backfill`);
        continue;
      }
      const chunks = planBackfillChunks(from, to);
      console.log(
        `• ${name}: ${chunks.length} ngày [${floorHour(from).toISOString()} → ${to.toISOString()})`,
      );
      for (const [i, c] of chunks.entries()) {
        await job.runRange(name, c.from, c.to);
        console.log(
          `  ${i + 1}/${chunks.length} ✓ [${c.from.toISOString()}, ${c.to.toISOString()})`,
        );
      }
    }
    console.log('✅ Backfill KPI xong.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
