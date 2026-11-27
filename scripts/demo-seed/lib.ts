import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { AppDataSource } from '../../src/database/data-source';

dotenv.config();

/**
 * Lõi seed dữ liệu demo — MỌI dòng demo được ghi vào bảng `demo_seed_rows` (do script tự tạo,
 * KHÔNG phải migration) để `purge` xoá đúng những dòng đó + các dòng server sinh ra trỏ tới chúng.
 */

export const REGISTRY = 'demo_seed_rows';

export const db = AppDataSource;

export async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  // logger phải tạo lại thì logging:false mới có hiệu lực (TypeORM chỉ rebuild khi có logger)
  AppDataSource.setOptions({ logging: false, logger: 'advanced-console' });
  await AppDataSource.initialize();
  try {
    return await fn();
  } finally {
    await AppDataSource.destroy();
  }
}

export async function ensureRegistry(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${REGISTRY} (
      seq bigserial PRIMARY KEY,
      part varchar(20) NOT NULL,
      table_name varchar(100) NOT NULL,
      row_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
}

export async function partSeeded(part: string): Promise<boolean> {
  const [row]: Array<{ n: string }> = await db.query(
    `SELECT count(*) AS n FROM ${REGISTRY} WHERE part = $1`,
    [part],
  );
  return Number(row.n) > 0;
}

type Row = Record<string, unknown>;

/**
 * INSERT nhiều dòng (chia lô 500) + ghi vào registry. Trả về id theo đúng thứ tự `rows`.
 * Giá trị object/array được stringify (cột jsonb).
 */
export async function insertTracked(
  part: string,
  table: string,
  rows: Row[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  const cols = Object.keys(rows[0]);
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const params: unknown[] = [];
    const values = chunk
      .map((r) => {
        const ph = cols.map((c) => {
          const v = r[c];
          params.push(
            v !== null && typeof v === 'object' && !(v instanceof Date)
              ? JSON.stringify(v)
              : v,
          );
          return `$${params.length}`;
        });
        return `(${ph.join(',')})`;
      })
      .join(',');
    const inserted: Array<{ id: string }> = await db.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${values} RETURNING id`,
      params,
    );
    const chunkIds = inserted.map((x) => x.id);
    await db.query(
      `INSERT INTO ${REGISTRY} (part, table_name, row_id)
       SELECT $1, $2, unnest($3::uuid[])`,
      [part, table, chunkIds],
    );
    ids.push(...chunkIds);
  }
  return ids;
}

/** Id các dòng demo của 1 bảng (để phần sau dùng lại dữ liệu nền). */
export async function trackedIds(table: string): Promise<string[]> {
  const rows: Array<{ row_id: string }> = await db.query(
    `SELECT row_id FROM ${REGISTRY} WHERE table_name = $1 ORDER BY seq`,
    [table],
  );
  return rows.map((r) => r.row_id);
}

interface FkRef {
  table: string;
  column: string;
  nullable: boolean;
}

const fkCache = new Map<string, FkRef[]>();

/** Các cột (bảng khác) có FK trỏ tới `table.id`. */
async function referencing(table: string): Promise<FkRef[]> {
  const cached = fkCache.get(table);
  if (cached) return cached;
  const rows: Array<{ tbl: string; col: string; nullable: string }> =
    await db.query(
      `SELECT kcu.table_name AS tbl, kcu.column_name AS col, c.is_nullable AS nullable
       FROM information_schema.referential_constraints rc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = rc.constraint_name AND kcu.constraint_schema = rc.constraint_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = rc.unique_constraint_name AND ccu.constraint_schema = rc.unique_constraint_schema
       JOIN information_schema.columns c
         ON c.table_name = kcu.table_name AND c.column_name = kcu.column_name AND c.table_schema = kcu.table_schema
       WHERE ccu.table_name = $1 AND ccu.column_name = 'id' AND kcu.table_schema = 'public'`,
      [table],
    );
  const refs = rows.map((r) => ({
    table: r.tbl,
    column: r.col,
    nullable: r.nullable === 'YES',
  }));
  fkCache.set(table, refs);
  return refs;
}

const idCache = new Map<string, boolean>();

/** Bảng tổng hợp (vd kpi_zone_hourly) không có cột id → xoá thẳng theo FK. */
async function hasIdColumn(table: string): Promise<boolean> {
  const cached = idCache.get(table);
  if (cached !== undefined) return cached;
  const [row]: Array<{ n: string }> = await db.query(
    `SELECT count(*) AS n FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id'`,
    [table],
  );
  const has = Number(row.n) > 0;
  idCache.set(table, has);
  return has;
}

/**
 * Xoá dòng + mọi dòng trỏ tới nó (đệ quy). Cột FK nullable → gán NULL (dòng thật trỏ tới
 * dữ liệu demo chỉ mất liên kết, không bị xoá); NOT NULL → xoá luôn dòng đó.
 */
export async function deleteCascade(
  table: string,
  ids: string[],
  log: (msg: string) => void,
  depth = 0,
): Promise<void> {
  if (ids.length === 0 || depth > 8) return;
  for (const ref of await referencing(table)) {
    if (ref.nullable) {
      try {
        await db.query(
          `UPDATE ${ref.table} SET ${ref.column} = NULL WHERE ${ref.column} = ANY($1::uuid[])`,
          [ids],
        );
        continue;
      } catch (e) {
        // Gán NULL vi phạm unique (vd security_alerts mở theo zone → trùng khoá "toàn cục")
        // → các dòng này gắn với dữ liệu demo, xoá luôn như FK NOT NULL
        if (
          (e as { driverError?: { code?: string } }).driverError?.code !==
          '23505'
        )
          throw e;
      }
    }
    if (!(await hasIdColumn(ref.table))) {
      await db.query(
        `DELETE FROM ${ref.table} WHERE ${ref.column} = ANY($1::uuid[])`,
        [ids],
      );
      continue;
    }
    const child: Array<{ id: string }> = await db.query(
      `SELECT id FROM ${ref.table} WHERE ${ref.column} = ANY($1::uuid[])`,
      [ids],
    );
    if (child.length > 0) {
      log(`    ↳ ${ref.table}: ${child.length} dòng liên quan`);
      await deleteCascade(
        ref.table,
        child.map((c) => c.id),
        log,
        depth + 1,
      );
    }
  }
  await db.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
}

export const pick = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

export const randInt = (min: number, max: number): number =>
  min + Math.floor(Math.random() * (max - min + 1));
