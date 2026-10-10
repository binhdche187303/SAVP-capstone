import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { VISITOR_REPORT_SOURCE, type VisitorReportSource } from '../../../../common/ports/visitor-report-source.js';
import { REPORT_DEFINITIONS } from '../report-definition.registry.js';
import { describeFilters } from '../report-filter-lines.js';
import type { ReportFilters, ReportModel, ReportPage, ReportProvider, ResolvedScope } from '../report-model.js';

/**
 * Khách đến làm việc (2.13). KPI và biểu đồ đi qua đúng `VisitQueryService` của `GET /visitors/stats` (qua port VISITOR_REPORT_SOURCE)
 * để hai nơi luôn khớp; bảng không chứa số giấy tờ và điện thoại.
 */
@Injectable()
export class VisitorReportProvider implements ReportProvider {
  readonly type = 'visitor' as const;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(VISITOR_REPORT_SOURCE) private readonly visits: VisitorReportSource,
  ) {}

  async build(filters: ReportFilters, scope: ResolvedScope, page: ReportPage | null, now: Date): Promise<ReportModel> {
    const def = REPORT_DEFINITIONS.visitor;
    // Phạm vi MANAGER: chỉ khách của đơn vị mình tiếp. `departmentId` đã được ReportScopeService kiểm; không chọn thì lấy lần lượt.
    const departmentIds = scope.unrestricted ? [filters['departmentId']] : scope.departmentIds ?? [];
    const partial = await Promise.all(
      departmentIds.map(async (departmentId) => {
        const base = { from: filters.from, to: filters.to, departmentId: departmentId ?? undefined, purpose: filters['purpose'] };
        return {
          kpis: await this.visits.computeKpis(base, now),
          stats: await this.visits.stats(base),
        };
      }),
    );
    const only = partial.length === 1 ? partial[0] : null;
    const kpis = only?.kpis ?? this.mergeKpis(partial.map((p) => p.kpis));
    const byPeriod = new Map<string, number>();
    const byDepartment = new Map<string, number>();
    for (const p of partial) {
      for (const b of p.stats.byPeriod) byPeriod.set(b.bucket, (byPeriod.get(b.bucket) ?? 0) + b.count);
      for (const d of p.stats.byDepartment) byDepartment.set(d.name, (byDepartment.get(d.name) ?? 0) + d.count);
    }

    const list = scope.unrestricted
      ? await this.visits.reportRows({ from: filters.from, to: filters.to, departmentId: filters['departmentId'], purpose: filters['purpose'], status: filters['status'], q: filters.q }, page, now)
      : await this.rowsForDepartments(departmentIds as string[], filters, page, now);

    return {
      type: 'visitor',
      title: def.title,
      period: { from: filters.from, to: filters.to },
      filterLines: await describeFilters(this.dataSource, def, filters),
      kpis: [
        { key: 'totalVisits', label: 'Tổng lượt', value: kpis.totalVisits, format: 'number' },
        { key: 'uniqueVisitors', label: 'Khách duy nhất', value: kpis.uniqueVisitors, format: 'number' },
        { key: 'avgStayMinutes', label: 'Lưu trú TB', value: kpis.avgStayMinutes, format: 'minutes' },
        { key: 'overstayCount', label: 'Lượt quá giờ', value: kpis.overstayCount, format: 'number' },
        { key: 'noShowRate', label: 'Tỷ lệ không đến', value: kpis.noShowRate, format: 'percent' },
      ],
      charts: [
        { key: 'daily', data: [...byPeriod.entries()].map(([date, count]) => ({ date, count })) },
        { key: 'byDepartment', data: [...byDepartment.entries()].map(([name, count]) => ({ name, count })) },
      ],
      columns: def.columns,
      rows: list.rows,
      total: list.total,
    };
  }

  /** Phạm vi nhiều đơn vị: gộp số liệu (khách duy nhất cộng dồn — chấp nhận sai lệch nhỏ khi một khách đến nhiều đơn vị). */
  private mergeKpis(parts: Array<{ totalVisits: number; uniqueVisitors: number; avgStayMinutes: number; overstayCount: number; noShowRate: number }>) {
    const total = parts.reduce((t, p) => t + p.totalVisits, 0);
    return {
      totalVisits: total,
      uniqueVisitors: parts.reduce((t, p) => t + p.uniqueVisitors, 0),
      avgStayMinutes: total ? Math.round(parts.reduce((t, p) => t + p.avgStayMinutes * p.totalVisits, 0) / total) : 0,
      overstayCount: parts.reduce((t, p) => t + p.overstayCount, 0),
      noShowRate: 0,
    };
  }

  private async rowsForDepartments(ids: string[], filters: ReportFilters, page: ReportPage | null, now: Date) {
    const all = await Promise.all(ids.map((departmentId) =>
      this.visits.reportRows({ from: filters.from, to: filters.to, departmentId, purpose: filters['purpose'], status: filters['status'], q: filters.q }, null, now)));
    const rows = all.flatMap((r) => r.rows).sort((a, b) => String(b['checkInTime'] ?? '').localeCompare(String(a['checkInTime'] ?? '')));
    return { rows: page ? rows.slice((page.page - 1) * page.limit, page.page * page.limit) : rows, total: rows.length };
  }
}
