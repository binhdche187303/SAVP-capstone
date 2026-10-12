import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { REPORT_DEFINITIONS } from '../report-definition.registry.js';
import { describeFilters } from '../report-filter-lines.js';
import type { ReportFilters, ReportModel, ReportPage, ReportProvider, ResolvedScope } from '../report-model.js';
import { aggregateSessions, listSessions } from './session-report.query.js';

const pad = (n: number) => String(n).padStart(2, '0');

/** Dải giờ hiển thị: 06h–18h, mở rộng nếu có phát sinh ngoài dải. */
export const hourRange = (...maps: Array<Map<number, number>>): number[] => {
  const hours = maps.flatMap((m) => [...m.keys()]);
  const lo = Math.min(6, ...hours);
  const hi = Math.max(18, ...hours);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
};
export const hourLabel = (h: number): string => `${pad(h)}h`;

/**
 * Ra vào khuôn viên (2.13). Dựng trên CTE phiên của `gate-access-history.service`: bảng chỉ liệt kê phiên hoàn tất,
 * "đang trong khuôn viên" đếm riêng phiên mở của hôm nay (giờ VN).
 */
@Injectable()
export class GateAccessReportProvider implements ReportProvider {
  readonly type = 'gate-access' as const;

  constructor(private readonly dataSource: DataSource) {}

  async build(filters: ReportFilters, scope: ResolvedScope, page: ReportPage | null, now: Date): Promise<ReportModel> {
    const def = REPORT_DEFINITIONS['gate-access'];
    const opts = { filters, scope, now, completedOnly: true };
    const [agg, list, filterLines] = await Promise.all([
      aggregateSessions(this.dataSource, opts),
      listSessions(this.dataSource, opts, page),
      describeFilters(this.dataSource, def, filters),
    ]);
    const hasData = agg.entries > 0 || agg.exits > 0;
    return {
      type: 'gate-access',
      title: def.title,
      period: { from: filters.from, to: filters.to },
      filterLines,
      kpis: [
        { key: 'entries', label: 'Lượt vào', value: agg.entries, format: 'number' },
        { key: 'exits', label: 'Lượt ra', value: agg.exits, format: 'number' },
        { key: 'onSite', label: 'Đang trong khuôn viên', value: agg.onSite, format: 'number' },
        { key: 'avgStayMinutes', label: 'Lưu trú TB', value: agg.avgStaySeconds === null ? 0 : Math.round(agg.avgStaySeconds / 60), format: 'minutes' },
      ],
      charts: [
        {
          key: 'hourly',
          data: hasData ? hourRange(agg.hourlyIn, agg.hourlyOut).map((h) => ({ hour: hourLabel(h), entries: agg.hourlyIn.get(h) ?? 0, exits: agg.hourlyOut.get(h) ?? 0 })) : [],
        },
        { key: 'byZone', data: agg.byZone },
      ],
      columns: def.columns,
      rows: list.rows.map((r) => ({
        zoneName: r.zone_name,
        code: r.employee_code,
        fullName: r.full_name,
        departmentName: r.department_name,
        plateNumber: r.plate_number,
        checkInTime: r.check_in_time?.toISOString() ?? null,
        checkOutTime: r.check_out_time?.toISOString() ?? null,
        durationSeconds: r.duration_seconds,
      })),
      total: list.total,
    };
  }
}
