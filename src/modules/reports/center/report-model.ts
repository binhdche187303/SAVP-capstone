// RPT-CENTER-BE-001 §3 — mô hình báo cáo trung gian giữa dữ liệu và trình bày.
export type ReportType =
  | 'staff-attendance' | 'student-attendance' | 'gate-access' | 'room-utilization'
  | 'vehicle' | 'visitor' | 'security-alert';

export type CellFormat = 'text' | 'number' | 'percent' | 'hours' | 'minutes' | 'duration' | 'datetime';

export interface ReportFilterDefinition {
  key: string;
  label: string;
  /** `lookup`: giá trị lấy từ `GET /reports/lookups`; `options`: danh sách cố định. */
  lookup?: string;
  options?: { value: string; label: string }[];
}

export interface ReportDefinition {
  type: ReportType;
  title: string;
  description: string;
  available: boolean;
  unavailableReason?: string;
  /** false → MANAGER không có phạm vi theo đơn vị cho loại này (403 REPORT_OUT_OF_SCOPE). */
  hasDepartmentScope: boolean;
  filters: ReportFilterDefinition[];
  kpis: { key: string; label: string; format: CellFormat }[];
  charts: { key: string; title: string; kind: 'line' | 'bar' | 'pie'; xKey: string; series: { key: string; label: string }[] }[];
  columns: { key: string; label: string; format: CellFormat }[];
}

export interface ReportFilters {
  from: string;
  to: string;
  q?: string;
  [key: string]: string | undefined;
}

export interface ReportPage {
  page: number;
  limit: number;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
}

/** Phạm vi dữ liệu đã phân giải theo vai trò: `departmentIds === null` nghĩa là không giới hạn. */
export interface ResolvedScope {
  unrestricted: boolean;
  departmentIds: string[] | null;
}

export interface ReportTable {
  title: string;
  columns: { key: string; label: string; format: CellFormat }[];
  rows: Record<string, unknown>[];
}

export interface ReportModel {
  /** `document`: văn bản dựng từ dữ liệu trang khác gửi lên (POST /report-templates/render-document), không qua provider. */
  type: ReportType | 'document';
  title: string;
  period: { from: string; to: string };
  filterLines: string[];
  /** `unit` / `display` chỉ dùng cho bản quy chuẩn: ghi đè đơn vị tính / chữ hiển thị (chỉ tiêu dạng chữ có `value = null`). */
  kpis: { key: string; label: string; value: number | null; format: CellFormat; unit?: string; display?: string }[];
  charts: { key: string; data: Record<string, unknown>[] }[];
  columns: { key: string; label: string; format: CellFormat }[];
  rows: Record<string, unknown>[];
  total: number;
  notes?: string[];
  /** Ghi đè dòng "Nguồn dữ liệu" của bản quy chuẩn. */
  dataSource?: string;
  /** Nhiều bảng phụ lục (bản quy chuẩn). Không có = một bảng `columns` / `rows`. */
  tables?: ReportTable[];
}

export interface ReportProvider {
  readonly type: ReportType;
  /** `page = null` khi xuất file (lấy toàn bộ, vẫn sắp xếp mặc định). */
  build(filters: ReportFilters, scope: ResolvedScope, page: ReportPage | null, now: Date): Promise<ReportModel>;
}

export const REPORT_PROVIDERS = Symbol('REPORT_PROVIDERS');
