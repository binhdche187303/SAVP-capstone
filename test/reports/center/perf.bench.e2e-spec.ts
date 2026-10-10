// Đo hiệu năng xem trước (Task 9). Chỉ chạy khi BENCH=1, trên DB tổng hợp (xem .superpowers/sdd/bench-seed.sql):
//   BENCH=1 RUN_DB_TESTS=1 DB_DATABASE=capstone_bench npx jest --config test/jest-e2e.json test/reports/center/perf.bench --runInBand
import { AppDataSource } from '../../../src/database/data-source';
import { SecurityAlertEntity } from '../../../src/modules/alerts/entities/security-alert.entity';
import { GateAccessReportProvider } from '../../../src/modules/reports/center/providers/gate-access.provider';
import { RoomUtilizationReportProvider } from '../../../src/modules/reports/center/providers/room-utilization.provider';
import { SecurityAlertReportProvider } from '../../../src/modules/reports/center/providers/security-alert.provider';
import { StaffAttendanceReportProvider } from '../../../src/modules/reports/center/providers/staff-attendance.provider';
import { VehicleReportProvider } from '../../../src/modules/reports/center/providers/vehicle.provider';
import type { ReportProvider } from '../../../src/modules/reports/center/report-model';
import { SecurityAlertReportDataService } from '../../../src/modules/reports/services/security-alert-report-data.service';

const describeBench = process.env.BENCH === '1' && process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const RUNS = 5;

describeBench('RPT-CENTER perf (kỳ 31 ngày)', () => {
  beforeAll(async () => { await AppDataSource.initialize(); });
  afterAll(async () => { await AppDataSource.destroy(); });

  it('đo thời gian xem trước từng loại', async () => {
    const providers: ReportProvider[] = [
      new StaffAttendanceReportProvider(AppDataSource), new GateAccessReportProvider(AppDataSource), new VehicleReportProvider(AppDataSource),
      new RoomUtilizationReportProvider(AppDataSource),
      new SecurityAlertReportProvider(AppDataSource, new SecurityAlertReportDataService(AppDataSource.getRepository(SecurityAlertEntity))),
    ];
    const lines: string[] = [];
    for (const p of providers) {
      const times: number[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        const t = process.hrtime.bigint();
        await p.build({ from: '2026-09-01', to: '2026-10-01' }, { unrestricted: true, departmentIds: null }, { page: 1, limit: 20 }, new Date('2026-10-02T03:00:00Z'));
        times.push(Number(process.hrtime.bigint() - t) / 1e6);
      }
      lines.push(`${p.type.padEnd(18)} avg ${(times.reduce((a, b) => a + b, 0) / RUNS).toFixed(0).padStart(5)} ms  max ${Math.max(...times).toFixed(0).padStart(5)} ms  (${times.map((x) => x.toFixed(0)).join(', ')})`);
    }
    // eslint-disable-next-line no-console
    console.log(`\n${lines.join('\n')}\n`);
  }, 300_000);
});
