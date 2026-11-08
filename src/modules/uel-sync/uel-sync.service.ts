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
} from './uel-api.types.js';
import {
  clean,
  eachDate,
  emailOf,
  fullNameOf,
  roomNameOf,
  semesterCodeOf,
  sessionTimesOf,
  staffRoleOf,
  toIsoDate,
  usernameOf,
} from './uel-sync.mapper.js';
import type { PeriodTime } from './uel-sync.mapper.js';
import { UEL_API_CLIENT } from './uel-sync.constants.js';

export const UEL_SYNC_STEPS = [
  'departments',
  'staff',
  'students',
  'sections',
  'enrollments',
  'sessions',
] as const;
export type UelSyncStep = (typeof UEL_SYNC_STEPS)[number];

export interface UelSyncOptions {
  steps?: UelSyncStep[];
  /** Bắt buộc cho sections / enrollments. */
  namHoc?: string;
  hocKy?: string;
  /** Bắt buộc cho sessions (yyyy-MM-dd). */
  fromDate?: string;
  toDate?: string;
}

export interface UelSyncStepResult {
  step: UelSyncStep;
  fetched: number;
  upserted: number;
  skipped: number;
  deactivated: number;
  warnings: string[];
  error?: string;
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
}

/** Lượt đọc từ lịch sử, kèm tên người bấm. */
export interface UelSyncRunView extends UelSyncRun {
  requestedByName: string | null;
}

/** failed: mọi bước lỗi; partial: có bước lỗi; còn lại succeeded. */
export function runStatusOf(results: UelSyncStepResult[]): UelSyncRunStatus {
  const errors = results.filter((r) => r.error).length;
  if (!results.length || errors === 0) return 'succeeded';
  return errors === results.length ? 'failed' : 'partial';
}

/** Giữ tối đa N cảnh báo mỗi bước để kết quả không phình to. */
const MAX_WARNINGS = 50;
/** Lịch học: tối đa 1 lần gọi = 1 ngày; chặn khoảng quá dài. */
const MAX_SESSION_DAYS = 120;

interface IdRow {
  id: string;
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
  /** ds_phong_ban của lần chạy gần nhất — dùng để gán trưởng đơn vị sau khi có cán bộ. */
  private deptRows: UelPhongBan[] = [];

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
        `UPDATE uel_sync_runs SET status = 'failed', finished_at = now()
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
      options: { ...options, steps },
      results: [],
    };
    this.lastRun = run;
    return this.persistStart(run)
      .then(() => this.execute(run, steps))
      .finally(async () => {
        run.finishedAt = new Date().toISOString();
        run.status = runStatusOf(run.results);
        await this.persistFinish(run);
        this.running = false;
      });
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
        started_at: Date;
        finished_at: Date | null;
      }[]
    >(
      `SELECT r.id, r.trigger, r.requested_by, u.full_name AS requested_by_name, r.status,
              r.options, r.results, r.started_at, r.finished_at
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
        status: live?.status ?? r.status,
        options: r.options,
        results: live?.results ?? r.results,
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

  private async persistFinish(run: UelSyncRun): Promise<void> {
    if (!run.id) return;
    try {
      await this.db.query(
        `UPDATE uel_sync_runs SET status = $2, results = $3::jsonb, finished_at = now() WHERE id = $1`,
        [run.id, run.status, JSON.stringify(run.results)],
      );
    } catch (e) {
      this.logger.warn(
        `Không cập nhật được uel_sync_runs: ${(e as Error).message}`,
      );
    }
  }

  private validate(o: UelSyncOptions): UelSyncStep[] {
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
      if (eachDate(from, to).length > MAX_SESSION_DAYS) {
        throw new BadRequestException(
          `Khoảng ngày tối đa ${MAX_SESSION_DAYS} ngày.`,
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
      const r: UelSyncStepResult = {
        step,
        fetched: 0,
        upserted: 0,
        skipped: 0,
        deactivated: 0,
        warnings: [],
      };
      run.results.push(r);
      try {
        const ctx: StepCtx = { runStart: await this.dbNow(), r };
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
            );
            break;
        }
      } catch (e) {
        r.error = e instanceof Error ? e.message : String(e);
        this.logger.error(`UEL sync bước ${step} lỗi: ${r.error}`);
      }
      this.logger.log(
        `UEL sync ${step}: fetched=${r.fetched} upserted=${r.upserted} skipped=${r.skipped} deactivated=${r.deactivated}`,
      );
    }
    return run;
  }

  // ───────────────────────── 1. Đơn vị ─────────────────────────

  private async syncDepartments({ runStart, r }: StepCtx): Promise<void> {
    const rows = await this.client.all<UelPhongBan>(UEL_API.DS_PHONG_BAN);
    r.fetched = rows.length;
    this.deptRows = rows;

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
    await this.applyDepartmentManagers();

    if (rows.length) {
      r.deactivated = await this.affected(
        `UPDATE departments SET is_active = false, updated_at = now()
          WHERE source = 'uel_api' AND deleted_at IS NULL AND is_active = true
            AND (last_synced_at IS NULL OR last_synced_at < $1)`,
        [runStart],
      );
    }
  }

  /** Gán trưởng đơn vị (ma_quan_ly) — chỉ được khi cán bộ đã đồng bộ. */
  private async applyDepartmentManagers(): Promise<void> {
    for (const row of this.deptRows) {
      const code = clean(row.ma_phong_ban);
      const mgr = clean(row.ma_quan_ly);
      if (!code || !mgr) continue;
      await this.db.query(
        `UPDATE departments d SET manager_user_id = u.id
           FROM users u
          WHERE d.department_code = $1 AND d.deleted_at IS NULL
            AND u.employee_code = $2 AND u.deleted_at IS NULL
            AND d.manager_user_id IS DISTINCT FROM u.id`,
        [code, mgr],
      );
    }
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
        const userId = await this.upsertUser({
          code,
          fullName: fullNameOf(row.ho, row.ten, code),
          email: row.email,
          departmentCode: clean(row.ma_phong_ban),
          resigned: row.khong_con_cong_tac === true,
        });
        await this.ensureRole(userId, staffRoleOf(row.loai));
        r.upserted++;
      });
    }

    // Quản lý trực tiếp (cần đủ cán bộ trước).
    for (const row of rows) {
      const code = clean(row.ma_nhan_su);
      const mgr = clean(row.ma_quan_ly);
      if (!code || !mgr) continue;
      await this.db.query(
        `UPDATE users u SET direct_manager_id = m.id
           FROM users m
          WHERE u.employee_code = $1 AND u.deleted_at IS NULL
            AND m.employee_code = $2 AND m.deleted_at IS NULL
            AND u.id <> m.id AND u.direct_manager_id IS DISTINCT FROM m.id`,
        [code, mgr],
      );
    }
    await this.applyDepartmentManagers();

    // Cán bộ uel_api không còn trong danh sách (và không phải SV) → nghỉ.
    if (rows.length) {
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

    for (const lop of classes) {
      const maLop = clean(lop.ma_lop);
      if (!maLop) continue;
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
          const userId = await this.upsertUser({
            code,
            fullName: clean(sv.ho_ten) ?? code,
            email: sv.email,
            departmentId: deptId,
            resigned: false,
          });
          await this.ensureRole(userId, 'STUDENT');
          await this.db.query(
            `INSERT INTO students (user_id, student_code, administrative_class, department_id, source, last_synced_at)
             VALUES ($1, $2, $3, $4, 'uel_api', now())
             ON CONFLICT (student_code) WHERE deleted_at IS NULL DO UPDATE
               SET administrative_class = EXCLUDED.administrative_class,
                   department_id = COALESCE(EXCLUDED.department_id, students.department_id),
                   source = 'uel_api', last_synced_at = now(), updated_at = now()`,
            [userId, code, clean(sv.ma_lop) ?? maLop, deptId],
          );
          r.upserted++;
        });
      }
    }
    // Không vô hiệu SV vắng mặt: API không có trạng thái học, ds theo lớp có thể thiếu
    // (lớp lỗi khi gọi) ⇒ để quản trị xử lý thủ công.
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
          `INSERT INTO class_sections (class_code, semester_id, subject_id, status, source, last_synced_at)
           VALUES ($1, $2, $3, 'open', 'uel_api', now())
           ON CONFLICT (semester_id, subject_id, class_code) WHERE deleted_at IS NULL DO UPDATE
             SET source = 'uel_api', last_synced_at = now(), updated_at = now()`,
          [code, semesterId, subjectId],
        );
        // giang_vien: tài liệu chưa rõ là mã hay tên ⇒ chỉ gán khi khớp mã cán bộ.
        // Bước sessions gán chắc chắn hơn từ ma_giang_vien.
        const gv = clean(row.giang_vien);
        if (gv) {
          await this.db.query(
            `UPDATE class_sections cs SET lecturer_user_id = u.id
               FROM users u
              WHERE cs.class_code = $1 AND cs.semester_id = $2 AND cs.deleted_at IS NULL
                AND u.employee_code = $3 AND u.deleted_at IS NULL
                AND cs.lecturer_user_id IS NULL`,
            [code, semesterId, gv],
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
    const studentIds = await this.idMap(
      `SELECT student_code AS k, id FROM students WHERE deleted_at IS NULL`,
    );

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
      let missing = 0;
      for (const row of rows) {
        const studentId = studentIds.get(clean(row.ma_sinh_vien) ?? '');
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
          `lớp HP ${sec.class_code}: ${missing} SV chưa có trong hệ thống (chạy bước students).`,
        );
      }
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
  ): Promise<void> {
    const periods = await this.loadPeriods();
    if (!periods.size) {
      throw new Error(
        'Bảng study_periods trống — cần nhập giờ từng tiết trước khi đồng bộ lịch học.',
      );
    }
    const sectionIds = await this.idMap(
      `SELECT s.semester_code || '|' || sub.subject_code || '|' || cs.class_code AS k, cs.id
         FROM class_sections cs
         JOIN semesters s ON s.id = cs.semester_id
         JOIN subjects sub ON sub.id = cs.subject_id
        WHERE cs.deleted_at IS NULL`,
    );
    const roomCache = new Map<string, string | null>();

    for (const date of eachDate(fromDate, toDate)) {
      let rows: UelTkbLopHp1Ngay[];
      try {
        rows = await this.client.all<UelTkbLopHp1Ngay>(
          UEL_API.TKB_LOPHP_1NGAY,
          {
            ngay_hoc: date,
          },
        );
      } catch (e) {
        this.warn(r, `ngày ${date}: ${(e as Error).message}`);
        continue;
      }
      r.fetched += rows.length;

      for (const row of rows) {
        const code = clean(row.ma_lop_hoc_phan);
        const key = `${semesterCodeOf(row.nam_hoc ?? '', row.hoc_ky ?? '')}|${clean(row.ma_hoc_phan)}|${code}`;
        const sectionId = sectionIds.get(key);
        const sessionDate = toIsoDate(row.ngay_hoc) ?? date;
        const times = sessionTimesOf(
          sessionDate,
          row.tiet_bat_dau,
          row.so_tiet,
          periods,
        );
        if (!code || !sectionId || !times) {
          r.skipped++;
          if (code && !sectionId) {
            this.warn(
              r,
              `${date} ${code}: chưa có lớp HP (chạy bước sections).`,
            );
          } else if (code && !times) {
            this.warn(
              r,
              `${date} ${code}: không quy đổi được tiết ${row.tiet_bat_dau}+${row.so_tiet}.`,
            );
          }
          continue;
        }
        await this.tryRow(r, `buổi ${code} ${date}`, async () => {
          const roomId = await this.resolveRoom(row, roomCache);
          const externalId =
            row.ma_lich_hoc !== null && row.ma_lich_hoc !== undefined
              ? String(row.ma_lich_hoc)
              : `${code}|${sessionDate}|${row.tiet_bat_dau}`;
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
          await this.db.query(
            `UPDATE class_sections cs
                SET lecturer_user_id = COALESCE(
                      (SELECT id FROM users WHERE employee_code = $2 AND deleted_at IS NULL LIMIT 1),
                      cs.lecturer_user_id),
                    default_room_id = COALESCE(cs.default_room_id, $3),
                    updated_at = now()
              WHERE cs.id = $1`,
            [sectionId, clean(row.ma_giang_vien), roomId],
          );
          r.upserted++;
        });
      }

      // Buổi uel_api của ngày này không còn trong TKB → hủy (chỉ buổi chưa diễn ra).
      r.deactivated += await this.affected(
        `UPDATE class_sessions SET status = 'cancelled', updated_at = now()
          WHERE source = 'uel_api' AND session_date = $1 AND status = 'scheduled'
            AND (last_synced_at IS NULL OR last_synced_at < $2)`,
        [date, runStart],
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

  /** Upsert user theo employee_code (= mã NS / mã SV). Trả về users.id. */
  private async upsertUser(u: {
    code: string;
    fullName: string;
    email: string | null;
    departmentCode?: string | null;
    departmentId?: string | null;
    resigned: boolean;
  }): Promise<string> {
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
      return existing[0].id;
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
    return inserted[0].id;
  }

  private async ensureRole(userId: string, roleCode: string): Promise<void> {
    await this.db.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, r.id FROM roles r
        WHERE r.role_code = $2
          AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = $1 AND ur.role_id = r.id)`,
      [userId, roleCode],
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
        `Học kỳ ${hocKy.trim()} năm học ${namHoc.trim()}`,
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
