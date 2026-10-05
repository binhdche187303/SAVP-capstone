import type ExcelJS from 'exceljs';
import type { RoomUtilizationReportData } from './room-utilization-pdf-renderer.js';

/**
 * renderRoomUtilizationXlsx — UC-RUM-16.
 * Sheet 1 "Tổng quan": thông tin chung + Utilization Rate + No-show Rate.
 * Sheet 2 "Sử dụng theo phòng": Phần Actual Usage (1 dòng/phòng).
 * Sheet 3 "Phòng bị thu hồi": Phần Released Rooms (1 dòng/sự kiện).
 *
 * Dynamic import `exceljs` — tránh load package này ở module-parse-time
 * (mirror pattern StorageService dùng cho `minio`: "tránh phá Jest nếu
 * chưa cần dùng" — exceljs kéo theo submodule `stream/xlsx/workbook-reader`
 * gây lỗi trong 1 số môi trường Jest nếu bị import tĩnh chỉ vì cùng cây
 * import với 1 processor khác không thực sự gọi tới renderer này).
 */
export async function renderRoomUtilizationXlsx(
  data: RoomUtilizationReportData,
): Promise<Buffer> {
  // exceljs là CJS: dynamic import trả namespace với class nằm ở `.default`
  // (`.Workbook` ở top-level = undefined → "Workbook is not a constructor").
  const mod = await import('exceljs');
  const ExcelJSModule = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const workbook = new ExcelJSModule.Workbook();
  workbook.creator = 'SmartTracking System';
  workbook.created = new Date();

  buildOverviewSheet(workbook, data);
  buildUsageByRoomSheet(workbook, data);
  buildReleasedRoomsSheet(workbook, data);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function buildOverviewSheet(
  workbook: ExcelJS.Workbook,
  data: RoomUtilizationReportData,
): void {
  const sheet = workbook.addWorksheet('Tổng quan');
  sheet.columns = [
    { key: 'label', width: 40 },
    { key: 'value', width: 30 },
  ];

  sheet.mergeCells('A1:B1');
  const title = sheet.getCell('A1');
  title.value = 'BÁO CÁO SỬ DỤNG PHÒNG HỌP';
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 30;

  sectionHeader(sheet, '1. Thông tin chung');
  appendLabelValue(sheet, 'Phạm vi', data.metadata.organizationLabel);
  appendLabelValue(
    sheet,
    'Kỳ báo cáo',
    `${data.metadata.period.from} → ${data.metadata.period.to}`,
  );
  appendLabelValue(sheet, 'Người tạo', data.metadata.extractedByEmail);
  appendLabelValue(
    sheet,
    'Thời điểm tạo',
    data.metadata.generatedAt.toLocaleString('vi-VN'),
  );
  sheet.addRow([]);

  sectionHeader(sheet, '2. Tỷ lệ lấp đầy (Utilization Rate)');
  appendLabelValue(
    sheet,
    'Tỷ lệ lấp đầy (Reservation) (%)',
    data.utilization.reservationUtilizationRate,
  );
  appendLabelValue(
    sheet,
    'Tỷ lệ sử dụng thực tế (Occupancy) (%)',
    data.utilization.roomOccupancyRate,
  );
  appendLabelValue(sheet, 'Số giờ đã đặt', data.utilization.bookedHours);
  appendLabelValue(
    sheet,
    'Số giờ sử dụng thực tế',
    data.utilization.actualHours,
  );
  appendLabelValue(sheet, 'Số giờ khả dụng', data.utilization.availableHours);
  sheet.addRow([]);

  sectionHeader(sheet, '3. Tỷ lệ vắng mặt (No-show Rate)');
  appendLabelValue(sheet, 'Số lượt No-show', data.noShow.noShowCount);
  appendLabelValue(sheet, 'Tổng số lượt đặt phòng', data.noShow.totalBookings);
  appendLabelValue(sheet, 'Tỷ lệ No-show (%)', data.noShow.noShowRate);
}

function buildUsageByRoomSheet(
  workbook: ExcelJS.Workbook,
  data: RoomUtilizationReportData,
): void {
  const sheet = workbook.addWorksheet('Sử dụng theo phòng');
  sheet.columns = [
    { header: 'Mã phòng', key: 'roomCode', width: 15 },
    { header: 'Tên phòng', key: 'roomName', width: 30 },
    { header: 'Giờ đã đặt', key: 'bookedHours', width: 15 },
    { header: 'Giờ sử dụng thực tế', key: 'actualHours', width: 18 },
    { header: 'Tỷ lệ sử dụng (%)', key: 'roomOccupancyRate', width: 18 },
  ];
  styleHeaderRow(sheet, 'FFDCE6F1');

  data.usageByRoom.forEach((row) => sheet.addRow(row));
  if (data.usageByRoom.length === 0) {
    sheet.addRow(['Không có dữ liệu sử dụng phòng trong kỳ báo cáo.']);
  }
}

function buildReleasedRoomsSheet(
  workbook: ExcelJS.Workbook,
  data: RoomUtilizationReportData,
): void {
  const sheet = workbook.addWorksheet('Phòng bị thu hồi');
  sheet.columns = [
    { header: 'Mã phòng', key: 'roomCode', width: 15 },
    { header: 'Tên phòng', key: 'roomName', width: 30 },
    { header: 'Loại thu hồi', key: 'eventType', width: 20 },
    { header: 'Thời điểm', key: 'eventTime', width: 22 },
    { header: 'Trạng thái cũ', key: 'oldStatus', width: 15 },
    { header: 'Trạng thái mới', key: 'newStatus', width: 15 },
  ];
  styleHeaderRow(sheet, 'FFE2EFDA');

  data.releasedRooms.forEach((row) => {
    sheet.addRow({
      roomCode: row.roomCode,
      roomName: row.roomName,
      eventType:
        row.eventType === 'room_auto_released'
          ? 'Tự động (No-show)'
          : 'Thủ công',
      eventTime: row.eventTime.toLocaleString('vi-VN'),
      oldStatus: row.oldStatus ?? '—',
      newStatus: row.newStatus ?? '—',
    });
  });
  if (data.releasedRooms.length === 0) {
    sheet.addRow(['Không có phòng nào bị thu hồi trong kỳ báo cáo.']);
  }
}

function sectionHeader(sheet: ExcelJS.Worksheet, title: string): void {
  sheet.mergeCells(`A${sheet.rowCount + 1}:B${sheet.rowCount + 1}`);
  const row = sheet.getRow(sheet.rowCount);
  row.getCell(1).value = title;
  row.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF1F497D' } };
  row.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9E1F2' },
  };
  row.height = 22;
}

function appendLabelValue(
  sheet: ExcelJS.Worksheet,
  label: string,
  value: string | number,
): void {
  const row = sheet.addRow([label, value]);
  row.getCell(1).font = { bold: false };
}

function styleHeaderRow(sheet: ExcelJS.Worksheet, argb: string): void {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  headerRow.eachCell((cell) => {
    cell.border = { bottom: { style: 'thin' } };
    cell.alignment = { wrapText: true };
  });
}
