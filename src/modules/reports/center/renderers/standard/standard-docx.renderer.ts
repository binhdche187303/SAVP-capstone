import {
  AlignmentType, BorderStyle, Document, Footer, Header, HorizontalPositionAlign, HorizontalPositionRelativeFrom, ImageRun, Packer,
  PageNumber, PageOrientation, Paragraph, PositionalTab, PositionalTabAlignment, PositionalTabLeader, PositionalTabRelativeTo,
  ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, UnderlineType, VerticalAlign, VerticalMergeType,
  VerticalPositionAlign, VerticalPositionRelativeFrom, WidthType, type ISectionOptions, type TableVerticalAlign,
} from 'docx';
import JSZip from 'jszip';
import type { ReportModel, ReportTable } from '../../report-model.js';
import { EMPTY_TEXT, type ReportRenderMeta } from '../report-render.common.js';
import {
  agencyParts, appendixText, buildStandardContext, columnWeight, grouped, imageSize, ymdVn,
  type StandardContext, type StandardRenderInput,
} from './standard-context.js';

// ── Thể thức NĐ 30/2020: A4, lề trên/dưới 20 mm, trái 30 mm, phải 15 mm; Times New Roman. ──
const FONT = 'Times New Roman';
const A4_W = 11906;
const A4_H = 16838;
const MARGIN = { top: 1134, bottom: 1134, left: 1701, right: 851, header: 567, footer: 454 };
const PORTRAIT_W = A4_W - MARGIN.left - MARGIN.right; // 9354
// Phụ lục A4 ngang: mép trên là gáy khi đóng quyển → lề trên 30 mm.
const LAND_MARGIN = { top: 1701, bottom: 851, left: 1134, right: 1134, header: 851, footer: 454 };
const LAND_W = A4_H - LAND_MARGIN.left - LAND_MARGIN.right;
const HEAD_FILL = 'DCE6F2';
const PX_PER_MM = 96 / 25.4;
const DXA_PER_MM = 1440 / 25.4;
const C = AlignmentType.CENTER;

type RunOpts = { size?: number; bold?: boolean; italic?: boolean; u?: boolean };
const t = (text: string, o: RunOpts = {}) =>
  new TextRun({ text, font: FONT, size: (o.size ?? 13) * 2, bold: o.bold, italics: o.italic, underline: o.u ? { type: UnderlineType.SINGLE } : undefined });

type ParaOpts = {
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  indent?: { firstLine?: number; left?: number; right?: number };
  keepNext?: boolean; before?: number; after?: number; line?: number;
  border?: ConstructorParameters<typeof Paragraph>[0] extends infer O ? (O extends { border?: infer B } ? B : never) : never;
};
const p = (runs: TextRun | ImageRun | Array<TextRun | ImageRun>, o: ParaOpts = {}) => new Paragraph({
  alignment: o.align ?? AlignmentType.JUSTIFIED,
  indent: o.indent,
  keepNext: o.keepNext,
  keepLines: o.keepNext,
  spacing: { before: o.before ?? 0, after: o.after ?? 0, line: o.line ?? 240 },
  border: o.border,
  children: Array.isArray(runs) ? runs : [runs],
});
// Thân văn bản 13pt, lùi đầu dòng 1 cm, cách đoạn 6pt, giãn dòng 1,15.
const body = (runs: TextRun | TextRun[], o: ParaOpts = {}) => p(runs, { indent: { firstLine: 567 }, after: 120, line: 276, ...o });
const heading = (txt: string) => p(t(txt, { bold: true }), { indent: { firstLine: 567 }, before: 120, after: 120, keepNext: true });

const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };
const LINE = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const GRID = { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE };
const M0 = { top: 0, bottom: 0, left: 0, right: 0 };
const CELL_M = { top: 40, bottom: 40, left: 80, right: 80 };

type CellOpts = { span?: number; valign?: TableVerticalAlign; margins?: typeof M0; fill?: string; vmerge?: (typeof VerticalMergeType)[keyof typeof VerticalMergeType] };
const cell = (children: Paragraph | Table | Array<Paragraph | Table>, w: number, o: CellOpts = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA },
  columnSpan: o.span,
  verticalMerge: o.vmerge,
  verticalAlign: o.valign ?? VerticalAlign.CENTER,
  margins: o.margins ?? CELL_M,
  shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
  children: Array.isArray(children) ? children : [children],
});

function imageRun(data: Buffer, widthPx: number, floating?: ConstructorParameters<typeof ImageRun>[0]['floating']): ImageRun | null {
  const info = imageSize(data);
  if (!info || !info.width || !info.height) return null;
  const w = Math.round(widthPx);
  const h = Math.round((widthPx * info.height) / info.width);
  return new ImageRun({ type: info.type, data, transformation: { width: w, height: h }, floating });
}

/**
 * Đầu văn bản: lưới [logo trong lề trái] [cơ quan] [δ] [quốc hiệu] [δ].
 * Dòng ngày tháng 13pt dài hơn cột quốc hiệu → nới δ hai bên để vẫn canh giữa dưới quốc hiệu (đã đo, xem mẫu đã duyệt).
 */
function headerBlock(ctx: StandardContext): Table {
  const h = ctx.layout.header;
  const inMargin = !!ctx.logo && ctx.layout.logo.position === 'margin';
  // Logo trong lề trái tối đa 24 mm để không lọt ra ngoài mép giấy (lề trái 30 mm).
  const logoMm = inMargin ? Math.min(ctx.layout.logo.widthMm, 24) : ctx.layout.logo.widthMm;
  const LOGO_W = inMargin ? Math.round(logoMm * DXA_PER_MM) + 300 : 0;
  const D = 260;
  const AG = 4200 - D;
  const QH = PORTRAIT_W - 4200;
  const top = { margins: M0, valign: VerticalAlign.TOP };
  const [a1, a2, a3] = agencyParts(h.agency, h.agencyUnderline);
  const agencyRuns = [a1 && t(a1, { size: 12, bold: true }), t(a2, { size: 12, bold: true, u: true }), a3 && t(a3, { size: 12, bold: true })].filter(Boolean) as TextRun[];

  const agencyChildren: Paragraph[] = [];
  if (ctx.logo && !inMargin) {
    const img = imageRun(ctx.logo, logoMm * PX_PER_MM);
    if (img) agencyChildren.push(p(img, { align: C, after: 60 }));
  }
  if (h.parentAgency) agencyChildren.push(p(t(h.parentAgency, { size: 12 }), { align: C }));
  agencyChildren.push(p(agencyRuns, { align: C }));

  const row1: TableCell[] = [];
  const row2: TableCell[] = [];
  if (inMargin) {
    const img = imageRun(ctx.logo!, logoMm * PX_PER_MM);
    row1.push(cell(img ? p(img, { align: AlignmentType.LEFT }) : p(t('')), LOGO_W, { margins: M0, valign: VerticalAlign.TOP, vmerge: VerticalMergeType.RESTART }));
    row2.push(cell(p(t('')), LOGO_W, { margins: M0, vmerge: VerticalMergeType.CONTINUE }));
  }
  row1.push(
    cell(agencyChildren, AG + D, { ...top, span: 2 }),
    cell([p(t('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', { size: 12, bold: true }), { align: C }), p(t('Độc lập - Tự do - Hạnh phúc', { size: 13, bold: true, u: true }), { align: C })], QH, top),
    cell(p(t('')), D, top),
  );
  row2.push(
    cell(p(t(ctx.docNo, { size: 13 }), { align: C, before: 160 }), AG, top),
    cell(p(t(ctx.dateLine, { size: 13, italic: true }), { align: C, before: 160 }), D + QH + D, { ...top, span: 3 }),
  );
  return new Table({
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    indent: { size: -LOGO_W, type: WidthType.DXA },
    width: { size: LOGO_W + PORTRAIT_W + D, type: WidthType.DXA },
    columnWidths: [...(inMargin ? [LOGO_W] : []), AG, D, QH, D],
    rows: [new TableRow({ children: row1 }), new TableRow({ children: row2 })],
  });
}

const dotLine = () => new Paragraph({
  spacing: { after: 60, line: 360 },
  children: [new TextRun({ font: FONT, size: 26, children: [new PositionalTab({ alignment: PositionalTabAlignment.RIGHT, relativeTo: PositionalTabRelativeTo.MARGIN, leader: PositionalTabLeader.DOT })] })],
});

function kpiTable(ctx: StandardContext): Table {
  const W = [700, 5200, 1400, PORTRAIT_W - 7300];
  const hdr = ['STT', 'Chỉ tiêu', 'Đơn vị tính', 'Kết quả'];
  return new Table({
    layout: TableLayoutType.FIXED,
    borders: GRID,
    width: { size: PORTRAIT_W, type: WidthType.DXA },
    columnWidths: W,
    rows: [
      new TableRow({ tableHeader: true, children: hdr.map((x, i) => cell(p(t(x, { size: 12, bold: true }), { align: C }), W[i], { fill: HEAD_FILL })) }),
      ...ctx.kpis.map((k, i) => new TableRow({
        cantSplit: true,
        children: [
          cell(p(t(String(i + 1), { size: 12 }), { align: C }), W[0]),
          cell(p(t(k.label, { size: 12 }), { align: AlignmentType.LEFT }), W[1]),
          cell(p(t(k.unit, { size: 12 }), { align: C }), W[2]),
          cell(p(t(k.text, { size: 12, bold: true }), { align: AlignmentType.RIGHT }), W[3]),
        ],
      })),
    ],
  });
}

function sectionBlocks(ctx: StandardContext): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  const m = ctx.model;
  for (const { block, heading: head } of ctx.sections) {
    switch (block.kind) {
      case 'opening':
        if (block.text) out.push(body(t(ctx.fill(block.text))));
        break;
      case 'scope':
        out.push(
          heading(head),
          body([t('1. Kỳ báo cáo: ', { bold: true }), t(`từ 00 giờ 00 ngày ${ymdVn(m.period.from)} đến 23 giờ 59 ngày ${ymdVn(m.period.to)}.`)]),
          body([t('2. Phạm vi dữ liệu: ', { bold: true }), t(`${ctx.filterText}.`)]),
          body([t('3. Nguồn dữ liệu: ', { bold: true }), t(`${ctx.dataSource}.`)]),
          body([t('4. Thời điểm trích xuất: ', { bold: true }), t(`${ctx.generatedText}, người trích xuất: ${ctx.generatedBy}.`)]),
        );
        break;
      case 'summary':
        out.push(heading(head));
        if (ctx.kpis.length) out.push(kpiTable(ctx));
        for (const n of m.notes ?? []) out.push(body([t('Ghi chú: ', { bold: true, italic: true, size: 12 }), t(n, { italic: true, size: 12 })], { before: 120 }));
        if (ctx.isEmpty) out.push(body(t(`${EMPTY_TEXT}.`, { italic: true }), { before: 120 }));
        else if (ctx.appendixLead) out.push(body(t(ctx.appendixLead), { before: 120 }));
        break;
      case 'assessment':
        out.push(heading(head));
        if (block.text) out.push(body(t(ctx.fill(block.text), { italic: true, size: 12 }), { after: 60 }));
        out.push(dotLine(), dotLine());
        break;
      case 'text':
        out.push(heading(head));
        for (const line of ctx.fill(block.text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) out.push(body(t(line)));
        break;
    }
  }
  return out;
}

/** `pad` dòng trống thêm để tên người ký thẳng hàng với ô có dòng thẩm quyền ("TL. HIỆU TRƯỞNG"). */
function signatureCell(s: StandardContext['signatures'][number], w: number, pad = 0): TableCell {
  const lines: Paragraph[] = [];
  if (s.authority) lines.push(p(t(s.authority, { bold: true }), { align: C, keepNext: true }));
  lines.push(
    p(t(s.title, { bold: true }), { align: C, keepNext: true }),
    p(t('(Ký, ghi rõ họ tên)', { size: 12, italic: true }), { align: C, keepNext: true }),
    ...Array.from({ length: 4 + pad }, () => p(t(''))),
    p(t(s.fullName || '……………………………', { bold: true }), { align: C }),
  );
  return cell(lines, w, { margins: M0, valign: VerticalAlign.TOP });
}

function recipientParas(ctx: StandardContext): Paragraph[] {
  const r = ctx.layout.recipients;
  if (!r.enabled || r.items.length === 0) return [];
  return [
    p(t('Nơi nhận:', { size: 12, bold: true, italic: true }), { align: AlignmentType.LEFT }),
    ...r.items.map((x) => p(t(`- ${x}`, { size: 11 }), { align: AlignmentType.LEFT })),
  ];
}

/** Một người ký: [Nơi nhận | ô ký]. Hai, ba người ký: các ô ký dàn ngang, Nơi nhận xuống dưới. */
function signatureBlock(ctx: StandardContext): Array<Paragraph | Table> {
  const sigs = ctx.signatures;
  const recips = recipientParas(ctx);
  if (sigs.length <= 1) {
    const W = [4400, PORTRAIT_W - 4400];
    const right = sigs[0] ? signatureCell(sigs[0], W[1]) : cell(p(t('')), W[1], { margins: M0 });
    return [new Table({
      layout: TableLayoutType.FIXED, borders: NO_BORDERS, width: { size: PORTRAIT_W, type: WidthType.DXA }, columnWidths: W,
      rows: [new TableRow({ cantSplit: true, children: [cell(recips.length ? recips : p(t('')), W[0], { margins: M0, valign: VerticalAlign.TOP }), right] })],
    })];
  }
  const anyAuthority = sigs.some((x) => x.authority);
  const w = Math.floor(PORTRAIT_W / sigs.length);
  const W = sigs.map((_, i) => (i === sigs.length - 1 ? PORTRAIT_W - w * (sigs.length - 1) : w));
  const table = new Table({
    layout: TableLayoutType.FIXED, borders: NO_BORDERS, width: { size: PORTRAIT_W, type: WidthType.DXA }, columnWidths: W,
    rows: [new TableRow({ cantSplit: true, children: sigs.map((s, i) => signatureCell(s, W[i], anyAuthority && !s.authority ? 1 : 0)) })],
  });
  return recips.length ? [table, p(t(''), { after: 120 }), ...recips] : [table];
}

function detailTable(table: ReportTable): Table {
  const cols = table.columns;
  const STT = 600;
  const weights = cols.map(columnWeight);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const W = [STT, ...weights.map((x) => Math.floor(((LAND_W - STT) * x) / sumW))];
  W[W.length - 1] += LAND_W - W.reduce((a, b) => a + b, 0);
  const align = (f: string) => (['number', 'percent', 'hours', 'minutes', 'duration'].includes(f) ? AlignmentType.RIGHT : f === 'datetime' ? C : AlignmentType.LEFT);
  return new Table({
    layout: TableLayoutType.FIXED, borders: GRID, width: { size: LAND_W, type: WidthType.DXA }, columnWidths: W,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: [cell(p(t('STT', { size: 11, bold: true }), { align: C }), W[0], { fill: HEAD_FILL }), ...cols.map((c, i) => cell(p(t(c.label, { size: 11, bold: true }), { align: C }), W[i + 1], { fill: HEAD_FILL }))] }),
      ...table.rows.map((r, ri) => new TableRow({
        cantSplit: true,
        children: [
          cell(p(t(String(ri + 1), { size: 11 }), { align: C }), W[0]),
          ...cols.map((c, i) => cell(p(t(appendixText(r[c.key], c.format), { size: 11 }), { align: align(c.format) }), W[i + 1])),
        ],
      })),
      new TableRow({ cantSplit: true, children: [cell(p(t(`Tổng cộng: ${grouped(table.rows.length)} bản ghi`, { size: 11, bold: true }), { align: AlignmentType.LEFT }), LAND_W, { span: cols.length + 1, fill: 'F2F2F2' })] }),
    ],
  });
}

/** Logo nền: ảnh nổi trong header, nằm sau chữ, canh giữa trang. Độ mờ được chèn sau khi đóng gói (xem applyWatermarkAlpha). */
function watermarkPara(ctx: StandardContext, printableDxa: number): Paragraph[] {
  if (!ctx.watermark) return [];
  const widthPx = ((printableDxa / 1440) * 96 * ctx.layout.watermark.widthPct) / 100;
  const img = imageRun(ctx.watermark, widthPx, {
    horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, align: HorizontalPositionAlign.CENTER },
    verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, align: VerticalPositionAlign.CENTER },
    behindDocument: true,
    allowOverlap: true,
  });
  return img ? [p(img, { align: C })] : [];
}

/**
 * docx không có tùy chọn độ trong suốt cho ảnh → chèn `<a:alphaModFix>` vào blip trong header (chỉ header mới chứa logo nền).
 */
async function applyWatermarkAlpha(buf: Buffer, opacity: number): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const amt = Math.round(Math.min(1, Math.max(0, opacity)) * 100000);
  const names = Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n));
  for (const n of names) {
    const xml = await zip.file(n)!.async('string');
    const patched = xml.replace(/<a:blip ([^>]*?)\/>/g, `<a:blip $1><a:alphaModFix amt="${amt}"/></a:blip>`);
    if (patched !== xml) zip.file(n, patched);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function renderStandardDocx(model: ReportModel, meta: ReportRenderMeta, input: StandardRenderInput): Promise<Buffer> {
  const ctx = buildStandardContext(model, meta, input);
  const L = ctx.layout;

  const pageNoHeader = (printable: number) => new Header({
    children: [p(new TextRun({ font: FONT, size: 26, children: [PageNumber.CURRENT] }), { align: C }), ...watermarkPara(ctx, printable)],
  });
  const firstHeader = new Header({ children: [p(t('')), ...watermarkPara(ctx, PORTRAIT_W)] });
  const footer = () => new Footer({ children: L.footer.provenance ? [p(t(ctx.provenance, { size: 9, italic: true }), { align: AlignmentType.LEFT })] : [p(t(''))] });

  const s1: Array<Paragraph | Table> = [
    headerBlock(ctx),
    p(t('BÁO CÁO', { size: 14, bold: true }), { align: C, before: 360 }),
    p(t(ctx.subject, { size: 14, bold: true }), { align: C }),
    p(t(ctx.periodText, { size: 14, bold: true }), { align: C }),
    // Đường kẻ dưới trích yếu: khoảng 1/3 dòng, canh giữa.
    p(t('', { size: 4 }), { align: C, indent: { left: 3150, right: 3150 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } }, after: 240 }),
  ];
  if (L.addressee.enabled && L.addressee.text) s1.push(p([t('Kính gửi: ', { size: 14 }), t(ctx.fill(L.addressee.text), { size: 14 })], { align: C, after: 240 }));
  s1.push(...sectionBlocks(ctx));
  // Câu kết luôn đi cùng trang với khối ký.
  if (L.closing.enabled && L.closing.text) s1.push(body(t(ctx.fill(L.closing.text)), { before: 120, after: 240, keepNext: true }));
  else s1.push(p(t(''), { after: 240, keepNext: true }));
  s1.push(...signatureBlock(ctx));

  const sections: ISectionOptions[] = [{
    properties: { titlePage: true, page: { size: { width: A4_W, height: A4_H }, margin: MARGIN } },
    headers: { default: pageNoHeader(PORTRAIT_W), first: firstHeader },
    footers: { default: footer(), first: footer() },
    children: s1,
  }];

  if (ctx.showAppendix && ctx.hasRows) {
    const tables = ctx.tables.filter((tb) => tb.rows.length > 0);
    const multi = tables.length > 1;
    sections.push({
      properties: { page: { size: { width: A4_W, height: A4_H, orientation: PageOrientation.LANDSCAPE }, margin: LAND_MARGIN } },
      headers: { default: pageNoHeader(LAND_W) },
      footers: { default: footer() },
      children: [
        p(t('PHỤ LỤC', { bold: true }), { align: C }),
        p(t(`DỮ LIỆU CHI TIẾT ${model.title.toUpperCase()}`, { bold: true }), { align: C }),
        p(t(`(Kèm theo Báo cáo số       ${ctx.docRef} ${ctx.dateWords} của ${L.header.unitName || L.header.agency})`, { italic: true }), { align: C }),
        p(t(`Kỳ báo cáo: ${ctx.periodText}  ·  ${model.filterLines.join('  ·  ') || 'Toàn bộ'}`, { size: 11, italic: true }), { align: C, before: 60, after: 160 }),
        ...tables.flatMap((tb, i) => [
          ...(multi ? [p(t(`${i + 1}. ${tb.title}`, { size: 12, bold: true }), { before: i ? 240 : 0, after: 100 })] : []),
          detailTable(tb),
        ]),
      ],
    });
  }

  const doc = new Document({
    creator: 'VISMA',
    title: `Báo cáo ${model.title}`,
    styles: { default: { document: { run: { font: FONT, size: 26 } } } },
    sections,
  });
  const buf = await Packer.toBuffer(doc);
  return ctx.watermark ? applyWatermarkAlpha(buf, L.watermark.opacity) : buf;
}
