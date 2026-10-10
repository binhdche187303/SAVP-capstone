import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SecurityAlertReportDataService } from '../../services/security-alert-report-data.service.js';
import { REPORT_DEFINITIONS } from '../report-definition.registry.js';
import { describeFilters } from '../report-filter-lines.js';
import type { ReportFilters, ReportModel, ReportPage, ReportProvider, ResolvedScope } from '../report-model.js';
import { pageRows, vnDayEnd, vnDayKey, vnDayLabel, vnDayStart } from './report-provider.util.js';

/** Giá trị lọc của FE → alert_type thật trong `security_alerts` (FE gộp một số loại). */
const TYPE_ALIASES: Record<string, string[]> = {
  watchlist_person: ['person_watchlist_match'],
  vehicle: ['unknown_vehicle', 'vehicle_control_match'],
  camera_offline: ['device_error'],
};
const TYPE_LABELS: Record<string, string> = {
  stranger: 'Người lạ', crowd: 'Tụ tập đông người', intrusion: 'Xâm nhập khu vực cấm',
  person_watchlist_match: 'Người thuộc danh sách kiểm soát', unknown_vehicle: 'Phương tiện bất thường', vehicle_control_match: 'Biển số theo dõi',
  device_error: 'Camera mất tín hiệu', visitor_overstay: 'Khách quá giờ', visitor_must_leave: 'Khách phải rời', visitor_zone_violation: 'Khách vào sai khu vực',
};
const SEVERITY_LABELS: Record<string, string> = { low: 'Thấp', medium: 'Trung bình', high: 'Cao', critical: 'Nghiêm trọng' };
const STATUS_LABELS: Record<string, string> = { new: 'Chưa xử lý', acknowledged: 'Đã tiếp nhận', resolved: 'Đã xử lý' };
const STATUS_ALIASES: Record<string, string> = { open: 'new' };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** Sự kiện an ninh (2.13): dùng `SecurityAlertReportDataService.listAllForExport` (không sửa), gộp ở ứng dụng. */
@Injectable()
export class SecurityAlertReportProvider implements ReportProvider {
  readonly type = 'security-alert' as const;

  constructor(
    private readonly dataSource: DataSource,
    private readonly data: SecurityAlertReportDataService,
  ) {}

  async build(filters: ReportFilters, _scope: ResolvedScope, page: ReportPage | null, _now: Date): Promise<ReportModel> {
    const def = REPORT_DEFINITIONS['security-alert'];
    const status = filters['status'] ? STATUS_ALIASES[filters['status']] ?? filters['status'] : null;
    const alerts = await this.data.listAllForExport({
      from: vnDayStart(filters.from).toISOString(),
      to: vnDayEnd(filters.to).toISOString(),
      filters: { alertType: null, zoneId: filters['zoneId'] ?? null, status },
    });
    const types = filters['alertType'] ? TYPE_ALIASES[filters['alertType']] ?? [filters['alertType']] : null;
    const list = alerts.filter((a) => (!types || types.includes(a.alertType)) && (!filters['severity'] || a.severity === filters['severity']));

    const rows = list.map((a) => {
      const exp = this.data.mapToExportRow(a);
      const payload = a.payloadJson ?? {};
      const handler = exp.resolvedByName ?? exp.acknowledgedByName;
      return {
        occurredAt: a.triggeredAt.toISOString(),
        typeLabel: TYPE_LABELS[a.alertType] ?? a.alertType,
        severityLabel: SEVERITY_LABELS[a.severity] ?? a.severity,
        zoneName: exp.zoneName,
        cameraName: str(payload['cameraName']) ?? str(payload['deviceName']),
        subject: str(payload['visitorName']) ?? str(payload['plateNumber']) ?? str(payload['personName']) ?? str(payload['detail']),
        statusLabel: STATUS_LABELS[a.status] ?? a.status,
        handlerName: handler,
        resolveMinutes: a.resolvedAt ? Math.round((a.resolvedAt.getTime() - a.triggeredAt.getTime()) / 60_000) : null,
      };
    });

    const resolved = list.filter((a) => a.status === 'resolved' && a.resolvedAt);
    const avgResolve = resolved.length ? Math.round(resolved.reduce((s, a) => s + (a.resolvedAt as Date).getTime() - a.triggeredAt.getTime(), 0) / resolved.length / 60_000) : 0;
    const byDay = new Map<string, { label: string; count: number }>();
    const byType = new Map<string, number>();
    for (const a of list) {
      const key = vnDayKey(a.triggeredAt);
      const d = byDay.get(key) ?? { label: vnDayLabel(a.triggeredAt), count: 0 };
      d.count += 1;
      byDay.set(key, d);
      const label = TYPE_LABELS[a.alertType] ?? a.alertType;
      byType.set(label, (byType.get(label) ?? 0) + 1);
    }
    const paged = pageRows(rows, page, filters.q, ['typeLabel', 'severityLabel', 'zoneName', 'cameraName', 'subject', 'statusLabel', 'handlerName']);
    return {
      type: 'security-alert',
      title: def.title,
      period: { from: filters.from, to: filters.to },
      filterLines: await describeFilters(this.dataSource, def, filters),
      kpis: [
        { key: 'total', label: 'Tổng sự kiện', value: list.length, format: 'number' },
        { key: 'critical', label: 'Mức nghiêm trọng', value: list.filter((a) => a.severity === 'critical').length, format: 'number' },
        { key: 'resolved', label: 'Đã xử lý', value: resolved.length, format: 'number' },
        { key: 'avgResolveMinutes', label: 'Thời gian xử lý TB', value: avgResolve, format: 'minutes' },
      ],
      charts: [
        { key: 'daily', data: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, d]) => ({ date: d.label, count: d.count })) },
        { key: 'byType', data: [...byType.entries()].map(([name, count]) => ({ name, count })) },
      ],
      columns: def.columns,
      rows: paged.rows,
      total: paged.total,
    };
  }
}
