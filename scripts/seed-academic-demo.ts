import { AppDataSource } from '../src/database/data-source.js';
import { seedAcademicDemo } from './academic-demo/seed-academic-demo.js';

/**
 * Nạp dữ liệu DEMO Học vụ (ACD-001 R11). Idempotent, 1 transaction.
 * Yêu cầu: đã chạy migration CreateAcademicTables + SeedStudyShifts.
 * Thực thi: npx tsx scripts/seed-academic-demo.ts
 */
async function main(): Promise<void> {
  await AppDataSource.initialize();
  const runner = AppDataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await seedAcademicDemo(runner);
    await runner.commitTransaction();
    console.log(
      '✅ Đã nạp demo Học vụ: FA26, 3 môn, 10 SV (HE180001..10), 2 lớp, 8 buổi học.',
    );
    console.log(
      '   Tài khoản SV: he180001..he180010 / GV: gv.demo — mật khẩu Abcd1234@',
    );
  } catch (err) {
    await runner.rollbackTransaction();
    throw err;
  } finally {
    await runner.release();
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
