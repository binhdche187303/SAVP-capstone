import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { ReportModel } from '../report-model.js';
import { EMPTY_TEXT } from './report-render.common.js';
import { renderReportDocx } from './report-docx.renderer.js';
import { renderReportPdf } from './report-pdf.renderer.js';
import { renderReportXlsx } from './report-xlsx.renderer.js';

const meta = { generatedAt: new Date('2026-10-08T03:00:00Z'), generatedByEmail: 'admin@fpt.edu.vn' };
const columns = [
  { key: 'fullName', label: 'Họ tên', format: 'text' as const },
  { key: 'workDays', label: 'Ngày công', format: 'number' as const },
  { key: 'rate', label: 'Tỷ lệ', format: 'percent' as const },
  { key: 'checkInTime', label: 'Giờ vào', format: 'datetime' as const },
];
const model = (rows: Array<Record<string, unknown>>): ReportModel => ({
  type: 'staff-attendance', title: 'Chuyên cần cán bộ', period: { from: '2026-10-01', to: '2026-10-07' },
  filterLines: ['Đơn vị: Khoa CNTT & Truyền thông'],
  kpis: [{ key: 'attendanceRate', label: 'Tỷ lệ chuyên cần', value: 92.5, format: 'percent' }, { key: 'lateCount', label: 'Lượt đi muộn', value: 1234, format: 'number' }],
  charts: [], columns, rows, total: rows.length, notes: ['Chưa trừ ngày nghỉ lễ'],
});
const rows = [
  { fullName: 'Nguyễn Thị Hồng Ánh', workDays: 5, rate: 80, checkInTime: '2026-10-07T17:30:00Z' },
  { fullName: 'A <b> & "Tên" lạ', workDays: 1200, rate: 33.3, checkInTime: null },
];

describe('renderReportXlsx', () => {
  it('2 sheet "Tổng hợp" và "Dữ liệu"; A1 là tiêu đề; số là số, ngày giờ là ngày giờ (giờ VN)', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderReportXlsx(model(rows), meta)) as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Tổng hợp', 'Dữ liệu']);
    expect(wb.getWorksheet('Tổng hợp')?.getCell('A1').value).toBe('CHUYÊN CẦN CÁN BỘ');
    const data = wb.getWorksheet('Dữ liệu')!;
    expect(data.getRow(1).values).toEqual([undefined, 'Họ tên', 'Ngày công', 'Tỷ lệ', 'Giờ vào']);
    expect(data.getCell('B2').value).toBe(5);
    expect(typeof data.getCell('B3').value).toBe('number');
    const when = data.getCell('D2').value as Date;
    expect(when).toBeInstanceOf(Date);
    expect(when.toISOString()).toBe('2026-10-08T00:30:00.000Z'); // 17:30Z = 00:30 hôm sau giờ VN
    expect(data.getCell('D3').value).toBeNull();
    expect(data.getCell('A2').value).toBe('Nguyễn Thị Hồng Ánh');
  });

  it('mô hình rỗng: ô A2 của "Dữ liệu" là thông báo không có dữ liệu', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderReportXlsx(model([]), meta)) as never);
    expect(wb.getWorksheet('Dữ liệu')?.getCell('A2').value).toBe(EMPTY_TEXT);
  });
});

describe('renderReportDocx', () => {
  const xml = async (buf: Buffer) => (await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string'));

  it('có tiêu đề, kỳ, nhãn cột, chữ có dấu còn nguyên, ký tự đặc biệt được thoát', async () => {
    const x = await xml(await renderReportDocx(model(rows), meta));
    for (const text of ['CHUYÊN CẦN CÁN BỘ', 'Kỳ báo cáo: 01/10/2026 đến 07/10/2026', 'Họ tên', 'Ngày công', 'Nguyễn Thị Hồng Ánh', '92,5%', '1.234', '08/10/2026 00:30']) {
      expect(x).toContain(text);
    }
    expect(x).toContain('A &lt;b&gt; &amp; &quot;Tên&quot; lạ'); // < > & " được thoát
    expect(x).not.toContain('<b>');
  });

  it('mô hình rỗng có thông báo không có dữ liệu', async () => {
    expect(await xml(await renderReportDocx(model([]), meta))).toContain(EMPTY_TEXT);
  });
});

describe('renderReportPdf', () => {
  it('bắt đầu bằng %PDF và dựng được với tên có dấu', async () => {
    const buf = await renderReportPdf(model(rows), meta);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(1500);
  });

  it('500 dòng → nhiều hơn 1 trang', async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ fullName: `Nhân viên số ${i}`, workDays: i, rate: 50, checkInTime: '2026-10-07T01:00:00Z' }));
    const buf = await renderReportPdf(model(many), meta);
    const pages = (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(1);
  });

  it('mô hình rỗng vẫn dựng được', async () => {
    expect((await renderReportPdf(model([]), meta)).subarray(0, 4).toString()).toBe('%PDF');
  });
});
