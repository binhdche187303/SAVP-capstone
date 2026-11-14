import { REPORT_DEFINITIONS } from '../center/report-definition.registry.js';
import type { CellFormat, ReportModel, ReportType } from '../center/report-model.js';

/**
 * Dữ liệu mẫu để xem thử một mẫu báo cáo trên màn hình cấu hình — không đụng dữ liệu thật,
 * nên người chỉ có quyền sửa mẫu không nhìn thấy số liệu ngoài phạm vi của mình.
 */

const NAMES = ['Nguyễn Văn An', 'Trần Thị Bình', 'Lê Hoàng Cường', 'Phạm Thu Dung', 'Võ Minh Đức', 'Đặng Ngọc Giang', 'Bùi Thanh Hà', 'Huỳnh Gia Khánh'];
const UNITS = ['Phòng Hành chính', 'Phòng Đào tạo', 'Khoa Kinh tế', 'Khoa Luật', 'Phòng Công nghệ thông tin'];
const TEXT: Array<[RegExp, string[]]> = [
  [/department/i, UNITS],
  [/name$|^fullName$|owner|host|visitor/i, NAMES],
  [/zone|gate/i, ['Cổng chính', 'Cổng phụ', 'Cổng nhà xe']],
  [/plate/i, ['51F-123.45', '59X1-678.90', '50H-246.80', '59P2-135.79']],
  [/direction/i, ['Vào', 'Ra']],
  [/room/i, ['Phòng họp A.101', 'Phòng họp B.203', 'Hội trường C']],
  [/building/i, ['Tòa A', 'Tòa B', 'Tòa C']],
  [/vehicleType/i, ['Ô tô', 'Xe máy']],
  [/severity/i, ['Cao', 'Trung bình', 'Thấp']],
  [/type|status/i, ['Loại 1', 'Loại 2', 'Loại 3']],
  [/camera/i, ['Camera cổng chính 01', 'Camera sảnh A 02']],
  [/organization/i, ['Công ty TNHH Minh Phát', 'Sở Giáo dục và Đào tạo', 'Ngân hàng ABC']],
  [/purpose|subject|class/i, ['Làm việc với Phòng Hành chính', 'Kinh tế vi mô', 'Luật dân sự']],
];
const KPI_NUMBERS = [12345, 12001, 344, 187, 96, 52, 18, 7];

function textSample(key: string, i: number): string {
  if (/code/i.test(key)) return `MS${String(1001 + i).padStart(5, '0')}`;
  const list = TEXT.find(([re]) => re.test(key))?.[1];
  return list ? list[i % list.length] : `Nội dung ${i + 1}`;
}

function cellSample(key: string, format: CellFormat, i: number, day: string): unknown {
  switch (format) {
    case 'datetime': return new Date(Date.parse(`${day}T00:15:00.000Z`) + i * 173 * 60_000).toISOString();
    case 'number': return 3 + ((i * 7) % 23);
    case 'percent': return 78 + ((i * 3.5) % 21);
    case 'hours': return 4 + ((i * 1.5) % 6);
    case 'minutes': return 15 + ((i * 11) % 90);
    case 'duration': return i % 5 === 0 ? null : 1800 + i * 431;
    default: return textSample(key, i);
  }
}

function kpiSample(format: CellFormat, i: number): number {
  switch (format) {
    case 'percent': return [92.4, 87.5, 95.1][i % 3];
    case 'hours': return [126.5, 98, 42.5][i % 3];
    case 'minutes': return [187, 42, 15][i % 3];
    case 'duration': return [11_220, 5400][i % 2];
    default: return KPI_NUMBERS[i % KPI_NUMBERS.length];
  }
}

/** `today` dạng YYYY-MM-DD (giờ Việt Nam). Kỳ mẫu là 7 ngày kết thúc hôm nay. */
export function sampleReportModel(type: ReportType, today: string, rows = 12): ReportModel {
  const def = REPORT_DEFINITIONS[type];
  const end = new Date(`${today}T00:00:00.000Z`);
  const from = new Date(end.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  return {
    type,
    title: def.title,
    period: { from, to: today },
    filterLines: [],
    kpis: def.kpis.map((k, i) => ({ key: k.key, label: k.label, format: k.format, value: kpiSample(k.format, i) })),
    charts: [],
    columns: def.columns.map((c) => ({ key: c.key, label: c.label, format: c.format })),
    rows: Array.from({ length: rows }, (_, i) => Object.fromEntries(def.columns.map((c) => [c.key, cellSample(c.key, c.format, i, from)]))),
    total: rows,
    notes: ['Số liệu minh họa — chỉ dùng để xem thử bố cục mẫu.'],
  };
}
