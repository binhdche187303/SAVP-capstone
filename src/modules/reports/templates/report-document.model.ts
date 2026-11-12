import { reportBadRequest } from '../center/report-center.errors.js';
import type { CellFormat, ReportModel, ReportTable } from '../center/report-model.js';

/**
 * Văn bản quy chuẩn dựng từ dữ liệu một trang khác (Nhật ký ra/vào phòng, Truy vết camera, Hành trình, Lưu lượng…)
 * gửi lên `POST /report-templates/render-document`. Trang đã lọc + tổng hợp sẵn; BE chỉ trình bày theo mẫu.
 *
 * Body `document`:
 * ```
 * { title, period: { from, to }, filterLines?: string[], dataSource?,
 *   kpis?: [{ label, value: number | string, unit? }], notes?: string[],
 *   tables?: [{ title, columns: [{ key, label, format? }], rows: [{ [key]: string | number | null }] }] }
 * ```
 */

export const DOCUMENT_LIMITS = { tables: 10, columns: 40, rows: 20_000, kpis: 40, notes: 20, filterLines: 30, cell: 2_000 } as const;

const FORMATS: CellFormat[] = ['text', 'number', 'percent', 'hours', 'minutes', 'duration', 'datetime'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[A-Za-z0-9_.-]{1,60}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown, field: string, max: number, required = false): string {
  if (v === undefined || v === null || v === '') {
    if (required) throw reportBadRequest(`Thiếu ${field}`);
    return '';
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw reportBadRequest(`${field} không hợp lệ`);
  const s = String(v).trim();
  if (s.length > max) throw reportBadRequest(`${field} tối đa ${max} ký tự`);
  return s;
}

function list(v: unknown, field: string, max: number): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw reportBadRequest(`${field} phải là danh sách`);
  if (v.length > max) throw reportBadRequest(`${field} tối đa ${max} mục`);
  return v;
}

function cellValue(v: unknown, format: CellFormat, field: string): unknown {
  if (v === undefined || v === null || v === '') return null;
  if (format === 'datetime') {
    if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw reportBadRequest(`${field}: thời điểm không hợp lệ`);
    return v;
  }
  if (format !== 'text') {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) throw reportBadRequest(`${field}: giá trị số không hợp lệ`);
    return n;
  }
  if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw reportBadRequest(`${field} không hợp lệ`);
  const s = String(v);
  return s.length > DOCUMENT_LIMITS.cell ? `${s.slice(0, DOCUMENT_LIMITS.cell - 1)}…` : s;
}

function table(raw: unknown, i: number, budget: { rows: number }): ReportTable {
  const field = `Bảng ${i + 1}`;
  if (!isObj(raw)) throw reportBadRequest(`${field} không hợp lệ`);
  const title = str(raw['title'], `Tên ${field.toLowerCase()}`, 200, true);
  const columns = list(raw['columns'], `Cột của ${field.toLowerCase()}`, DOCUMENT_LIMITS.columns).map((c, ci) => {
    if (!isObj(c)) throw reportBadRequest(`${field}: cột ${ci + 1} không hợp lệ`);
    const key = String(c['key'] ?? '');
    if (!KEY.test(key)) throw reportBadRequest(`${field}: mã cột ${ci + 1} không hợp lệ`);
    const format = (c['format'] ?? 'text') as CellFormat;
    if (!FORMATS.includes(format)) throw reportBadRequest(`${field}: định dạng cột "${key}" không hợp lệ`);
    return { key, label: str(c['label'], `${field}: tên cột ${ci + 1}`, 120, true), format };
  });
  if (!columns.length) throw reportBadRequest(`${field} chưa có cột`);
  if (new Set(columns.map((c) => c.key)).size !== columns.length) throw reportBadRequest(`${field}: mã cột bị trùng`);

  const rawRows = raw['rows'] ?? [];
  if (!Array.isArray(rawRows)) throw reportBadRequest(`Dòng của ${field.toLowerCase()} phải là danh sách`);
  budget.rows -= rawRows.length;
  if (budget.rows < 0) throw reportBadRequest(`Văn bản tối đa ${DOCUMENT_LIMITS.rows.toLocaleString('vi-VN')} dòng dữ liệu — hãy thu hẹp bộ lọc`, 'DOCUMENT_TOO_LARGE');
  const rows = rawRows.map((r, ri) => {
    if (!isObj(r)) throw reportBadRequest(`${field}: dòng ${ri + 1} không hợp lệ`);
    const out: Record<string, unknown> = {};
    for (const c of columns) out[c.key] = cellValue(r[c.key], c.format, `${field}, dòng ${ri + 1}, cột "${c.label}"`);
    return out;
  });
  return { title, columns, rows };
}

export function documentModel(raw: unknown): ReportModel {
  if (!isObj(raw)) throw reportBadRequest('Thiếu nội dung văn bản');
  const title = str(raw['title'], 'Tên báo cáo', 200, true);
  const period = isObj(raw['period']) ? raw['period'] : {};
  const from = String(period['from'] ?? '');
  const to = String(period['to'] ?? '');
  if (!YMD.test(from) || !YMD.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    throw reportBadRequest('Kỳ báo cáo không hợp lệ (YYYY-MM-DD)');
  }
  if (from > to) throw reportBadRequest('Ngày bắt đầu phải trước ngày kết thúc');

  const kpis = list(raw['kpis'], 'Chỉ tiêu', DOCUMENT_LIMITS.kpis).map((k, i): ReportModel['kpis'][number] => {
    if (!isObj(k)) throw reportBadRequest(`Chỉ tiêu ${i + 1} không hợp lệ`);
    const label = str(k['label'], `Tên chỉ tiêu ${i + 1}`, 200, true);
    const unit = str(k['unit'], `Đơn vị chỉ tiêu ${i + 1}`, 30);
    const v = k['value'];
    if (typeof v === 'number' && Number.isFinite(v)) return { key: `k${i}`, label, value: v, format: 'number', unit };
    return { key: `k${i}`, label, value: null, format: 'text', unit, display: str(v, `Giá trị chỉ tiêu ${i + 1}`, 200) || '—' };
  });

  const budget = { rows: DOCUMENT_LIMITS.rows };
  const tables = list(raw['tables'], 'Bảng', DOCUMENT_LIMITS.tables).map((t, i) => table(t, i, budget));

  return {
    type: 'document',
    title,
    period: { from, to },
    filterLines: list(raw['filterLines'], 'Điều kiện lọc', DOCUMENT_LIMITS.filterLines).map((x, i) => str(x, `Điều kiện lọc ${i + 1}`, 300)).filter(Boolean),
    kpis,
    charts: [],
    columns: tables[0]?.columns ?? [],
    rows: tables[0]?.rows ?? [],
    total: tables.reduce((n, t) => n + t.rows.length, 0),
    notes: list(raw['notes'], 'Ghi chú', DOCUMENT_LIMITS.notes).map((x, i) => str(x, `Ghi chú ${i + 1}`, 1_000)).filter(Boolean),
    dataSource: str(raw['dataSource'], 'Nguồn dữ liệu', 300) || undefined,
    tables,
  };
}
