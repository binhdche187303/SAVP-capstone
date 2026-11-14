import type { BodyBlock, ReportTemplateLayout, ResolvedSignature } from '../../../templates/report-template.layout.js';
import { fillText } from '../../../templates/report-template.layout.js';
import { formatCell, formatDateTimeVn } from '../../report-format.util.js';
import type { CellFormat, ReportModel, ReportTable, ReportType } from '../../report-model.js';
import type { ReportRenderMeta } from '../report-render.common.js';

/**
 * Dữ liệu dùng chung cho 3 bộ dựng "bản quy chuẩn" (Word / Excel / PDF), để ba định dạng ra cùng chữ, cùng thứ tự.
 * Thể thức theo NĐ 30/2020/NĐ-CP — xem docs/mau-bao-cao/README.md ở repo gốc.
 */

export interface StandardRenderInput {
  layout: ReportTemplateLayout;
  /** mediaFileId → bytes ảnh (logo, logo nền). Ảnh thiếu thì bỏ qua. */
  assets: Record<string, Buffer>;
  signatures: ResolvedSignature[];
}

/** Đơn vị tính của chỉ tiêu. Để ở đây thay vì registry vì registry phải trùng snapshot FE. */
const KPI_UNITS: Partial<Record<ReportType, Record<string, string>>> = {
  'staff-attendance': { lateCount: 'lượt', earlyLeaveCount: 'lượt', absentDays: 'ngày' },
  'student-attendance': { sessionCount: 'buổi', absentCount: 'lượt', lateCount: 'lượt', atRiskStudents: 'sinh viên' },
  'gate-access': { entries: 'lượt', exits: 'lượt', onSite: 'người' },
  'room-utilization': { meetingCount: 'cuộc' },
  vehicle: { total: 'lượt', cars: 'lượt', motorbikes: 'lượt', unregistered: 'lượt', watchlist: 'lượt' },
  visitor: { totalVisits: 'lượt', uniqueVisitors: 'người', overstayCount: 'lượt' },
  'security-alert': { total: 'sự kiện', critical: 'sự kiện', resolved: 'sự kiện' },
};
const FORMAT_UNITS: Partial<Record<CellFormat, string>> = { percent: '%', hours: 'giờ', minutes: 'phút', duration: 'giờ:phút' };

const DATA_SOURCES: Partial<Record<ReportModel['type'], string>> = {
  'staff-attendance': 'Hệ thống VISMA (chấm công bằng nhận diện khuôn mặt)',
  'student-attendance': 'Hệ thống VISMA (điểm danh buổi học bằng nhận diện khuôn mặt)',
  'gate-access': 'Hệ thống VISMA (camera nhận diện khuôn mặt và đầu đọc biển số tại các cổng)',
  'room-utilization': 'Hệ thống VISMA (lịch đặt phòng và ghi nhận sử dụng phòng họp)',
  vehicle: 'Hệ thống VISMA (camera nhận diện biển số tại các cổng)',
  visitor: 'Hệ thống VISMA (đăng ký và ghi nhận khách tại cổng)',
  'security-alert': 'Hệ thống VISMA (cảnh báo từ camera và thiết bị an ninh)',
};

const VN_OFFSET_MS = 7 * 3_600_000;
const pad = (n: number): string => String(n).padStart(2, '0');
export const ymdVn = (ymd: string): string => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
export const grouped = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const oneDecimal = (n: number): string => String(Math.round(n * 10) / 10).replace('.', ',');

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export interface StandardKpi { label: string; unit: string; value: number | null; text: string; format: CellFormat }
export interface StandardSection { block: BodyBlock; heading: string }

export interface StandardContext {
  model: ReportModel;
  layout: ReportTemplateLayout;
  assets: Record<string, Buffer>;
  signatures: ResolvedSignature[];
  /** Trích yếu (dòng dưới "BÁO CÁO"). */
  subject: string;
  /** "từ ngày 02/11/2026 đến ngày 08/11/2026" */
  periodText: string;
  /** "Thành phố Hồ Chí Minh, ngày 12 tháng 11 năm 2026" — NĐ30: ngày < 10, tháng 1–2 thêm số 0. */
  dateLine: string;
  /** "12/11/2026" để in trong phụ lục Excel. */
  dateShort: string;
  /** "ngày 12 tháng 11 năm 2026" */
  dateWords: string;
  /** "Số:       /BC-ĐHKTL-HC" */
  docNo: string;
  /** "/BC-ĐHKTL-HC" */
  docRef: string;
  provenance: string;
  generatedText: string;
  generatedBy: string;
  filterText: string;
  dataSource: string;
  kpis: StandardKpi[];
  sections: StandardSection[];
  fill: (text: string) => string;
  logo: Buffer | null;
  watermark: Buffer | null;
  showAppendix: boolean;
  /** Các bảng phụ lục — mặc định một bảng từ `model.columns` / `model.rows`. */
  tables: ReportTable[];
  /** Có ít nhất một dòng dữ liệu trong các bảng phụ lục. */
  hasRows: boolean;
  /** Tổng số dòng của các bảng phụ lục (bảng đơn dùng `model.total`). */
  rowCount: number;
  /** In câu "không có dữ liệu" ở mục kết quả: không có dòng nào (văn bản tự dựng còn chỉ tiêu thì thôi). */
  isEmpty: boolean;
  /** Câu dẫn xuống phụ lục, null khi không có phụ lục. */
  appendixLead: string | null;
}

export function kpiUnit(type: ReportModel['type'], key: string, format: CellFormat): string {
  return KPI_UNITS[type as ReportType]?.[key] ?? FORMAT_UNITS[format] ?? '';
}

/** Giá trị KPI không kèm đơn vị (đơn vị nằm ở cột riêng). */
export function kpiText(value: number | null, format: CellFormat): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  switch (format) {
    case 'percent': case 'hours': return oneDecimal(n);
    case 'minutes': return grouped(n);
    case 'duration': { const m = Math.round(n / 60); return `${Math.floor(m / 60)}:${pad(m % 60)}`; }
    case 'number': return grouped(n);
    default: return formatCell(value, format);
  }
}

const lowerFirst = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function buildStandardContext(model: ReportModel, meta: ReportRenderMeta, input: StandardRenderInput): StandardContext {
  const { layout } = input;
  const h = layout.header;
  const vn = new Date(meta.generatedAt.getTime() + VN_OFFSET_MS);
  const dd = pad(vn.getUTCDate());
  const month = vn.getUTCMonth() + 1;
  const mmText = month < 3 ? pad(month) : String(month);
  const year = vn.getUTCFullYear();
  const dateWords = `ngày ${dd} tháng ${mmText} năm ${year}`;
  const code = ['BC', h.agencyShort, h.unitCode].filter(Boolean).join('-');
  const subject = layout.title.subject || model.title;
  const periodText = `từ ngày ${ymdVn(model.period.from)} đến ngày ${ymdVn(model.period.to)}`;
  const vars = { title: lowerFirst(subject), period: periodText, unit: h.unitName || h.agency };
  const generatedBy = meta.generatedByName ? `${meta.generatedByName} (${meta.generatedByEmail})` : meta.generatedByEmail;

  const tables: ReportTable[] = model.tables?.length
    ? model.tables
    : [{ title: model.title, columns: model.columns, rows: model.rows }];
  const rowCount = model.tables?.length ? tables.reduce((sum, t) => sum + t.rows.length, 0) : model.total;
  const hasRows = tables.some((t) => t.rows.length > 0);

  let n = 0;
  const sections = layout.body
    .filter((b) => b.enabled)
    .map((block) => ({ block, heading: block.kind === 'opening' ? '' : `${ROMAN[n++] ?? String(n)}. ${block.title.toUpperCase()}` }));

  return {
    model,
    layout,
    assets: input.assets,
    signatures: input.signatures,
    subject,
    periodText,
    dateLine: `${h.place}, ${dateWords}`,
    dateShort: `${dd}/${pad(month)}/${year}`,
    dateWords,
    docNo: `Số:       /${code}`,
    docRef: `/${code}`,
    provenance: `Báo cáo được trích xuất tự động từ Hệ thống VISMA lúc ${formatDateTimeVn(meta.generatedAt)} bởi ${meta.generatedByEmail}`,
    generatedText: formatDateTimeVn(meta.generatedAt),
    generatedBy,
    filterText: model.filterLines.length ? model.filterLines.join('; ') : 'Toàn bộ dữ liệu trong phạm vi được phân quyền',
    dataSource: model.dataSource || DATA_SOURCES[model.type] || 'Hệ thống VISMA',
    kpis: model.kpis.map((k) => ({
      label: k.label,
      unit: k.unit ?? kpiUnit(model.type, k.key, k.format),
      value: k.value,
      text: k.display ?? kpiText(k.value, k.format),
      format: k.format,
    })),
    sections,
    fill: (text: string) => fillText(text, vars),
    logo: (layout.logo.enabled && layout.logo.mediaFileId && input.assets[layout.logo.mediaFileId]) || null,
    watermark: (layout.watermark.enabled && layout.watermark.mediaFileId && input.assets[layout.watermark.mediaFileId]) || null,
    showAppendix: layout.appendix.enabled,
    tables,
    hasRows,
    rowCount,
    isEmpty: !hasRows && (model.type !== 'document' || model.kpis.length === 0),
    appendixLead: !hasRows || !layout.appendix.enabled
      ? null
      : tables.length > 1 ? 'Chi tiết số liệu được thể hiện tại Phụ lục kèm theo Báo cáo này.'
        : `Chi tiết ${grouped(rowCount)} bản ghi được thể hiện tại Phụ lục kèm theo Báo cáo này.`,
  };
}

/** Tách chữ có biến cơ quan thành 3 đoạn [trước, gạch chân, sau] để in tên trường như văn bản thật. */
export function agencyParts(agency: string, underline: string): [string, string, string] {
  if (!underline) return ['', agency, ''];
  const i = agency.indexOf(underline);
  if (i < 0) return ['', agency, ''];
  return [agency.slice(0, i), underline, agency.slice(i + underline.length)];
}

/** Bề rộng tương đối của cột phụ lục theo định dạng / tên cột. */
const WIDE_KEYS = /name|organization|subject|purpose|department|classSection|owner|handler/i;
export function columnWeight(c: { key: string; format: CellFormat }): number {
  if (c.format === 'datetime') return 1.7;
  if (c.format === 'text') return WIDE_KEYS.test(c.key) ? 2.3 : 1.4;
  return 1.1;
}

/** Ô phụ lục dạng chuỗi (Word/PDF). Thời lượng ghi "X giờ YY phút" như mẫu đã duyệt. */
export function appendixText(value: unknown, format: CellFormat): string {
  if (format === 'duration') {
    if (value === null || value === undefined || value === '') return '—';
    const m = Math.round(Number(value) / 60);
    const hh = Math.floor(m / 60);
    return hh ? `${hh} giờ ${pad(m % 60)} phút` : `${m} phút`;
  }
  return formatCell(value, format);
}

/** Kích thước ảnh PNG/JPEG (px) đọc từ header, để giữ đúng tỉ lệ. */
export function imageSize(b: Buffer): { width: number; height: number; type: 'png' | 'jpg' } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), type: 'png' };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      // SOF0..SOF15 trừ DHT(C4), JPG(C8), DAC(CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7), type: 'jpg' };
      }
      i += 2 + len;
    }
  }
  return null;
}
