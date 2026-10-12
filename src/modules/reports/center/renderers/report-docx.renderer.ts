import {
  AlignmentType, Document, HeadingLevel, Packer, PageOrientation, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { formatCell } from '../report-format.util.js';
import type { ReportModel } from '../report-model.js';
import { createdLine, EMPTY_TEXT, periodLine, type ReportRenderMeta } from './report-render.common.js';

const cell = (text: string, bold = false): TableCell =>
  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold, size: 16 })] })] });

/** Word khổ A4 ngang, cùng bố cục với PDF; bảng thật của Word, hàng tiêu đề lặp qua trang. */
export async function renderReportDocx(model: ReportModel, meta: ReportRenderMeta): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: model.title.toUpperCase(), bold: true })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${periodLine(model)}  ·  ${createdLine(meta)}`, size: 18 })] }),
    ...model.filterLines.map((line) => new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: line, size: 18 })] })),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Tổng hợp' })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: [cell('Chỉ số', true), cell('Giá trị', true)] }),
        ...model.kpis.map((k) => new TableRow({ children: [cell(k.label), cell(formatCell(k.value, k.format))] })),
      ],
    }),
    ...(model.notes ?? []).map((n) => new Paragraph({ children: [new TextRun({ text: `Lưu ý: ${n}`, italics: true, size: 18 })] })),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Dữ liệu chi tiết' })] }),
  ];
  if (model.rows.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: EMPTY_TEXT })] }));
  } else {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: model.columns.map((c) => cell(c.label, true)) }),
        ...model.rows.map((row) => new TableRow({ children: model.columns.map((c) => cell(formatCell(row[c.key], c.format))) })),
      ],
    }));
  }
  const doc = new Document({
    creator: 'SmartTracking System',
    sections: [{ properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } }, children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
