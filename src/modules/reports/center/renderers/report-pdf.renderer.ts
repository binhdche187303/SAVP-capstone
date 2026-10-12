import PDFDocument from 'pdfkit';
import { registerVietnamesePdfFonts, VN_FONT_BOLD, VN_FONT_REGULAR } from '../../../../common/utils/pdf-font.util.js';
import { formatCell } from '../report-format.util.js';
import type { ReportModel } from '../report-model.js';
import { createdLine, EMPTY_TEXT, periodLine, type ReportRenderMeta } from './report-render.common.js';

const MARGIN = 36;
const ROW_H = 16;

/** PDF A4 ngang: tiêu đề, kỳ, bộ lọc, bảng KPI, bảng dữ liệu có lặp tiêu đề cột qua các trang. */
export function renderReportPdf(model: ReportModel, meta: ReportRenderMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: MARGIN, size: 'A4', layout: 'landscape' });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      registerVietnamesePdfFonts(doc);

      const width = doc.page.width - MARGIN * 2;
      doc.font(VN_FONT_BOLD).fontSize(16).text(model.title.toUpperCase(), { align: 'center' });
      doc.moveDown(0.3);
      doc.font(VN_FONT_REGULAR).fontSize(9).fillColor('#555555').text(`${periodLine(model)}  ·  ${createdLine(meta)}`, { align: 'center' });
      for (const line of model.filterLines) doc.text(line, { align: 'center' });
      doc.fillColor('#000000').moveDown(0.6);

      // Bảng KPI: nhãn + giá trị, chia hai cột.
      doc.font(VN_FONT_BOLD).fontSize(10).text('Tổng hợp');
      doc.font(VN_FONT_REGULAR).fontSize(9);
      for (const k of model.kpis) {
        doc.text(`${k.label}: ${formatCell(k.value, k.format)}`);
      }
      for (const note of model.notes ?? []) doc.fillColor('#8a5a00').text(`Lưu ý: ${note}`).fillColor('#000000');
      doc.moveDown(0.6);

      doc.font(VN_FONT_BOLD).fontSize(10).text('Dữ liệu chi tiết');
      doc.moveDown(0.3);
      if (model.rows.length === 0) {
        doc.font(VN_FONT_REGULAR).fontSize(10).text(EMPTY_TEXT);
        doc.end();
        return;
      }

      const colW = width / model.columns.length;
      const drawRow = (cells: string[], bold: boolean, shade: boolean) => {
        const y = doc.y;
        if (shade) doc.rect(MARGIN, y - 2, width, ROW_H).fill('#eef2f7').fillColor('#000000');
        doc.font(bold ? VN_FONT_BOLD : VN_FONT_REGULAR).fontSize(7.5);
        cells.forEach((text, i) => {
          doc.text(text, MARGIN + i * colW + 2, y, { width: colW - 4, height: ROW_H - 2, ellipsis: true, lineBreak: false });
        });
        doc.y = y + ROW_H;
        doc.x = MARGIN;
      };
      const header = () => drawRow(model.columns.map((c) => c.label), true, true);
      header();
      for (const row of model.rows) {
        if (doc.y > doc.page.height - MARGIN - ROW_H) {
          doc.addPage();
          doc.y = MARGIN;
          header();
        }
        drawRow(model.columns.map((c) => formatCell(row[c.key], c.format)), false, false);
      }
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
