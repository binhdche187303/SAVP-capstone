import * as ExcelJS from 'exceljs';
import type { UserExportRow } from '../services/user-export-data.service.js';

export interface UserExportMeta {
  generatedAt: Date;
  extractedByEmail: string;
}

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** Format theo giờ Việt Nam, dạng dd/MM/yyyy HH:mm:ss, dễ đọc trong Excel. */
function formatVnDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: VN_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * renderUserExportXlsx (BE-04) — 1 sheet, 1 dòng/user. Mirror style
 * renderGateAccessXlsx (renderers/gate-access-xlsx-renderer.ts).
 */
export async function renderUserExportXlsx(
  rows: UserExportRow[],
  meta: UserExportMeta,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'VISMA';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Danh sách người dùng');

  sheet.mergeCells('A1:H1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'DANH SÁCH NGƯỜI DÙNG';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:H2');
  sheet.getCell('A2').value =
    `Người tạo: ${meta.extractedByEmail}  |  Thời điểm xuất: ${formatVnDateTime(meta.generatedAt)}  |  Tổng số: ${rows.length}`;
  sheet.getCell('A2').alignment = { horizontal: 'center' };
  sheet.addRow([]);

  const headerRow = sheet.addRow([
    'Mã NV',
    'Họ tên',
    'Email',
    'Số điện thoại',
    'Phòng ban',
    'Trạng thái',
    'Vai trò',
    'Ngày tạo',
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

  for (const row of rows) {
    sheet.addRow([
      row.employeeCode ?? '',
      row.fullName,
      row.email,
      row.phoneNumber ?? '',
      row.departmentName ?? '',
      row.accountStatus,
      row.roles.join(', '),
      formatVnDateTime(row.createdAt),
    ]);
  }

  sheet.columns.forEach((col) => {
    col.width = 22;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
