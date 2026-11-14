import * as ExcelJS from 'exceljs';
import type { GateAccessExportRow } from '../services/gate-access-report-data.service.js';
import type { GateAccessReportMeta } from './gate-access-pdf-renderer.js';

/**
 * renderGateAccessXlsx — UC-127.
 * 1 sheet, 1 dòng/1 phiên (chỉ session_status='completed'), header tổng hợp.
 */
export async function renderGateAccessXlsx(
  rows: GateAccessExportRow[],
  meta: GateAccessReportMeta,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'VISMA';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Ra vào khuôn viên');

  sheet.mergeCells('A1:I1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'BÁO CÁO RA VÀO KHUÔN VIÊN';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:I2');
  sheet.getCell('A2').value =
    `Kỳ báo cáo: ${meta.from} → ${meta.to}  |  Người tạo: ${meta.extractedByEmail}  |  Tổng số phiên: ${rows.length}`;
  sheet.getCell('A2').alignment = { horizontal: 'center' };
  sheet.addRow([]);

  const headerRow = sheet.addRow([
    'Mã cổng',
    'Tên cổng',
    'Mã NV',
    'Họ tên',
    'Phòng ban',
    'Biển số',
    'Giờ vào',
    'Giờ ra',
    'Thời lượng (giây)',
  ]);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDCE6F1' },
    };
    cell.border = { bottom: { style: 'thin' } };
  });

  sheet.columns = [
    { key: 'zoneCode', width: 14 },
    { key: 'zoneName', width: 24 },
    { key: 'employeeCode', width: 14 },
    { key: 'fullName', width: 24 },
    { key: 'departmentName', width: 22 },
    { key: 'plateNumber', width: 14 },
    { key: 'checkInTime', width: 20 },
    { key: 'checkOutTime', width: 20 },
    { key: 'durationSeconds', width: 16 },
  ];

  rows.forEach((row) => {
    sheet.addRow([
      row.zoneCode ?? '—',
      row.zoneName ?? '—',
      row.employeeCode ?? '—',
      row.fullName ?? '—',
      row.departmentName ?? '—',
      row.plateNumber ?? '—',
      row.checkInTime ? row.checkInTime.toLocaleString('vi-VN') : '—',
      row.checkOutTime ? row.checkOutTime.toLocaleString('vi-VN') : '—',
      row.durationSeconds ?? '—',
    ]);
  });

  if (rows.length === 0) {
    sheet.addRow(['Không có dữ liệu trong khoảng thời gian đã chọn.']);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
