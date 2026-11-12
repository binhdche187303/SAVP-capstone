import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import type { ReportModel } from '../../report-model.js';
import { EMPTY_TEXT, type ReportRenderMeta } from '../report-render.common.js';
import {
  agencyParts, appendixText, buildStandardContext, columnWeight, grouped, imageSize, ymdVn,
  type StandardContext, type StandardRenderInput,
} from './standard-context.js';

/**
 * PDF bản quy chuẩn — cùng bố cục với bản Word (NĐ 30/2020): A4 dọc lề 20/20/30/15 mm, chữ kiểu Times
 * (Tinos, SIL OFL — cùng số đo với Times New Roman, đủ dấu tiếng Việt), số trang giữa phía trên từ trang 2,
 * phụ lục A4 ngang. Logo nền vẽ đầu mỗi trang (nằm dưới chữ) với độ mờ theo mẫu.
 */

const MM = 72 / 25.4;
const PORTRAIT = { top: 20 * MM, bottom: 20 * MM, left: 30 * MM, right: 15 * MM };
const LANDSCAPE = { top: 30 * MM, bottom: 15 * MM, left: 20 * MM, right: 20 * MM };
const HEAD_FILL = '#DCE6F2';
const INDENT = 10 * MM; // lùi đầu dòng 1 cm
const LINE_GAP = 2.2; // ≈ giãn dòng 1,15 của bản Word

const F = { R: 'ST-Regular', B: 'ST-Bold', I: 'ST-Italic', BI: 'ST-BoldItalic' } as const;
const FONT_FILES: Record<keyof typeof F, string> = { R: 'Tinos-Regular.ttf', B: 'Tinos-Bold.ttf', I: 'Tinos-Italic.ttf', BI: 'Tinos-BoldItalic.ttf' };

function fontPath(file: string): string {
  const candidates = [
    path.join(__dirname, '..', '..', '..', '..', '..', 'assets', 'fonts', file),
    path.join(process.cwd(), 'src', 'assets', 'fonts', file),
    path.join(process.cwd(), 'dist', 'assets', 'fonts', file),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

type Style = { size?: number; bold?: boolean; italic?: boolean };
type Run = [string, Style?];
type Align = 'left' | 'center' | 'right' | 'justify';
type Cell = { text: string; align?: Align; bold?: boolean; span?: number; fill?: string };
const fontOf = (s: Style = {}): string => (s.bold ? (s.italic ? F.BI : F.B) : s.italic ? F.I : F.R);

export function renderStandardPdf(model: ReportModel, meta: ReportRenderMeta, input: StandardRenderInput): Promise<Buffer> {
  const ctx = buildStandardContext(model, meta, input);
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margins: PORTRAIT, bufferPages: true, info: { Title: `Báo cáo ${model.title}`, Creator: 'VISMA' } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      (Object.keys(F) as Array<keyof typeof F>).forEach((k) => doc.registerFont(F[k], fontPath(FONT_FILES[k])));
      new StandardPdfWriter(doc, ctx).render();
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

class StandardPdfWriter {
  private pageOpts: PDFKit.PDFDocumentOptions = { size: 'A4', margins: PORTRAIT };

  constructor(private readonly doc: PDFKit.PDFDocument, private readonly ctx: StandardContext) {}

  private get left(): number { return this.doc.page.margins.left; }
  private get width(): number { return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right; }
  private get bottom(): number { return this.doc.page.height - this.doc.page.margins.bottom; }

  private use(s: Style = {}): void { this.doc.font(fontOf(s)).fontSize(s.size ?? 13); }

  private newPage(): void { this.doc.addPage(this.pageOpts); }
  private ensure(h: number): void { if (this.doc.y + h > this.bottom) this.newPage(); }

  /** Logo nền: vẽ ngay khi sang trang mới để nằm dưới mọi nội dung. */
  private drawWatermark(): void {
    const img = this.ctx.watermark;
    const info = img ? imageSize(img) : null;
    if (!img || !info) return;
    const { doc } = this;
    const w = (this.width * this.ctx.layout.watermark.widthPct) / 100;
    const h = (w * info.height) / info.width;
    const { x, y } = doc;
    doc.save();
    doc.opacity(this.ctx.layout.watermark.opacity);
    doc.image(img, (doc.page.width - w) / 2, (doc.page.height - h) / 2, { width: w });
    doc.restore();
    doc.x = x; doc.y = y;
  }

  private textHeight(runs: Run[], width: number, indent = 0): number {
    // Đo bằng kiểu chữ của đoạn dài nhất — đủ chính xác để quyết định ngắt trang.
    const main = runs.reduce((a, b) => (b[0].length > a[0].length ? b : a), runs[0]);
    this.use(main[1]);
    return this.doc.heightOfString(runs.map((r) => r[0]).join(''), { width, indent, lineGap: LINE_GAP });
  }

  private para(runs: Run[], o: { align?: Align; indent?: number; before?: number; after?: number; x?: number; width?: number; keep?: number; lineGap?: number } = {}): void {
    const { doc } = this;
    const x = o.x ?? this.left;
    const width = o.width ?? this.width;
    doc.y += o.before ?? 0;
    if (o.keep !== undefined) this.ensure(this.textHeight(runs, width, o.indent) + o.keep);
    // pdfkit căn giữa / phải từng đoạn `continued` riêng lẻ → chữ chồng nhau. Nhiều kiểu chữ + căn giữa:
    // vừa một dòng thì tự đặt từng đoạn; dài hơn thì gộp về kiểu chữ của đoạn đầu.
    if (runs.length > 1 && (o.align === 'center' || o.align === 'right')) {
      const widths = runs.map(([txt, st]) => { this.use(st); return doc.widthOfString(txt); });
      const total = widths.reduce((a, b) => a + b, 0);
      if (total > width) { this.para([[runs.map((r) => r[0]).join(''), runs[0][1]]], { ...o, before: 0 }); return; }
      let cx = x + (o.align === 'center' ? (width - total) / 2 : width - total);
      const y = doc.y;
      let h = 0;
      runs.forEach(([txt, st], i) => {
        this.use(st);
        doc.text(txt, cx, y, { lineBreak: false });
        h = Math.max(h, doc.currentLineHeight(true) + (o.lineGap ?? LINE_GAP));
        cx += widths[i];
      });
      doc.x = this.left;
      doc.y = y + h + (o.after ?? 0);
      return;
    }
    runs.forEach(([txt, st], i) => {
      this.use(st);
      const opts: PDFKit.Mixins.TextOptions = { width, align: o.align ?? 'justify', indent: o.indent ?? 0, lineGap: o.lineGap ?? LINE_GAP, continued: i < runs.length - 1 };
      if (i === 0) doc.text(txt, x, doc.y, opts);
      else doc.text(txt, opts);
    });
    doc.x = this.left;
    doc.y += o.after ?? 0;
  }

  private body(runs: Run[], o: { before?: number; after?: number; keep?: number } = {}): void {
    this.para(runs, { indent: INDENT, after: 6, ...o });
  }

  private heading(txt: string): void {
    this.para([[txt, { bold: true }]], { indent: INDENT, before: 6, after: 6, keep: 40 });
  }

  render(): void {
    const { doc, ctx } = this;
    doc.on('pageAdded', () => this.drawWatermark());
    this.drawWatermark();
    this.header();
    this.title();
    const L = ctx.layout;
    if (L.addressee.enabled && L.addressee.text) this.para([['Kính gửi: ', { size: 14 }], [ctx.fill(L.addressee.text), { size: 14 }]], { align: 'center', after: 12 });
    this.sections();
    this.closingAndSignatures();
    if (ctx.showAppendix && ctx.hasRows) this.appendix();
    this.pageDecorations();
  }

  /** Đầu văn bản: [logo trong lề trái] [cơ quan 210 pt] [quốc hiệu] — như lưới bảng của bản Word. */
  private header(): void {
    const { doc, ctx } = this;
    const h = ctx.layout.header;
    const top = doc.page.margins.top;
    const AG = 197; // 3940 dxa
    const D = 13; // 260 dxa
    const QH = this.width - AG - D;
    const leftW = AG + D;
    let ly = top;
    const logoInfo = ctx.logo ? imageSize(ctx.logo) : null;
    if (ctx.logo && logoInfo) {
      if (ctx.layout.logo.position === 'margin') {
        const w = Math.min(ctx.layout.logo.widthMm, 24) * MM;
        doc.image(ctx.logo, this.left - w - 15, top, { width: w });
      } else {
        const w = ctx.layout.logo.widthMm * MM;
        doc.image(ctx.logo, this.left + (leftW - w) / 2, top, { width: w });
        ly += (w * logoInfo.height) / logoInfo.width + 3;
      }
    }
    if (h.parentAgency) {
      this.use({ size: 12 });
      doc.text(h.parentAgency, this.left, ly, { width: leftW, align: 'center' });
      ly = doc.y;
    }
    // Tên cơ quan: gạch chân một phần (vd "ĐẠI HỌC KINH TẾ") như văn bản thật của trường.
    const [a1, a2, a3] = agencyParts(h.agency, h.agencyUnderline);
    this.use({ size: 12, bold: true });
    const total = doc.widthOfString(h.agency);
    if (total <= leftW) {
      let x = this.left + (leftW - total) / 2;
      const lineH = doc.currentLineHeight(true);
      for (const [part, u] of [[a1, false], [a2, true], [a3, false]] as Array<[string, boolean]>) {
        if (!part) continue;
        const w = doc.widthOfString(part);
        doc.text(part, x, ly, { lineBreak: false });
        if (u) doc.moveTo(x, ly + lineH - 1.2).lineTo(x + w, ly + lineH - 1.2).lineWidth(0.6).stroke('#000000');
        x += w;
      }
      ly += lineH;
    } else {
      doc.text(h.agency, this.left, ly, { width: leftW, align: 'center' });
      ly = doc.y;
    }

    const rx = this.left + leftW;
    this.use({ size: 12, bold: true });
    doc.text('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', rx, top, { width: QH, align: 'center' });
    this.use({ size: 13, bold: true });
    const tn = 'Độc lập - Tự do - Hạnh phúc';
    const tnW = doc.widthOfString(tn);
    const tnY = doc.y;
    doc.text(tn, rx, tnY, { width: QH, align: 'center' });
    const tnLine = tnY + doc.currentLineHeight(true) - 0.8;
    doc.moveTo(rx + (QH - tnW) / 2, tnLine).lineTo(rx + (QH + tnW) / 2, tnLine).lineWidth(0.6).stroke('#000000');
    const ry = doc.y;

    const y2 = Math.max(ly, ry) + 8;
    this.use({ size: 13 });
    doc.text(ctx.docNo, this.left, y2, { width: AG, align: 'center' });
    const a = doc.y;
    this.use({ size: 13, italic: true });
    // Ô ngày tháng rộng δ + quốc hiệu + δ (lấn sang lề phải δ) — như bản Word.
    doc.text(ctx.dateLine, this.left + AG, y2, { width: D + QH + D, align: 'center' });
    doc.x = this.left;
    doc.y = Math.max(a, doc.y);
  }

  private title(): void {
    const { doc, ctx } = this;
    this.para([['BÁO CÁO', { size: 14, bold: true }]], { align: 'center', before: 18, lineGap: 0 });
    this.para([[ctx.subject, { size: 14, bold: true }]], { align: 'center', lineGap: 0 });
    this.para([[ctx.periodText, { size: 14, bold: true }]], { align: 'center', lineGap: 0 });
    const y = doc.y + 6;
    const pad = 157.5; // 3150 dxa mỗi bên ≈ 1/3 dòng
    doc.moveTo(this.left + pad, y).lineTo(this.left + this.width - pad, y).lineWidth(0.6).stroke('#000000');
    doc.y = y + 12;
  }

  private sections(): void {
    const { ctx } = this;
    const m = ctx.model;
    for (const { block, heading } of ctx.sections) {
      switch (block.kind) {
        case 'opening':
          if (block.text) this.body([[ctx.fill(block.text)]]);
          break;
        case 'scope':
          this.heading(heading);
          this.body([['1. Kỳ báo cáo: ', { bold: true }], [`từ 00 giờ 00 ngày ${ymdVn(m.period.from)} đến 23 giờ 59 ngày ${ymdVn(m.period.to)}.`]]);
          this.body([['2. Phạm vi dữ liệu: ', { bold: true }], [`${ctx.filterText}.`]]);
          this.body([['3. Nguồn dữ liệu: ', { bold: true }], [`${ctx.dataSource}.`]]);
          this.body([['4. Thời điểm trích xuất: ', { bold: true }], [`${ctx.generatedText}, người trích xuất: ${ctx.generatedBy}.`]]);
          break;
        case 'summary':
          this.heading(heading);
          if (ctx.kpis.length) this.kpiTable();
          for (const n of m.notes ?? []) this.body([['Ghi chú: ', { bold: true, italic: true, size: 12 }], [n, { italic: true, size: 12 }]], { before: 6 });
          if (ctx.isEmpty) this.body([[`${EMPTY_TEXT}.`, { italic: true }]], { before: 6 });
          else if (ctx.appendixLead) this.body([[ctx.appendixLead]], { before: 6 });
          break;
        case 'assessment':
          this.heading(heading);
          if (block.text) this.body([[ctx.fill(block.text), { italic: true, size: 12 }]], { after: 3 });
          this.dotLines(2);
          break;
        case 'text':
          this.heading(heading);
          for (const line of ctx.fill(block.text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) this.body([[line]]);
          break;
      }
    }
  }

  private dotLines(n: number): void {
    const { doc } = this;
    for (let i = 0; i < n; i++) {
      this.ensure(22);
      const y = doc.y + 16;
      doc.save().dash(0.8, { space: 2.2 }).moveTo(this.left, y).lineTo(this.left + this.width, y).lineWidth(0.6).stroke('#000000').restore();
      doc.y = y + 6;
    }
  }

  /** Bảng có kẻ ô; dòng tiêu đề lặp lại khi sang trang. */
  private table(widths: number[], header: Cell[], rows: Cell[][], size: number): void {
    const { doc } = this;
    const PX = 4, PY = 2.5;
    const x0 = this.left;
    const cellsOf = (row: Cell[]) => {
      let col = 0;
      return row.map((c) => {
        const span = c.span ?? 1;
        const x = x0 + widths.slice(0, col).reduce((a, b) => a + b, 0);
        const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0);
        col += span;
        return { c, x, w };
      });
    };
    const rowHeight = (row: Cell[], bold = false) =>
      Math.max(...cellsOf(row).map(({ c, w }) => { this.use({ size, bold: bold || c.bold }); return doc.heightOfString(c.text || ' ', { width: w - 2 * PX, lineGap: 0.5 }); })) + 2 * PY;
    const draw = (row: Cell[], opts: { bold?: boolean; fill?: string }) => {
      const h = rowHeight(row, opts.bold);
      const y = doc.y;
      for (const { c, x, w } of cellsOf(row)) {
        const f = c.fill ?? opts.fill;
        if (f) doc.rect(x, y, w, h).fill(f);
        doc.rect(x, y, w, h).lineWidth(0.5).stroke('#000000');
        this.use({ size, bold: opts.bold || c.bold });
        doc.fillColor('#000000').text(c.text, x + PX, y + PY, { width: w - 2 * PX, align: c.align ?? 'left', lineGap: 0.5, height: h });
      }
      doc.x = x0;
      doc.y = y + h;
    };
    const hdr: Cell[] = header.map((h) => ({ ...h, align: h.align ?? 'center' }));
    this.ensure(rowHeight(hdr, true) + (rows[0] ? rowHeight(rows[0]) : 0));
    draw(hdr, { bold: true, fill: HEAD_FILL });
    for (const r of rows) {
      const h = rowHeight(r);
      if (doc.y + h > this.bottom) { this.newPage(); draw(hdr, { bold: true, fill: HEAD_FILL }); }
      draw(r, {});
    }
  }

  private kpiTable(): void {
    const k = this.ctx.kpis;
    const W = [35, 260, 70, this.width - 365];
    this.table(W, [{ text: 'STT' }, { text: 'Chỉ tiêu' }, { text: 'Đơn vị tính' }, { text: 'Kết quả' }],
      k.map((x, i): Cell[] => [{ text: String(i + 1), align: 'center' }, { text: x.label }, { text: x.unit, align: 'center' }, { text: x.text, align: 'right', bold: true }]), 12);
  }

  private signatureHeight(): { sig: number; recips: number } {
    const { doc, ctx } = this;
    this.use({ size: 13 });
    const lh = doc.currentLineHeight(true) + 1;
    const head = Math.max(0, ...ctx.signatures.map((s) => (s.authority ? 3 : 2)));
    const sig = ctx.signatures.length ? (head + 5) * lh : 0;
    const r = ctx.layout.recipients;
    const recips = r.enabled && r.items.length ? 16 + r.items.length * 14 : 0;
    return { sig, recips };
  }

  /** Câu kết + khối ký luôn chung một trang (như keepNext của bản Word). */
  private closingAndSignatures(): void {
    const { doc, ctx } = this;
    const L = ctx.layout;
    const { sig, recips } = this.signatureHeight();
    const blockH = ctx.signatures.length <= 1 ? Math.max(sig, recips) : sig + (recips ? recips + 10 : 0);
    const closing: Run[] | null = L.closing.enabled && L.closing.text ? [[ctx.fill(L.closing.text)]] : null;
    const closingH = closing ? this.textHeight(closing, this.width, INDENT) + 18 : 12;
    if (blockH + closingH < this.bottom - doc.page.margins.top) this.ensure(blockH + closingH);
    if (closing) this.body(closing, { before: 6, after: 12 });
    else doc.y += 12;

    const sigs = ctx.signatures;
    const top = doc.y;
    const head = Math.max(0, ...sigs.map((s) => (s.authority ? 3 : 2)));
    const drawSig = (s: (typeof sigs)[number], x: number, w: number) => {
      let y = top;
      const line = (txt: string, st: Style) => { this.use(st); doc.text(txt, x, y, { width: w, align: 'center' }); y = doc.y + 1; };
      if (s.authority) line(s.authority, { bold: true });
      line(s.title, { bold: true });
      line('(Ký, ghi rõ họ tên)', { size: 12, italic: true });
      this.use({ size: 13 });
      const lh = doc.currentLineHeight(true) + 1;
      y = top + (head + 4) * lh;
      line(s.fullName || '……………………………', { bold: true });
      return y;
    };
    const drawRecips = (x: number, y: number, w: number) => {
      const r = L.recipients;
      if (!r.enabled || !r.items.length) return y;
      this.use({ size: 12, bold: true, italic: true });
      doc.text('Nơi nhận:', x, y, { width: w });
      this.use({ size: 11 });
      for (const item of r.items) doc.text(`- ${item}`, x, doc.y, { width: w });
      return doc.y;
    };
    let end = top;
    if (sigs.length <= 1) {
      const LW = 220; // 4400 dxa
      end = drawRecips(this.left, top, LW - 10);
      if (sigs[0]) end = Math.max(end, drawSig(sigs[0], this.left + LW, this.width - LW));
    } else {
      const w = this.width / sigs.length;
      sigs.forEach((s, i) => { end = Math.max(end, drawSig(s, this.left + i * w, w)); });
      end = drawRecips(this.left, end + 10, this.width / 2);
    }
    doc.x = this.left;
    doc.y = end;
  }

  private appendix(): void {
    const { ctx } = this;
    const m = ctx.model;
    this.pageOpts = { size: 'A4', layout: 'landscape', margins: LANDSCAPE };
    this.newPage();
    const unit = ctx.layout.header.unitName || ctx.layout.header.agency;
    this.para([['PHỤ LỤC', { bold: true }]], { align: 'center', lineGap: 0 });
    this.para([[`DỮ LIỆU CHI TIẾT ${m.title.toUpperCase()}`, { bold: true }]], { align: 'center', lineGap: 0 });
    this.para([[`(Kèm theo Báo cáo số       ${ctx.docRef} ${ctx.dateWords} của ${unit})`, { italic: true }]], { align: 'center', lineGap: 0 });
    this.para([[`Kỳ báo cáo: ${ctx.periodText}  ·  ${m.filterLines.join('  ·  ') || 'Toàn bộ'}`, { size: 11, italic: true }]], { align: 'center', before: 3, after: 8, lineGap: 0 });

    const tables = ctx.tables.filter((tb) => tb.rows.length > 0);
    const STT = 30;
    const align = (f: string): Align => (['number', 'percent', 'hours', 'minutes', 'duration'].includes(f) ? 'right' : f === 'datetime' ? 'center' : 'left');
    tables.forEach((tb, ti) => {
      if (tables.length > 1) this.para([[`${ti + 1}. ${tb.title}`, { size: 12, bold: true }]], { before: ti ? 10 : 0, after: 5, lineGap: 0 });
      const weights = tb.columns.map(columnWeight);
      const sum = weights.reduce((a, b) => a + b, 0);
      const W = [STT, ...weights.map((x) => ((this.width - STT) * x) / sum)];
      const rows: Cell[][] = tb.rows.map((r, i) => [{ text: String(i + 1), align: 'center' }, ...tb.columns.map((c): Cell => ({ text: appendixText(r[c.key], c.format), align: align(c.format) }))]);
      rows.push([{ text: `Tổng cộng: ${grouped(tb.rows.length)} bản ghi`, align: 'left', bold: true, span: tb.columns.length + 1, fill: '#F2F2F2' }]);
      this.table(W, [{ text: 'STT' }, ...tb.columns.map((c) => ({ text: c.label }))], rows, 10);
    });
  }

  /** Số trang (giữa, phía trên, bỏ trang 1) + dòng nguồn gốc dữ liệu ở chân trang. */
  private pageDecorations(): void {
    const { doc, ctx } = this;
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const saved = { ...doc.page.margins };
      doc.page.margins.bottom = 0;
      doc.page.margins.top = 0;
      const w = doc.page.width - saved.left - saved.right;
      if (i > range.start) {
        this.use({ size: 13 });
        doc.text(String(i - range.start + 1), saved.left, 10 * MM, { width: w, align: 'center', lineBreak: false });
      }
      if (ctx.layout.footer.provenance) {
        this.use({ size: 9, italic: true });
        doc.text(ctx.provenance, saved.left, doc.page.height - 8 * MM - 11, { width: w, align: 'left', lineBreak: false, ellipsis: true });
      }
      doc.page.margins.bottom = saved.bottom;
      doc.page.margins.top = saved.top;
    }
  }
}
