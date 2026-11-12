import * as ExcelJS from 'exceljs';
import type {
  SecurityAlertExportRow,
  SecurityAlertStatusCounts,
} from '../services/security-alert-report-data.service.js';
import type { SecurityAlertReportMeta } from './security-alert-pdf-renderer.js';

const STATUS_LABEL: Record<string, string> = {
  new: 'Mới',
  acknowledged: 'Đã tiếp nhận',
  resolved: 'Đã xử lý',
};

/**
 * renderSecurityAlertXlsx — UC-129.
 * 1 sheet, 1 dòng/1 cảnh báo, header tổng hợp (tổng số + phân bổ theo status).
 */
export async function renderSecurityAlertXlsx(
  rows: SecurityAlertExportRow[],
  statusCounts: SecurityAlertStatusCounts,
  meta: SecurityAlertReportMeta,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'VISMA';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Sự kiện an ninh');

  sheet.mergeCells('A1:I1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'BÁO CÁO SỰ KIỆN AN NINH';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:I2');
  sheet.getCell('A2').value =
    `Kỳ báo cáo: ${meta.from} → ${meta.to}  |  Tổng số: ${rows.length}  |  Mới: ${statusCounts.new}  |  Đã tiếp nhận: ${statusCounts.acknowledged}  |  Đã xử lý: ${statusCounts.resolved}`;
  sheet.getCell('A2').alignment = { horizontal: 'center' };
  sheet.addRow([]);

  const headerRow = sheet.addRow([
    'Loại cảnh báo',
    'Mức độ',
    'Khu vực',
    'Trạng thái',
    'Thời điểm phát sinh',
    'Số lần lặp',
    'Người tiếp nhận',
    'Thời điểm tiếp nhận',
    'Người xử lý',
    'Thời điểm xử lý',
    'Ghi chú xử lý',
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
    { key: 'alertType', width: 18 },
    { key: 'severity', width: 12 },
    { key: 'zoneName', width: 22 },
    { key: 'status', width: 16 },
    { key: 'triggeredAt', width: 20 },
    { key: 'occurrenceCount', width: 12 },
    { key: 'acknowledgedByName', width: 20 },
    { key: 'acknowledgedAt', width: 20 },
    { key: 'resolvedByName', width: 20 },
    { key: 'resolvedAt', width: 20 },
    { key: 'resolutionNote', width: 30 },
  ];

  rows.forEach((row) => {
    sheet.addRow([
      row.alertType,
      row.severity,
      row.zoneName,
      STATUS_LABEL[row.status] ?? row.status,
      row.triggeredAt.toLocaleString('vi-VN'),
      row.occurrenceCount,
      row.acknowledgedByName ?? '—',
      row.acknowledgedAt ? row.acknowledgedAt.toLocaleString('vi-VN') : '—',
      row.resolvedByName ?? '—',
      row.resolvedAt ? row.resolvedAt.toLocaleString('vi-VN') : '—',
      row.resolutionNote ?? '—',
    ]);
  });

  if (rows.length === 0) {
    sheet.addRow(['Không có dữ liệu trong khoảng thời gian đã chọn.']);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
