// RPT-CENTER-BE-001 Task 11 — tạo job xuất, worker dựng 3 định dạng, trần dòng, file gần đây.
import { AppDataSource } from '../../../src/database/data-source';
import { MediaFileEntity } from '../../../src/modules/recording/entities/media-file.entity';
import { ReportCenterExportService } from '../../../src/modules/reports/center/report-center-export.service';
import { ReportCenterWorkerProcessor } from '../../../src/modules/reports/center/report-center-worker.processor';
import { ReportCenterService } from '../../../src/modules/reports/center/report-center.service';
import { ReportFileService } from '../../../src/modules/reports/center/report-file.service';
import type { ReportModel, ReportProvider } from '../../../src/modules/reports/center/report-model';
import { ReportScopeService } from '../../../src/modules/reports/center/report-scope.service';
import { BackgroundJobsService } from '../../../src/modules/administration/services/background-jobs.service';
import { BackgroundJobEntity } from '../../../src/modules/administration/entities/background-job.entity';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const TAG = 'fa11ed03';

describeDb('RPT-CENTER export', () => {
  let userId: string;
  let rowCount = 3;
  const queued: Array<{ queue: string; name: string; data: any }> = [];
  const saved: Array<{ originalName: string; size: number }> = [];
  const audits: unknown[] = [];
  let exporter: ReportCenterExportService;
  let worker: ReportCenterWorkerProcessor;
  const provider: ReportProvider = {
    type: 'gate-access',
    build: async (f) => {
      if ((f as Record<string, string>)['boom']) throw new Error('lỗi dữ liệu giả');
      const rows = Array.from({ length: rowCount }, (_, i) => ({ fullName: `Người ${i}`, durationSeconds: 60 }));
      return {
        type: 'gate-access', title: 'Ra vào khuôn viên', period: { from: f.from, to: f.to }, filterLines: [], kpis: [{ key: 'entries', label: 'Lượt vào', value: rowCount, format: 'number' }],
        charts: [], columns: [{ key: 'fullName', label: 'Họ tên', format: 'text' }, { key: 'durationSeconds', label: 'Thời lượng', format: 'duration' }], rows, total: rowCount,
      } as ReportModel;
    },
  };

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    userId = (await AppDataSource.query(`INSERT INTO users (employee_code, username, email, password_hash, full_name) VALUES ('${TAG}-U','${TAG}u','${TAG}u@t.invalid','x','${TAG} U') RETURNING id`))[0].id;
    const jobs = new BackgroundJobsService(AppDataSource.getRepository(BackgroundJobEntity) as never, { get: () => undefined } as never);
    const scope = { resolve: async () => ({ unrestricted: true, departmentIds: null }) } as unknown as ReportScopeService;
    const center = new ReportCenterService(AppDataSource, scope, { getMaxRangeDays: async () => 366 } as never, { get: () => true } as never, [provider]);
    exporter = new ReportCenterExportService(
      center, jobs, { addJob: async (queue: string, name: string, data: unknown) => { queued.push({ queue, name, data }); } } as never,
      { logAction: async (a: unknown) => { audits.push(a); } } as never, AppDataSource);
    const storage = { saveFile: async (i: { buffer: Buffer; originalName: string }) => { saved.push({ originalName: i.originalName, size: i.buffer.length }); return { storageKey: `exports/${TAG}-${i.originalName}`, sizeBytes: i.buffer.length }; }, getDriver: () => 'local' };
    worker = new ReportCenterWorkerProcessor(jobs, new ReportFileService(AppDataSource.getRepository(MediaFileEntity), storage as never), AppDataSource, [provider]);
  });
  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM media_files WHERE storage_key LIKE 'exports/${TAG}-%'`);
    await AppDataSource.query(`DELETE FROM background_jobs WHERE requested_by = $1`, [userId]);
    await AppDataSource.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await AppDataSource.destroy();
  });
  beforeEach(() => { queued.length = 0; saved.length = 0; audits.length = 0; rowCount = 3; });

  const body = (extra: Record<string, unknown> = {}) => ({ format: 'pdf', from: '2026-10-01', to: '2026-10-07', ...extra });
  const job = async (id: string) => (await AppDataSource.query(`SELECT status, output_file_id, error_message, input_json FROM background_jobs WHERE id = $1`, [id]))[0];
  const runJob = async (extra: Record<string, unknown> = {}) => {
    const res = await exporter.create('gate-access', body(extra), { userId, email: 'x@t.invalid' });
    await worker.processExport({ id: 'j1', data: queued[queued.length - 1].data } as never);
    return res.jobId;
  };

  it('định dạng lạ → 400; loại chưa khả dụng/không tồn tại bị chặn trước khi tạo job', async () => {
    await expect(exporter.create('gate-access', body({ format: 'csv' }), { userId, email: 'e' })).rejects.toMatchObject({ response: { message: 'Định dạng xuất không hợp lệ' } });
    await expect(exporter.create('student-attendance', body(), { userId, email: 'e' })).rejects.toMatchObject({ status: 409 });
    await expect(exporter.create('nope', body(), { userId, email: 'e' })).rejects.toMatchObject({ status: 404 });
    expect(queued).toHaveLength(0);
  });

  it('tạo job: related_entity_type=report_center, input_json giữ loại/định dạng/phạm vi, đẩy đúng queue và ghi audit', async () => {
    const res = await exporter.create('gate-access', body(), { userId, email: 'x@t.invalid' });
    expect(res).toMatchObject({ status: 'queued', delivery: 'download', outputFileId: null });
    const row = await job(res.jobId);
    expect(row.input_json).toMatchObject({ type: 'gate-access', format: 'pdf', scope: { unrestricted: true } });
    expect((await AppDataSource.query(`SELECT related_entity_type FROM background_jobs WHERE id = $1`, [res.jobId]))[0].related_entity_type).toBe('report_center');
    expect(queued[0]).toMatchObject({ queue: 'report-export', name: 'export:report-center' });
    expect(audits).toHaveLength(1);
  });

  it.each([['pdf', 'application/pdf'], ['xlsx', 'spreadsheetml.sheet'], ['docx', 'wordprocessingml.document']])('worker %s: tạo media_files đúng mime và hoàn tất job', async (format, mime) => {
    const id = await runJob({ format });
    const row = await job(id);
    expect(row.status).toBe('completed');
    const media = (await AppDataSource.query(`SELECT mime_type, file_name FROM media_files WHERE id = $1`, [row.output_file_id]))[0];
    expect(media.mime_type).toContain(mime);
    expect(media.file_name).toBe(`gate-access_2026-10-01_2026-10-07.${format}`);
  });

  it('mô hình rỗng vẫn hoàn tất', async () => {
    rowCount = 0;
    expect((await job(await runJob())).status).toBe('completed');
  });

  it('quá trần dòng → job failed với thông điệp yêu cầu thu hẹp kỳ', async () => {
    await AppDataSource.query(`DELETE FROM system_configs WHERE config_key = 'report.export_max_rows'`);
    await AppDataSource.query(`INSERT INTO system_configs (config_key, config_value, config_group) VALUES ('report.export_max_rows', '2', 'report')`);
    try {
      const row = await job(await runJob());
      expect(row.status).toBe('failed');
      expect(row.error_message).toContain('thu hẹp');
    } finally { await AppDataSource.query(`DELETE FROM system_configs WHERE config_key = 'report.export_max_rows'`); }
  });

  it('lỗi provider → markFailed, worker không ném', async () => {
    const res = await exporter.create('gate-access', body(), { userId, email: 'e' });
    const data = { ...queued[0].data, filters: { ...queued[0].data.filters, boom: '1' } };
    await expect(worker.processExport({ id: 'j', data } as never)).resolves.toBeUndefined();
    const row = await job(res.jobId);
    expect(row.status).toBe('failed');
    expect(row.error_message).toContain('lỗi dữ liệu giả');
  });

  it('recent: chỉ job của chính người gọi, tối đa 10, kèm outputFileId và tên file', async () => {
    for (let i = 0; i < 11; i += 1) await runJob({ format: 'xlsx' });
    const other = (await AppDataSource.query(`INSERT INTO users (employee_code, username, email, password_hash, full_name) VALUES ('${TAG}-O','${TAG}o','${TAG}o@t.invalid','x','o') RETURNING id`))[0].id;
    try {
      expect(await exporter.recent(other)).toEqual([]);
      const mine = await exporter.recent(userId);
      expect(mine).toHaveLength(10);
      expect(mine[0]).toMatchObject({ reportType: 'gate-access', reportTitle: 'Ra vào khuôn viên', format: 'xlsx', from: '2026-10-01', to: '2026-10-07', status: 'completed' });
      expect(mine[0].outputFileId).toBeTruthy();
      expect(mine[0].fileName).toBe('gate-access_2026-10-01_2026-10-07.xlsx');
    } finally { await AppDataSource.query(`DELETE FROM users WHERE id = $1`, [other]); }
  });
});
