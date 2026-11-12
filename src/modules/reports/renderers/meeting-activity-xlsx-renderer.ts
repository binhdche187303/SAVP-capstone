import * as ExcelJS from 'exceljs';
import {
  ReportMetadata,
  CoreKpis,
  StatusBreakdownItem,
  MeetingDetailItem,
} from '../services/meeting-activity-report-data.service.js';
import type { ReportData } from './meeting-activity-pdf-renderer.js';

/**
 * renderMeetingActivityXlsx — T027 [FR-028].
 * Render báo cáo hoạt động cuộc họp dưới dạng XLSX.
 * Sử dụng exceljs (mới thêm vào package.json).
 *
 * Cấu trúc workbook:
 *  Sheet 1 "Tổng quan" — Phần 1 (metadata) + Phần 2 (KPI) + Phần 3 (phân bổ trạng thái)
 *  Sheet 2 "Chi tiết cuộc họp" — Phần 4 (1 dòng/cuộc họp)
 *
 * @returns Buffer chứa file .xlsx
 */
export async function renderMeetingActivityXlsx(
  data: ReportData,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'VISMA';
  workbook.created = new Date();

  buildOverviewSheet(workbook, data.metadata, data.kpis, data.statusBreakdown);
  buildDetailSheet(workbook, data.meetingDetails);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ── Sheet 1: Tổng quan ────────────────────────────────────────────────────────

function buildOverviewSheet(
  workbook: ExcelJS.Workbook,
  metadata: ReportMetadata,
  kpis: CoreKpis,
  statusBreakdown: StatusBreakdownItem[],
): void {
  const sheet = workbook.addWorksheet('Tổng quan');
  sheet.columns = [
    { key: 'label', width: 40 },
    { key: 'value', width: 30 },
  ];

  // Title
  sheet.mergeCells('A1:B1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'BÁO CÁO TỔNG HỢP HOẠT ĐỘNG CUỘC HỌP';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 30;

  // ─── Phần 1: Metadata ────────────────────────────────────────────
  appendSectionHeader(sheet, '1. Thông tin báo cáo');

  appendLabelValue(sheet, 'Phạm vi tổ chức', metadata.organizationLabel);
  appendLabelValue(
    sheet,
    'Kỳ báo cáo',
    `${metadata.period.from} → ${metadata.period.to}`,
  );
  appendLabelValue(sheet, 'Người tạo', metadata.extractedByEmail);
  appendLabelValue(
    sheet,
    'Thời điểm tạo',
    metadata.generatedAt.toLocaleString('vi-VN'),
  );
  sheet.addRow([]);

  // ─── Phần 2: KPI ─────────────────────────────────────────────────
  appendSectionHeader(sheet, '2. KPI tổng quan');

  appendLabelValue(sheet, 'Tổng số cuộc họp', kpis.meetingCount);
  appendLabelValue(
    sheet,
    'Tỷ lệ sử dụng phòng (Reservation Utilization) (%)',
    kpis.reservationUtilizationRate,
  );
  appendLabelValue(sheet, 'Tỷ lệ no-show (%)', kpis.noShowRate);
  appendLabelValue(sheet, 'Tỷ lệ đúng giờ On-time Rate (%)', kpis.onTimeRate);
  sheet.addRow([]);

  // ─── Phần 3: Phân bổ trạng thái ──────────────────────────────────
  appendSectionHeader(sheet, '3. Phân bổ trạng thái cuộc họp');

  // Table header
  const headerRow = sheet.addRow(['Trạng thái', 'Số lượng', 'Tỷ lệ (%)']);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDCE6F1' },
    };
    cell.border = {
      bottom: { style: 'thin' },
    };
  });
  sheet.getColumn('C').width = 15;

  statusBreakdown.forEach((item) => {
    const row = sheet.addRow([item.status, item.count, item.percentage]);
    row.getCell(3).numFmt = '0.00"%"';
  });
}

// ── Sheet 2: Chi tiết cuộc họp ────────────────────────────────────────────────

function buildDetailSheet(
  workbook: ExcelJS.Workbook,
  meetingDetails: MeetingDetailItem[],
): void {
  const sheet = workbook.addWorksheet('Chi tiết cuộc họp');

  sheet.columns = [
    { header: 'Mã cuộc họp', key: 'meetingCode', width: 18 },
    { header: 'Tên cuộc họp', key: 'title', width: 35 },
    { header: 'Người tổ chức', key: 'organizerEmail', width: 30 },
    { header: 'Phòng họp', key: 'roomName', width: 20 },
    { header: 'Bắt đầu', key: 'startTime', width: 20 },
    { header: 'Kết thúc', key: 'endTime', width: 20 },
    { header: 'Trạng thái', key: 'status', width: 15 },
    { header: 'Tỷ lệ tham dự (%)', key: 'participationRate', width: 20 },
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2EFDA' },
  };
  headerRow.eachCell((cell) => {
    cell.border = { bottom: { style: 'thin' } };
    cell.alignment = { wrapText: true };
  });

  // Data rows
  meetingDetails.forEach((item) => {
    const row = sheet.addRow({
      meetingCode: item.meetingCode ?? '—',
      title: item.title,
      organizerEmail: item.organizerEmail ?? '—',
      roomName: item.roomName ?? '—',
      startTime: item.startTime ? item.startTime.toLocaleString('vi-VN') : '—',
      endTime: item.endTime ? item.endTime.toLocaleString('vi-VN') : '—',
      status: item.status,
      participationRate: item.participationRate,
    });
    row.getCell('participationRate').numFmt = '0.00"%"';
  });

  if (meetingDetails.length === 0) {
    sheet.addRow(['Không có cuộc họp nào trong kỳ báo cáo.']);
  }
}

// ── Helper functions ──────────────────────────────────────────────────────────

function appendSectionHeader(
  sheet: ExcelJS.Worksheet,
  title: string,
): ExcelJS.Row {
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
  return row;
}

function appendLabelValue(
  sheet: ExcelJS.Worksheet,
  label: string,
  value: string | number,
): void {
  const row = sheet.addRow([label, value]);
  row.getCell(1).font = { bold: false };
}
