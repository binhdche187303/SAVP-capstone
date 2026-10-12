/**
 * VISITOR_REPORT_SOURCE (RPT-CENTER-BE-001 ↔ VIS-BE-001) — port nối Trung tâm báo cáo → phân hệ Khách.
 *
 * `AccountsModule → ReportsModule` đã tồn tại và `VisitorsModule → AccountsModule`, nên `ReportsModule` KHÔNG được
 * import `VisitorsModule` (vòng). Báo cáo khách lấy số liệu qua token này; `VisitorHooksModule` (toàn cục) đăng ký
 * bằng `useExisting` → `VisitQueryService`, để KPI báo cáo và `GET /visitors/stats` luôn dùng cùng một định nghĩa.
 */
export interface VisitorReportKpis {
  totalVisits: number;
  uniqueVisitors: number;
  avgStayMinutes: number;
  overstayCount: number;
  noShowRate: number;
}

export interface VisitorReportFilter {
  from: string;
  to: string;
  departmentId?: string;
  purpose?: string;
}

export interface VisitorReportSource {
  computeKpis(filter: VisitorReportFilter, now?: Date): Promise<VisitorReportKpis>;
  stats(filter: VisitorReportFilter): Promise<{
    byPeriod: Array<{ bucket: string; count: number }>;
    byDepartment: Array<{ departmentId: string | null; name: string; count: number }>;
  }>;
  reportRows(
    filter: VisitorReportFilter & { status?: string; q?: string },
    page: { page: number; limit: number; sortKey?: string; sortDir?: 'asc' | 'desc' } | null,
    now?: Date,
  ): Promise<{ rows: Array<Record<string, unknown>>; total: number }>;
}

export const VISITOR_REPORT_SOURCE = Symbol('VISITOR_REPORT_SOURCE');
