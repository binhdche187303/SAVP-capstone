import type { TimeRange } from './kpi-window.types.js';

/** Gom tham số `$n` khi ghép SQL động (SEC-03: giá trị luôn bind, không nội suy). */
export class SqlParams {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** `column` PHẢI là hằng trong code (không lấy từ input). */
export function rangeClause(
  column: string,
  ranges: TimeRange[],
  p: SqlParams,
): string {
  const parts = ranges.map(
    (r) =>
      `(${column} >= ${p.add(r.from)} AND ${column} ${r.toInclusive ? '<=' : '<'} ${p.add(r.to)})`,
  );
  return parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`;
}
