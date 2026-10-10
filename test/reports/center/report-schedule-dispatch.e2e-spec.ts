// RPT-CENTER-BE-001 Task 15 — dispatch (chống trùng), worker lần chạy, gửi thử, gửi lại, tải tệp.
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../../src/database/data-source';
import { MediaFileEntity } from '../../../src/modules/recording/entities/media-file.entity';
import { ReportCenterWorkerProcessor } from '../../../src/modules/reports/center/report-center-worker.processor';
import { ReportFileService } from '../../../src/modules/reports/center/report-file.service';
import type { ReportModel, ReportProvider } from '../../../src/modules/reports/center/report-model';
import { ReportScopeService } from '../../../src/modules/reports/center/report-scope.service';
import { ReportScheduleDispatchService } from '../../../src/modules/reports/schedules/report-schedule-dispatch.service';
import { PermanentRunError, ReportScheduleRunWorker } from '../../../src/modules/reports/schedules/report-schedule-run.worker';
import { ReportScheduleRunService } from '../../../src/modules/reports/schedules/report-schedule-run.service';
import { ReportScheduleService } from '../../../src/modules/reports/schedules/report-schedule.service';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const TAG = 'fa11ed05';

describeDb('RPT-CENTER schedule dispatch / run', () => {
  let ownerId: string;
  let staffId: string;
  let resignedId: string;
  const jobs: Array<{ name: string; data: { runId: string }; opts: unknown }> = [];
  const mails: any[] = [];
  let queueFails = false;
  let ownerPerms = ['report.schedule.manage'];
  let storedSize = 1000;
  let providerThrows = false;
  let dispatcher: ReportScheduleDispatchService;
  let worker: ReportScheduleRunWorker;
  let runs: ReportScheduleRunService;
  let schedules: ReportScheduleService;
  const created: string[] = [];

  const provider: ReportProvider = {
    type: 'gate-access',
    build: async (f) => {
      if (providerThrows) throw new Error('DB tạm thời lỗi');
      return { type: 'gate-access', title: 'Ra vào', period: { from: f.from, to: f.to }, filterLines: [], kpis: [], charts: [], columns: [{ key: 'a', label: 'A', format: 'text' }], rows: [{ a: 'x' }], total: 1 } as ReportModel;
    },
  };

  const makeSchedule = async (extra: Record<string, unknown> = {}) => {
    const s = await schedules.create({
      name: `${TAG} lịch`, reportType: 'gate-access', filters: {}, period: 'yesterday', frequency: 'daily', time: '08:00', formats: ['pdf', 'xlsx'],
      recipients: [{ type: 'email', value: 'x@y.vn', label: 'x' }], ...extra,
    }, ownerId);
    created.push(s.id);
    return s;
  };
  const makeDue = async (id: string, at = '2026-10-05T01:00:00Z') => AppDataSource.query(`UPDATE report_schedules SET next_run_at = $2 WHERE id = $1`, [id, at]);

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    const mk = async (c: string, status = 'active', employment = 'active') => (await AppDataSource.query(
      `INSERT INTO users (employee_code, username, email, password_hash, full_name, account_status, employment_status) VALUES ($1,$2,$3,'x',$4,$5,$6) RETURNING id`,
      [`${TAG}-${c}`, `${TAG}${c}`.toLowerCase(), `${TAG}${c}@t.invalid`.toLowerCase(), `${TAG} ${c}`, status, employment]))[0].id as string;
    ownerId = await mk('OWNER'); staffId = await mk('STAFF'); resignedId = await mk('GONE', 'active', 'resigned');
    // email thật cho người nhận nội bộ (đuôi .invalid bị bỏ qua có chủ đích)
    await AppDataSource.query(`UPDATE users SET email = $2 WHERE id = $1`, [staffId, `${TAG}.staff@fpt.edu.vn`]);
    await AppDataSource.query(`UPDATE users SET email = $2 WHERE id = $1`, [resignedId, `${TAG}.gone@fpt.edu.vn`]);

    const queue = { addJob: async (_q: string, name: string, data: any, opts: unknown) => { if (queueFails) throw new Error('Redis down'); jobs.push({ name, data, opts }); return 'j'; } };
    schedules = new ReportScheduleService(AppDataSource, { logAction: async () => undefined } as never);
    dispatcher = new ReportScheduleDispatchService(AppDataSource, queue as never);
    const store = { saveFile: async (i: { originalName: string }) => ({ storageKey: `exports/${TAG}-${i.originalName}`, sizeBytes: storedSize }), getDriver: () => 'local', generateSignedDownloadToken: () => ({ token: 'tok' }) };
    const files = new ReportFileService(AppDataSource.getRepository(MediaFileEntity), store as never);
    const scope = { resolve: async () => ({ unrestricted: true, departmentIds: null }) } as unknown as ReportScopeService;
    const authz = { getEffectiveRolesAndPermissions: async () => ({ roles: ['SYSTEM_ADMIN'], permissions: ownerPerms }) };
    const notifications = { enqueueEmailNotification: async (d: unknown) => { mails.push(d); return { notification: { id: 'n' } }; } };
    const config = { get: (k: string, d?: unknown) => (k === 'API_PUBLIC_BASE_URL' ? 'http://api.test' : d) } as unknown as ConfigService;
    const center = new ReportCenterWorkerProcessor({} as never, files, AppDataSource, [provider]);
    worker = new ReportScheduleRunWorker(AppDataSource as DataSource, scope, authz as never, files, notifications as never, center, config, [provider]);
    runs = new ReportScheduleRunService(AppDataSource, schedules, dispatcher, store as never, config);
  });
  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM media_files WHERE storage_key LIKE 'exports/${TAG}-%'`);
    await AppDataSource.query(`DELETE FROM report_schedule_runs WHERE schedule_name LIKE '${TAG}%'`);
    await AppDataSource.query(`DELETE FROM report_schedules WHERE name LIKE '${TAG}%'`);
    await AppDataSource.query(`DELETE FROM users WHERE employee_code LIKE '${TAG}-%'`);
    await AppDataSource.destroy();
  });
  beforeEach(async () => {
    jobs.length = 0; mails.length = 0; queueFails = false; ownerPerms = ['report.schedule.manage']; storedSize = 1000; providerThrows = false;
    await AppDataSource.query(`UPDATE report_schedules SET enabled = false, next_run_at = NULL WHERE name LIKE '${TAG}%'`); // chỉ lịch của test này tham gia dispatch
  });
  const run = async (id: string) => (await AppDataSource.query(`SELECT * FROM report_schedule_runs WHERE id = $1`, [id]))[0];

  describe('dispatch', () => {
    it('lịch đến hạn → 1 lần chạy queued kỳ "hôm qua" theo lượt hẹn, next_run_at nhảy, 1 job', async () => {
      const s = await makeSchedule();
      await AppDataSource.query(`UPDATE report_schedules SET enabled = true WHERE id = $1`, [s.id]);
      await makeDue(s.id, '2026-10-05T01:00:00Z');
      const now = new Date('2026-10-05T01:00:20Z');
      expect(await dispatcher.dispatchDue(now)).toEqual({ dispatched: 1 });
      const r = (await AppDataSource.query(`SELECT * FROM report_schedule_runs WHERE schedule_id = $1`, [s.id]))[0];
      expect(r).toMatchObject({ trigger: 'scheduled', status: 'queued', recipient_count: 1 });
      expect(String(r.period_from).slice(0, 10)).toBeDefined();
      expect((await AppDataSource.query(`SELECT to_char(period_from,'YYYY-MM-DD') f, to_char(period_to,'YYYY-MM-DD') t FROM report_schedule_runs WHERE id = $1`, [r.id]))[0]).toEqual({ f: '2026-10-04', t: '2026-10-04' });
      const sch = (await AppDataSource.query(`SELECT next_run_at, last_run_at FROM report_schedules WHERE id = $1`, [s.id]))[0];
      expect(new Date(sch.next_run_at).toISOString()).toBe('2026-10-06T01:00:00.000Z');
      expect(new Date(sch.last_run_at).toISOString()).toBe(now.toISOString());
      expect(jobs).toEqual([{ name: 'report-schedule:run', data: { runId: r.id }, opts: { attempts: 3, backoffDelay: 30000 } }]);
    });

    it('lịch tắt hoặc chưa đến hạn không chạy; chạy lại không sinh lần thứ hai', async () => {
      const off = await makeSchedule();
      await makeDue(off.id);
      await AppDataSource.query(`UPDATE report_schedules SET enabled = false WHERE id = $1`, [off.id]);
      const future = await makeSchedule();
      await AppDataSource.query(`UPDATE report_schedules SET enabled = true, next_run_at = '2099-01-01' WHERE id = $1`, [future.id]);
      expect(await dispatcher.dispatchDue(new Date('2026-10-05T02:00:00Z'))).toEqual({ dispatched: 0 });
      const due = await makeSchedule();
      await AppDataSource.query(`UPDATE report_schedules SET enabled = true WHERE id = $1`, [due.id]);
      await makeDue(due.id);
      expect((await dispatcher.dispatchDue(new Date('2026-10-05T02:00:00Z'))).dispatched).toBe(1);
      expect((await dispatcher.dispatchDue(new Date('2026-10-05T02:00:30Z'))).dispatched).toBe(0);
    });

    it('hai lời gọi đồng thời với 5 lịch đến hạn → tổng đúng 5 lần chạy và 5 job', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const s = await makeSchedule({ name: `${TAG} song song ${i}` });
        await AppDataSource.query(`UPDATE report_schedules SET enabled = true WHERE id = $1`, [s.id]);
        await makeDue(s.id);
        ids.push(s.id);
      }
      const now = new Date('2026-10-05T01:05:00Z');
      const [a, b] = await Promise.all([dispatcher.dispatchDue(now), dispatcher.dispatchDue(now)]);
      expect(a.dispatched + b.dispatched).toBe(5);
      expect(Number((await AppDataSource.query(`SELECT count(*) c FROM report_schedule_runs WHERE schedule_id = ANY($1::uuid[])`, [ids]))[0].c)).toBe(5);
      expect(jobs).toHaveLength(5);
    });

    it('đẩy job lỗi → lần chạy failed với lý do, không mất dấu', async () => {
      const s = await makeSchedule();
      await AppDataSource.query(`UPDATE report_schedules SET enabled = true WHERE id = $1`, [s.id]);
      await makeDue(s.id);
      queueFails = true;
      await dispatcher.dispatchDue(new Date('2026-10-05T01:05:00Z'));
      const r = (await AppDataSource.query(`SELECT status, error_message FROM report_schedule_runs WHERE schedule_id = $1`, [s.id]))[0];
      expect(r.status).toBe('failed');
      expect(r.error_message).toContain('Redis down');
    });
  });

  describe('worker', () => {
    const queued = async (extra: Record<string, unknown> = {}) => {
      const s = await makeSchedule(extra);
      const r = await runs.runNow(s.id, new Date('2026-10-05T03:00:00Z'));
      return { s, runId: r.id };
    };

    it('2 định dạng → 2 media_files, một email có 2 tệp, success với recipient_count', async () => {
      const { runId } = await queued();
      await worker.processExport({ data: { runId }, attemptsMade: 0, opts: { attempts: 3 } } as never);
      const r = await run(runId);
      expect({ status: r.status, error: r.error_message }).toEqual({ status: 'success', error: null });
      expect(r.output_file_ids).toHaveLength(2);
      expect(r.recipient_count).toBe(1);
      expect(mails).toHaveLength(1);
      expect(mails[0].attachments.map((a: { fileName: string }) => a.fileName).sort()).toEqual(['gate-access_2026-10-04_2026-10-04.pdf', 'gate-access_2026-10-04_2026-10-04.xlsx']);
      expect(mails[0].toEmails).toEqual(['x@y.vn']);
    });

    it('người nhận nội bộ đã nghỉ bị bỏ qua; trùng email gộp; .invalid bị bỏ', async () => {
      const { runId } = await queued({ recipients: [
        { type: 'user', value: staffId, label: 's' }, { type: 'user', value: resignedId, label: 'g' },
        { type: 'email', value: 'X@Y.vn' }, { type: 'email', value: 'x@y.vn' },
      ] });
      await worker.processExport({ data: { runId }, attemptsMade: 0, opts: { attempts: 3 } } as never);
      expect((await run(runId)).recipient_count).toBe(2);
      expect([...mails[0].toEmails].sort()).toEqual([`${TAG}.staff@fpt.edu.vn`, 'x@y.vn']);
    });

    it('không còn ai nhận hợp lệ → failed ngay "Không còn người nhận hợp lệ"', async () => {
      const { runId } = await queued({ recipients: [{ type: 'user', value: resignedId, label: 'g' }] });
      await worker.processExport({ data: { runId }, attemptsMade: 0, opts: { attempts: 3 } } as never);
      const r = await run(runId);
      expect([r.status, r.error_message]).toEqual(['failed', 'Không còn người nhận hợp lệ']);
      expect(mails).toHaveLength(0);
    });

    it('người sở hữu mất quyền → failed, không gửi', async () => {
      const { runId } = await queued();
      ownerPerms = [];
      await worker.processExport({ data: { runId }, attemptsMade: 0, opts: { attempts: 3 } } as never);
      expect((await run(runId)).error_message).toContain('không còn quyền');
      expect(mails).toHaveLength(0);
    });

    it('tổng tệp vượt 15 MB → email không đính kèm, lần chạy success kèm ghi chú', async () => {
      storedSize = 9 * 1024 * 1024;
      const { runId } = await queued();
      await worker.processExport({ data: { runId }, attemptsMade: 0, opts: { attempts: 3 } } as never);
      const r = await run(runId);
      expect(r.status).toBe('success');
      expect(r.error_message).toContain('15 MB');
      expect(mails[0].attachments).toBeUndefined();
    });

    it('lỗi tạm thời: ném lại để BullMQ thử lại, trạng thái về queued; lần thử cuối → failed, không ném', async () => {
      const { runId } = await queued();
      providerThrows = true;
      await expect(worker.processExport({ data: { runId }, attemptsMade: 0, opts: { attempts: 3 } } as never)).rejects.toThrow('DB tạm thời lỗi');
      expect((await run(runId)).status).toBe('queued');
      await expect(worker.processExport({ data: { runId }, attemptsMade: 2, opts: { attempts: 3 } } as never)).resolves.toBeUndefined();
      const r = await run(runId);
      expect([r.status, r.error_message]).toEqual(['failed', 'DB tạm thời lỗi']);
    });

    it('job lặp trên lần chạy đã xong là no-op (không gửi email thứ hai)', async () => {
      const { runId } = await queued();
      await worker.processExport({ data: { runId }, attemptsMade: 0, opts: { attempts: 3 } } as never);
      await worker.processExport({ data: { runId }, attemptsMade: 0, opts: { attempts: 3 } } as never);
      expect(mails).toHaveLength(1);
    });

    it('lịch đã xóa → failed "Lịch gửi đã bị xóa"', async () => {
      const { s, runId } = await queued();
      await schedules.remove(s.id, ownerId);
      await worker.processExport({ data: { runId }, attemptsMade: 0, opts: { attempts: 3 } } as never);
      expect((await run(runId)).error_message).toBe('Lịch gửi đã bị xóa');
      expect(new PermanentRunError('x')).toBeInstanceOf(Error);
    });
  });

  describe('API dịch vụ lần chạy', () => {
    it('run-now không đổi next_run_at, tạo lần manual', async () => {
      const s = await makeSchedule();
      const before = (await AppDataSource.query(`SELECT next_run_at FROM report_schedules WHERE id = $1`, [s.id]))[0].next_run_at;
      const r = await runs.runNow(s.id);
      expect(r).toMatchObject({ trigger: 'manual', status: 'queued', scheduleId: s.id, reportTitle: 'Ra vào khuôn viên' });
      expect((await AppDataSource.query(`SELECT next_run_at FROM report_schedules WHERE id = $1`, [s.id]))[0].next_run_at).toEqual(before);
      expect(jobs).toHaveLength(1);
    });

    it('retry: chỉ lần failed, một lần duy nhất, cùng kỳ, gắn retried_by_run_id', async () => {
      const s = await makeSchedule();
      const first = await runs.runNow(s.id);
      await expect(runs.retry(first.id)).rejects.toMatchObject({ response: { message: 'Chỉ gửi lại được lần chạy thất bại' } });
      await AppDataSource.query(`UPDATE report_schedule_runs SET status = 'failed' WHERE id = $1`, [first.id]);
      const again = await runs.retry(first.id);
      expect(again).toMatchObject({ trigger: 'manual', from: first.from, to: first.to });
      expect((await run(first.id)).retried_by_run_id).toBe(again.id);
      await expect(runs.retry(first.id)).rejects.toMatchObject({ response: { message: 'Lần chạy này đã được gửi lại' } });
      await expect(runs.retry('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ status: 404 });
    });

    it('tải tệp: lần failed → 409; lần success → liên kết ký; định dạng không có → 409', async () => {
      const s = await makeSchedule({ formats: ['pdf'] });
      const r = await runs.runNow(s.id);
      await expect(runs.fileLink(r.id, 'pdf')).rejects.toMatchObject({ status: 409 });
      await worker.processExport({ data: { runId: r.id }, attemptsMade: 0, opts: { attempts: 3 } } as never);
      const link = await runs.fileLink(r.id, 'pdf');
      expect(link.downloadUrl).toMatch(/^http:\/\/api\.test\/api\/v1\/media-files\/[0-9a-f-]{36}\/secure-download\?token=tok$/);
      await expect(runs.fileLink(r.id, 'docx')).rejects.toMatchObject({ response: { message: 'Lần chạy này không có file ở định dạng đã chọn' } });
      await expect(runs.fileLink(r.id, 'zip')).rejects.toMatchObject({ status: 400 });
    });

    it('lọc và phân trang lịch sử', async () => {
      const s = await makeSchedule();
      for (let i = 0; i < 3; i += 1) await runs.runNow(s.id);
      await AppDataSource.query(`UPDATE report_schedule_runs SET status = 'failed' WHERE id = (SELECT id FROM report_schedule_runs WHERE schedule_id = $1 LIMIT 1)`, [s.id]);
      const all = await runs.list({ scheduleId: s.id, limit: 2, page: 1 });
      expect([all.items.length, all.total]).toEqual([2, 3]);
      expect((await runs.list({ scheduleId: s.id, status: 'failed' })).total).toBe(1);
      await expect(runs.list({ status: 'weird' })).rejects.toMatchObject({ status: 400 });
    });
  });
});
