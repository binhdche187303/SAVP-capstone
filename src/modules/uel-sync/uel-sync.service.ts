import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UelApiClient } from './uel-api.client.js';
import { UEL_API } from './uel-api.types.js';
import type {
  UelDangKy,
  UelLopHp,
  UelLopSv,
  UelNhanSu,
  UelPhongBan,
  UelSvLopSv,
  UelTkbLopHp1Ngay,
  UelTkbNguoi1Ngay,
} from './uel-api.types.js';
import {
  clean,
  codeListOf,
  eachDate,
  emailOf,
  fullNameOf,
  roomNameOf,
  semesterCodeOf,
  semesterNameOf,
  sessionTimesFromClock,
  lecturerNamesOf,
  personNameKey,
  sessionTimesFromStart,
  sessionTimesOf,
  staffRoleOf,
  isCohortInScope,
  toIsoDate,
  toUelDate,
  usernameOf,
} from './uel-sync.mapper.js';
import type { PeriodTime } from './uel-sync.mapper.js';
import {
  gapsWorkbook,
  loadGaps,
  staffIdsByName,
  summarizeGaps,
  type UelGapSummary,
} from './uel-sync-gaps.js';
import {
  UEL_API_CLIENT,
  UEL_MIN_STUDENT_COHORT,
} from './uel-sync.constants.js';

export const UEL_SYNC_STEPS = [
  'departments',
  'staff',
  'students',
  'sections',
  'enrollments',
  'sessions',
] as const;
export type UelSyncStep = (typeof UEL_SYNC_STEPS)[number];

export interface UelSyncTerm {
  namHoc: string;
  hocKy: string;
}

export interface UelSyncOptions {
  steps?: UelSyncStep[];
  /** Bắt buộc cho sections / enrollments. */
  namHoc?: string;
  hocKy?: string;
  /** Bắt buộc cho sessions (yyyy-MM-dd). */
  fromDate?: string;
  toDate?: string;
  /**
   * sessions theo người: chỉ lấy TKB của các mã GV / SV này (chi_tiet_tkb_gv|sv_1ngay).
   * Có mã ⇒ không gọi tkb_lophp_1ngay và không hủy buổi nào.
   */
  lecturerCodes?: string[];
  studentCodes?: string[];
  /** Lượt "toàn bộ": cách chọn học kỳ + các học kỳ đã chạy bước sections/enrollments. */
  termMode?: 'auto' | 'fixed';
  terms?: UelSyncTerm[];
}

/** Tham số lượt "đồng bộ toàn bộ" (POST /uel-sync/run-all + lịch tự động). */
export interface UelSyncAllPlan {
  fromDate: string;
  toDate: string;
  termMode: 'auto' | 'fixed';
  /** fixed: đúng 1 học kỳ; auto: để trống, tự nhận khi chạy. */
  terms: UelSyncTerm[];
}

export interface UelSyncStepResult {
  step: UelSyncStep;
  fetched: number;
  upserted: number;
  skipped: number;
  deactivated: number;
  warnings: string[];
  error?: string;
  /** sections/enrollments chạy nhiều học kỳ: học kỳ của kết quả này, vd "2026-2027 HK01". */
  term?: string;
}

export type UelSyncTrigger = 'manual' | 'schedule';
export type UelSyncRunStatus = 'running' | 'succeeded' | 'partial' | 'failed';

export interface UelSyncRun {
  /** id dòng uel_sync_runs (null nếu ghi lịch sử lỗi). */
  id: string | null;
  trigger: UelSyncTrigger;
  requestedBy: string | null;
  status: UelSyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  options: UelSyncOptions;
  results: UelSyncStepResult[];
  /** Bước đang chạy (chỉ có khi status = running). */
  currentStep?: UelSyncStep | null;
  /** Dữ liệu cần bổ sung (SV/cán bộ chưa có email, lớp HP chưa có GV) lúc lượt kết thúc. */
  gaps?: UelGapSummary | null;
}

/** Lượt đọc từ lịch sử, kèm tên người bấm. */
export interface UelSyncRunView extends UelSyncRun {
  requestedByName: string | null;
  /** Lượt bị dừng giữa chừng vì server khởi động lại (kết quả là các bước đã xong trước đó). */
  interrupted: boolean;
}

/** Chạy dài (vd bước sessions cả năm) ⇒ lưu tiến độ định kỳ để server dừng giữa chừng vẫn còn kết quả. */
const PROGRESS_SAVE_MS = 60_000;

/** users.id theo mã cán bộ/SV: mã chính (employee_code) hoặc mã phụ đã gộp (uel_code_aliases). */
function userIdByCodeSql(
  param: string,
  kind: 'staff' | 'student' = 'staff',
): string {
  return `COALESCE(
      (SELECT id FROM users WHERE employee_code = ${param} AND deleted_at IS NULL LIMIT 1),
      (SELECT a.user_id FROM uel_code_aliases a JOIN users au ON au.id = a.user_id AND au.deleted_at IS NULL
        WHERE a.kind = '${kind}' AND a.alias_code = ${param} LIMIT 1))`;
}

/** failed: mọi bước lỗi; partial: có bước lỗi; còn lại succeeded. */
export function runStatusOf(results: UelSyncStepResult[]): UelSyncRunStatus {
  const errors = results.filter((r) => r.error).length;
  if (results.length && errors === results.length) return 'failed';
  return results.some(
    (r) => r.error || r.skipped > 0 || (r.warnings?.length ?? 0) > 0,
  )
    ? 'partial'
    : 'succeeded';
}

/** Giữ tối đa N cảnh báo mỗi bước để kết quả không phình to. */
const MAX_WARNINGS = 50;
/** Lịch học: tối đa 1 lần gọi = 1 ngày; chặn khoảng quá dài (lượt chọn tay). */
const MAX_SESSION_DAYS = 120;
/** Lượt đồng bộ toàn bộ lấy đến hết năm học (~1 năm) ⇒ chặn riêng, rộng hơn. */
const MAX_FULL_SYNC_DAYS = 400;
/** Lịch theo người: mỗi mã × mỗi ngày = 1 lần gọi; giới hạn để không bị UEL chặn (429). */
const MAX_SESSION_CODES = 30;
const MAX_TARGETED_CALLS = 600;

interface IdRow {
  id: string;
}

interface SessionCtx {
  r: UelSyncStepResult;
  periods: Map<number, PeriodTime>;
  /** Thời lượng (phút) thường gặp theo "tiết bắt đầu|số tiết" từ các buổi UEL đã có giờ. */
  durations: Map<string, number>;
  sectionIds: Map<string, string>;
  roomCache: Map<string, string | null>;
  /** external_id đã ghi trong lượt này (GV/SV trùng buổi). */
  seen: Set<string>;
  /** Học kỳ chỉ định (semester_code): buổi của kỳ khác bỏ qua, không tính là lỗi. */
  onlyTerm?: string;
}

interface StepCtx {
  /** Mốc bắt đầu bước theo đồng hồ DB (text timestamptz, đủ micro giây). */
  runStart: string;
  r: UelSyncStepResult;
}

/**
 * UelSyncService — đồng bộ dữ liệu từ API Đào tạo UEL vào SAVP.
 *
 * Quy tắc chung:
 * - Key nguồn: mã của UEL (ma_phong_ban, ma_nhan_su, ma_sinh_vien, ma_hoc_phan, ma_lop_hoc_phan, ma_lich_hoc).
 * - Chỉ ghi các cột API có dữ liệu; cột nhập tay (SĐT, chức danh, ...) giữ nguyên.
 * - Bản ghi được đánh dấu source='uel_api', last_synced_at = lúc đồng bộ.
 * - Bản ghi uel_api không còn ở nguồn (last_synced_at < lúc bắt đầu chạy) → vô hiệu hóa, không xóa.
 * - Mỗi câu lệnh chạy độc lập: 1 dòng lỗi (vd trùng email) chỉ bị bỏ qua + ghi cảnh báo.
 */
@Injectable()
export class UelSyncService implements OnModuleInit {
  private readonly logger = new Logger(UelSyncService.name);
  private running = false;
  private lastRun: UelSyncRun | null = null;

  constructor(
    @Inject(UEL_API_CLIENT) private readonly client: UelApiClient,
    private readonly db: DataSource,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  get lastResult(): UelSyncRun | null {
    return this.lastRun;
  }

  get configured(): boolean {
    return this.client.configured;
  }

  /** Server tắt giữa chừng ⇒ lượt "running" cũ không bao giờ kết thúc; đánh dấu failed khi khởi động. */
  async onModuleInit(): Promise<void> {
    try {
      await this.db.query(
        `UPDATE uel_sync_runs SET status = 'failed', finished_at = now(),
                options = options || '{"interrupted": true}'::jsonb
          WHERE status = 'running'`,
      );
    } catch (e) {
      this.logger.warn(`Không dọn được uel_sync_runs: ${(e as Error).message}`);
    }
  }

  /** Kiểm tra tham số + khóa chạy; trả về promise chạy nền. */
  start(
    options: UelSyncOptions,
    meta: { trigger?: UelSyncTrigger; requestedBy?: string | null } = {},
  ): Promise<UelSyncRun> {
    const steps = this.validate(options);
    return this.begin({ ...options, steps }, steps, meta);
  }

  /**
   * Đồng bộ toàn bộ: đơn vị → cán bộ → SV → (tự nhận / học kỳ chỉ định) lớp HP + đăng ký từng
   * học kỳ → lịch học từ plan.fromDate (hôm nay) đến plan.toDate. Không lấy ngày quá khứ.
   */
  startAll(
    plan: UelSyncAllPlan,
    meta: { trigger?: UelSyncTrigger; requestedBy?: string | null } = {},
  ): Promise<UelSyncRun> {
    const steps = [...UEL_SYNC_STEPS];
    const options: UelSyncOptions = {
      steps,
      fromDate: plan.fromDate,
      toDate: plan.toDate,
      termMode: plan.termMode,
      terms: plan.termMode === 'fixed' ? plan.terms : [],
    };
    if (plan.termMode === 'fixed' && plan.terms[0]) {
      options.namHoc = plan.terms[0].namHoc;
      options.hocKy = plan.terms[0].hocKy;
    }
    // validate đòi namHoc/hocKy cho sections ⇒ chế độ auto kiểm tra phần còn lại với học kỳ tạm.
    this.validate(
      {
        ...options,
        namHoc: options.namHoc ?? 'auto',
        hocKy: options.hocKy ?? 'auto',
      },
      MAX_FULL_SYNC_DAYS,
    );
    return this.begin(options, steps, meta);
  }

  private begin(
    options: UelSyncOptions,
    steps: UelSyncStep[],
    meta: { trigger?: UelSyncTrigger; requestedBy?: string | null },
  ): Promise<UelSyncRun> {
    if (this.running) {
      throw new ConflictException('Đang có một lượt đồng bộ UEL chạy.');
    }
    this.running = true;
    const run: UelSyncRun = {
      id: null,
      trigger: meta.trigger ?? 'manual',
      requestedBy: meta.requestedBy ?? null,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      options,
      results: [],
      currentStep: steps[0] ?? null,
    };
    this.lastRun = run;
    return this.persistStart(run)
      .then(() => this.execute(run, steps))
      .finally(async () => {
        run.finishedAt = new Date().toISOString();
        run.status = runStatusOf(run.results);
        run.currentStep = null;
        run.gaps = await this.gapSummary();
        await this.persistFinish(run);
        this.running = false;
      });
  }

  /** Giờ bắt đầu lượt tự động gần nhất đã chạy xong (thành công / có bước lỗi) — cho lịch mỗi N ngày. */
  async lastScheduledRunAt(): Promise<string | null> {
    const rows = await this.db.query<{ started_at: Date }[]>(
      `SELECT started_at FROM uel_sync_runs
        WHERE trigger = 'schedule' AND status IN ('succeeded', 'partial')
        ORDER BY started_at DESC LIMIT 1`,
    );
    return rows[0] ? new Date(rows[0].started_at).toISOString() : null;
  }

  /** Lịch sử các lượt, mới nhất trước. */
  async history(limit = 20): Promise<UelSyncRunView[]> {
    const rows = await this.db.query<
      {
        id: string;
        trigger: UelSyncTrigger;
        requested_by: string | null;
        requested_by_name: string | null;
        status: UelSyncRunStatus;
        options: UelSyncOptions;
        results: UelSyncStepResult[];
        gaps: UelGapSummary | null;
        started_at: Date;
        finished_at: Date | null;
      }[]
    >(
      `SELECT r.id, r.trigger, r.requested_by, u.full_name AS requested_by_name, r.status,
              r.options, r.results, r.gaps, r.started_at, r.finished_at
         FROM uel_sync_runs r LEFT JOIN users u ON u.id = r.requested_by
        ORDER BY r.started_at DESC
        LIMIT $1`,
      [Math.min(Math.max(1, limit), 100)],
    );
    return rows.map((r) => {
      // Lượt đang chạy trong tiến trình này: trả kết quả trực tiếp (DB chỉ ghi lúc xong).
      const live =
        this.lastRun?.id === r.id && r.status === 'running'
          ? this.lastRun
          : null;
      return {
        id: r.id,
        trigger: r.trigger,
        requestedBy: r.requested_by,
        requestedByName: r.requested_by_name,
        interrupted:
          (r.options as { interrupted?: boolean } | null)?.interrupted === true,
        status: live?.status ?? r.status,
        options: live?.options ?? r.options,
        results: live?.results ?? r.results,
        currentStep: live?.currentStep ?? null,
        gaps: r.gaps ?? null,
        startedAt: new Date(r.started_at).toISOString(),
        finishedAt: r.finished_at
          ? new Date(r.finished_at).toISOString()
          : null,
      };
    });
  }

  private async persistStart(run: UelSyncRun): Promise<void> {
    try {
      const rows = await this.db.query<IdRow[]>(
        `INSERT INTO uel_sync_runs (trigger, requested_by, status, options)
         VALUES ($1, $2, 'running', $3::jsonb) RETURNING id`,
        [run.trigger, run.requestedBy, JSON.stringify(run.options)],
      );
      run.id = rows[0]?.id ?? null;
    } catch (e) {
      // Không ghi được lịch sử thì vẫn đồng bộ.
      this.logger.warn(`Không ghi được uel_sync_runs: ${(e as Error).message}`);
    }
  }

  /** Ghi kết quả các bước đã có vào lượt đang chạy (lỗi ghi thì bỏ qua, không dừng đồng bộ). */
  private async persistProgress(run: UelSyncRun): Promise<void> {
    if (!run.id) return;
    try {
      await this.db.query(
        `UPDATE uel_sync_runs SET results = $2::jsonb, options = $3::jsonb
          WHERE id = $1 AND status = 'running'`,
        [run.id, JSON.stringify(run.results), JSON.stringify(run.options)],
      );
    } catch (e) {
      this.logger.warn(
        `Không lưu được tiến độ uel_sync_runs: ${(e as Error).message}`,
      );
    }
  }

  private async persistFinish(run: UelSyncRun): Promise<void> {
    if (!run.id) return;
    try {
      await this.db.query(
        `UPDATE uel_sync_runs SET status = $2, results = $3::jsonb, options = $4::jsonb,
                gaps = $5::jsonb, finished_at = now() WHERE id = $1`,
        [
          run.id,
          run.status,
          JSON.stringify(run.results),
          JSON.stringify(run.options),
          JSON.stringify(run.gaps ?? null),
        ],
      );
    } catch (e) {
      this.logger.warn(
        `Không cập nhật được uel_sync_runs: ${(e as Error).message}`,
      );
    }
  }

  private validate(
    o: UelSyncOptions,
    maxDays = MAX_SESSION_DAYS,
  ): UelSyncStep[] {
    if (!this.client.configured) {
      throw new BadRequestException(
        'Chưa cấu hình UEL_API_BASE_URL / UEL_API_KEY.',
      );
    }
    const steps = o.steps?.length ? o.steps : [...UEL_SYNC_STEPS];
    const bad = steps.filter((s) => !UEL_SYNC_STEPS.includes(s));
    if (bad.length) {
      throw new BadRequestException(`Bước không hợp lệ: ${bad.join(', ')}`);
    }
    const needSemester = steps.some(
      (s) => s === 'sections' || s === 'enrollments',
    );
    if (needSemester && (!clean(o.namHoc) || !clean(o.hocKy))) {
      throw new BadRequestException(
        'Bước sections/enrollments cần namHoc và hocKy.',
      );
    }
    if (steps.includes('sessions')) {
      const from = toIsoDate(o.fromDate ?? null);
      const to = toIsoDate(o.toDate ?? null);
      if (!from || !to || from > to) {
        throw new BadRequestException(
          'Bước sessions cần fromDate ≤ toDate (yyyy-MM-dd).',
        );
      }
      const days = eachDate(from, to).length;
      if (days > maxDays) {
        throw new BadRequestException(`Khoảng ngày tối đa ${maxDays} ngày.`);
      }
      const codes =
        codeListOf(o.lecturerCodes).length + codeListOf(o.studentCodes).length;
      if (codes > MAX_SESSION_CODES) {
        throw new BadRequestException(
          `Lịch theo người: tối đa ${MAX_SESSION_CODES} mã GV + SV.`,
        );
      }
      if (codes * days > MAX_TARGETED_CALLS) {
        throw new BadRequestException(
          `Lịch theo người: ${codes} mã × ${days} ngày = ${codes * days} lần gọi API, tối đa ${MAX_TARGETED_CALLS}. Rút ngắn khoảng ngày.`,
        );
      }
    }
    // Giữ đúng thứ tự phụ thuộc.
    return UEL_SYNC_STEPS.filter((s) => steps.includes(s));
  }

  private async execute(
    run: UelSyncRun,
    steps: UelSyncStep[],
  ): Promise<UelSyncRun> {
    const o = run.options;
    for (const step of steps) {
      run.currentStep = step;
      if (
        (step === 'sections' || step === 'enrollments') &&
        o.termMode !== undefined
      ) {
        // Lượt "toàn bộ": lớp HP + đăng ký chạy cho từng học kỳ.
        if (o.termMode === 'auto' && step === 'sections') {
          o.terms = await this.detectTerms(o.fromDate!, o.toDate!);
        }
        const terms = o.terms ?? [];
        if (!terms.length) {
          run.results.push({
            ...this.emptyResult(step),
            error:
              'Không nhận được học kỳ nào từ thời khóa biểu các ngày tới — chọn "Học kỳ chỉ định" trong cài đặt.',
          });
          continue;
        }
        for (const t of terms) {
          await this.runStep(run, step, `${t.namHoc} ${t.hocKy}`, (ctx) =>
            step === 'sections'
              ? this.syncSections(ctx, t.namHoc, t.hocKy)
              : this.syncEnrollments(ctx, t.namHoc, t.hocKy),
          );
        }
        continue;
      }
      await this.runStep(run, step, undefined, async (ctx) => {
        switch (step) {
          case 'departments':
            await this.syncDepartments(ctx);
            break;
          case 'staff':
            await this.syncStaff(ctx);
            break;
          case 'students':
            await this.syncStudents(ctx);
            break;
          case 'sections':
            await this.syncSections(ctx, o.namHoc!, o.hocKy!);
            break;
          case 'enrollments':
            await this.syncEnrollments(ctx, o.namHoc!, o.hocKy!);
            break;
          case 'sessions':
            await this.syncSessions(
              ctx,
              toIsoDate(o.fromDate!)!,
              toIsoDate(o.toDate!)!,
              {
                lecturerCodes: codeListOf(o.lecturerCodes),
                studentCodes: codeListOf(o.studentCodes),
              },
              o.termMode === 'fixed' && o.namHoc && o.hocKy
                ? semesterCodeOf(o.namHoc, o.hocKy)
                : undefined,
            );
            break;
        }
      });
    }
    return run;
  }

  private emptyResult(step: UelSyncStep, term?: string): UelSyncStepResult {
    return {
      step,
      fetched: 0,
      upserted: 0,
      skipped: 0,
      deactivated: 0,
      warnings: [],
      ...(term ? { term } : {}),
    };
  }

  /** Chạy 1 bước, ghi kết quả; lỗi của bước không dừng các bước sau. */
  private async runStep(
    run: UelSyncRun,
    step: UelSyncStep,
    term: string | undefined,
    fn: (ctx: StepCtx) => Promise<void>,
  ): Promise<void> {
    const r = this.emptyResult(step, term);
    run.results.push(r);
    const timer = setInterval(
      () => void this.persistProgress(run),
      PROGRESS_SAVE_MS,
    );
    timer.unref?.();
    try {
      await fn({ runStart: await this.dbNow(), r });
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e);
      this.logger.error(`UEL sync bước ${step} lỗi: ${r.error}`);
    } finally {
      clearInterval(timer);
    }
    await this.persistProgress(run);
    this.logger.log(
      `UEL sync ${step}${term ? ` (${term})` : ''}: fetched=${r.fetched} upserted=${r.upserted} skipped=${r.skipped} deactivated=${r.deactivated}`,
    );
  }

  /**
   * Tự nhận học kỳ: đọc TKB cả trường từng ngày trong khoảng (hôm nay → hết năm học), lấy các cặp
   * (nam_hoc, hoc_ky) khác nhau — nhiều học kỳ (HK1, HK2, hè…) thì chạy tất cả. Không giữ TKB
   * (bước sessions tải lại bản mới). API không trả gì ⇒ dùng học kỳ uel_api trong DB còn hiệu lực trong khoảng.
   */
  private async detectTerms(
    fromDate: string,
    toDate: string,
  ): Promise<UelSyncTerm[]> {
    const found = new Map<string, UelSyncTerm>();
    for (const date of eachDate(fromDate, toDate)) {
      try {
        const rows = await this.client.all<UelTkbLopHp1Ngay>(
          UEL_API.TKB_LOPHP_1NGAY,
          { ngay_hoc: toUelDate(date) },
        );
        for (const row of rows) {
          const namHoc = clean(row.nam_hoc);
          const hocKy = clean(row.hoc_ky);
          if (!namHoc || !hocKy) continue;
          const key = semesterCodeOf(namHoc, hocKy);
          if (!found.has(key)) found.set(key, { namHoc, hocKy });
        }
      } catch (e) {
        this.logger.warn(
          `Tự nhận học kỳ — TKB ngày ${date} lỗi: ${(e as Error).message}`,
        );
      }
    }
    if (found.size) return [...found.values()];

    const rows = await this.db.query<{ semester_code: string }[]>(
      `SELECT semester_code FROM semesters
        WHERE source = 'uel_api' AND deleted_at IS NULL
          AND start_date <= $2 AND end_date >= $1
        ORDER BY start_date`,
      [fromDate, toDate],
    );
    return rows
      .map((x) => {
        const i = x.semester_code.lastIndexOf('_');
        return i > 0
          ? {
              namHoc: x.semester_code.slice(0, i),
              hocKy: x.semester_code.slice(i + 1),
            }
          : null;
      })
      .filter((t): t is UelSyncTerm => t !== null);
  }

  // ───────────────────────── 1. Đơn vị ─────────────────────────

  private async syncDepartments({ runStart, r }: StepCtx): Promise<void> {
    const rows = await this.client.all<UelPhongBan>(UEL_API.DS_PHONG_BAN);
    r.fetched = rows.length;

    for (const row of rows) {
      const code = clean(row.ma_phong_ban);
      if (!code) {
        r.skipped++;
        continue;
      }
      await this.tryRow(r, `đơn vị ${code}`, async () => {
        await this.db.query(
          `INSERT INTO departments (department_code, department_name, is_active, source, last_synced_at)
           VALUES ($1, $2, true, 'uel_api', now())
           ON CONFLICT (department_code) WHERE deleted_at IS NULL DO UPDATE
             SET department_name = EXCLUDED.department_name,
                 is_active = true, source = 'uel_api', last_synced_at = now(), updated_at = now()`,
          [code, clean(row.ten_phong_ban) ?? code],
        );
        r.upserted++;
      });
    }

    // Lượt 2: đơn vị cha (cần đủ đơn vị trước).
    for (const row of rows) {
      const code = clean(row.ma_phong_ban);
      const parent = clean(row.ma_phong_ban_cha);
      if (!code) continue;
      await this.db.query(
        `UPDATE departments d
            SET parent_department_id = p.id
           FROM (SELECT id FROM departments WHERE department_code = $2 AND deleted_at IS NULL) p
          WHERE d.department_code = $1 AND d.deleted_at IS NULL AND d.id <> p.id
            AND d.parent_department_id IS DISTINCT FROM p.id`,
        [code, parent],
      );
    }
    if (rows.length && r.skipped === 0) {
      r.deactivated = await this.affected(
        `UPDATE departments SET is_active = false, updated_at = now()
          WHERE source = 'uel_api' AND deleted_at IS NULL AND is_active = true
            AND (last_synced_at IS NULL OR last_synced_at < $1)`,
        [runStart],
      );
    }
  }

  /**
   * ds_phong_ban.ma_quan_ly là mã phân cấp của đơn vị (vd "02_21" Khoa Toán KT, "02_21_02" bộ môn con),
   * không phải người quản lý ⇒ API không có trưởng đơn vị; manager_user_id do BUSINESS_ADMIN gán tay.
   *
   * MANAGER theo dữ liệu: trưởng đơn vị (departments.manager_user_id) và Ban Giám hiệu
   * (users.leadership_title) có MANAGER; cán bộ uel_api không còn là quản lý thì gỡ MANAGER
   * do đồng bộ gán (assigned_by IS NULL) — role gán tay giữ nguyên.
   */
  private async syncManagerRoles(): Promise<void> {
    const leaders = await this.db.query<IdRow[]>(
      `SELECT u.id FROM users u
        WHERE u.deleted_at IS NULL
          AND (u.leadership_title IS NOT NULL
               OR EXISTS (SELECT 1 FROM departments d
                           WHERE d.manager_user_id = u.id AND d.deleted_at IS NULL))`,
    );
    for (const { id } of leaders) await this.ensureRole(id, 'MANAGER');
    await this.revokeSyncRole(
      'MANAGER',
      `u.leadership_title IS NULL
       AND NOT EXISTS (SELECT 1 FROM departments d
                        WHERE d.manager_user_id = u.id AND d.deleted_at IS NULL)`,
    );
  }

  // ───────────────────────── 2. Cán bộ ─────────────────────────

  private async syncStaff({ runStart, r }: StepCtx): Promise<void> {
    const rows = await this.client.all<UelNhanSu>(UEL_API.DS_NHANSU);
    r.fetched = rows.length;

    for (const row of rows) {
      const code = clean(row.ma_nhan_su);
      if (!code) {
        r.skipped++;
        continue;
      }
      await this.tryRow(r, `cán bộ ${code}`, async () => {
        const { id: userId, aliasOf } = await this.upsertUser({
          code,
          fullName: fullNameOf(row.ho, row.ten, code),
          email: row.email,
          departmentCode: clean(row.ma_phong_ban),
          resigned: row.khong_con_cong_tac === true,
        });
        if (aliasOf) await this.saveAlias('staff', code, userId, aliasOf);
        const role = staffRoleOf(row.loai);
        await this.ensureRole(userId, role);
        if (role === 'EMPLOYEE') {
          // Bản cũ gán TEACHER cho mọi cán bộ CH thuộc Khoa ⇒ gỡ nếu không dạy lớp HP nào.
          await this.revokeSyncRole(
            'TEACHER',
            `u.id = $2 AND NOT EXISTS (SELECT 1 FROM class_sections cs
                                        WHERE cs.lecturer_user_id = u.id AND cs.deleted_at IS NULL)`,
            [userId],
          );
        }
        r.upserted++;
      });
    }

    // ma_quan_ly KHÔNG phải người quản lý (dữ liệu thật: luôn = ma_nhan_su) ⇒ không suy ra
    // quản lý trực tiếp. Trưởng đơn vị gán tay ở màn Phòng ban; ở đây chỉ đồng bộ role MANAGER.
    await this.syncManagerRoles();

    // Cán bộ uel_api không còn trong danh sách (và không phải SV) → nghỉ.
    if (rows.length && r.skipped === 0) {
      r.deactivated = await this.affected(
        `UPDATE users u SET employment_status = 'resigned',
                account_status = CASE WHEN u.account_status = 'active' THEN 'inactive' ELSE u.account_status END,
                updated_at = now()
          WHERE u.source = 'uel_api' AND u.deleted_at IS NULL
            AND u.employment_status <> 'resigned'
            AND (u.last_synced_at IS NULL OR u.last_synced_at < $1)
            AND NOT EXISTS (SELECT 1 FROM students s WHERE s.user_id = u.id AND s.deleted_at IS NULL)`,
        [runStart],
      );
    }
  }

  // ───────────────────────── 3. Sinh viên ─────────────────────────

  private async syncStudents({ r }: StepCtx): Promise<void> {
    const classes = await this.client.all<UelLopSv>(UEL_API.DS_LOPSV);
    const deptByName = await this.departmentIdsByName();
    let outOfScope = 0;

    for (const lop of classes) {
      const maLop = clean(lop.ma_lop);
      if (!maLop) continue;
      // Khóa cũ (đã tốt nghiệp) ⇒ không lấy SV, khỏi gọi API.
      if (!isCohortInScope(maLop, UEL_MIN_STUDENT_COHORT)) {
        outOfScope++;
        continue;
      }
      let students: UelSvLopSv[];
      try {
        students = await this.client.all<UelSvLopSv>(UEL_API.DS_SV_LOPSV, {
          ma_lop: maLop,
        });
      } catch (e) {
        this.warn(r, `lớp ${maLop}: ${(e as Error).message}`);
        continue;
      }
      r.fetched += students.length;
      const deptId =
        deptByName.get((clean(lop.thuoc_khoa) ?? '').toLowerCase()) ?? null;

      for (const sv of students) {
        const code = clean(sv.ma_sinh_vien);
        if (!code) {
          r.skipped++;
          continue;
        }
        await this.tryRow(r, `SV ${code}`, async () => {
          await this.saveStudent({
            code,
            fullName: clean(sv.ho_ten) ?? code,
            email: sv.email,
            adminClass: clean(sv.ma_lop) ?? maLop,
            deptId,
            educationLevel: clean(lop.bac_dao_tao),
            trainingType: clean(lop.loai_hinh_dao_tao),
          });
          r.upserted++;
        });
      }
    }
    this.logger.log(
      `UEL sync students: bỏ qua ${outOfScope}/${classes.length} lớp trước khóa K${UEL_MIN_STUDENT_COHORT}`,
    );
    // Không vô hiệu SV vắng mặt: API không có trạng thái học, ds theo lớp có thể thiếu
    // (lớp lỗi khi gọi) ⇒ để quản trị xử lý thủ công.
  }

  /**
   * Lưu 1 SV (user + role STUDENT + students). Email đã thuộc người cùng họ tên (1 người 2 mã) ⇒
   * mã này thành mã phụ của tài khoản đó; tài khoản chưa có hồ sơ SV thì nhận mã này làm mã SV.
   * Trả về students.id (null nếu DB không trả).
   */
  private async saveStudent(sv: {
    code: string;
    fullName: string;
    email: string | null;
    adminClass: string | null;
    deptId: string | null;
    educationLevel?: string | null;
    trainingType?: string | null;
  }): Promise<string | null> {
    const { id: userId, aliasOf } = await this.upsertUser({
      code: sv.code,
      fullName: sv.fullName,
      email: sv.email,
      departmentId: sv.deptId,
      resigned: false,
    });
    await this.ensureRole(userId, 'STUDENT');
    if (aliasOf) {
      const own = await this.db.query<{ id: string; student_code: string }[]>(
        `SELECT id, student_code FROM students WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId],
      );
      if (
        own[0] &&
        own[0].student_code.toUpperCase() !== sv.code.toUpperCase()
      ) {
        await this.saveAlias('student', sv.code, userId, own[0].student_code);
        return own[0].id;
      }
    }
    const rows = await this.db.query<IdRow[]>(
      `INSERT INTO students (user_id, student_code, administrative_class, department_id,
                             education_level, training_type, source, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'uel_api', now())
       ON CONFLICT (student_code) WHERE deleted_at IS NULL DO UPDATE
         SET administrative_class = EXCLUDED.administrative_class,
             department_id = COALESCE(EXCLUDED.department_id, students.department_id),
             education_level = COALESCE(EXCLUDED.education_level, students.education_level),
             training_type = COALESCE(EXCLUDED.training_type, students.training_type),
             source = 'uel_api', last_synced_at = now(), updated_at = now()
       RETURNING id`,
      [
        userId,
        sv.code,
        sv.adminClass,
        sv.deptId,
        sv.educationLevel ?? null,
        sv.trainingType ?? null,
      ],
    );
    return rows[0]?.id ?? null;
  }

  /** Ghi mã phụ (1 người có 2 mã ở UEL, cùng email) trỏ về tài khoản chính. */
  private async saveAlias(
    kind: 'staff' | 'student',
    code: string,
    userId: string,
    primaryCode: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO uel_code_aliases (kind, alias_code, user_id, primary_code, last_synced_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (kind, alias_code) DO UPDATE
         SET user_id = EXCLUDED.user_id, primary_code = EXCLUDED.primary_code, last_synced_at = now()`,
      [kind, code, userId, primaryCode],
    );
    this.logger.log(`UEL sync: gộp mã ${code} vào tài khoản ${primaryCode}`);
  }

  /** SV có đăng ký nhưng chưa có trong hệ thống (khóa cũ, hệ VLVH…) ⇒ tra thong_tin_sv rồi tạo. */
  private async fetchMissingStudent(
    code: string,
    deptByName: Map<string, string>,
  ): Promise<string | null> {
    const items = await this.client.all<{
      ma_sinh_vien: string | null;
      ho_ten: string | null;
      lop: string | null;
      khoa: string | null;
      email: string | null;
    }>(UEL_API.THONG_TIN_SV, { ma_sinh_vien: code });
    const sv = items[0];
    const svCode = clean(sv?.ma_sinh_vien);
    if (!sv || !svCode) return null;
    return this.saveStudent({
      code: svCode,
      fullName: clean(sv.ho_ten) ?? svCode,
      email: sv.email,
      adminClass: clean(sv.lop),
      deptId: deptByName.get((clean(sv.khoa) ?? '').toLowerCase()) ?? null,
    });
  }

  // ───────────────────────── 4. Học kỳ / môn / lớp HP ─────────────────────────

  private async syncSections(
    { r }: StepCtx,
    namHoc: string,
    hocKy: string,
  ): Promise<void> {
    const rows = await this.client.all<UelLopHp>(UEL_API.TKB_DS_LOPHP, {
      nam_hoc: namHoc,
      hoc_ky: hocKy,
    });
    r.fetched = rows.length;
    const semesterId = await this.upsertSemester(namHoc, hocKy);
    const lecturers = await staffIdsByName(this.db);

    for (const row of rows) {
      const code = clean(row.ma_lop_hoc_phan);
      const subjectCode = clean(row.ma_hoc_phan);
      if (!code || !subjectCode) {
        r.skipped++;
        continue;
      }
      await this.tryRow(r, `lớp HP ${code}`, async () => {
        const subjectId = await this.upsertSubject(
          subjectCode,
          clean(row.ten_hoc_phan),
          row.so_tin_chi,
        );
        await this.db.query(
          `INSERT INTO class_sections (class_code, semester_id, subject_id, status, uel_lecturer_name,
                                      source, last_synced_at)
           VALUES ($1, $2, $3, 'open', $4, 'uel_api', now())
           ON CONFLICT (semester_id, subject_id, class_code) WHERE deleted_at IS NULL DO UPDATE
             SET uel_lecturer_name = EXCLUDED.uel_lecturer_name,
                 source = 'uel_api', last_synced_at = now(), updated_at = now()`,
          [code, semesterId, subjectId, clean(row.giang_vien)],
        );
        // giang_vien là họ tên kèm học vị ("TS. Lê Thanh Hòa") ⇒ gán GV đầu tiên khi tên khớp
        // đúng 1 cán bộ (trùng tên thì bỏ, tránh nhầm). Bước sessions gán lại theo ma_giang_vien.
        const [firstName] = lecturerNamesOf(row.giang_vien);
        const ids = firstName ? lecturers.get(firstName) : undefined;
        if (ids?.length === 1) {
          await this.ensureRole(ids[0], 'TEACHER');
          await this.db.query(
            `UPDATE class_sections cs SET lecturer_user_id = $3
              WHERE cs.class_code = $1 AND cs.semester_id = $2 AND cs.deleted_at IS NULL
                AND cs.lecturer_user_id IS NULL`,
            [code, semesterId, ids[0]],
          );
        }
        r.upserted++;
      });
    }
  }

  // ───────────────────────── 5. Đăng ký học phần ─────────────────────────

  private async syncEnrollments(
    { runStart, r }: StepCtx,
    namHoc: string,
    hocKy: string,
  ): Promise<void> {
    const sections = await this.db.query<{ id: string; class_code: string }[]>(
      `SELECT cs.id, cs.class_code
         FROM class_sections cs JOIN semesters s ON s.id = cs.semester_id
        WHERE s.semester_code = $1 AND cs.deleted_at IS NULL AND cs.source = 'uel_api'`,
      [semesterCodeOf(namHoc, hocKy)],
    );
    if (!sections.length) {
      this.warn(r, 'Chưa có lớp HP của học kỳ này — chạy bước sections trước.');
      return;
    }
    // Mã so khớp không phân biệt hoa/thường (API đăng ký có lúc trả "k23…"); gồm cả mã phụ đã gộp.
    const studentIds = new Map([
      ...(await this.idMap(
        `SELECT upper(student_code) AS k, id FROM students WHERE deleted_at IS NULL`,
      )),
      ...(await this.idMap(
        `SELECT upper(a.alias_code) AS k, s.id FROM uel_code_aliases a
           JOIN students s ON s.user_id = a.user_id AND s.deleted_at IS NULL
          WHERE a.kind = 'student'`,
      )),
    ]);
    const deptByName = await this.departmentIdsByName();
    /** Mã đã tra UEL mà không có ⇒ khỏi tra lại ở lớp khác. */
    const notOnUel = new Set<string>();

    for (const sec of sections) {
      let rows: UelDangKy[];
      try {
        rows = await this.client.all<UelDangKy>(UEL_API.DKHP_CUA_1_LOPHP, {
          ma_lop_hoc_phan: sec.class_code,
        });
      } catch (e) {
        // Không gọi được ⇒ KHÔNG đánh dấu hủy cho lớp này.
        this.warn(r, `lớp HP ${sec.class_code}: ${(e as Error).message}`);
        continue;
      }
      r.fetched += rows.length;
      const skippedBefore = r.skipped;
      let missing = 0;
      for (const row of rows) {
        const key = (clean(row.ma_sinh_vien) ?? '').toUpperCase();
        let studentId = studentIds.get(key);
        if (!studentId && key && !notOnUel.has(key)) {
          try {
            studentId =
              (await this.fetchMissingStudent(key, deptByName)) ?? undefined;
          } catch (e) {
            this.warn(r, `SV ${key}: ${(e as Error).message}`);
          }
          if (studentId) studentIds.set(key, studentId);
          else notOnUel.add(key);
        }
        if (!studentId) {
          missing++;
          r.skipped++;
          continue;
        }
        await this.tryRow(
          r,
          `ĐK ${row.ma_sinh_vien}/${sec.class_code}`,
          async () => {
            await this.db.query(
              `INSERT INTO class_enrollments (class_section_id, student_id, enrolled_at, status, source, last_synced_at)
             VALUES ($1, $2, COALESCE($3::timestamptz, now()), 'active', 'uel_api', now())
             ON CONFLICT (class_section_id, student_id) DO UPDATE
               SET status = 'active', source = 'uel_api', last_synced_at = now(), updated_at = now()`,
              [sec.id, studentId, this.toTimestamp(row.ngay_dang_ky)],
            );
            r.upserted++;
          },
        );
      }
      if (missing) {
        this.warn(
          r,
          `lớp HP ${sec.class_code}: ${missing} SV không tìm thấy trên UEL nên chưa ghi đăng ký.`,
        );
      }
      // Do not infer withdrawals from a scope that could not be fully applied.
      if (r.skipped !== skippedBefore) continue;
      r.deactivated += await this.affected(
        `UPDATE class_enrollments SET status = 'dropped', updated_at = now()
          WHERE class_section_id = $1 AND source = 'uel_api' AND status = 'active'
            AND (last_synced_at IS NULL OR last_synced_at < $2)`,
        [sec.id, runStart],
      );
    }
  }

  // ───────────────────────── 6. Lịch học theo ngày ─────────────────────────

  private async syncSessions(
    { runStart, r }: StepCtx,
    fromDate: string,
    toDate: string,
    targets: { lecturerCodes: string[]; studentCodes: string[] },
    onlyTerm?: string,
  ): Promise<void> {
    const ctx: SessionCtx = {
      onlyTerm,
      r,
      periods: await this.loadPeriods(),
      durations: await this.loadDurations(),
      sectionIds: await this.idMap(
        `SELECT s.semester_code || '|' || sub.subject_code || '|' || cs.class_code AS k, cs.id
           FROM class_sections cs
           JOIN semesters s ON s.id = cs.semester_id
           JOIN subjects sub ON sub.id = cs.subject_id
          WHERE cs.deleted_at IS NULL`,
      ),
      roomCache: new Map(),
      seen: new Set(),
    };
    const targeted =
      targets.lecturerCodes.length > 0 || targets.studentCodes.length > 0;

    for (const date of eachDate(fromDate, toDate)) {
      const uelDate = toUelDate(date); // UEL đòi dd/MM/yyyy
      if (targeted) {
        // Chỉ lấy TKB của các GV/SV được chọn; KHÔNG hủy buổi khác (không thấy cả trường).
        const calls: [string, Record<string, string>][] = [
          ...targets.lecturerCodes.map(
            (c) =>
              [
                UEL_API.TKB_GV_1NGAY,
                { ma_giang_vien: c, ngay_hoc: uelDate },
              ] as [string, Record<string, string>],
          ),
          ...targets.studentCodes.map(
            (c) =>
              [
                UEL_API.TKB_SV_1NGAY,
                { ma_sinh_vien: c, ngay_hoc: uelDate },
              ] as [string, Record<string, string>],
          ),
        ];
        for (const [api, filter] of calls) {
          let rows: UelTkbNguoi1Ngay[];
          try {
            rows = await this.client.all<UelTkbNguoi1Ngay>(api, filter);
          } catch (e) {
            const who = filter.ma_giang_vien ?? filter.ma_sinh_vien;
            this.warn(r, `${who} ngày ${date}: ${(e as Error).message}`);
            continue;
          }
          r.fetched += rows.length;
          for (const row of rows) await this.upsertSessionRow(ctx, row, date);
        }
        continue;
      }

      let rows: UelTkbLopHp1Ngay[];
      try {
        // Luôn tải mới: bước này chạy sau lớp HP/đăng ký (có thể 1–2h sau lúc tự nhận học kỳ).
        rows = await this.client.all<UelTkbLopHp1Ngay>(
          UEL_API.TKB_LOPHP_1NGAY,
          {
            ngay_hoc: uelDate,
          },
        );
      } catch (e) {
        this.warn(r, `ngày ${date}: ${(e as Error).message}`);
        continue;
      }
      r.fetched += rows.length;
      const skippedBefore = r.skipped;
      for (const row of rows) await this.upsertSessionRow(ctx, row, date);

      // Keep previous sessions when any source row for this day was not applied.
      if (r.skipped !== skippedBefore) continue;
      if (!rows.length) {
        // API trả rỗng cả ngày mà DB đang có lịch ⇒ nghi API lỗi/chưa có dữ liệu: KHÔNG hủy.
        const existing = await this.db.query<{ n: string }[]>(
          `SELECT count(*)::text AS n FROM class_sessions
            WHERE source = 'uel_api' AND session_date = $1 AND status = 'scheduled'`,
          [date],
        );
        const n = Number(existing[0]?.n ?? 0);
        if (n > 0) {
          this.warn(
            r,
            `ngày ${date}: API không trả buổi nào nhưng hệ thống có ${n} buổi — giữ nguyên, không hủy.`,
          );
        }
        continue;
      }

      // Buổi uel_api của ngày này không còn trong TKB → hủy (chỉ buổi chưa diễn ra).
      // Học kỳ chỉ định: chỉ hủy buổi của kỳ đó (buổi kỳ khác lượt này không xét).
      r.deactivated += await this.affected(
        `UPDATE class_sessions SET status = 'cancelled', updated_at = now()
          WHERE source = 'uel_api' AND session_date = $1 AND status = 'scheduled'
            AND (last_synced_at IS NULL OR last_synced_at < $2)` +
          (onlyTerm
            ? `
            AND class_section_id IN (
              SELECT cs.id FROM class_sections cs
                JOIN semesters s ON s.id = cs.semester_id
               WHERE s.semester_code = $3)`
            : ''),
        onlyTerm ? [date, runStart, onlyTerm] : [date, runStart],
      );
    }

    // Ngày bắt đầu/kết thúc học kỳ (API không có) = min/max ngày học đã đồng bộ.
    await this.db.query(
      `UPDATE semesters s
          SET start_date = LEAST(COALESCE(s.start_date, agg.mn), agg.mn),
              end_date = GREATEST(COALESCE(s.end_date, agg.mx), agg.mx),
              updated_at = now()
         FROM (SELECT cs.semester_id, MIN(se.session_date) mn, MAX(se.session_date) mx
                 FROM class_sessions se JOIN class_sections cs ON cs.id = se.class_section_id
                WHERE se.source = 'uel_api' AND se.status <> 'cancelled'
                GROUP BY cs.semester_id) agg
        WHERE s.id = agg.semester_id AND s.source = 'uel_api'`,
    );
  }

  // ───────────────────────── helpers ─────────────────────────

  /**
   * Upsert user theo employee_code (= mã NS / mã SV). Mã mới mà email thật đã thuộc tài khoản khác:
   * cùng họ tên ⇒ cùng 1 người có 2 mã ⇒ trả tài khoản đó kèm aliasOf (mã chính) để lưu mã phụ;
   * khác họ tên ⇒ báo lỗi (không gộp nhầm 2 người).
   */
  private async upsertUser(u: {
    code: string;
    fullName: string;
    email: string | null;
    departmentCode?: string | null;
    departmentId?: string | null;
    resigned: boolean;
  }): Promise<{ id: string; aliasOf?: string }> {
    const email = emailOf(u.email, u.code);
    const deptId =
      u.departmentId ??
      (u.departmentCode
        ? ((
            await this.db.query<IdRow[]>(
              `SELECT id FROM departments WHERE department_code = $1 AND deleted_at IS NULL LIMIT 1`,
              [u.departmentCode],
            )
          )[0]?.id ?? null)
        : null);

    const existing = await this.db.query<IdRow[]>(
      `SELECT id FROM users WHERE employee_code = $1 AND deleted_at IS NULL LIMIT 1`,
      [u.code],
    );

    if (existing[0]) {
      // Email sinh tự động không ghi đè email thật đã có.
      await this.db.query(
        `UPDATE users
            SET full_name = $2,
                email = CASE WHEN $3 LIKE '%@no-email.uel.local' THEN email ELSE $3 END,
                department_id = COALESCE($4, department_id),
                employment_status = CASE WHEN $5 THEN 'resigned'
                                         WHEN employment_status = 'resigned' THEN 'active'
                                         ELSE employment_status END,
                -- Đăng nhập chỉ xét account_status ⇒ nghỉ việc phải khóa tài khoản; đi làm lại thì mở.
                account_status = CASE WHEN $5 AND account_status = 'active' THEN 'inactive'
                                      WHEN NOT $5 AND employment_status = 'resigned'
                                           AND account_status = 'inactive' THEN 'active'
                                      ELSE account_status END,
                source = 'uel_api', last_synced_at = now(), updated_at = now()
          WHERE id = $1`,
        [existing[0].id, u.fullName, email, deptId, u.resigned],
      );
      return { id: existing[0].id };
    }

    if (!email.endsWith('@no-email.uel.local')) {
      const owner = (
        await this.db.query<
          {
            id: string;
            full_name: string | null;
            employee_code: string | null;
          }[]
        >(
          `SELECT id, full_name, employee_code FROM users
            WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1`,
          [email],
        )
      )[0];
      if (owner) {
        const ownerCode = owner.employee_code ?? owner.id;
        if (personNameKey(owner.full_name) !== personNameKey(u.fullName)) {
          throw new Error(
            `Email ${email} đã thuộc tài khoản ${ownerCode} (${owner.full_name ?? '?'}), khác họ tên nên không gộp — kiểm tra lại email bên UEL.`,
          );
        }
        // Còn ở UEL dưới mã phụ ⇒ không bị coi là vắng mặt khi xét nghỉ việc.
        await this.db.query(
          `UPDATE users SET last_synced_at = now() WHERE id = $1`,
          [owner.id],
        );
        return { id: owner.id, aliasOf: ownerCode };
      }
    }

    const inserted = await this.db.query<IdRow[]>(
      `INSERT INTO users (employee_code, username, email, password_hash, full_name, department_id,
                          employment_status, account_status, source, last_synced_at)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, 'uel_api', now())
       RETURNING id`,
      [
        u.code,
        usernameOf(u.code),
        email,
        u.fullName,
        deptId,
        u.resigned ? 'resigned' : 'active',
        u.resigned ? 'inactive' : 'active',
      ],
    );
    return { id: inserted[0].id };
  }

  /** Người được ghi là GV của lớp HP / buổi học ⇒ thêm role TEACHER (giữ role cũ). */
  private async grantTeacherByCode(code: string): Promise<void> {
    const rows = await this.db.query<IdRow[]>(
      `SELECT ${userIdByCodeSql('$1')} AS id`,
      [code],
    );
    if (rows[0]?.id) await this.ensureRole(rows[0].id, 'TEACHER');
  }

  /**
   * Thêm role (đồng bộ ⇒ assigned_by NULL). Role bị gỡ tay giữ nguyên trạng thái gỡ;
   * chỉ bật lại role do chính đồng bộ gỡ trước đó (metadata_json.revokedBy = 'uel_sync').
   */
  private async ensureRole(userId: string, roleCode: string): Promise<void> {
    await this.db.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, r.id FROM roles r
        WHERE r.role_code = $2
          AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = $1 AND ur.role_id = r.id)`,
      [userId, roleCode],
    );
    await this.db.query(
      `UPDATE user_roles ur
          SET is_active = true, expired_at = NULL, assigned_at = now(),
              metadata_json = ur.metadata_json - 'revokedBy'
         FROM roles r
        WHERE ur.role_id = r.id AND r.role_code = $2 AND ur.user_id = $1
          AND NOT ur.is_active AND ur.metadata_json->>'revokedBy' = 'uel_sync'`,
      [userId, roleCode],
    );
  }

  /**
   * Gỡ role do đồng bộ gán (assigned_by NULL) khỏi cán bộ uel_api thỏa `condition`
   * (alias users = u, tham số bắt đầu từ $2). Role gán tay (assigned_by có giá trị) không bị đụng.
   */
  private async revokeSyncRole(
    roleCode: string,
    condition: string,
    params: unknown[] = [],
  ): Promise<void> {
    await this.db.query(
      `UPDATE user_roles ur
          SET expired_at = now(), is_active = false,
              metadata_json = COALESCE(ur.metadata_json, '{}'::jsonb) || '{"revokedBy":"uel_sync"}'::jsonb
         FROM roles r, users u
        WHERE ur.role_id = r.id AND r.role_code = $1 AND ur.user_id = u.id
          AND ur.is_active AND ur.assigned_by IS NULL
          AND u.source = 'uel_api' AND u.deleted_at IS NULL
          AND ${condition}`,
      [roleCode, ...params],
    );
  }

  private async upsertSemester(namHoc: string, hocKy: string): Promise<string> {
    const rows = await this.db.query<IdRow[]>(
      `INSERT INTO semesters (semester_code, semester_name, academic_year, source, last_synced_at)
       VALUES ($1, $2, $3, 'uel_api', now())
       ON CONFLICT (semester_code) WHERE deleted_at IS NULL DO UPDATE
         SET source = 'uel_api', last_synced_at = now(), updated_at = now()
       RETURNING id`,
      [
        semesterCodeOf(namHoc, hocKy),
        semesterNameOf(namHoc, hocKy),
        namHoc.trim().slice(0, 20),
      ],
    );
    return rows[0].id;
  }

  private async upsertSubject(
    code: string,
    name: string | null,
    credits: number | null,
  ): Promise<string> {
    const rows = await this.db.query<IdRow[]>(
      `INSERT INTO subjects (subject_code, subject_name, credits, source, last_synced_at)
       VALUES ($1, $2, $3, 'uel_api', now())
       ON CONFLICT (subject_code) WHERE deleted_at IS NULL DO UPDATE
         SET subject_name = EXCLUDED.subject_name,
             credits = COALESCE(EXCLUDED.credits, subjects.credits),
             source = 'uel_api', last_synced_at = now(), updated_at = now()
       RETURNING id`,
      [code, name ?? code, credits !== null && credits >= 0 ? credits : null],
    );
    return rows[0].id;
  }

  /**
   * Ghi 1 buổi học từ dòng TKB (dùng chung cho cả trường / theo GV-SV).
   * Giờ: ưu tiên gio_bat_dau/gio_ket_thuc API trả kèm; thiếu thì quy đổi tiết qua study_periods.
   */
  private async upsertSessionRow(
    {
      r,
      periods,
      durations,
      sectionIds,
      roomCache,
      seen,
      onlyTerm,
    }: SessionCtx,
    row: UelTkbLopHp1Ngay,
    date: string,
  ): Promise<void> {
    const code = clean(row.ma_lop_hoc_phan);
    const sessionDate = toIsoDate(row.ngay_hoc) ?? date;
    // Lớp ghép (cùng phòng, cùng giờ) dùng chung ma_lich_hoc ⇒ khóa buổi = mã lịch + mã lớp HP.
    const externalId =
      row.ma_lich_hoc !== null && row.ma_lich_hoc !== undefined
        ? `${row.ma_lich_hoc}|${code}`
        : `${code}|${sessionDate}|${row.tiet_bat_dau}`;
    // GV và SV cùng học 1 buổi ⇒ API trả trùng; chỉ ghi 1 lần mỗi lượt.
    if (seen.has(externalId)) return;
    seen.add(externalId);

    const semCode = semesterCodeOf(row.nam_hoc ?? '', row.hoc_ky ?? '');
    if (onlyTerm && semCode !== onlyTerm) return; // kỳ khác: không đồng bộ ở chế độ chỉ định
    const key = `${semCode}|${clean(row.ma_hoc_phan)}|${code}`;
    const sectionId = sectionIds.get(key);
    const times =
      sessionTimesFromClock(sessionDate, row.gio_bat_dau, row.gio_ket_thuc) ??
      sessionTimesOf(sessionDate, row.tiet_bat_dau, row.so_tiet, periods) ??
      // Giờ kết thúc UEL thiếu/sai (vd 17:45→17:35) ⇒ bắt đầu + thời lượng theo số tiết.
      sessionTimesFromStart(
        sessionDate,
        row.gio_bat_dau,
        row.tiet_bat_dau,
        row.so_tiet,
        durations,
      );
    if (!code || !sectionId || !times) {
      r.skipped++;
      if (code && !sectionId) {
        this.warn(r, `${date} ${code}: chưa có lớp HP (chạy bước sections).`);
      } else if (code && !times) {
        this.warn(
          r,
          `${date} ${code}: API không có giờ và bảng tiết chưa có tiết ${row.tiet_bat_dau}+${row.so_tiet}.`,
        );
      }
      return;
    }
    await this.tryRow(r, `buổi ${code} ${date}`, async () => {
      const roomId = await this.resolveRoom(row, roomCache);
      await this.db.query(
        `INSERT INTO class_sessions
           (class_section_id, session_date, shift_id, room_id, start_time, end_time, status,
            external_id, period_start, period_count, source, last_synced_at)
         VALUES ($1, $2, NULL, $3, $4, $5, 'scheduled', $6, $7, $8, 'uel_api', now())
         ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
           SET class_section_id = EXCLUDED.class_section_id,
               session_date = EXCLUDED.session_date,
               room_id = EXCLUDED.room_id,
               start_time = EXCLUDED.start_time,
               end_time = EXCLUDED.end_time,
               period_start = EXCLUDED.period_start,
               period_count = EXCLUDED.period_count,
               status = CASE WHEN class_sessions.status = 'cancelled' THEN 'scheduled'
                             ELSE class_sessions.status END,
               source = 'uel_api', last_synced_at = now(), updated_at = now()`,
        [
          sectionId,
          sessionDate,
          roomId,
          times.start,
          times.end,
          externalId,
          row.tiet_bat_dau,
          row.so_tiet,
        ],
      );
      // Giảng viên + phòng mặc định của lớp HP (chỉ điền khi còn trống / theo mã GV).
      const gvCode = clean(row.ma_giang_vien);
      await this.db.query(
        `UPDATE class_sections cs
            SET lecturer_user_id = COALESCE(
                  ${userIdByCodeSql('$2')},
                  cs.lecturer_user_id),
                default_room_id = COALESCE(cs.default_room_id, $3),
                updated_at = now()
          WHERE cs.id = $1`,
        [sectionId, gvCode, roomId],
      );
      if (gvCode) await this.grantTeacherByCode(gvCode);
      r.upserted++;
    });
  }

  /** Phòng theo (room_code, campus_code); chưa có thì tạo (capacity mặc định 0). */
  private async resolveRoom(
    row: UelTkbLopHp1Ngay,
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    const code = clean(row.ma_phong_hoc);
    if (!code) return null;
    const campus = clean(row.ma_co_so);
    const key = `${code}|${campus ?? ''}`;
    if (cache.has(key)) return cache.get(key)!;

    const found = await this.db.query<IdRow[]>(
      `SELECT id FROM rooms
        WHERE room_code = $1 AND campus_code IS NOT DISTINCT FROM $2 AND deleted_at IS NULL
        LIMIT 1`,
      [code, campus],
    );
    let id = found[0]?.id ?? null;
    if (!id) {
      const name = roomNameOf(row.ten_phong_hoc, code, row.ten_co_so);
      try {
        const ins = await this.db.query<IdRow[]>(
          `INSERT INTO rooms (room_code, room_name, site_name, area_name, building_code, campus_code,
                              capacity, room_type, source, last_synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 'training_room', 'uel_api', now())
           RETURNING id`,
          [
            code,
            name,
            clean(row.ten_co_so),
            clean(row.ten_day_nha),
            clean(row.ma_day_nha),
            campus,
          ],
        );
        id = ins[0].id;
      } catch {
        // Trùng room_name với phòng nhập tay → dùng lại phòng đó.
        const byName = await this.db.query<IdRow[]>(
          `SELECT id FROM rooms WHERE lower(btrim(room_name)) = lower(btrim($1)) AND deleted_at IS NULL LIMIT 1`,
          [name],
        );
        id = byName[0]?.id ?? null;
      }
    }
    cache.set(key, id);
    return id;
  }

  /** Thời lượng phổ biến nhất của buổi UEL theo "tiết bắt đầu|số tiết" (vd 13|3 → 150 phút). */
  private async loadDurations(): Promise<Map<string, number>> {
    const rows = await this.db.query<{ k: string; minutes: number }[]>(
      `SELECT period_start || '|' || period_count AS k,
              mode() WITHIN GROUP (ORDER BY extract(epoch FROM end_time - start_time) / 60)::int AS minutes
         FROM class_sessions
        WHERE source = 'uel_api' AND period_start IS NOT NULL AND period_count IS NOT NULL
          AND end_time > start_time
        GROUP BY period_start, period_count`,
    );
    return new Map(rows.map((x) => [x.k, Number(x.minutes)]));
  }

  private async loadPeriods(): Promise<Map<number, PeriodTime>> {
    const rows = await this.db.query<
      { period_no: number; start_time: string; end_time: string }[]
    >(
      `SELECT period_no, start_time::text AS start_time, end_time::text AS end_time
         FROM study_periods WHERE is_active = true`,
    );
    return new Map(
      rows.map((p) => [
        Number(p.period_no),
        { startTime: p.start_time, endTime: p.end_time },
      ]),
    );
  }

  /** Dữ liệu cần bổ sung hiện tại (đọc DB, không gọi UEL). */
  async gaps(): Promise<UelGapSummary> {
    return summarizeGaps(await loadGaps(this.db));
  }

  /** File Excel danh sách SV/cán bộ chưa có email, lớp HP chưa có GV. */
  async gapsXlsx(): Promise<Buffer> {
    return gapsWorkbook(await loadGaps(this.db), new Date());
  }

  /** Tóm tắt dữ liệu cần bổ sung sau lượt chạy; lỗi đọc thì bỏ qua (không làm hỏng lượt). */
  private async gapSummary(): Promise<UelGapSummary | null> {
    try {
      return summarizeGaps(await loadGaps(this.db));
    } catch (e) {
      this.logger.warn(
        `Không tính được dữ liệu cần bổ sung: ${(e as Error).message}`,
      );
      return null;
    }
  }

  private async departmentIdsByName(): Promise<Map<string, string>> {
    return this.idMap(
      `SELECT lower(btrim(department_name)) AS k, id FROM departments WHERE deleted_at IS NULL`,
    );
  }

  private async idMap(sql: string): Promise<Map<string, string>> {
    const rows = await this.db.query<{ k: string; id: string }[]>(sql);
    return new Map(rows.map((x) => [x.k, x.id]));
  }

  /**
   * Mốc "bắt đầu bước" lấy từ đồng hồ DB, không dùng new Date(): last_synced_at = now() của DB,
   * nếu đồng hồ app nhanh hơn DB vài ms thì bản ghi vừa đồng bộ bị coi là cũ và bị vô hiệu nhầm.
   */
  private async dbNow(): Promise<string> {
    const rows = await this.db.query<{ t: string }[]>(
      `SELECT clock_timestamp()::text AS t`,
    );
    return rows[0].t;
  }

  /** Số dòng bị ảnh hưởng của UPDATE (pg trả [rows, count]). */
  private async affected(sql: string, params: unknown[]): Promise<number> {
    const res = await this.db.query<unknown>(sql, params);
    return Array.isArray(res) && typeof res[1] === 'number' ? res[1] : 0;
  }

  private toTimestamp(v: string | null): string | null {
    const s = clean(v);
    return s && !Number.isNaN(Date.parse(s)) ? s : null;
  }

  private async tryRow(
    r: UelSyncStepResult,
    label: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (e) {
      r.skipped++;
      this.warn(r, `${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private warn(r: UelSyncStepResult, msg: string): void {
    if (r.warnings.length < MAX_WARNINGS) r.warnings.push(msg);
    else if (r.warnings.length === MAX_WARNINGS) r.warnings.push('…');
  }
}
