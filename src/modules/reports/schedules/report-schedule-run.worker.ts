import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { returnedRows } from '../../../common/utils/pg-result.util.js';
import { buildReportScheduleEmail } from '../../mail/templates/builders.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { NotificationChannel, NotificationType } from '../../notifications/entities/notification.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { REPORT_DEFINITIONS, isReportType } from '../center/report-definition.registry.js';
import { ReportFileService, type ReportFormat, type StoredReportFile } from '../center/report-file.service.js';
import { ReportCenterWorkerProcessor } from '../center/report-center-worker.processor.js';
import { REPORT_PROVIDERS, type ReportProvider } from '../center/report-model.js';
import { ReportScopeService } from '../center/report-scope.service.js';
import { SCHEDULE_RUN_ATTEMPTS } from './report-schedule-dispatch.service.js';
import type { ScheduleRecipient } from './report-schedule.service.js';

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Lỗi không thể khỏi khi thử lại (người nhận, quyền, dữ liệu): thất bại ngay, không retry. */
export class PermanentRunError extends Error {}

interface RunRow {
  id: string; schedule_id: string; schedule_name: string; report_type: string; status: string; period_from: string; period_to: string; formats: string[];
}
interface ScheduleRow {
  id: string; name: string; filters_json: Record<string, string>; recipients_json: ScheduleRecipient[]; subject: string | null; message: string | null; owner_user_id: string; deleted_at: Date | null;
}

const ymd = (d: Date | string): string => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
const dmy = (s: string): string => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

/**
 * Chạy một lần gửi báo cáo (job `report-schedule:run`): phạm vi của người sở hữu (BR-S9) → dựng một lần → render từng định dạng
 * → một email kèm mọi tệp (BR-S8). Lỗi tạm thời ném lại để BullMQ thử lại tối đa 3 lần (BR-S10); hết lượt thì `failed`.
 */
@Injectable()
export class ReportScheduleRunWorker {
  private readonly logger = new Logger(ReportScheduleRunWorker.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scope: ReportScopeService,
    private readonly authz: AuthzReadRepository,
    private readonly files: ReportFileService,
    private readonly notifications: NotificationsService,
    private readonly center: ReportCenterWorkerProcessor,
    private readonly config: ConfigService,
    @Inject(REPORT_PROVIDERS) private readonly providers: ReportProvider[],
  ) {}

  async processExport(job: Job<{ runId: string }>): Promise<void> {
    const runId = job.data.runId;
    const attempts = job.opts?.attempts ?? SCHEDULE_RUN_ATTEMPTS;
    const finalAttempt = (job.attemptsMade ?? 0) + 1 >= attempts;
    try {
      await this.processRun(runId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Lỗi không xác định';
      if (e instanceof PermanentRunError || finalAttempt) {
        await this.fail(runId, msg);
        return;
      }
      await this.dataSource.query(`UPDATE report_schedule_runs SET status = 'queued', error_message = $2 WHERE id = $1`, [runId, `Lần thử ${(job.attemptsMade ?? 0) + 1}: ${msg}`]);
      throw e; // BullMQ thử lại với backoff
    }
  }

  async processRun(runId: string): Promise<void> {
    const claimed = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE report_schedule_runs SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1 AND status IN ('queued','running') RETURNING id`,
        [runId],
      ),
    );
    if (!claimed[0]) return; // đã xong hoặc không tồn tại: job lặp là no-op
    // Cột `date` đọc bằng to_char: để driver tự đổi sang Date sẽ lệch một ngày khi múi giờ máy chủ không phải UTC.
    const runs: RunRow[] = await this.dataSource.query(
      `SELECT id, schedule_id, schedule_name, report_type, status, to_char(period_from, 'YYYY-MM-DD') AS period_from,
              to_char(period_to, 'YYYY-MM-DD') AS period_to, formats
         FROM report_schedule_runs WHERE id = $1`,
      [runId],
    );
    const run = runs[0];
    const schedules: ScheduleRow[] = await this.dataSource.query(
      `SELECT id, name, filters_json, recipients_json, subject, message, owner_user_id, deleted_at FROM report_schedules WHERE id = $1`,
      [run.schedule_id],
    );
    const schedule = schedules[0];
    if (!schedule || schedule.deleted_at) throw new PermanentRunError('Lịch gửi đã bị xóa');
    if (!isReportType(run.report_type)) throw new PermanentRunError('Loại báo cáo không tồn tại');
    const def = REPORT_DEFINITIONS[run.report_type];
    if (!def.available) throw new PermanentRunError(def.unavailableReason ?? 'Báo cáo chưa khả dụng');
    const provider = this.providers.find((p) => p.type === run.report_type);
    if (!provider) throw new PermanentRunError('Báo cáo chưa khả dụng');

    // BR-S9: người sở hữu mất quyền → thất bại, không gửi dữ liệu theo quyền cũ.
    const { permissions } = await this.authz.getEffectiveRolesAndPermissions(schedule.owner_user_id);
    if (!permissions.includes('report.schedule.manage')) throw new PermanentRunError('Người sở hữu lịch không còn quyền quản lý lịch gửi báo cáo');
    const owners: Array<{ email: string }> = await this.dataSource.query(`SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL AND account_status = 'active'`, [schedule.owner_user_id]);
    if (!owners[0]) throw new PermanentRunError('Người sở hữu lịch không còn hoạt động');

    const filters = { ...schedule.filters_json, from: ymd(run.period_from), to: ymd(run.period_to) };
    let resolved;
    try {
      resolved = await this.scope.resolve(schedule.owner_user_id, def, filters);
    } catch (e) {
      throw new PermanentRunError(e instanceof Error ? e.message : 'Người sở hữu lịch không đủ quyền xem báo cáo này');
    }

    const emails = await this.resolveRecipients(schedule.recipients_json);
    if (emails.length === 0) throw new PermanentRunError('Không còn người nhận hợp lệ');

    const now = new Date();
    const model = await provider.build(filters, resolved, null, now);
    const cap = await this.center.maxRows();
    if (model.total > cap) throw new PermanentRunError(`Báo cáo có ${model.total.toLocaleString('vi-VN')} dòng, vượt giới hạn ${cap.toLocaleString('vi-VN')} dòng. Hãy thu hẹp bộ lọc của lịch.`);

    const stored: StoredReportFile[] = [];
    for (const format of run.formats as ReportFormat[]) {
      stored.push(await this.files.renderAndStore(model, format, { generatedAt: now, generatedByEmail: owners[0].email }, { entityType: 'report_schedule_run', entityId: run.id }));
    }
    const total = stored.reduce((t, f) => t + f.sizeBytes, 0);
    const tooBig = total > MAX_ATTACHMENT_BYTES;
    const period = `${dmy(filters.from)} → ${dmy(filters.to)}`;
    const note = tooBig ? `Tổng dung lượng tệp (${(total / 1048576).toFixed(1)} MB) vượt 15 MB nên không đính kèm; tải tệp trên hệ thống.` : null;
    const subject = schedule.subject?.trim() || `Báo cáo ${def.title} — ${period}`;
    const html = buildReportScheduleEmail({
      scheduleName: schedule.name, reportTitle: def.title, periodLabel: period, message: schedule.message,
      fileNames: tooBig ? [] : stored.map((f) => f.fileName), appUrl: this.config.get<string>('APP_URL', '') || null, note,
    });
    await this.notifications.enqueueEmailNotification({
      notificationType: NotificationType.REPORT_SCHEDULE_DELIVERY,
      channel: NotificationChannel.EMAIL,
      subject,
      content: `${def.title} — ${period}${schedule.message ? `\n${schedule.message}` : ''}`,
      toEmails: emails,
      emailHtml: html,
      attachments: tooBig ? undefined : stored.map((f) => ({ storageKey: f.storageKey, fileName: f.fileName, mimeType: f.mimeType })),
      relatedEntityType: 'report_schedule_run',
      relatedEntityId: run.id,
      createdBy: schedule.owner_user_id,
    });
    await this.dataSource.query(
      `UPDATE report_schedule_runs SET status = 'success', output_file_ids = $2::uuid[], recipient_count = $3, error_message = $4, finished_at = now() WHERE id = $1`,
      [run.id, stored.map((f) => f.mediaFileId), emails.length, note],
    );
  }

  /** BR-S8: tra email người nhận nội bộ tại thời điểm gửi; tài khoản không còn hoạt động bị bỏ qua; bỏ trùng. */
  async resolveRecipients(list: ScheduleRecipient[]): Promise<string[]> {
    const emails = new Set<string>();
    const userIds = list.filter((r) => r.type === 'user').map((r) => r.value).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
    if (userIds.length) {
      const rows: Array<{ email: string }> = await this.dataSource.query(
        `SELECT email FROM users WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL AND account_status = 'active' AND employment_status IN ('active','probation')`,
        [userIds],
      );
      for (const r of rows) if (r.email && !r.email.endsWith('.invalid')) emails.add(r.email.toLowerCase());
    }
    for (const r of list) if (r.type === 'email' && r.value) emails.add(r.value.trim().toLowerCase());
    return [...emails];
  }

  private async fail(runId: string, message: string): Promise<void> {
    this.logger.error(`Lần chạy ${runId} thất bại: ${message}`);
    await this.dataSource.query(`UPDATE report_schedule_runs SET status = 'failed', error_message = $2, finished_at = now() WHERE id = $1 AND status <> 'success'`, [runId, message]);
  }
}
