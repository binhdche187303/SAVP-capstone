import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { reportBadRequest, reportConflict, reportNotFound } from '../center/report-center.errors.js';
import { REPORT_DEFINITIONS, isReportType } from '../center/report-definition.registry.js';
import { REPORT_FORMATS } from '../center/report-file.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { ReportScheduleDispatchService } from './report-schedule-dispatch.service.js';
import { ReportScheduleService } from './report-schedule.service.js';
import { resolvePeriod } from './schedule-next-run.js';

interface RunRow {
  id: string; schedule_id: string; schedule_name: string; report_type: string; trigger: string; status: string; error_message: string | null;
  ran_at: Date; retried_by_run_id: string | null; period_from: string | Date; period_to: string | Date; formats: string[]; recipient_count: number; output_file_ids: string[];
}
const day = (d: string | Date): string => (d instanceof Date ? new Date(d.getTime() + 7 * 3_600_000).toISOString() : d).slice(0, 10);

/** Lần chạy của lịch gửi: gửi thử, lịch sử, gửi lại, tải tệp (RPT-CENTER-BE-001 §6.3, §7). */
@Injectable()
export class ReportScheduleRunService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly schedules: ReportScheduleService,
    private readonly dispatcher: ReportScheduleDispatchService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  private view(r: RunRow) {
    return {
      id: r.id, scheduleId: r.schedule_id, scheduleName: r.schedule_name, reportType: r.report_type,
      reportTitle: isReportType(r.report_type) ? REPORT_DEFINITIONS[r.report_type].title : r.report_type,
      trigger: r.trigger, status: r.status, error: r.error_message, ranAt: new Date(r.ran_at).toISOString(), retriedByRunId: r.retried_by_run_id,
      from: day(r.period_from), to: day(r.period_to), formats: r.formats, recipientCount: r.recipient_count,
    };
  }
  private static readonly SELECT = `SELECT id, schedule_id, schedule_name, report_type, trigger, status, error_message, COALESCE(started_at, created_at) AS ran_at,
        retried_by_run_id, to_char(period_from, 'YYYY-MM-DD') AS period_from, to_char(period_to, 'YYYY-MM-DD') AS period_to, formats, recipient_count, output_file_ids
        FROM report_schedule_runs`;

  /** BR-S5: gửi thử không đổi `next_run_at`. */
  async runNow(scheduleId: string, now = new Date()) {
    const schedule = await this.schedules.find(scheduleId);
    const { from, to } = resolvePeriod(schedule.period, now);
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO report_schedule_runs (schedule_id, schedule_name, report_type, trigger, status, period_from, period_to, formats, recipient_count)
       VALUES ($1,$2,$3,'manual','queued',$4,$5,$6::text[],$7) RETURNING id`,
      [schedule.id, schedule.name, schedule.report_type, from, to, schedule.formats, schedule.recipients_json.length],
    );
    await this.dataSource.query(`UPDATE report_schedules SET last_run_at = $2 WHERE id = $1`, [schedule.id, now]);
    await this.dispatcher.enqueue(rows[0].id);
    return this.get(rows[0].id);
  }

  async get(id: string) {
    const rows: RunRow[] = /^[0-9a-f-]{36}$/i.test(id) ? await this.dataSource.query(`${ReportScheduleRunService.SELECT} WHERE id = $1`, [id]) : [];
    if (!rows[0]) throw reportNotFound('Không tìm thấy lần chạy', 'RUN_NOT_FOUND');
    return this.view(rows[0]);
  }

  async list(q: { scheduleId?: string; status?: string; from?: string; to?: string; page?: number | string; limit?: number | string }) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.scheduleId) { params.push(q.scheduleId); where.push(`schedule_id::text = $${params.length}`); }
    if (q.status) {
      if (!['queued', 'running', 'success', 'failed'].includes(q.status)) throw reportBadRequest('Trạng thái không hợp lệ', 'VALIDATION_ERROR');
      params.push(q.status); where.push(`status = $${params.length}`);
    }
    if (q.from) { params.push(q.from); where.push(`(COALESCE(started_at, created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $${params.length}::date`); }
    if (q.to) { params.push(q.to); where.push(`(COALESCE(started_at, created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= $${params.length}::date`); }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const page = Math.max(1, Math.floor(Number(q.page)) || 1);
    const limit = Math.min(100, Math.max(1, Math.floor(Number(q.limit)) || 10));
    const total = Number((await this.dataSource.query(`SELECT count(*) AS n FROM report_schedule_runs${clause}`, params))[0].n);
    const rows: RunRow[] = await this.dataSource.query(
      `${ReportScheduleRunService.SELECT}${clause} ORDER BY COALESCE(started_at, created_at) DESC, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    return { items: rows.map((r) => this.view(r)), total, page, limit };
  }

  /** Gửi lại một lần chạy thất bại: tạo lần `manual` cùng kỳ, gắn `retried_by_run_id` (chỉ một lần). */
  async retry(id: string) {
    const created = await this.dataSource.transaction(async (m) => {
      const rows: RunRow[] = await m.query(`SELECT * FROM report_schedule_runs WHERE id = $1 FOR UPDATE`, [id].map((x) => (/^[0-9a-f-]{36}$/i.test(x) ? x : '00000000-0000-0000-0000-000000000000')));
      const failed = rows[0];
      if (!failed) throw reportNotFound('Không tìm thấy lần chạy', 'RUN_NOT_FOUND');
      if (failed.status !== 'failed') throw reportConflict('Chỉ gửi lại được lần chạy thất bại', 'RUN_NOT_FAILED');
      if (failed.retried_by_run_id) throw reportConflict('Lần chạy này đã được gửi lại', 'RUN_ALREADY_RETRIED');
      const inserted: Array<{ id: string }> = await m.query(
        `INSERT INTO report_schedule_runs (schedule_id, schedule_name, report_type, trigger, status, period_from, period_to, formats, recipient_count)
         SELECT schedule_id, schedule_name, report_type, 'manual', 'queued', period_from, period_to, formats, recipient_count FROM report_schedule_runs WHERE id = $1 RETURNING id`,
        [id],
      );
      await m.query(`UPDATE report_schedule_runs SET retried_by_run_id = $2 WHERE id = $1`, [id, inserted[0].id]);
      return inserted[0].id;
    });
    await this.dispatcher.enqueue(created);
    return this.get(created);
  }

  /** Liên kết tải tạm (ký) tới tệp của một lần chạy thành công. */
  async fileLink(id: string, format: string) {
    if (!(REPORT_FORMATS as string[]).includes(format)) throw reportBadRequest('Định dạng không hợp lệ', 'VALIDATION_ERROR');
    const rows: RunRow[] = /^[0-9a-f-]{36}$/i.test(id) ? await this.dataSource.query(`${ReportScheduleRunService.SELECT} WHERE id = $1`, [id]) : [];
    const run = rows[0];
    if (!run) throw reportNotFound('Không tìm thấy lần chạy', 'RUN_NOT_FOUND');
    if (run.status !== 'success') throw reportConflict('Lần chạy thất bại không có file để tải', 'RUN_HAS_NO_FILE');
    const files: Array<{ id: string; file_name: string }> = await this.dataSource.query(
      `SELECT id, file_name FROM media_files WHERE id = ANY($1::uuid[]) AND is_active = true AND file_name LIKE $2 LIMIT 1`,
      [run.output_file_ids ?? [], `%.${format}`],
    );
    if (!files[0]) throw reportConflict('Lần chạy này không có file ở định dạng đã chọn', 'RUN_FORMAT_MISSING');
    const ttl = this.config.get<number>('MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS', 600);
    const base = this.config.get<string>('API_PUBLIC_BASE_URL', 'http://localhost:3000').replace(/\/$/, '');
    const { token } = this.storage.generateSignedDownloadToken(files[0].id, ttl);
    return { fileName: files[0].file_name, format, downloadUrl: `${base}/api/v1/media-files/${files[0].id}/secure-download?token=${token}` };
  }
}
