import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { toExcelValue } from '../../report-format.util.js';
import type { CellFormat, ReportModel, ReportTable } from '../../report-model.js';
import { EMPTY_TEXT, type ReportRenderMeta } from '../report-render.common.js';
import { fadePng } from './png-fade.js';
import {
  agencyParts, buildStandardContext, grouped, imageSize, ymdVn,
  type StandardContext, type StandardRenderInput,
} from './standard-context.js';

const FONT = 'Times New Roman';
const HEAD_FILL = 'FFDCE6F2';
const PX_PER_MM = 96 / 25.4;

type FontOpts = { size?: number; bold?: boolean; italic?: boolean; u?: boolean };
const xf = (o: FontOpts = {}): Partial<ExcelJS.Font> => ({ name: FONT, size: o.size ?? 12, bold: o.bold, italic: o.italic, underline: o.u || undefined });
const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF000000' } };
const dotted: Partial<ExcelJS.Border> = { style: 'dotted', color: { argb: 'FF808080' } };
const box: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

// Sheet "Báo cáo": A = lề/logo, B = STT, C = chỉ tiêu, D = ĐVT, E = kết quả, F = ghi chú (đã duyệt ở mẫu).
const SUMMARY_COLS: Record<string, number> = { A: 8, B: 7, C: 38, D: 12, E: 16, F: 22 };
const spanWidth = (from: string, to: string): number =>
  Object.entries(SUMMARY_COLS).filter(([k]) => k >= from && k <= to).reduce((s, [, w]) => s + w, 0);

const colLetter = (n: number): string => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

/** Giây → phần ngày của Excel, làm tròn tới phút để khớp cách ghi "x giờ yy phút" ở bản Word / PDF. */
const wholeMinutes = (seconds: number): number => Math.round(seconds / 60) / 1440;

function put(ws: ExcelJS.Worksheet, range: string, value: ExcelJS.CellValue, font?: Partial<ExcelJS.Font>, align: Partial<ExcelJS.Alignment> = {}): ExcelJS.Cell {
  if (range.includes(':')) ws.mergeCells(range);
  const c = ws.getCell(range.split(':')[0]);
  c.value = value;
  if (font) c.font = font;
  c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true, ...align };
  return c;
}

/**
 * Excel không tự giãn dòng cho ô gộp → ước lượng số dòng theo bề rộng cột.
 * Đo trên Excel: Times 12pt ≈ 1,08 ký tự / đơn vị bề rộng cột (đơn vị tính theo font Calibri mặc định);
 * lấy 1,05 cho an toàn; chữ in hoa đậm rộng hơn (`wide`). Thừa một chút còn hơn bị cắt chữ.
 */
function fitHeight(ws: ExcelJS.Worksheet, row: number, text: string, widthChars: number, size = 12, wide = 1): void {
  const perLine = Math.max(8, (widthChars * 1.05 * 12) / size / wide);
  const lines = text.split('\n').reduce((n, s) => n + Math.max(1, Math.ceil(s.length / perLine)), 0);
  const h = Math.max(lines * size * 1.32 + 5, 18);
  const r = ws.getRow(row);
  if (!r.height || r.height < h) r.height = h;
}

const NUM_FMT: Partial<Record<CellFormat, string>> = { number: '#,##0', percent: '0.0', hours: '0.0', minutes: '#,##0', duration: '[h]:mm' };
/** Giá trị KPI dạng số để Excel còn tính được; đơn vị nằm ở cột ĐVT. */
function kpiCell(c: ExcelJS.Cell, k: { value: number | null; format: CellFormat; text: string }): void {
  const { value, format } = k;
  // Chỉ tiêu dạng chữ (văn bản tự dựng) hoặc không có số liệu → ghi nguyên chữ hiển thị ('—' khi trống).
  if (value === null || value === undefined || Number.isNaN(Number(value))) { c.value = k.text || '—'; return; }
  c.value = format === 'duration' ? wholeMinutes(Number(value)) : Number(value);
  if (NUM_FMT[format]) c.numFmt = NUM_FMT[format] as string;
}

const hfEscape = (s: string): string => s.replace(/&/g, '&&');

function footerText(ctx: StandardContext): string {
  const right = '&R&"Times New Roman"&9Trang &P';
  return ctx.layout.footer.provenance ? `&L&"Times New Roman,Italic"&8${hfEscape(ctx.provenance)}${right}` : right;
}

function addImage(wb: ExcelJS.Workbook, data: Buffer): { id: number; w: number; h: number } | null {
  const info = imageSize(data);
  if (!info || !info.width || !info.height) return null;
  const id = wb.addImage({ buffer: data as unknown as ExcelJS.Buffer, extension: info.type === 'jpg' ? 'jpeg' : 'png' });
  return { id, w: info.width, h: info.height };
}

/** Đầu văn bản: trái B:C (cơ quan, số), phải D:F (quốc hiệu, tiêu ngữ, ngày tháng). Trả về dòng kế tiếp. */
function sheetHeader(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, ctx: StandardContext): number {
  const h = ctx.layout.header;
  let r = 1;
  const logo = ctx.logo ? addImage(wb, ctx.logo) : null;
  const logoPx = ctx.layout.logo.widthMm * PX_PER_MM;
  if (logo && ctx.layout.logo.position === 'above') {
    // Logo đặt trên tên cơ quan, canh giữa vùng B:C (cột B ≈ 54 px, C ≈ 271 px).
    const hPx = (logoPx * logo.h) / logo.w;
    ws.getRow(r).height = hPx * 0.75 + 6;
    const bPx = 54, cPx = 271;
    const off = Math.max(0, (bPx + cPx - logoPx) / 2);
    const col = off < bPx ? 1 + off / bPx : 2 + (off - bPx) / cPx;
    ws.addImage(logo.id, { tl: { col, row: r - 1 + 0.05 }, ext: { width: logoPx, height: hPx }, editAs: 'oneCell' } as unknown as ExcelJS.ImageRange);
    r++;
  }
  const top = r;
  const [a1, a2, a3] = agencyParts(h.agency, h.agencyUnderline);
  const left: Array<[ExcelJS.CellValue, Partial<ExcelJS.Font> | undefined, string]> = [];
  if (h.parentAgency) left.push([h.parentAgency, xf({ size: 12 }), h.parentAgency]);
  left.push([{ richText: [a1 && { text: a1, font: xf({ bold: true }) }, { text: a2, font: xf({ bold: true, u: true }) }, a3 && { text: a3, font: xf({ bold: true }) }].filter(Boolean) as ExcelJS.RichText[] }, undefined, h.agency]);
  left.push([ctx.docNo, xf({ size: 12 }), ctx.docNo]);
  const right: Array<[ExcelJS.CellValue, Partial<ExcelJS.Font>, string]> = [
    ['CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', xf({ bold: true }), 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'],
    ['Độc lập - Tự do - Hạnh phúc', xf({ bold: true, size: 13, u: true }), ''],
    [ctx.dateLine, xf({ italic: true }), ctx.dateLine],
  ];
  // Không có cơ quan chủ quản: số văn bản xuống ngang dòng ngày tháng.
  if (left.length === 2) left.splice(1, 0, ['', undefined, '']);
  const rows = Math.max(left.length, right.length);
  for (let i = 0; i < rows; i++) {
    const row = top + i;
    if (left[i]) { put(ws, `B${row}:C${row}`, left[i][0], left[i][1]); fitHeight(ws, row, left[i][2], spanWidth('B', 'C'), 12, 1.25); }
    if (right[i]) { put(ws, `D${row}:F${row}`, right[i][0], right[i][1]); fitHeight(ws, row, right[i][2], spanWidth('D', 'F'), 12, 1.1); }
  }
  if (logo && ctx.layout.logo.position === 'margin') {
    const w = Math.min(logoPx, 20 * PX_PER_MM);
    ws.addImage(logo.id, { tl: { col: 0.1, row: top - 1 + 0.1 }, ext: { width: w, height: (w * logo.h) / logo.w }, editAs: 'oneCell' } as unknown as ExcelJS.ImageRange);
  }
  return top + rows + 1;
}

function summarySheet(wb: ExcelJS.Workbook, ctx: StandardContext): void {
  const L = ctx.layout;
  const m = ctx.model;
  const s = wb.addWorksheet('Báo cáo', { properties: { defaultRowHeight: 18 }, views: [{ showGridLines: false }] });
  Object.entries(SUMMARY_COLS).forEach(([, w], i) => { s.getColumn(i + 1).width = w; });
  const BODY_W = spanWidth('B', 'F');
  let r = sheetHeader(wb, s, ctx);

  put(s, `A${r}:F${r}`, 'BÁO CÁO', xf({ bold: true, size: 14 })); s.getRow(r).height = 22; r++;
  put(s, `A${r}:F${r}`, ctx.subject, xf({ bold: true, size: 13 })); fitHeight(s, r, ctx.subject, spanWidth('A', 'F'), 13, 1.1); r++;
  put(s, `A${r}:F${r}`, ctx.periodText, xf({ bold: true, size: 13 })); r += 2;
  if (L.addressee.enabled && L.addressee.text) {
    const txt = `Kính gửi: ${ctx.fill(L.addressee.text)}`;
    put(s, `A${r}:F${r}`, txt, xf({ size: 13 })); fitHeight(s, r, txt, spanWidth('A', 'F'), 13); r += 2;
  }

  const para = (text: string, font = xf({ size: 12 })) => {
    const v = `    ${text}`;
    put(s, `B${r}:F${r}`, v, font, { horizontal: 'justify', vertical: 'top' });
    fitHeight(s, r, v, BODY_W, font.size ?? 12);
    r++;
  };
  /** Khoảng cách giữa các nhóm ≈ 6pt như bản Word (dòng trống cao 18pt thì quá thưa). */
  const gap = (h = 9) => { s.getRow(r).height = h; r++; };
  const heading = (txt: string) => { put(s, `B${r}:F${r}`, txt, xf({ bold: true }), { horizontal: 'left' }); s.getRow(r).height = 20; r++; };
  const labelled = (label: string, value: string) => {
    put(s, `B${r}:F${r}`, { richText: [{ text: `    ${label}`, font: xf({ bold: true }) }, { text: value, font: xf() }] }, undefined, { horizontal: 'justify', vertical: 'top' });
    fitHeight(s, r, `    ${label}${value}`, BODY_W);
    r++;
  };

  for (const { block, heading: head } of ctx.sections) {
    switch (block.kind) {
      case 'opening':
        if (block.text) para(ctx.fill(block.text));
        gap();
        break;
      case 'scope':
        heading(head);
        labelled('1. Kỳ báo cáo: ', `từ 00 giờ 00 ngày ${ymdVn(m.period.from)} đến 23 giờ 59 ngày ${ymdVn(m.period.to)}.`);
        labelled('2. Phạm vi dữ liệu: ', `${ctx.filterText}.`);
        labelled('3. Nguồn dữ liệu: ', `${ctx.dataSource}.`);
        labelled('4. Thời điểm trích xuất: ', `${ctx.generatedText}, người trích xuất: ${ctx.generatedBy}.`);
        gap();
        break;
      case 'summary':
        heading(head);
        if (ctx.kpis.length) {
          [['B', 'STT'], ['C', 'Chỉ tiêu'], ['D', 'Đơn vị tính'], ['E', 'Kết quả'], ['F', 'Ghi chú']].forEach(([col, h]) => {
            const c = put(s, `${col}${r}`, h, xf({ bold: true })); c.fill = fill(HEAD_FILL); c.border = box;
          });
          s.getRow(r).height = 22; r++;
          ctx.kpis.forEach((k, i) => {
            const cells: Array<[string, ExcelJS.CellValue, Partial<ExcelJS.Alignment>]> = [['B', i + 1, {}], ['C', k.label, { horizontal: 'left' }], ['D', k.unit, {}], ['E', null, { horizontal: 'right' }], ['F', '', { horizontal: 'left' }]];
            for (const [col, v, al] of cells) {
              const c = put(s, `${col}${r}`, v, xf({ bold: col === 'E' }), al);
              c.border = box;
              if (col === 'E') kpiCell(c, k);
            }
            fitHeight(s, r, k.label, SUMMARY_COLS.C);
            r++;
          });
          gap(6);
        }
        for (const n of m.notes ?? []) {
          put(s, `B${r}:F${r}`, { richText: [{ text: 'Ghi chú: ', font: xf({ bold: true, italic: true, size: 11 }) }, { text: n, font: xf({ italic: true, size: 11 }) }] }, undefined, { horizontal: 'left', vertical: 'top' });
          fitHeight(s, r, `Ghi chú: ${n}`, BODY_W, 11); r++;
        }
        if (ctx.isEmpty) { put(s, `B${r}:F${r}`, `${EMPTY_TEXT}.`, xf({ italic: true }), { horizontal: 'left' }); r++; }
        else if (ctx.appendixLead) {
          const names = appendixSheetNames(ctx);
          const where = names.length > 1 ? `các sheet "${names[0]}" – "${names[names.length - 1]}"` : `sheet "${names[0]}"`;
          put(s, `B${r}:F${r}`, names.length > 1 ? `Chi tiết số liệu tại ${where}.` : `Chi tiết ${grouped(ctx.rowCount)} bản ghi tại ${where}.`, xf({ italic: true, size: 11 }), { horizontal: 'left' });
          r++;
        }
        gap();
        break;
      case 'assessment':
        heading(head);
        if (block.text) para(ctx.fill(block.text), xf({ italic: true, size: 11 }));
        // Ba dòng chấm để đơn vị gõ / viết tay nội dung đánh giá.
        for (let i = 0; i < 3; i++) { s.mergeCells(`B${r}:F${r}`); s.getCell(`B${r}`).border = { bottom: dotted }; s.getRow(r).height = 22; r++; }
        gap();
        break;
      case 'text':
        heading(head);
        for (const line of ctx.fill(block.text).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) para(line);
        gap();
        break;
    }
  }
  const closingRow = r;
  if (L.closing.enabled && L.closing.text) { para(ctx.fill(L.closing.text)); gap(); }

  r = signatureArea(s, ctx, r);
  const margins = { left: 0.79, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 };
  keepTogether(s, closingRow, r, margins, SUMMARY_COLS);
  s.pageSetup = {
    paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    margins, printArea: `A1:F${r}`,
  };
  s.headerFooter.oddFooter = footerText(ctx);
}

/**
 * Câu kết + khối ký không được tách trang (NĐ30: trang có chữ ký phải có nội dung đi kèm).
 * Excel tự ngắt trang theo chiều cao dòng → mô phỏng lại (A4 dọc, có tính tỉ lệ thu nhỏ "vừa 1 trang ngang")
 * và chèn ngắt trang thủ công trước câu kết nếu khối bị cắt ngang.
 */
function keepTogether(
  s: ExcelJS.Worksheet, from: number, to: number,
  m: { left: number; right: number; top: number; bottom: number }, cols: Record<string, number>,
): void {
  if (to <= from) return;
  // Bề rộng cột (ký tự font mặc định Calibri 11, chữ số rộng 7px) → px ≈ 7w + 5 → pt.
  const sheetWpt = Object.values(cols).reduce((sum, w) => sum + (Math.trunc(w * 7) + 5) * 0.75, 0);
  const scale = Math.min(1, (595.28 - (m.left + m.right) * 72) / sheetWpt);
  const cap = (841.89 - (m.top + m.bottom) * 72) / scale;
  const h = (row: number) => s.getRow(row).height ?? 18;
  let used = 0;
  for (let row = 1; row < from; row++) { used += h(row); if (used > cap) used = h(row); }
  let block = 0;
  for (let row = from; row < to; row++) block += h(row);
  if (block <= cap && used + block > cap && from > 1) s.getRow(from - 1).addPageBreak();
}

/** Ô ký dàn ngang (1 người: Nơi nhận bên trái; 2–3 người: Nơi nhận xuống dưới). Trả về dòng cuối. */
function signatureArea(s: ExcelJS.Worksheet, ctx: StandardContext, start: number): number {
  const sigs = ctx.signatures;
  const recips = ctx.layout.recipients.enabled ? ctx.layout.recipients.items : [];
  const spans: Array<[string, string]> = sigs.length <= 1 ? [['D', 'F']] : sigs.length === 2 ? [['A', 'C'], ['D', 'F']] : [['A', 'C'], ['D', 'E'], ['F', 'F']];
  // Tên người ký thẳng hàng giữa các ô dù ô có / không có dòng thẩm quyền ("TL. HIỆU TRƯỞNG").
  const headLines = Math.max(0, ...sigs.map((x) => (x.authority ? 3 : 2)));
  const nameRow = start + headLines + 4;
  sigs.forEach((sig, i) => {
    const [c1, c2] = spans[i];
    const w = spanWidth(c1, c2);
    const rng = (row: number) => (c1 === c2 ? `${c1}${row}` : `${c1}${row}:${c2}${row}`);
    const line = (row: number, text: string, font: Partial<ExcelJS.Font>) => { put(s, rng(row), text, font); fitHeight(s, row, text, w, font.size ?? 12, 1.2); };
    let r = start;
    if (sig.authority) line(r++, sig.authority, xf({ bold: true }));
    line(r++, sig.title, xf({ bold: true }));
    line(r++, '(Ký, ghi rõ họ tên)', xf({ italic: true, size: 11 }));
    line(nameRow, sig.fullName || '……………………………', xf({ bold: true }));
  });
  const end = sigs.length ? nameRow + 1 : start;
  if (!recips.length) return end;
  let r = sigs.length <= 1 ? start : end + 1;
  put(s, `A${r}:C${r}`, 'Nơi nhận:', xf({ bold: true, italic: true }), { horizontal: 'left' }); r++;
  for (const x of recips) { put(s, `A${r}:C${r}`, `- ${x}`, xf({ size: 11 }), { horizontal: 'left' }); fitHeight(s, r, `- ${x}`, spanWidth('A', 'C'), 11); r++; }
  return Math.max(end, r);
}

/** Bề rộng cột phụ lục: cột chữ co theo dữ liệu thật (200 dòng đầu), trong khoảng [nhãn, 40]. */
const dataWidth = (c: { key: string; format: CellFormat; label: string }, rows: ReportModel['rows']): number => {
  const head = Math.min(18, c.label.length + 2);
  if (c.format === 'datetime') return 17;
  if (c.format === 'text') {
    const longest = rows.slice(0, 200).reduce((n, r) => Math.max(n, String(r[c.key] ?? '').length), 0);
    return Math.max(8, head, Math.min(40, Math.ceil(longest * 1.05) + 2));
  }
  return Math.max(11, Math.min(16, head));
};

/** Bảng phụ lục có dữ liệu + tên sheet: một bảng → "Phụ lục", nhiều bảng → "Phụ lục 1..N". */
function appendixTables(ctx: StandardContext): ReportTable[] {
  return ctx.tables.filter((tb) => tb.rows.length > 0);
}
function appendixSheetNames(ctx: StandardContext): string[] {
  const tables = appendixTables(ctx);
  return tables.length > 1 ? tables.map((_, i) => `Phụ lục ${i + 1}`) : ['Phụ lục'];
}

function appendixSheet(wb: ExcelJS.Workbook, ctx: StandardContext, table: ReportTable, name: string, title: string): ExcelJS.Worksheet {
  const m = { ...ctx.model, columns: table.columns, rows: table.rows };
  const H = 6;
  const d = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: H, showGridLines: false }] });
  const cols = [{ key: '__stt', label: 'STT', format: 'number' as CellFormat }, ...m.columns];
  cols.forEach((c, i) => { d.getColumn(i + 1).width = i === 0 ? 6 : dataWidth(c, m.rows); });
  const last = colLetter(cols.length);
  const unit = ctx.layout.header.unitName || ctx.layout.header.agency;
  put(d, `A1:${last}1`, title, xf({ bold: true, size: 13 })); d.getRow(1).height = 22;
  put(d, `A2:${last}2`, `(Kèm theo Báo cáo số       ${ctx.docRef} ngày ${ctx.dateShort} của ${unit})`, xf({ italic: true }));
  put(d, `A3:${last}3`, `Kỳ báo cáo: ${ctx.periodText}  ·  ${m.filterLines.join('  ·  ') || 'Toàn bộ'}`, xf({ italic: true, size: 11 }));
  put(d, `A4:${last}4`, `Tổng số bản ghi: ${grouped(m.rows.length)}`, xf({ bold: true, size: 11 }), { horizontal: 'left' });
  cols.forEach((c, i) => {
    const cl = d.getRow(H).getCell(i + 1);
    cl.value = c.label; cl.font = xf({ bold: true, size: 11 }); cl.fill = fill(HEAD_FILL); cl.border = box;
    cl.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  d.getRow(H).height = 30;
  m.rows.forEach((row, ri) => {
    const xr = d.getRow(H + 1 + ri);
    cols.forEach((c, ci) => {
      const cl = xr.getCell(ci + 1);
      cl.font = xf({ size: 11 }); cl.border = box;
      if (ci === 0) { cl.value = ri + 1; cl.alignment = { horizontal: 'center', vertical: 'middle' }; return; }
      const v = row[c.key];
      if (c.format === 'datetime') { cl.value = toExcelValue(v, 'datetime'); cl.numFmt = 'dd/mm/yyyy hh:mm'; cl.alignment = { horizontal: 'center', vertical: 'middle' }; }
      // Thời lượng: phân số ngày → Excel cộng / trung bình được.
      else if (c.format === 'duration') { const n = toExcelValue(v, 'duration'); cl.value = typeof n === 'number' ? wholeMinutes(n) : null; cl.numFmt = '[h]:mm'; cl.alignment = { horizontal: 'right', vertical: 'middle' }; }
      else if (c.format === 'text') { cl.value = toExcelValue(v, 'text'); cl.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }; }
      else { cl.value = toExcelValue(v, c.format); if (NUM_FMT[c.format]) cl.numFmt = NUM_FMT[c.format] as string; cl.alignment = { horizontal: 'right', vertical: 'middle' }; }
    });
    if (ri % 2 === 1) cols.forEach((_, ci) => { xr.getCell(ci + 1).fill = fill('FFF7F9FC'); });
  });
  const lastRow = H + m.rows.length;
  d.autoFilter = `A${H}:${last}${lastRow}`;
  d.pageSetup = {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    margins: { left: 0.6, right: 0.6, top: 0.9, bottom: 0.5, header: 0.3, footer: 0.3 }, printTitlesRow: `${H}:${H}`,
  };
  d.headerFooter.oddFooter = footerText(ctx);
  return d;
}

/**
 * Logo nền kiểu Excel: ảnh trong đầu trang (&G) — hiện khi in / xem trước khi in / chế độ Page Layout, không che ô khi nhập liệu.
 * exceljs không hỗ trợ ảnh đầu trang → chèn VML sau khi đóng gói.
 * Độ mờ: Excel không có alpha cho ảnh đầu trang và kẹp gain/blacklevel của VML (đo thực tế: sáng nhất ≈ 24% đậm),
 * nên ảnh PNG được pha sẵn với nền trắng theo `opacity` (khớp Word / PDF). JPEG không giải mã được → dùng mức
 * "Washout" chuẩn của Excel (đậm hơn; giao diện cấu hình mẫu luôn đổi ảnh tải lên sang PNG).
 */
export async function applyXlsxWatermark(
  buf: Buffer,
  image: Buffer,
  opacity: number,
  sheets: Array<{ index: number; widthPt: number; heightPt: number }>,
): Promise<Buffer> {
  const info = imageSize(image);
  if (!info || !sheets.length) return buf;
  const zip = await JSZip.loadAsync(buf);
  const faded = info.type === 'png' ? fadePng(image, opacity) : null;
  const ext = faded || info.type === 'png' ? 'png' : 'jpeg';
  zip.file(`xl/media/st-watermark.${ext}`, faded ?? image);

  const ctPath = '[Content_Types].xml';
  let ct = await zip.file(ctPath)!.async('string');
  if (!/Extension="vml"/i.test(ct)) ct = ct.replace(/(<Types[^>]*>)/, '$1<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>');
  if (!new RegExp(`Extension="${ext}"`, 'i').test(ct)) ct = ct.replace(/(<Types[^>]*>)/, `$1<Default Extension="${ext}" ContentType="image/${ext}"/>`);
  zip.file(ctPath, ct);

  const adjust = faded ? '' : ' gain="19661f" blacklevel="22938f"';
  for (const s of sheets) {
    const sheetPath = `xl/worksheets/sheet${s.index}.xml`;
    const relPath = `xl/worksheets/_rels/sheet${s.index}.xml.rels`;
    const vmlPath = `xl/drawings/vmlDrawingSTWM${s.index}.vml`;
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) continue;
    const rId = 'rIdStWatermark';
    let rels = zip.file(relPath) ? await zip.file(relPath)!.async('string')
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    rels = rels.replace('</Relationships>', `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawingSTWM${s.index}.vml"/></Relationships>`);
    zip.file(relPath, rels);

    let xml = await sheetFile.async('string');
    const tag = `<legacyDrawingHF r:id="${rId}"/>`;
    const before = xml.search(/<picture |<oleObjects|<controls|<webPublishItems|<tableParts|<extLst|<legacyDrawing |<\/worksheet>/);
    xml = xml.slice(0, before) + tag + xml.slice(before);
    zip.file(sheetPath, xml);

    zip.file(vmlPath, [
      '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">',
      ` <o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${100 + s.index}"/></o:shapelayout>`,
      ' <v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f">',
      '  <v:stroke joinstyle="miter"/>',
      '  <v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas>',
      '  <v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/>',
      '  <o:lock v:ext="edit" aspectratio="t"/>',
      ' </v:shapetype>',
      ` <v:shape id="CH" o:spid="_x0000_s${(100 + s.index) * 1024 + 1}" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:${s.widthPt.toFixed(1)}pt;height:${s.heightPt.toFixed(1)}pt;z-index:1">`,
      `  <v:imagedata o:relid="rId1" o:title="watermark"${adjust}/>`,
      '  <o:lock v:ext="edit" rotation="t"/>',
      ' </v:shape>',
      '</xml>',
    ].join('\n'));
    zip.file(`xl/drawings/_rels/vmlDrawingSTWM${s.index}.vml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/st-watermark.${ext}"/></Relationships>`);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Đầu trang chứa ảnh nền: Excel đặt ảnh ngay dưới lề đầu trang; xuống dòng trước &G để đẩy ảnh vào giữa trang
 * (ảnh trong header được phép tràn vào vùng ô — đó chính là cách làm "watermark" chuẩn của Excel).
 */
function watermarkHeader(pageHeightPt: number, imgHeightPt: number, headerMarginIn: number): string {
  const LINE_PT = 13.8; // Times New Roman 12pt
  const n = Math.max(0, Math.round(((pageHeightPt - imgHeightPt) / 2 - headerMarginIn * 72) / LINE_PT));
  return `&C&"Times New Roman"&12${'\n'.repeat(n)}&G`;
}

export async function renderStandardXlsx(model: ReportModel, meta: ReportRenderMeta, input: StandardRenderInput): Promise<Buffer> {
  const ctx = buildStandardContext(model, meta, input);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VISMA';
  wb.created = meta.generatedAt;
  summarySheet(wb, ctx);
  const appendix: ExcelJS.Worksheet[] = [];
  if (ctx.showAppendix && ctx.hasRows) {
    const tables = appendixTables(ctx);
    const names = appendixSheetNames(ctx);
    tables.forEach((tb, i) => appendix.push(appendixSheet(wb, ctx, tb, names[i],
      tables.length > 1 ? `PHỤ LỤC ${i + 1} - ${tb.title.toUpperCase()}` : `PHỤ LỤC - DỮ LIỆU CHI TIẾT ${model.title.toUpperCase()}`)));
  }

  const wm = ctx.watermark ? imageSize(ctx.watermark) : null;
  const marks: Array<{ index: number; widthPt: number; heightPt: number }> = [];
  if (ctx.watermark && wm) {
    // Bề rộng theo % vùng in (A4 dọc 210 − 20 − 10 mm; A4 ngang 297 − 2 × 15 mm).
    const pages: Array<[number, number, number, ExcelJS.Worksheet | undefined]> = [
      [1, 180, 297, wb.getWorksheet('Báo cáo')],
      ...appendix.map((ws, i): [number, number, number, ExcelJS.Worksheet] => [i + 2, 267, 210, ws]),
    ];
    for (const [index, printableMm, pageHmm, ws] of pages) {
      if (!ws) continue;
      const widthPt = ((printableMm * ctx.layout.watermark.widthPct) / 100) * (72 / 25.4);
      const heightPt = (widthPt * wm.height) / wm.width;
      ws.headerFooter.oddHeader = watermarkHeader(pageHmm * (72 / 25.4), heightPt, 0.3);
      marks.push({ index, widthPt, heightPt });
    }
  }
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return marks.length && ctx.watermark ? applyXlsxWatermark(buf, ctx.watermark, ctx.layout.watermark.opacity, marks) : buf;
}
