import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { DashboardOverviewConfigService } from '../../analytics/services/dashboard-overview-config.service.js';
import { resolveNonStaffDepartmentIds } from '../../../common/utils/non-staff-department.util.js';
import { VISITOR_CONFIG_DEFAULTS } from '../../visitors/config/visitor-config.service.js';
import { REPORT_DEFINITIONS, REPORT_TYPE_ORDER, isReportType } from './report-definition.registry.js';
import { reportBadRequest, reportConflict, reportNotFound } from './report-center.errors.js';
import { REPORT_PROVIDERS, type ReportDefinition, type ReportType, type ReportFilters, type ReportModel, type ReportPage, type ReportProvider, type ResolvedScope } from './report-model.js';
import { ReportScopeService } from './report-scope.service.js';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const COMMON_KEYS = ['from', 'to', 'q', 'page', 'limit', 'sortKey', 'sortDir', 'format'];

export interface PreparedReport {
  definition: ReportDefinition;
  provider: ReportProvider;
  filters: ReportFilters;
  scope: ResolvedScope;
}

/** Điều phối Trung tâm báo cáo (RPT-CENTER-BE-001 §3): danh mục, tra cứu, xem trước, kiểm tra đầu vào dùng chung với xuất file. */
@Injectable()
export class ReportCenterService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly scope: ReportScopeService,
    private readonly rangeConfig: DashboardOverviewConfigService,
    private readonly config: ConfigService,
    @Inject(REPORT_PROVIDERS) private readonly providers: ReportProvider[],
  ) {}

  /** Định nghĩa kèm khả dụng theo cấu hình: báo cáo khách cần phân hệ Khách đang bật. */
  private effective(type: ReportType): ReportDefinition {
    const d = REPORT_DEFINITIONS[type];
    if (type === 'visitor') {
      const on = this.config.get<boolean | string>('VISITORS_ENABLED', false);
      if (on !== true && on !== 'true') return { ...d, available: false, unavailableReason: 'Phân hệ Khách đến làm việc chưa được bật' };
    }
    return d;
  }

  async catalog() {
    const schedules: Array<{ report_type: string; n: string }> = await this.dataSource.query(
      `SELECT report_type, count(*) AS n FROM report_schedules WHERE enabled = true AND deleted_at IS NULL GROUP BY report_type`,
    );
    const exportsOf: Array<{ report_type: string; last: Date }> = await this.dataSource.query(
      `SELECT input_json->>'type' AS report_type, max(completed_at) AS last FROM background_jobs
        WHERE related_entity_type = 'report_center' AND status = 'completed' GROUP BY 1`,
    );
    return REPORT_TYPE_ORDER.map((type) => {
      const d = this.effective(type);
      return {
        type,
        title: d.title,
        description: d.description,
        available: d.available,
        unavailableReason: d.available ? null : d.unavailableReason ?? null,
        activeSchedules: Number(schedules.find((s) => s.report_type === type)?.n ?? 0),
        lastExportAt: exportsOf.find((e) => e.report_type === type)?.last?.toISOString?.() ?? null,
      };
    });
  }

  /** Danh sách chọn cho bộ lọc; `departments` và `staff` thu hẹp theo phạm vi của người gọi. */
  async lookups(userId: string) {
    const scope = await this.scope.resolve(userId, REPORT_DEFINITIONS['staff-attendance'], { from: '', to: '' }).catch(() => ({ unrestricted: false, departmentIds: [] as string[] }));
    const nonStaff = await resolveNonStaffDepartmentIds(this.dataSource);
    const deptFilter = scope.unrestricted ? null : scope.departmentIds ?? [];
    const departments = await this.dataSource.query(
      `SELECT id, department_name AS name FROM departments
        WHERE deleted_at IS NULL AND is_active = true AND NOT (id = ANY($1::uuid[])) AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
        ORDER BY department_name`,
      [nonStaff, deptFilter],
    );
    const staff = await this.dataSource.query(
      `SELECT u.id, u.full_name || ' (' || u.employee_code || ')' AS name FROM users u
        WHERE u.deleted_at IS NULL AND u.account_status = 'active'
          AND NOT (u.department_id = ANY($1::uuid[]))
          AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND ur.is_active = true AND r.role_code = 'STUDENT')
          AND ($2::uuid[] IS NULL OR u.department_id = ANY($2::uuid[]))
        ORDER BY u.full_name LIMIT 1000`,
      [nonStaff, deptFilter],
    );
    const zones = await this.dataSource.query(`SELECT id, zone_name AS name FROM zones WHERE deleted_at IS NULL AND status = 'active' ORDER BY zone_name`);
    const gates = await this.dataSource.query(`SELECT id, zone_name AS name FROM zones WHERE deleted_at IS NULL AND status = 'active' AND zone_type = 'gate' ORDER BY zone_name`);
    const rooms = await this.dataSource.query(`SELECT id, room_name AS name, site_name FROM rooms WHERE deleted_at IS NULL AND is_active = true ORDER BY room_name`);
    const buildings = [...new Set(rooms.map((r: { site_name: string | null }) => r.site_name).filter(Boolean))].map((b) => ({ id: b, name: `Tòa ${b}` }));
    const cfg: Array<{ config_json: unknown }> = await this.dataSource.query(`SELECT config_json FROM system_configs WHERE config_key = 'visitor.purposes' LIMIT 1`);
    const raw = cfg[0]?.config_json;
    const purposes = (Array.isArray(raw) && raw.every((x) => typeof x === 'string') && raw.length ? (raw as string[]) : VISITOR_CONFIG_DEFAULTS.purposes).map((p) => ({ id: p, name: p }));
    return {
      departments,
      staff,
      zones,
      gates,
      buildings,
      rooms: rooms.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name })),
      purposes,
    };
  }

  /** Dùng chung cho xem trước, xuất file và lịch gửi: kiểm loại, khả dụng, kỳ, bộ lọc rồi phân giải phạm vi. */
  async prepare(type: string, raw: Record<string, unknown>, userId: string): Promise<PreparedReport> {
    if (!isReportType(type)) throw reportNotFound('Không tìm thấy loại báo cáo', 'REPORT_TYPE_NOT_FOUND');
    const definition = this.effective(type);
    if (!definition.available) throw reportConflict(definition.unavailableReason ?? 'Báo cáo này chưa khả dụng', 'REPORT_NOT_AVAILABLE');
    const provider = this.providers.find((p) => p.type === type);
    if (!provider) throw reportConflict('Báo cáo này chưa khả dụng', 'REPORT_NOT_AVAILABLE');

    const filters = await this.validateFilters(definition, raw);
    const scope = await this.scope.resolve(userId, definition, filters);
    return { definition, provider, filters, scope };
  }

  async preview(type: string, raw: Record<string, unknown>, userId: string, now = new Date()) {
    const { definition, provider, filters, scope } = await this.prepare(type, raw, userId);
    const page = this.parsePage(definition, raw);
    const model = await provider.build(filters, scope, page, now);
    return this.toPreview(model);
  }

  toPreview(model: ReportModel) {
    return {
      kpis: model.kpis.map((k) => ({ key: k.key, value: k.value })),
      charts: model.charts,
      rows: model.rows,
      total: model.total,
      notes: model.notes ?? [],
    };
  }

  async validateFilters(definition: ReportDefinition, raw: Record<string, unknown>): Promise<ReportFilters> {
    const from = String(raw['from'] ?? '');
    const to = String(raw['to'] ?? '');
    if (!from || !to) throw reportBadRequest('Vui lòng chọn kỳ báo cáo', 'VALIDATION_ERROR');
    if (!YMD.test(from) || !YMD.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      throw reportBadRequest('Kỳ báo cáo không hợp lệ, định dạng ngày là YYYY-MM-DD', 'VALIDATION_ERROR');
    }
    if (from > to) throw reportBadRequest('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc', 'VALIDATION_ERROR');
    const maxDays = await this.rangeConfig.getMaxRangeDays();
    const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
    if (days > maxDays) throw reportBadRequest(`Kỳ báo cáo vượt quá ${maxDays} ngày tối đa.`, 'DATE_RANGE_TOO_LARGE', { maxDays });

    const allowed = new Set([...COMMON_KEYS, ...definition.filters.map((f) => f.key)]);
    const filters: ReportFilters = { from, to };
    for (const [key, value] of Object.entries(raw)) {
      if (!allowed.has(key)) throw reportBadRequest(`Bộ lọc "${key}" không thuộc loại báo cáo này`, 'INVALID_FILTER', { key });
      if (['from', 'to', 'page', 'limit', 'sortKey', 'sortDir', 'format'].includes(key)) continue;
      if (value === undefined || value === null || value === '') continue;
      if (typeof value !== 'string') throw reportBadRequest(`Bộ lọc "${key}" không hợp lệ`, 'INVALID_FILTER', { key });
      const options = definition.filters.find((f) => f.key === key)?.options;
      if (options && !options.some((o) => o.value === value)) throw reportBadRequest(`Giá trị bộ lọc "${key}" không hợp lệ`, 'INVALID_FILTER', { key });
      filters[key] = value;
    }
    return filters;
  }

  parsePage(definition: ReportDefinition, raw: Record<string, unknown>): ReportPage {
    const page = Math.max(1, Math.floor(Number(raw['page'])) || 1);
    const limit = Math.min(100, Math.max(1, Math.floor(Number(raw['limit'])) || 20));
    const sortKey = raw['sortKey'] === undefined || raw['sortKey'] === '' ? undefined : String(raw['sortKey']);
    if (sortKey && !definition.columns.some((c) => c.key === sortKey)) throw reportBadRequest('Cột sắp xếp không hợp lệ', 'INVALID_SORT', { sortKey });
    const sortDir = raw['sortDir'] === 'desc' ? 'desc' : 'asc';
    return { page, limit, sortKey, sortDir };
  }
}
