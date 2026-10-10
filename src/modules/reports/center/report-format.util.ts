import type { CellFormat } from './report-model.js';

// Định dạng ô dùng chung cho PDF/Word (chuỗi) và Excel (giá trị thật). Chuỗi trùng `src/utils/reportFormat.js` của FE.
// Giờ Việt Nam là UTC+7 cố định (không có giờ mùa hè) nên cộng offset thay vì phụ thuộc TZ của máy chủ.

const EMPTY = '—';
const VN_OFFSET_MS = 7 * 3_600_000;
const pad = (n: number): string => String(n).padStart(2, '0');
const isEmpty = (v: unknown): boolean => v === null || v === undefined || v === '';
const grouped = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const oneDecimal = (n: number): string => String(Math.round(Number(n) * 10) / 10).replace('.', ',');

/** Dời một thời điểm sang "giờ tường" Việt Nam, đọc bằng getter UTC. */
const toVn = (value: unknown): Date | null => {
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + VN_OFFSET_MS);
};

export const formatDateTimeVn = (value: unknown): string => {
  if (isEmpty(value)) return EMPTY;
  const d = toVn(value);
  if (!d) return EMPTY;
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

export const formatDuration = (seconds: unknown): string => {
  if (isEmpty(seconds)) return EMPTY;
  const minutes = Math.round(Number(seconds) / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}g ${minutes % 60}p` : `${minutes}p`;
};

export const formatCell = (value: unknown, format: CellFormat = 'text'): string => {
  if (format === 'datetime') return formatDateTimeVn(value);
  if (format === 'duration') return formatDuration(value);
  if (isEmpty(value)) return EMPTY;
  switch (format) {
    case 'number': return grouped(Number(value));
    case 'percent': return `${oneDecimal(Number(value))}%`;
    case 'hours': return `${oneDecimal(Number(value))} giờ`;
    case 'minutes': return `${Math.round(Number(value))} phút`;
    default: return String(value);
  }
};

/**
 * Giá trị cho ô Excel: số là số, ngày giờ là `Date`. `Date` được dời +7 giờ để Excel (đọc UTC) hiển thị đúng giờ Việt Nam.
 * `duration` giữ nguyên số giây; ô rỗng → null.
 */
export const toExcelValue = (value: unknown, format: CellFormat = 'text'): string | number | Date | null => {
  if (isEmpty(value)) return null;
  switch (format) {
    case 'datetime': return toVn(value);
    case 'number': case 'percent': case 'hours': case 'minutes': case 'duration': {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    default: return String(value);
  }
};
