import type { ReportPage } from '../report-model.js';

const VN_OFFSET_MS = 7 * 3_600_000;

/** Đầu ngày `ymd` (giờ VN) và đầu ngày kế tiếp, dạng Date. */
export const vnDayStart = (ymd: string): Date => new Date(Date.parse(`${ymd}T00:00:00Z`) - VN_OFFSET_MS);
export const vnDayEnd = (ymd: string): Date => new Date(vnDayStart(ymd).getTime() + 86_400_000 - 1);

/** "dd/mm" theo giờ Việt Nam — nhãn trục ngày của biểu đồ. */
export const vnDayLabel = (value: Date): string => {
  const d = new Date(value.getTime() + VN_OFFSET_MS);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export const vnDayKey = (value: Date): string => new Date(value.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

const normalize = (v: unknown): string => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const compare = (a: unknown, b: unknown): number => {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '' ? 0 : 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return normalize(a).localeCompare(normalize(b), 'vi');
};

/** Lọc `q` (không dấu, không phân biệt hoa thường) trên các khóa chữ, sắp xếp, phân trang trong bộ nhớ. */
export function pageRows<T extends Record<string, unknown>>(rows: T[], page: ReportPage | null, q: string | undefined, textKeys: string[]): { rows: T[]; total: number } {
  let list = rows;
  const needle = normalize(q).trim();
  if (needle) list = list.filter((r) => textKeys.some((k) => normalize(r[k]).includes(needle)));
  if (page?.sortKey) {
    const dir = page.sortDir === 'desc' ? -1 : 1;
    const key = page.sortKey;
    list = [...list].sort((a, b) => compare(a[key], b[key]) * dir);
  }
  const total = list.length;
  if (!page) return { rows: list, total };
  return { rows: list.slice((page.page - 1) * page.limit, page.page * page.limit), total };
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const pct = (part: number, whole: number): number => (whole > 0 ? round1((part / whole) * 100) : 0);
