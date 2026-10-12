import * as ExcelJS from 'exceljs';
import { toExcelValue } from '../report-format.util.js';
import type { CellFormat, ReportModel } from '../report-model.js';
import { createdLine, EMPTY_TEXT, periodLine, type ReportRenderMeta } from './report-render.common.js';

const NUM_FMT: Partial<Record<CellFormat, string>> = {
  number: '#,##0',
  percent: '0.0"%"',
  hours: '0.0" giờ"',
  minutes: '0" phút"',
  duration: '0', // số giây
  datetime: 'dd/mm/yyyy hh:mm',
};

/** Excel 2 sheet: "Tổng hợp" và "Dữ liệu". Số là số, ngày giờ là ngày giờ (không phải chuỗi). */
export async function renderReportXlsx(model: ReportModel, meta: ReportRenderMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SmartTracking System';
  wb.created = meta.generatedAt;

  const summary = wb.addWorksheet('Tổng hợp');
  summary.getColumn(1).width = 34;
  summary.getColumn(2).width = 22;
  summary.getCell('A1').value = model.title.toUpperCase();
  summary.getCell('A1').font = { bold: true, size: 14 };
  summary.getCell('A2').value = periodLine(model);
  summary.getCell('A3').value = createdLine(meta);
  let r = 4;
  for (const line of model.filterLines) summary.getCell(`A${r++}`).value = line;
  r += 1;
  summary.getRow(r).values = ['Chỉ số', 'Giá trị'];
  summary.getRow(r).font = { bold: true };
  r += 1;
  for (const k of model.kpis) {
    summary.getCell(`A${r}`).value = k.label;
    const c = summary.getCell(`B${r}`);
    c.value = toExcelValue(k.value, k.format);
    if (NUM_FMT[k.format]) c.numFmt = NUM_FMT[k.format] as string;
    r += 1;
  }
  r += 1;
  for (const note of model.notes ?? []) summary.getCell(`A${r++}`).value = `Lưu ý: ${note}`;

  const data = wb.addWorksheet('Dữ liệu');
  data.getRow(1).values = model.columns.map((c) => c.label);
  data.getRow(1).font = { bold: true };
  data.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F7' } };
  data.views = [{ state: 'frozen', ySplit: 1 }];
  model.columns.forEach((c, i) => { data.getColumn(i + 1).width = c.format === 'datetime' ? 18 : Math.max(12, Math.min(34, c.label.length + 6)); });
  if (model.rows.length === 0) {
    data.getCell('A2').value = EMPTY_TEXT;
  } else {
    model.rows.forEach((row, ri) => {
      const excelRow = data.getRow(ri + 2);
      model.columns.forEach((c, ci) => {
        const cell = excelRow.getCell(ci + 1);
        cell.value = toExcelValue(row[c.key], c.format);
        if (NUM_FMT[c.format]) cell.numFmt = NUM_FMT[c.format] as string;
      });
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
