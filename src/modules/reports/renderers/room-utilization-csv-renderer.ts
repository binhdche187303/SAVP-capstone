import { CsvRow } from '../services/room-utilization-report-data.service.js';

/**
 * renderRoomUtilizationCsv — UC-RUM-16 (§0.3 spec.md).
 *
 * CSV KHÁC cấu trúc PDF/Excel: 1 dòng = 1 room_booking_usage, phục vụ
 * import ERP/Data Warehouse ("dữ liệu thô dung lượng lớn"), không phải
 * bảng tổng hợp 4 phần. Dùng exceljs.csv.writeBuffer() — không cần thêm
 * dependency mới (research.md §3).
 *
 * Dynamic import `exceljs` — xem ghi chú ở room-utilization-xlsx-renderer.ts.
 */
export async function renderRoomUtilizationCsv(
  rows: CsvRow[],
): Promise<Buffer> {
  // exceljs là CJS: class nằm ở `.default` khi dynamic import (xem xlsx renderer).
  const mod = await import('exceljs');
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('data');

  sheet.columns = [
    { header: 'bookingId', key: 'bookingId' },
    { header: 'roomCode', key: 'roomCode' },
    { header: 'roomName', key: 'roomName' },
    { header: 'meetingId', key: 'meetingId' },
    { header: 'reservedStartTime', key: 'reservedStartTime' },
    { header: 'reservedEndTime', key: 'reservedEndTime' },
    { header: 'actualStartTime', key: 'actualStartTime' },
    { header: 'actualEndTime', key: 'actualEndTime' },
    { header: 'usageStatus', key: 'usageStatus' },
    { header: 'isNoShow', key: 'isNoShow' },
    { header: 'isReleased', key: 'isReleased' },
    { header: 'releaseType', key: 'releaseType' },
    { header: 'releasedAt', key: 'releasedAt' },
  ];

  rows.forEach((row) => {
    sheet.addRow({
      bookingId: row.bookingId,
      roomCode: row.roomCode,
      roomName: row.roomName,
      meetingId: row.meetingId,
      reservedStartTime: row.reservedStartTime.toISOString(),
      reservedEndTime: row.reservedEndTime.toISOString(),
      actualStartTime: row.actualStartTime
        ? row.actualStartTime.toISOString()
        : '',
      actualEndTime: row.actualEndTime ? row.actualEndTime.toISOString() : '',
      usageStatus: row.usageStatus ?? '',
      isNoShow: row.isNoShow,
      isReleased: row.isReleased,
      releaseType: row.releaseType ?? '',
      releasedAt: row.releasedAt ? row.releasedAt.toISOString() : '',
    });
  });

  const csvBuffer = await workbook.csv.writeBuffer();
  return Buffer.from(csvBuffer);
}
