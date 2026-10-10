import { DataSource } from 'typeorm';
import type { ReportDefinition, ReportFilters } from './report-model.js';

const LOOKUP_SQL: Record<string, { sql: string; label?: (v: string) => string }> = {
  departments: { sql: `SELECT department_name AS name FROM departments WHERE id = $1` },
  staff: { sql: `SELECT full_name AS name FROM users WHERE id = $1` },
  zones: { sql: `SELECT zone_name AS name FROM zones WHERE id = $1` },
  gates: { sql: `SELECT zone_name AS name FROM zones WHERE id = $1` },
  rooms: { sql: `SELECT room_name AS name FROM rooms WHERE id = $1` },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Đơn vị: Khoa CNTT" cho đầu trang file xuất; tên tra từ DB, không tra được thì giữ nguyên giá trị. */
export async function describeFilters(ds: Pick<DataSource, 'query'>, definition: ReportDefinition, filters: ReportFilters): Promise<string[]> {
  const lines: string[] = [];
  for (const f of definition.filters) {
    const value = filters[f.key];
    if (!value) continue;
    let text = value;
    if (f.options) text = f.options.find((o) => o.value === value)?.label ?? value;
    else if (f.lookup === 'buildings') text = `Tòa ${value}`;
    else if (f.lookup && LOOKUP_SQL[f.lookup] && UUID.test(value)) {
      const rows: Array<{ name: string }> = await ds.query(LOOKUP_SQL[f.lookup].sql, [value]);
      text = rows[0]?.name ?? value;
    }
    lines.push(`${f.label}: ${text}`);
  }
  if (filters.q) lines.push(`Từ khóa: ${filters.q}`);
  return lines;
}
