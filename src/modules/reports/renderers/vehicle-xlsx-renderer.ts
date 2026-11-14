import * as ExcelJS from 'exceljs';
import type {
  VehicleReportData,
  VehicleReportMeta,
} from './vehicle-pdf-renderer.js';

/**
 * renderVehicleXlsx — UC-128.
 * Sheet riêng cho mỗi phần khi content='both' (FR-025 spec: KHÔNG trộn 2 nguồn).
 */
export async function renderVehicleXlsx(
  data: VehicleReportData,
  meta: VehicleReportMeta,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'VISMA';
  workbook.created = new Date();

  if (data.registrations) {
    buildRegistrationsSheet(workbook, data.registrations, meta);
  }
  if (data.trafficStats) {
    buildTrafficStatsSheet(workbook, data.trafficStats, meta);
  }

  if (!data.registrations && !data.trafficStats) {
    const sheet = workbook.addWorksheet('Báo cáo phương tiện');
    sheet.addRow(['Không có dữ liệu trong khoảng thời gian đã chọn.']);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function buildRegistrationsSheet(
  workbook: ExcelJS.Workbook,
  rows: VehicleReportData['registrations'],
  meta: VehicleReportMeta,
): void {
  const sheet = workbook.addWorksheet('Danh sách đăng ký');
  sheet.mergeCells('A1:G1');
  sheet.getCell('A1').value = 'DANH SÁCH ĐĂNG KÝ PHƯƠNG TIỆN';
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:G2');
  sheet.getCell('A2').value =
    `Kỳ báo cáo: ${meta.from} → ${meta.to}  |  Tổng số: ${rows?.length ?? 0}`;
  sheet.getCell('A2').alignment = { horizontal: 'center' };
  sheet.addRow([]);

  const headerRow = sheet.addRow([
    'Biển số',
    'Biển gốc',
    'Loại xe',
    'Trạng thái',
    'Mã NV chủ xe',
    'Họ tên chủ xe',
    'Ghi chú',
    'Ngày đăng ký',
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
    { key: 'plateNumber', width: 16 },
    { key: 'plateRaw', width: 16 },
    { key: 'vehicleType', width: 14 },
    { key: 'status', width: 14 },
    { key: 'employeeCode', width: 16 },
    { key: 'fullName', width: 24 },
    { key: 'note', width: 28 },
    { key: 'createdAt', width: 18 },
  ];

  (rows ?? []).forEach((row) => {
    sheet.addRow([
      row.plateNumber,
      row.plateRaw,
      row.vehicleType ?? '—',
      row.status,
      row.ownerEmployeeCode ?? '—',
      row.ownerFullName ?? '—',
      row.note ?? '—',
      row.createdAt.toLocaleDateString('vi-VN'),
    ]);
  });

  if (!rows || rows.length === 0) {
    sheet.addRow(['Không có dữ liệu trong khoảng thời gian đã chọn.']);
  }
}

function buildTrafficStatsSheet(
  workbook: ExcelJS.Workbook,
  stats: NonNullable<VehicleReportData['trafficStats']>,
  meta: VehicleReportMeta,
): void {
  const sheet = workbook.addWorksheet('Thống kê lưu lượng');
  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = 'THỐNG KÊ LƯU LƯỢNG PHƯƠNG TIỆN';
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:D2');
  sheet.getCell('A2').value = `Kỳ báo cáo: ${meta.from} → ${meta.to}`;
  sheet.getCell('A2').alignment = { horizontal: 'center' };
  sheet.addRow([]);

  const s = stats.summary;
  [
    ['Tổng sự kiện', s.total_events],
    ['Đã đối chiếu', s.total_matched],
    ['Chưa đối chiếu', s.total_unmatched],
    ['Lượt vào', s.total_enter],
    ['Lượt ra', s.total_leave],
    ['Lượt phát hiện (seen)', s.total_seen],
    ['Số xe duy nhất', s.unique_vehicles],
  ].forEach(([label, value]) => sheet.addRow([label, value]));
  sheet.addRow([]);

  const headerRow = sheet.addRow(['Thời điểm', 'Vào', 'Ra', 'Phát hiện']);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2EFDA' },
    };
    cell.border = { bottom: { style: 'thin' } };
  });
  sheet.columns = [
    { key: 'bucket', width: 20 },
    { key: 'enter', width: 12 },
    { key: 'leave', width: 12 },
    { key: 'seen', width: 12 },
  ];

  stats.series.forEach((bucket) => {
    sheet.addRow([bucket.bucket, bucket.enter, bucket.leave, bucket.seen]);
  });

  if (stats.series.length === 0) {
    sheet.addRow([
      'Không có dữ liệu chuỗi thời gian trong khoảng thời gian đã chọn.',
    ]);
  }
}
