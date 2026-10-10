import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { reportBadRequest, reportConflict, reportNotFound } from '../center/report-center.errors.js';
import { REPORT_DEFINITIONS, isReportType } from '../center/report-definition.registry.js';
import { REPORT_FORMATS } from '../center/report-file.service.js';
import { computeNextRun, type ScheduleFrequency } from './schedule-next-run.js';

const PERIODS = ['yesterday', 'last_week', 'last_month'];
const FREQUENCIES = ['daily', 'weekly', 'monthly'];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_RECIPIENTS = 20;

export interface ScheduleRecipient { type: 'user' | 'email'; value: string; label: string }
export interface SchedulePayload {
  name?: unknown; reportType?: unknown; filters?: unknown; period?: unknown; frequency?: unknown; time?: unknown;
  dayOfWeek?: unknown; dayOfMonth?: unknown; formats?: unknown; recipients?: unknown; subject?: unknown; message?: unknown; enabled?: unknown;
}

interface ScheduleRow {
  id: string; name: string; report_type: string; filters_json: Record<string, string>; period: string; frequency: string; time: string;
  day_of_week: number | null; day_of_month: number | null; last_day_of_month: boolean; formats: string[]; recipients_json: ScheduleRecipient[];
  subject: string | null; message: string | null; enabled: boolean; next_run_at: Date | null; last_run_at: Date | null; created_at: Date; owner_user_id: string;
}

const SELECT = `SELECT id, name, report_type, filters_json, period, frequency, to_char(send_time, 'HH24:MI') AS time, day_of_week, day_of_month, last_day_of_month,
                       formats, recipients_json, subject, message, enabled, next_run_at, last_run_at, created_at, owner_user_id
                  FROM report_schedules`;

/** CRUD lịch gửi báo cáo (RPT-CENTER-BE-001 §6). Xóa mềm; `next_run_at` tính lại khi tạo, sửa, bật (BR-S7). */
@Injectable()
export class ReportScheduleService {
  private readonly logger = new Logger(ReportScheduleService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditLogsService,
  ) {}

  /** Thứ tự kiểm và thông điệp trùng từng chữ với `validateSchedule` của FE (FE đang so chuỗi). BR-S11 thêm ở cuối loại báo cáo. */
  validate(raw: SchedulePayload): void {
    const p = raw ?? {};
    const bad = (m: string) => { throw reportBadRequest(m, 'VALIDATION_ERROR'); };
    if (!String(p.name ?? '').trim()) bad('Vui lòng nhập tên lịch gửi');
    if (typeof p.reportType !== 'string' || !isReportType(p.reportType)) bad('Loại báo cáo không tồn tại');
    if (!PERIODS.includes(p.period as string)) bad('Kỳ dữ liệu không hợp lệ');
    if (!FREQUENCIES.includes(p.frequency as string)) bad('Tần suất không hợp lệ');
    if (!TIME_PATTERN.test(String(p.time ?? ''))) bad('Giờ gửi không hợp lệ');
    if (p.frequency === 'weekly' && !(Number.isInteger(p.dayOfWeek) && (p.dayOfWeek as number) >= 0 && (p.dayOfWeek as number) <= 6)) bad('Vui lòng chọn thứ trong tuần');
    if (p.frequency === 'monthly' && p.dayOfMonth !== 'last' && !(Number.isInteger(p.dayOfMonth) && (p.dayOfMonth as number) >= 1 && (p.dayOfMonth as number) <= 28)) {
      bad('Ngày trong tháng phải từ 1 đến 28 hoặc ngày cuối tháng');
    }
    if (!Array.isArray(p.formats) || p.formats.length === 0 || p.formats.some((f) => !(REPORT_FORMATS as string[]).includes(f))) bad('Vui lòng chọn ít nhất một định dạng');
    const recipients = Array.isArray(p.recipients) ? (p.recipients as Array<{ type?: string; value?: string }>) : [];
    if (recipients.length === 0) bad('Cần ít nhất 1 người nhận');
    if (recipients.length > MAX_RECIPIENTS) bad(`Tối đa ${MAX_RECIPIENTS} người nhận`);
    const badEmail = recipients.find((r) => r.type === 'email' && !EMAIL_PATTERN.test(String(r.value ?? '')));
    if (badEmail) bad(`Email không hợp lệ: ${badEmail.value}`);
    if (recipients.some((r) => r.type !== 'email' && r.type !== 'user')) bad('Loại người nhận không hợp lệ');
    // BR-S11: loại chưa khả dụng không tạo được lịch.
    const def = REPORT_DEFINITIONS[p.reportType as keyof typeof REPORT_DEFINITIONS];
    if (!def.available) throw reportConflict(def.unavailableReason ?? 'Báo cáo này chưa khả dụng', 'REPORT_NOT_AVAILABLE');
    // Bộ lọc chỉ gồm khóa của loại.
    const filters = (p.filters ?? {}) as Record<string, unknown>;
    if (typeof filters !== 'object' || Array.isArray(filters)) bad('Bộ lọc không hợp lệ');
    const allowed = new Map(def.filters.map((f) => [f.key, f]));
    for (const [key, value] of Object.entries(filters)) {
      const f = allowed.get(key);
      if (!f) throw reportBadRequest(`Bộ lọc "${key}" không thuộc loại báo cáo này`, 'INVALID_FILTER', { key });
      if (value === '' || value === null || value === undefined) continue;
      if (typeof value !== 'string' || (f.options && !f.options.some((o) => o.value === value))) {
        throw reportBadRequest(`Giá trị bộ lọc "${key}" không hợp lệ`, 'INVALID_FILTER', { key });
      }
    }
  }

  private toView(r: ScheduleRow) {
    return {
      id: r.id, name: r.name, reportType: r.report_type, reportTitle: isReportType(r.report_type) ? REPORT_DEFINITIONS[r.report_type].title : r.report_type,
      filters: r.filters_json ?? {}, period: r.period, frequency: r.frequency, time: r.time,
      dayOfWeek: r.frequency === 'weekly' ? r.day_of_week : null,
      dayOfMonth: r.frequency === 'monthly' ? (r.last_day_of_month ? 'last' : r.day_of_month) : null,
      formats: r.formats, recipients: r.recipients_json, subject: r.subject ?? '', message: r.message ?? '',
      enabled: r.enabled, nextRunAt: r.next_run_at ? new Date(r.next_run_at).toISOString() : null,
      lastRunAt: r.last_run_at ? new Date(r.last_run_at).toISOString() : null, createdAt: new Date(r.created_at).toISOString(),
    };
  }

  private nextRun(p: { enabled: boolean; frequency: string; time: string; dayOfWeek: number | null; dayOfMonth: number | 'last' | null }, now: Date): Date | null {
    return computeNextRun({ enabled: p.enabled, frequency: p.frequency as ScheduleFrequency, time: p.time, dayOfWeek: p.dayOfWeek, dayOfMonth: p.dayOfMonth }, now);
  }

  private columns(p: SchedulePayload, now: Date) {
    const frequency = p.frequency as string;
    const enabled = p.enabled !== false;
    const dayOfWeek = frequency === 'weekly' ? (p.dayOfWeek as number) : null;
    const dayOfMonth = frequency === 'monthly' ? (p.dayOfMonth as number | 'last') : null;
    const filters = Object.fromEntries(Object.entries((p.filters ?? {}) as Record<string, unknown>).filter(([, v]) => v !== '' && v !== null && v !== undefined));
    const recipients = (p.recipients as Array<{ type: 'user' | 'email'; value: string; label?: string }>).map((r) => ({ type: r.type, value: String(r.value), label: String(r.label ?? r.value) }));
    return {
      name: String(p.name).trim(), reportType: p.reportType as string, filters, period: p.period as string, frequency, time: p.time as string,
      dayOfWeek, dayOfMonth: dayOfMonth === 'last' ? null : dayOfMonth, lastDay: dayOfMonth === 'last', formats: [...(p.formats as string[])], recipients,
      subject: String(p.subject ?? '').trim() || null, message: String(p.message ?? '').trim() || null, enabled,
      nextRunAt: this.nextRun({ enabled, frequency, time: p.time as string, dayOfWeek, dayOfMonth }, now),
    };
  }

  async list() {
    const rows: ScheduleRow[] = await this.dataSource.query(`${SELECT} WHERE deleted_at IS NULL ORDER BY created_at DESC, id`);
    return rows.map((r) => this.toView(r));
  }

  async create(payload: SchedulePayload, userId: string, now = new Date()) {
    this.validate(payload);
    const c = this.columns(payload, now);
    const rows: ScheduleRow[] = await this.dataSource.query(
      `INSERT INTO report_schedules (name, report_type, filters_json, period, frequency, send_time, day_of_week, day_of_month, last_day_of_month,
                                     formats, recipients_json, subject, message, enabled, next_run_at, owner_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [c.name, c.reportType, JSON.stringify(c.filters), c.period, c.frequency, c.time, c.dayOfWeek, c.dayOfMonth, c.lastDay, c.formats, JSON.stringify(c.recipients), c.subject, c.message, c.enabled, c.nextRunAt, userId],
    );
    const view = await this.get((rows[0] as unknown as { id: string }).id);
    this.record(userId, 'report_schedule_create', view.id, view);
    return view;
  }

  async update(id: string, payload: SchedulePayload, userId: string, now = new Date()) {
    await this.find(id);
    this.validate(payload);
    const c = this.columns(payload, now);
    await this.dataSource.query(
      `UPDATE report_schedules SET name=$2, report_type=$3, filters_json=$4, period=$5, frequency=$6, send_time=$7, day_of_week=$8, day_of_month=$9,
              last_day_of_month=$10, formats=$11::text[], recipients_json=$12, subject=$13, message=$14, enabled=$15, next_run_at=$16, updated_at=now()
        WHERE id=$1 AND deleted_at IS NULL`,
      [id, c.name, c.reportType, JSON.stringify(c.filters), c.period, c.frequency, c.time, c.dayOfWeek, c.dayOfMonth, c.lastDay, c.formats, JSON.stringify(c.recipients), c.subject, c.message, c.enabled, c.nextRunAt],
    );
    const view = await this.get(id);
    this.record(userId, 'report_schedule_update', id, view);
    return view;
  }

  async toggle(id: string, enabled: boolean, userId: string, now = new Date()) {
    const row = await this.find(id);
    const next = this.nextRun({ enabled, frequency: row.frequency, time: row.time, dayOfWeek: row.day_of_week, dayOfMonth: row.last_day_of_month ? 'last' : row.day_of_month }, now);
    await this.dataSource.query(`UPDATE report_schedules SET enabled=$2, next_run_at=$3, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, [id, enabled, next]);
    const view = await this.get(id);
    this.record(userId, enabled ? 'report_schedule_enable' : 'report_schedule_disable', id, view);
    return view;
  }

  async duplicate(id: string, userId: string) {
    const src = await this.find(id);
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO report_schedules (name, report_type, filters_json, period, frequency, send_time, day_of_week, day_of_month, last_day_of_month,
                                     formats, recipients_json, subject, message, enabled, next_run_at, owner_user_id)
       SELECT name || ' (bản sao)', report_type, filters_json, period, frequency, send_time, day_of_week, day_of_month, last_day_of_month,
              formats, recipients_json, subject, message, false, NULL, $2
         FROM report_schedules WHERE id = $1 RETURNING id`,
      [src.id, userId],
    );
    const view = await this.get(rows[0].id);
    this.record(userId, 'report_schedule_duplicate', view.id, view);
    return view;
  }

  async remove(id: string, userId: string) {
    const row = await this.find(id);
    await this.dataSource.query(`UPDATE report_schedules SET deleted_at = now(), enabled = false, next_run_at = NULL, updated_at = now() WHERE id = $1`, [id]);
    this.record(userId, 'report_schedule_delete', id, this.toView(row));
    return { deleted: true };
  }

  async find(id: string): Promise<ScheduleRow> {
    const rows: ScheduleRow[] = /^[0-9a-f-]{36}$/i.test(id) ? await this.dataSource.query(`${SELECT} WHERE id = $1 AND deleted_at IS NULL`, [id]) : [];
    if (!rows[0]) throw reportNotFound('Không tìm thấy lịch gửi', 'SCHEDULE_NOT_FOUND');
    return rows[0];
  }

  async get(id: string) {
    return this.toView(await this.find(id));
  }

  private record(userId: string, action: string, id: string, view: { recipients?: ScheduleRecipient[]; name?: string; reportType?: string }): void {
    this.audit
      .logAction({
        userId, actionType: action, entityType: 'report_schedules', entityId: id,
        metadataJson: { name: view.name, reportType: view.reportType, recipients: (view.recipients ?? []).map((r) => `${r.type}:${r.value}`) },
      })
      .catch((e) => this.logger.warn(`Audit ${action} lỗi: ${e instanceof Error ? e.message : String(e)}`));
  }
}
