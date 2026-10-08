import { AppDataSource } from '../src/database/data-source.js';

/**
 * Revert migration MỚI NHẤT bằng `tsx` (CLI `npm run migration:revert` hỏng cùng lý do với
 * migration:run — xem scripts/run-migrations.ts). Chạy N lần để revert N migration.
 * Thực thi: npx tsx scripts/revert-migration.ts
 */
async function main(): Promise<void> {
  AppDataSource.setOptions({ migrationsTransactionMode: 'each' });
  await AppDataSource.initialize();
  await AppDataSource.undoLastMigration();
  console.log('Reverted last migration.');
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
