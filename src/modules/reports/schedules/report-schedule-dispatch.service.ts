import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { QueueService } from '../../queue/queue.service.js';
import { REPORT_EXPORT_QUEUE_NAME, REPORT_SCHEDULE_RUN_JOB_NAME } from '../constants/report-export-job.constants.js';
import { computeNextRun, resolvePeriod, type ScheduleFrequency } from './schedule-next-run.js';

export const SCHEDULE_RUN_ATTEMPTS = 3;

interface DueRow {
  id: string; name: string; report_type: string; period: string; frequency: string; time: string;
  day_of_week: number | null; day_of_month: number | null; last_day_of_month: boolean; formats: string[]; next_run_at: Date; recipients: number;
}

/**
 * Cron `report-schedule-dispatch` (mỗi phút). Chống chạy trùng giữa các instance bằng `FOR UPDATE SKIP LOCKED` +
 * unique một phần `(schedule_id, scheduled_for)`; chỉ đẩy job sau khi giao dịch đã commit (RPT-CENTER-BE-001 §6.3).
 */
@Injectable()
export class ReportScheduleDispatchService {
  private readonly logger = new Logger(ReportScheduleDispatchService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly queue: QueueService,
  ) {}

  async dispatchDue(now: Date = new Date(), limit = 50): Promise<{ dispatched: number }> {
    const runIds = await this.dataSource.transaction(async (m) => {
      const due: DueRow[] = await m.query(
        `SELECT id, name, report_type, period, frequency, to_char(send_time, 'HH24:MI') AS time, day_of_week, day_of_month, last_day_of_month, formats, next_run_at,
                jsonb_array_length(recipients_json) AS recipients
           FROM report_schedules
          WHERE enabled = true AND deleted_at IS NULL AND next_run_at IS NOT NULL AND next_run_at <= $1
          ORDER BY next_run_at LIMIT $2
            FOR UPDATE SKIP LOCKED`,
        [now, limit],
      );
      const ids: string[] = [];
      for (const s of due) {
        // Kỳ dữ liệu tính theo thời điểm của lượt hẹn, không theo lúc cron chạy trễ.
        const { from, to } = resolvePeriod(s.period, new Date(s.next_run_at));
        const inserted: Array<{ id: string }> = await m.query(
          `INSERT INTO report_schedule_runs (schedule_id, schedule_name, report_type, trigger, status, scheduled_for, period_from, period_to, formats, recipient_count)
           VALUES ($1,$2,$3,'scheduled','queued',$4,$5,$6,$7::text[],$8)
           ON CONFLICT (schedule_id, scheduled_for) WHERE trigger = 'scheduled' DO NOTHING RETURNING id`,
          [s.id, s.name, s.report_type, s.next_run_at, from, to, s.formats, s.recipients],
        );
        if (inserted[0]) ids.push(inserted[0].id);
        // Nhảy tới lượt kế tiếp SAU "bây giờ": bỏ qua các lượt bị lỡ thay vì bắn dồn.
        const next = computeNextRun(
          { enabled: true, frequency: s.frequency as ScheduleFrequency, time: s.time, dayOfWeek: s.day_of_week, dayOfMonth: s.last_day_of_month ? 'last' : s.day_of_month },
          now,
        );
        await m.query(`UPDATE report_schedules SET next_run_at = $2, last_run_at = $3, updated_at = now() WHERE id = $1`, [s.id, next, now]);
      }
      return ids;
    });
    for (const id of runIds) await this.enqueue(id);
    return { dispatched: runIds.length };
  }

  /** Đẩy job lần chạy; lỗi đẩy → lần chạy `failed` có lý do, không mất dấu. */
  async enqueue(runId: string): Promise<void> {
    try {
      await this.queue.addJob(REPORT_EXPORT_QUEUE_NAME, REPORT_SCHEDULE_RUN_JOB_NAME, { runId }, { attempts: SCHEDULE_RUN_ATTEMPTS, backoffDelay: 30_000 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Đẩy job lần chạy ${runId} lỗi: ${msg}`);
      await this.dataSource.query(
        `UPDATE report_schedule_runs SET status = 'failed', error_message = $2, finished_at = now() WHERE id = $1 AND status = 'queued'`,
        [runId, `Không đưa được vào hàng đợi: ${msg}`],
      );
    }
  }
}
