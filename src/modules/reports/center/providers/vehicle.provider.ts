import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { REPORT_DEFINITIONS } from '../report-definition.registry.js';
import { describeFilters } from '../report-filter-lines.js';
import type { ReportFilters, ReportModel, ReportPage, ReportProvider, ResolvedScope } from '../report-model.js';
import { hourLabel, hourRange } from './gate-access.provider.js';
import { aggregateSessions, listSessions } from './session-report.query.js';

const TYPE_LABEL: Record<string, string> = { car: 'Ô tô', motorbike: 'Xe máy', other: 'Khác' };

/** Phương tiện (2.13): các phiên ra vào có biển số, đối chiếu đăng ký xe và danh sách kiểm soát hiện hành. */
@Injectable()
export class VehicleReportProvider implements ReportProvider {
  readonly type = 'vehicle' as const;

  constructor(private readonly dataSource: DataSource) {}

  async build(filters: ReportFilters, scope: ResolvedScope, page: ReportPage | null, now: Date): Promise<ReportModel> {
    const def = REPORT_DEFINITIONS.vehicle;
    const opts = { filters, scope, now, plateOnly: true };
    const [agg, list, filterLines] = await Promise.all([
      aggregateSessions(this.dataSource, opts),
      listSessions(this.dataSource, opts, page),
      describeFilters(this.dataSource, def, filters),
    ]);
    return {
      type: 'vehicle',
      title: def.title,
      period: { from: filters.from, to: filters.to },
      filterLines,
      kpis: [
        { key: 'total', label: 'Tổng lượt', value: agg.total, format: 'number' },
        { key: 'cars', label: 'Ô tô', value: agg.cars, format: 'number' },
        { key: 'motorbikes', label: 'Xe máy', value: agg.motorbikes, format: 'number' },
        { key: 'unregistered', label: 'Chưa đăng ký', value: agg.unregistered, format: 'number' },
        { key: 'watchlist', label: 'Thuộc danh sách kiểm soát', value: agg.watchlist, format: 'number' },
      ],
      charts: [
        {
          key: 'hourly',
          data: agg.total > 0 ? hourRange(agg.hourlyIn).map((h) => ({ hour: hourLabel(h), count: agg.hourlyIn.get(h) ?? 0 })) : [],
        },
        { key: 'byType', data: agg.byClass },
      ],
      columns: def.columns,
      rows: list.rows.map((r) => ({
        plateNumber: r.plate_number,
        vehicleTypeLabel: TYPE_LABEL[r.vehicle_class] ?? 'Khác',
        ownerName: r.owner_name,
        departmentName: r.department_name,
        zoneName: r.zone_name,
        checkInTime: r.check_in_time?.toISOString() ?? null,
        checkOutTime: r.check_out_time?.toISOString() ?? null,
        durationSeconds: r.duration_seconds,
        statusLabel: r.registration_label,
      })),
      total: list.total,
    };
  }
}
