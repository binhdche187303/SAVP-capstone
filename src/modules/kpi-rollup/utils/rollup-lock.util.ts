import type { QueryRunner } from 'typeorm';
import { KPI_ROLLUP_LOCK_CLASSID } from '../kpi-rollup.constants.js';

/**
 * Advisory lock theo transaction (tự nhả khi commit/rollback). Không phụ thuộc Redis.
 * blocking=false (cron): instance khác đang chạy ⇒ trả false để bỏ lượt.
 * blocking=true (backfill): chờ tới khi lấy được.
 */
export async function acquireRollupLock(
  qr: QueryRunner,
  blocking: boolean,
): Promise<boolean> {
  if (blocking) {
    await qr.query(
      `SELECT pg_advisory_xact_lock(${KPI_ROLLUP_LOCK_CLASSID}, hashtext('kpi_rollup'))`,
    );
    return true;
  }
  const rows = (await qr.query(
    `SELECT pg_try_advisory_xact_lock(${KPI_ROLLUP_LOCK_CLASSID}, hashtext('kpi_rollup')) AS ok`,
  )) as Array<{ ok: boolean }>;
  return rows?.[0]?.ok === true;
}
