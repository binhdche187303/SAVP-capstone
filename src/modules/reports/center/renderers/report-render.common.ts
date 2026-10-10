import { formatDateTimeVn } from '../report-format.util.js';
import type { ReportModel } from '../report-model.js';

export const EMPTY_TEXT = 'Không có dữ liệu trong kỳ đã chọn';

export interface ReportRenderMeta {
  generatedAt: Date;
  generatedByEmail: string;
}

const ymdVn = (ymd: string): string => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/** Dòng "Kỳ báo cáo: 01/10/2026 → 07/10/2026" dùng chung ba định dạng. */
export const periodLine = (m: ReportModel): string => `Kỳ báo cáo: ${ymdVn(m.period.from)} đến ${ymdVn(m.period.to)}`;
export const createdLine = (meta: ReportRenderMeta): string => `Người tạo: ${meta.generatedByEmail}  ·  Tạo lúc: ${formatDateTimeVn(meta.generatedAt)}`;

/** Tên tệp: <loại>_<từ>_<đến>.<đuôi> (ASCII, không dấu cách). */
export const reportFileName = (type: string, from: string, to: string, ext: string): string => `${type}_${from}_${to}.${ext}`;
