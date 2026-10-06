# ACD-001 Học vụ — DB Schema Đào tạo: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo 7 bảng Học vụ (Học kỳ, Môn học, Ca học, Sinh viên, Lớp học phần, Danh sách lớp, Buổi học) + entity + module schema-only + seed ca học + script demo, làm nền cho điểm danh phòng học (#23).

**Architecture:** 1 migration viết tay tạo 7 bảng (ADD-ONLY, ràng buộc ở DB: partial unique, CHECK, FK), 1 migration seed 6 ca học. Module `academic` chỉ đăng ký entity (giống `ZonesModule`). 1 util tính thời điểm buổi học theo giờ VN, dùng chung cho script demo và #23. Script demo idempotent nằm ngoài migration.

**Tech Stack:** NestJS 11, TypeORM 1.x (`synchronize: false`), PostgreSQL 16 (local `localhost:5433/capstone_db`), Jest 30 + ts-jest, `tsx` cho script.

**Spec:** [spec.md](./spec.md) · [data-model.md](./data-model.md)

## Global Constraints
- ADD-ONLY: KHÔNG ALTER/DROP bảng, cột, index hiện có; KHÔNG sửa entity cũ (`UserEntity`, `RoomEntity`, `DepartmentEntity`...).
- Không controller / service / DTO / permission trong `AcademicModule` (R14).
- Migration viết tay, mirror `src/database/migrations/20260721000001-CreateZonesTable.ts`: `uuid_generate_v4()`, `timestamptz`, partial unique `WHERE deleted_at IS NULL`.
- Đặt tên constraint: `PK_<t>_id`, `UQ_<t>_<cols>[_active]`, `IDX_<t>_<cols>`, `FK_<t>_<col>`, `CK_<t>_<rule>`.
- Import tương đối trong `src` dùng hậu tố `.js` (NodeNext), trừ `app.module.ts` (giữ style không `.js` hiện có).
- Giờ địa phương cố định UTC+07:00 (`Asia/Ho_Chi_Minh`, không DST).
- Chạy migration bằng `npx tsx scripts/run-migrations.ts` (CLI `npm run migration:run` hỏng với NodeNext — xem comment trong script).
- **KHÔNG `git commit`** ở bất kỳ bước nào — người dùng tự commit khi yêu cầu. Cuối mỗi task chỉ chạy `git status --short` để báo file thay đổi.

## Review Focus
1. **Múi giờ buổi học:** ngày `2026-09-07` + ca `07:30` phải lưu `2026-09-07T00:30:00Z`, không phải `07:30Z` (lệch 7 giờ ⇒ #23 khớp camera sai buổi) → test ở Task 4 (`session-time.util.spec.ts`).
2. **Tái dùng mã sau soft-delete & buổi học bị huỷ giải phóng phòng:** người dùng kỳ vọng xoá mềm/huỷ thì tạo lại được → test ở Task 1 (R3 reuse, R8 cancelled).
3. **Cột `date`/`time` đọc qua TypeORM phải là `string`**, không bị đổi thành `Date` lệch ngày → test ở Task 3.
4. **Chạy script demo 2 lần không nhân đôi dữ liệu** → test ở Task 4.
5. **Rollback sạch:** `down()` của 2 migration đảo ngược hoàn toàn, chạy lại `up()` được → kiểm ở Task 2 và Task 5.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| Create `src/database/migrations/20261006000001-CreateAcademicTables.ts` | DDL 7 bảng + index + constraint |
| Create `src/database/migrations/20261006000002-SeedStudyShifts.ts` | Seed 6 ca học cố định |
| Create `scripts/revert-migration.ts` | Revert 1 migration bằng `tsx` (CLI revert hỏng như CLI run) |
| Create `src/modules/academic/entities/*.entity.ts` (7 file) | Entity map 1-1 với DDL |
| Create `src/modules/academic/academic.module.ts` | Đăng ký entity, schema-only |
| Modify `src/app.module.ts` | Import `AcademicModule` |
| Modify `src/database/entities/index.ts` | Re-export entity Học vụ |
| Create `src/modules/academic/utils/session-time.util.ts` (+ `.spec.ts`) | Ngày + giờ ca (VN) → `timestamptz` |
| Create `scripts/academic-demo/seed-academic-demo.ts` | Hàm seed demo idempotent (nhận `QueryRunner`) |
| Create `scripts/seed-academic-demo.ts` | Runner CLI gọi hàm trên |
| Create `test/academic/academic-schema.e2e-spec.ts` | Test ràng buộc DB R3–R9, seed R10 |
| Create `test/academic/academic-entities.e2e-spec.ts` | Entity ↔ schema khớp (R13) |
| Create `test/academic/academic-demo-seed.e2e-spec.ts` | Demo idempotent + truy vấn §4.1 (R11, R12) |
| Modify `docs/SAVP_USE_CASE_TONG_HOP_2026-07-29.md`, `docs/CAM_AI_GAP_ANALYSIS_300_CAMERAS.md`, `docs/ARCHITECTURE_DECISIONS.md` | Cập nhật phạm vi / ADR-004 |

Test DB chạy trên DB local thật, mỗi test bọc transaction và **rollback** → không để lại dữ liệu. Test chỉ chạy khi `RUN_DB_TESTS=1` (mặc định skip để CI không có DB vẫn xanh).

Lệnh test chung: `RUN_DB_TESTS=1 npx jest --config ./test/jest-e2e.json test/academic --runInBand`

---

### Task 1: Migration tạo 7 bảng Học vụ + test ràng buộc

**Files:**
- Create: `test/academic/academic-schema.e2e-spec.ts`
- Create: `src/database/migrations/20261006000001-CreateAcademicTables.ts`

**Interfaces:**
- Consumes: bảng có sẵn `users`, `departments`, `rooms`; `AppDataSource` từ `src/database/data-source.ts`.
- Produces: 7 bảng + tên constraint đúng như `data-model.md` (Task 3 map entity theo đúng tên cột này).

- [ ] **Step 0: Ghi baseline unit test (để Task 5 so sánh regression)**

Run: `npx jest 2>&1 | tail -5`
Ghi lại số `Tests: X failed, Y passed` vào ghi chú bàn giao (không sửa test cũ đang fail, nếu có).

- [ ] **Step 1: Viết test ràng buộc (sẽ fail vì bảng chưa tồn tại)**

```ts
// test/academic/academic-schema.e2e-spec.ts
import { QueryRunner } from 'typeorm';
import { AppDataSource } from '../../src/database/data-source';

/**
 * ACD-001 — kiểm chứng ràng buộc DB R3–R10 trên Postgres local.
 * Chạy: RUN_DB_TESTS=1 npx jest --config ./test/jest-e2e.json test/academic --runInBand
 * Mỗi test chạy trong transaction và rollback — không để lại dữ liệu.
 */
const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDb('ACD-001 academic schema constraints', () => {
  let qr: QueryRunner;

  beforeAll(async () => {
    await AppDataSource.initialize();
  });
  afterAll(async () => {
    await AppDataSource.destroy();
  });
  beforeEach(async () => {
    qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
  });
  afterEach(async () => {
    await qr.rollbackTransaction();
    await qr.release();
  });

  /** Chạy SQL trong savepoint; trả mã lỗi Postgres (vd '23505') hoặc undefined nếu thành công. */
  async function pgError(sql: string, params: unknown[] = []): Promise<string | undefined> {
    await qr.query('SAVEPOINT t');
    try {
      await qr.query(sql, params);
      await qr.query('RELEASE SAVEPOINT t');
      return undefined;
    } catch (e) {
      await qr.query('ROLLBACK TO SAVEPOINT t');
      const err = e as { code?: string; driverError?: { code?: string } };
      return err.driverError?.code ?? err.code;
    }
  }

  async function one(sql: string, params: unknown[] = []): Promise<string> {
    const rows: Array<{ id: string }> = await qr.query(sql, params);
    return rows[0].id;
  }

  const sfx = () => Math.random().toString(36).slice(2, 10);

  interface Fixture {
    deptId: string;
    userId: string;
    roomId: string;
    semesterId: string;
    subjectId: string;
    shiftId: string;
    studentId: string;
    sectionId: string;
  }

  async function fixture(): Promise<Fixture> {
    const s = sfx();
    const deptId = await one(
      `INSERT INTO departments (department_code, department_name) VALUES ($1, $2) RETURNING id`,
      [`T-${s}`, `Test dept ${s}`],
    );
    const userId = await one(
      `INSERT INTO users (username, email, password_hash, full_name)
       VALUES ($1, $2, 'x', 'Test SV') RETURNING id`,
      [`t_${s}`, `t_${s}@test.local`],
    );
    const roomId = await one(
      `INSERT INTO rooms (room_code, room_name, capacity, room_type)
       VALUES ($1, $2, 40, 'training_room') RETURNING id`,
      [`R-${s}`, `Room ${s}`],
    );
    const semesterId = await one(
      `INSERT INTO semesters (semester_code, semester_name, start_date, end_date)
       VALUES ($1, 'Test sem', '2026-09-07', '2026-12-20') RETURNING id`,
      [`S-${s}`],
    );
    const subjectId = await one(
      `INSERT INTO subjects (subject_code, subject_name, credits, department_id)
       VALUES ($1, 'Test subject', 3, $2) RETURNING id`,
      [`SB-${s}`, deptId],
    );
    const shiftId = await one(
      `INSERT INTO study_shifts (shift_code, shift_name, shift_order, start_time, end_time)
       VALUES ($1, 'Test shift', 99, '07:30', '09:50') RETURNING id`,
      [`SH-${s}`],
    );
    const studentId = await one(
      `INSERT INTO students (user_id, student_code, department_id) VALUES ($1, $2, $3) RETURNING id`,
      [userId, `HE-${s}`, deptId],
    );
    const sectionId = await one(
      `INSERT INTO class_sections (class_code, semester_id, subject_id, lecturer_user_id, default_room_id, max_students)
       VALUES ('SE1801', $1, $2, $3, $4, 30) RETURNING id`,
      [semesterId, subjectId, userId, roomId],
    );
    return { deptId, userId, roomId, semesterId, subjectId, shiftId, studentId, sectionId };
  }

  const insertSession = (f: Fixture, date = '2026-09-07', roomId = f.roomId, sectionId = f.sectionId) =>
    pgError(
      `INSERT INTO class_sessions (class_section_id, session_no, session_date, shift_id, room_id, start_time, end_time)
       VALUES ($1, 1, $2, $3, $4, ($2::date + time '07:30') AT TIME ZONE 'Asia/Ho_Chi_Minh',
                                  ($2::date + time '09:50') AT TIME ZONE 'Asia/Ho_Chi_Minh')`,
      [sectionId, date, f.shiftId, roomId],
    );

  it('happy path: fixture + enrollment + session insert được', async () => {
    const f = await fixture();
    expect(
      await pgError(`INSERT INTO class_enrollments (class_section_id, student_id) VALUES ($1, $2)`, [
        f.sectionId,
        f.studentId,
      ]),
    ).toBeUndefined();
    expect(await insertSession(f)).toBeUndefined();
  });

  describe('R3 — mã trùng đang sống bị chặn, tái dùng sau soft-delete', () => {
    it('semester_code trùng → 23505; soft-delete rồi tạo lại → OK', async () => {
      const f = await fixture();
      const [{ semester_code: code }] = await qr.query(
        `SELECT semester_code FROM semesters WHERE id = $1`,
        [f.semesterId],
      );
      const dup = `INSERT INTO semesters (semester_code, semester_name, start_date, end_date)
                   VALUES ($1, 'Dup', '2026-01-01', '2026-02-01')`;
      expect(await pgError(dup, [code])).toBe('23505');
      await qr.query(`UPDATE semesters SET deleted_at = now() WHERE id = $1`, [f.semesterId]);
      expect(await pgError(dup, [code])).toBeUndefined();
    });

    it('subject_code trùng → 23505', async () => {
      const f = await fixture();
      expect(
        await pgError(
          `INSERT INTO subjects (subject_code, subject_name)
           SELECT subject_code, 'Dup' FROM subjects WHERE id = $1`,
          [f.subjectId],
        ),
      ).toBe('23505');
    });

    it('shift_code trùng → 23505; shift_order trùng → 23505', async () => {
      const f = await fixture();
      expect(
        await pgError(
          `INSERT INTO study_shifts (shift_code, shift_name, shift_order, start_time, end_time)
           SELECT shift_code, 'Dup', 98, '10:00', '11:00' FROM study_shifts WHERE id = $1`,
          [f.shiftId],
        ),
      ).toBe('23505');
      expect(
        await pgError(
          `INSERT INTO study_shifts (shift_code, shift_name, shift_order, start_time, end_time)
           VALUES ($1, 'Dup order', 99, '10:00', '11:00')`,
          [`SH-${sfx()}`],
        ),
      ).toBe('23505');
    });

    it('student_code trùng → 23505; cùng user_id 2 hồ sơ → 23505', async () => {
      const f = await fixture();
      const otherUser = await one(
        `INSERT INTO users (username, email, password_hash, full_name) VALUES ($1, $2, 'x', 'U2') RETURNING id`,
        [`u2_${sfx()}`, `u2_${sfx()}@test.local`],
      );
      expect(
        await pgError(
          `INSERT INTO students (user_id, student_code)
           SELECT $2, student_code FROM students WHERE id = $1`,
          [f.studentId, otherUser],
        ),
      ).toBe('23505');
      expect(
        await pgError(`INSERT INTO students (user_id, student_code) VALUES ($1, $2)`, [
          f.userId,
          `HE-${sfx()}`,
        ]),
      ).toBe('23505');
    });

    it('(semester, subject, class_code) trùng → 23505', async () => {
      const f = await fixture();
      expect(
        await pgError(
          `INSERT INTO class_sections (class_code, semester_id, subject_id) VALUES ('SE1801', $1, $2)`,
          [f.semesterId, f.subjectId],
        ),
      ).toBe('23505');
    });
  });

  describe('R4 — CHECK giá trị', () => {
    it('semester end_date < start_date → 23514', async () => {
      expect(
        await pgError(
          `INSERT INTO semesters (semester_code, semester_name, start_date, end_date)
           VALUES ($1, 'Bad', '2026-12-01', '2026-11-01')`,
          [`S-${sfx()}`],
        ),
      ).toBe('23514');
    });

    it('shift end_time <= start_time → 23514', async () => {
      expect(
        await pgError(
          `INSERT INTO study_shifts (shift_code, shift_name, shift_order, start_time, end_time)
           VALUES ($1, 'Bad', 97, '09:50', '09:50')`,
          [`SH-${sfx()}`],
        ),
      ).toBe('23514');
    });

    it('session end_time <= start_time → 23514', async () => {
      const f = await fixture();
      expect(
        await pgError(
          `INSERT INTO class_sessions (class_section_id, session_date, shift_id, room_id, start_time, end_time)
           VALUES ($1, '2026-09-07', $2, $3, '2026-09-07T03:00:00Z', '2026-09-07T02:00:00Z')`,
          [f.sectionId, f.shiftId, f.roomId],
        ),
      ).toBe('23514');
    });

    it('credits < 0 → 23514; max_students = 0 → 23514', async () => {
      const f = await fixture();
      expect(
        await pgError(`INSERT INTO subjects (subject_code, subject_name, credits) VALUES ($1, 'Bad', -1)`, [
          `SB-${sfx()}`,
        ]),
      ).toBe('23514');
      expect(
        await pgError(
          `INSERT INTO class_sections (class_code, semester_id, subject_id, max_students) VALUES ('SE9999', $1, $2, 0)`,
          [f.semesterId, f.subjectId],
        ),
      ).toBe('23514');
    });
  });

  describe('R5 — status ngoài tập cho phép → 23514', () => {
    it.each([
      ['semesters', 'status'],
      ['students', 'study_status'],
      ['class_sections', 'status'],
      ['class_enrollments', 'status'],
      ['class_sessions', 'status'],
    ])('%s.%s = "bogus"', async (table, col) => {
      const f = await fixture();
      await qr.query(`INSERT INTO class_enrollments (class_section_id, student_id) VALUES ($1, $2)`, [
        f.sectionId,
        f.studentId,
      ]);
      await insertSession(f);
      // cập nhật 1 dòng bất kỳ của bảng thuộc fixture này
      expect(await pgError(`UPDATE ${table} SET ${col} = 'bogus' WHERE id = (SELECT id FROM ${table} ORDER BY created_at DESC LIMIT 1)`)).toBe('23514');
    });
  });

  it('R6 — 1 sinh viên 2 lần trong cùng lớp → 23505', async () => {
    const f = await fixture();
    const sql = `INSERT INTO class_enrollments (class_section_id, student_id) VALUES ($1, $2)`;
    expect(await pgError(sql, [f.sectionId, f.studentId])).toBeUndefined();
    expect(await pgError(sql, [f.sectionId, f.studentId])).toBe('23505');
  });

  it('R7 — cùng lớp trùng (ngày, ca) → 23505', async () => {
    const f = await fixture();
    const otherRoom = await one(
      `INSERT INTO rooms (room_code, room_name, capacity) VALUES ($1, $2, 40) RETURNING id`,
      [`R2-${sfx()}`, `Room2 ${sfx()}`],
    );
    expect(await insertSession(f)).toBeUndefined();
    expect(await insertSession(f, '2026-09-07', otherRoom)).toBe('23505');
  });

  describe('R8 — trùng phòng cùng (ngày, ca)', () => {
    it('lớp khác cùng phòng/ngày/ca → 23505', async () => {
      const f = await fixture();
      const section2 = await one(
        `INSERT INTO class_sections (class_code, semester_id, subject_id) VALUES ('SE1802', $1, $2) RETURNING id`,
        [f.semesterId, f.subjectId],
      );
      expect(await insertSession(f)).toBeUndefined();
      expect(await insertSession(f, '2026-09-07', f.roomId, section2)).toBe('23505');
    });

    it('buổi cũ cancelled → phòng được giải phóng', async () => {
      const f = await fixture();
      const section2 = await one(
        `INSERT INTO class_sections (class_code, semester_id, subject_id) VALUES ('SE1802', $1, $2) RETURNING id`,
        [f.semesterId, f.subjectId],
      );
      expect(await insertSession(f)).toBeUndefined();
      await qr.query(`UPDATE class_sessions SET status = 'cancelled' WHERE class_section_id = $1`, [f.sectionId]);
      expect(await insertSession(f, '2026-09-07', f.roomId, section2)).toBeUndefined();
    });
  });

  describe('R9 — FK', () => {
    it('xoá cứng học kỳ đang có lớp → 23503', async () => {
      const f = await fixture();
      expect(await pgError(`DELETE FROM semesters WHERE id = $1`, [f.semesterId])).toBe('23503');
    });

    it('xoá cứng khoa → subjects.department_id và students.department_id = NULL', async () => {
      const f = await fixture();
      await qr.query(`DELETE FROM departments WHERE id = $1`, [f.deptId]);
      const [subj] = await qr.query(`SELECT department_id FROM subjects WHERE id = $1`, [f.subjectId]);
      const [stu] = await qr.query(`SELECT department_id FROM students WHERE id = $1`, [f.studentId]);
      expect(subj.department_id).toBeNull();
      expect(stu.department_id).toBeNull();
    });
  });
});
```

Ghi chú test R5: dòng mới nhất mỗi bảng (`ORDER BY created_at DESC`) là của fixture vì cùng transaction dùng `now()` lớn nhất; nếu bảng có dữ liệu demo cùng timestamp không ảnh hưởng — CHECK vẫn bắn trên bất kỳ dòng nào.

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `RUN_DB_TESTS=1 npx jest --config ./test/jest-e2e.json test/academic/academic-schema --runInBand`
Expected: FAIL — `relation "semesters" does not exist`.

- [ ] **Step 3: Viết migration**

```ts
// src/database/migrations/20261006000001-CreateAcademicTables.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ACD-001 (task #22) — Học vụ: tạo 7 bảng nền cho Điểm danh phòng học (docx §2.7).
 * Spec: spec/features/academic/feat-academic-db-schema/{spec,data-model}.md
 *
 * Schema-only, ADD-ONLY (R1, R2): chỉ CREATE/DROP 7 bảng mới; FK trỏ TỚI users/departments/rooms,
 * KHÔNG ALTER bảng cũ. Viết TAY, mirror 20260721000001-CreateZonesTable.ts.
 * - Danh mục (semesters/subjects/study_shifts/students/class_sections): soft-delete + partial unique (R3, D7).
 * - class_enrollments / class_sessions: vòng đời bằng status, không deleted_at (D6).
 * - Enum = varchar + CHECK (R5, D8). FK RESTRICT, trừ department/default_room/lecturer → SET NULL (R9).
 * - class_sessions.start_time/end_time = snapshot ngày + giờ ca (VN) (D5) — index (room_id, start_time) cho #23.
 */
export class CreateAcademicTables20261006000001 implements MigrationInterface {
  name = 'CreateAcademicTables20261006000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Học kỳ
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "semesters" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "semester_code" varchar(30) NOT NULL,
        "semester_name" varchar(150) NOT NULL,
        "academic_year" varchar(20),
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'upcoming',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_semesters_id" PRIMARY KEY ("id"),
        CONSTRAINT "CK_semesters_dates" CHECK ("end_date" >= "start_date"),
        CONSTRAINT "CK_semesters_status" CHECK ("status" IN ('upcoming', 'ongoing', 'closed'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_semesters_code_active"
        ON "semesters" ("semester_code") WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_semesters_dates"
        ON "semesters" ("start_date", "end_date") WHERE "deleted_at" IS NULL
    `);

    // 2. Môn học
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subjects" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "subject_code" varchar(30) NOT NULL,
        "subject_name" varchar(255) NOT NULL,
        "credits" smallint,
        "department_id" uuid,
        "description" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_subjects_id" PRIMARY KEY ("id"),
        CONSTRAINT "CK_subjects_credits" CHECK ("credits" IS NULL OR "credits" >= 0),
        CONSTRAINT "FK_subjects_department_id" FOREIGN KEY ("department_id")
          REFERENCES "departments" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_subjects_code_active"
        ON "subjects" ("subject_code") WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_subjects_department" ON "subjects" ("department_id")
    `);

    // 3. Ca học (khung giờ cố định, giờ địa phương VN)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "study_shifts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shift_code" varchar(20) NOT NULL,
        "shift_name" varchar(100) NOT NULL,
        "shift_order" smallint NOT NULL,
        "start_time" time NOT NULL,
        "end_time" time NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_study_shifts_id" PRIMARY KEY ("id"),
        CONSTRAINT "CK_study_shifts_time" CHECK ("end_time" > "start_time")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_study_shifts_code_active"
        ON "study_shifts" ("shift_code") WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_study_shifts_order_active"
        ON "study_shifts" ("shift_order") WHERE "deleted_at" IS NULL
    `);

    // 4. Sinh viên (1-1 users → tái dùng face_profiles)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "students" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "student_code" varchar(30) NOT NULL,
        "cohort" varchar(20),
        "major" varchar(150),
        "administrative_class" varchar(50),
        "department_id" uuid,
        "study_status" varchar(20) NOT NULL DEFAULT 'studying',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_students_id" PRIMARY KEY ("id"),
        CONSTRAINT "CK_students_study_status"
          CHECK ("study_status" IN ('studying', 'suspended', 'graduated', 'dropped_out')),
        CONSTRAINT "FK_students_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_students_department_id" FOREIGN KEY ("department_id")
          REFERENCES "departments" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_students_code_active"
        ON "students" ("student_code") WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_students_user_active"
        ON "students" ("user_id") WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_students_department" ON "students" ("department_id")
    `);

    // 5. Lớp học phần
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "class_sections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "class_code" varchar(50) NOT NULL,
        "semester_id" uuid NOT NULL,
        "subject_id" uuid NOT NULL,
        "lecturer_user_id" uuid,
        "default_room_id" uuid,
        "max_students" integer,
        "status" varchar(20) NOT NULL DEFAULT 'planned',
        "note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_class_sections_id" PRIMARY KEY ("id"),
        CONSTRAINT "CK_class_sections_max_students" CHECK ("max_students" IS NULL OR "max_students" > 0),
        CONSTRAINT "CK_class_sections_status"
          CHECK ("status" IN ('planned', 'open', 'closed', 'cancelled')),
        CONSTRAINT "FK_class_sections_semester_id" FOREIGN KEY ("semester_id")
          REFERENCES "semesters" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_class_sections_subject_id" FOREIGN KEY ("subject_id")
          REFERENCES "subjects" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_class_sections_lecturer_user_id" FOREIGN KEY ("lecturer_user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_class_sections_default_room_id" FOREIGN KEY ("default_room_id")
          REFERENCES "rooms" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_class_sections_sem_subj_code_active"
        ON "class_sections" ("semester_id", "subject_id", "class_code") WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_class_sections_subject_semester"
        ON "class_sections" ("subject_id", "semester_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_class_sections_lecturer" ON "class_sections" ("lecturer_user_id")
    `);

    // 6. Danh sách lớp
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "class_enrollments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "class_section_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "enrolled_at" timestamptz NOT NULL DEFAULT now(),
        "status" varchar(20) NOT NULL DEFAULT 'active',
        "note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_class_enrollments_id" PRIMARY KEY ("id"),
        CONSTRAINT "CK_class_enrollments_status" CHECK ("status" IN ('active', 'dropped')),
        CONSTRAINT "FK_class_enrollments_class_section_id" FOREIGN KEY ("class_section_id")
          REFERENCES "class_sections" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_class_enrollments_student_id" FOREIGN KEY ("student_id")
          REFERENCES "students" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_class_enrollments_section_student"
        ON "class_enrollments" ("class_section_id", "student_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_class_enrollments_student" ON "class_enrollments" ("student_id")
    `);

    // 7. Buổi học — cầu nối camera → phòng → thời điểm → lớp (#23)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "class_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "class_section_id" uuid NOT NULL,
        "session_no" smallint,
        "session_date" date NOT NULL,
        "shift_id" uuid NOT NULL,
        "room_id" uuid NOT NULL,
        "start_time" timestamptz NOT NULL,
        "end_time" timestamptz NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'scheduled',
        "note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_class_sessions_id" PRIMARY KEY ("id"),
        CONSTRAINT "CK_class_sessions_time" CHECK ("end_time" > "start_time"),
        CONSTRAINT "CK_class_sessions_status"
          CHECK ("status" IN ('scheduled', 'ongoing', 'completed', 'cancelled')),
        CONSTRAINT "FK_class_sessions_class_section_id" FOREIGN KEY ("class_section_id")
          REFERENCES "class_sections" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_class_sessions_shift_id" FOREIGN KEY ("shift_id")
          REFERENCES "study_shifts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_class_sessions_room_id" FOREIGN KEY ("room_id")
          REFERENCES "rooms" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_class_sessions_section_date_shift"
        ON "class_sessions" ("class_section_id", "session_date", "shift_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_class_sessions_room_date_shift_active"
        ON "class_sessions" ("room_id", "session_date", "shift_id") WHERE "status" <> 'cancelled'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_class_sessions_room_start"
        ON "class_sessions" ("room_id", "start_time")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_class_sessions_section_date"
        ON "class_sessions" ("class_section_id", "session_date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Thứ tự ngược FK; index/constraint đi theo bảng.
    await queryRunner.query(`DROP TABLE IF EXISTS "class_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "class_enrollments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "class_sections"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "students"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "study_shifts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subjects"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "semesters"`);
  }
}
```

- [ ] **Step 4: Apply migration**

Run: `npx tsx scripts/run-migrations.ts`
Expected: `Applied 1 migration(s):` ` - CreateAcademicTables20261006000001`

- [ ] **Step 5: Chạy test, xác nhận PASS**

Run: `RUN_DB_TESTS=1 npx jest --config ./test/jest-e2e.json test/academic/academic-schema --runInBand`
Expected: PASS toàn bộ (≈ 21 test).

- [ ] **Step 6: Báo thay đổi (không commit)**

Run: `git status --short`

---

### Task 2: Seed 6 ca học + script revert migration

**Files:**
- Modify: `test/academic/academic-schema.e2e-spec.ts` (thêm 1 test R10)
- Create: `src/database/migrations/20261006000002-SeedStudyShifts.ts`
- Create: `scripts/revert-migration.ts`

**Interfaces:**
- Consumes: bảng `study_shifts` (Task 1).
- Produces: 6 dòng `SLOT1..SLOT6` (shift_order 1..6) — Task 4 tra ca theo `shift_code`.

- [ ] **Step 1: Thêm test R10 (fail vì chưa seed)** — thêm vào cuối `describeDb(...)` trong `academic-schema.e2e-spec.ts`:

```ts
  it('R10 — đã seed đúng 6 ca học cố định', async () => {
    const rows: Array<{ shift_code: string; shift_order: number; start_time: string; end_time: string }> =
      await qr.query(
        `SELECT shift_code, shift_order, start_time::text AS start_time, end_time::text AS end_time
           FROM study_shifts WHERE deleted_at IS NULL AND shift_code LIKE 'SLOT%' ORDER BY shift_order`,
      );
    expect(rows).toEqual([
      { shift_code: 'SLOT1', shift_order: 1, start_time: '07:30:00', end_time: '09:50:00' },
      { shift_code: 'SLOT2', shift_order: 2, start_time: '10:00:00', end_time: '12:20:00' },
      { shift_code: 'SLOT3', shift_order: 3, start_time: '12:50:00', end_time: '15:10:00' },
      { shift_code: 'SLOT4', shift_order: 4, start_time: '15:20:00', end_time: '17:40:00' },
      { shift_code: 'SLOT5', shift_order: 5, start_time: '18:00:00', end_time: '20:20:00' },
      { shift_code: 'SLOT6', shift_order: 6, start_time: '20:30:00', end_time: '22:50:00' },
    ]);
  });
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `RUN_DB_TESTS=1 npx jest --config ./test/jest-e2e.json test/academic/academic-schema -t R10 --runInBand`
Expected: FAIL — `Expected: [6 phần tử] Received: []`.

- [ ] **Step 3: Viết migration seed**

```ts
// src/database/migrations/20261006000002-SeedStudyShifts.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ACD-001 R10 — seed 6 ca học cố định (giờ địa phương VN). Dữ liệu tham chiếu, cần ở mọi môi trường.
 * Idempotent: WHERE NOT EXISTS theo shift_code đang sống. Đổi giờ ca sau này = migration UPDATE mới;
 * buổi học đã tạo giữ snapshot start_time/end_time (D5) nên không bị ảnh hưởng.
 */
export class SeedStudyShifts20261006000002 implements MigrationInterface {
  name = 'SeedStudyShifts20261006000002';

  private readonly shifts: Array<[code: string, name: string, order: number, start: string, end: string]> = [
    ['SLOT1', 'Ca 1', 1, '07:30', '09:50'],
    ['SLOT2', 'Ca 2', 2, '10:00', '12:20'],
    ['SLOT3', 'Ca 3', 3, '12:50', '15:10'],
    ['SLOT4', 'Ca 4', 4, '15:20', '17:40'],
    ['SLOT5', 'Ca 5', 5, '18:00', '20:20'],
    ['SLOT6', 'Ca 6', 6, '20:30', '22:50'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [code, name, order, start, end] of this.shifts) {
      await queryRunner.query(
        `INSERT INTO study_shifts (shift_code, shift_name, shift_order, start_time, end_time)
         SELECT $1::varchar, $2::varchar, $3::smallint, $4::time, $5::time
         WHERE NOT EXISTS (
           SELECT 1 FROM study_shifts WHERE shift_code = $1 AND deleted_at IS NULL
         );`,
        [code, name, order, start, end],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Chỉ xoá ca CHƯA được buổi học nào tham chiếu (FK RESTRICT bảo vệ dữ liệu thật).
    await queryRunner.query(
      `DELETE FROM study_shifts s
        WHERE s.shift_code = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM class_sessions cs WHERE cs.shift_id = s.id);`,
      [this.shifts.map(([code]) => code)],
    );
  }
}
```

- [ ] **Step 4: Viết script revert**

```ts
// scripts/revert-migration.ts
import { AppDataSource } from '../src/database/data-source.js';

/**
 * Revert migration MỚI NHẤT bằng `tsx` (CLI `npm run migration:revert` hỏng cùng lý do với
 * migration:run — xem scripts/run-migrations.ts). Chạy N lần để revert N migration.
 * Thực thi: npx tsx scripts/revert-migration.ts
 */
async function main(): Promise<void> {
  AppDataSource.setOptions({ migrationsTransactionMode: 'each' });
  await AppDataSource.initialize();
  await AppDataSource.undoLastMigration();
  console.log('Reverted last migration.');
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Apply + test PASS**

Run: `npx tsx scripts/run-migrations.ts` → Expected: ` - SeedStudyShifts20261006000002`
Run: `RUN_DB_TESTS=1 npx jest --config ./test/jest-e2e.json test/academic/academic-schema --runInBand` → Expected: PASS toàn bộ.

- [ ] **Step 6: Kiểm tra rollback 2 migration rồi apply lại**

```bash
npx tsx scripts/revert-migration.ts   # revert SeedStudyShifts
npx tsx scripts/revert-migration.ts   # revert CreateAcademicTables
set -a; . ./.env; set +a
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_DATABASE" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('semesters','subjects','study_shifts','students','class_sections','class_enrollments','class_sessions')"
npx tsx scripts/run-migrations.ts
```
Expected: count = `0` sau revert; run lại applied 2 migration; chạy lại test Task 1+2 PASS.

- [ ] **Step 7: Báo thay đổi (không commit)** — `git status --short`

---

### Task 3: Entity + AcademicModule + đăng ký

**Files:**
- Create: `src/modules/academic/entities/semester.entity.ts`, `subject.entity.ts`, `study-shift.entity.ts`, `student.entity.ts`, `class-section.entity.ts`, `class-enrollment.entity.ts`, `class-session.entity.ts`
- Create: `src/modules/academic/academic.module.ts`
- Modify: `src/app.module.ts` (import + thêm vào `imports` ngay sau `ZonesModule`, dòng ~124)
- Modify: `src/database/entities/index.ts` (thêm nhóm cuối file)
- Test: `test/academic/academic-entities.e2e-spec.ts`

**Interfaces:**
- Consumes: bảng Task 1; `UserEntity`, `DepartmentEntity`, `RoomEntity` (chỉ import, KHÔNG sửa).
- Produces (dùng ở #23 / task sau): `SemesterEntity`, `SemesterStatus`, `SubjectEntity`, `StudyShiftEntity`, `StudentEntity`, `StudentStudyStatus`, `ClassSectionEntity`, `ClassSectionStatus`, `ClassEnrollmentEntity`, `ClassEnrollmentStatus`, `ClassSessionEntity`, `ClassSessionStatus`, `AcademicModule` (exports `TypeOrmModule`).

- [ ] **Step 1: Viết test entity ↔ schema (fail vì entity chưa có)**

```ts
// test/academic/academic-entities.e2e-spec.ts
import { AppDataSource } from '../../src/database/data-source';
import { SemesterEntity } from '../../src/modules/academic/entities/semester.entity';
import { SubjectEntity } from '../../src/modules/academic/entities/subject.entity';
import { StudyShiftEntity } from '../../src/modules/academic/entities/study-shift.entity';
import { StudentEntity } from '../../src/modules/academic/entities/student.entity';
import { ClassSectionEntity } from '../../src/modules/academic/entities/class-section.entity';
import { ClassEnrollmentEntity } from '../../src/modules/academic/entities/class-enrollment.entity';
import { ClassSessionEntity } from '../../src/modules/academic/entities/class-session.entity';

/** ACD-001 R13 — entity map 1-1 với DDL (tên cột + nullable); date/time đọc ra là string. */
const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

const ENTITIES = [
  SemesterEntity,
  SubjectEntity,
  StudyShiftEntity,
  StudentEntity,
  ClassSectionEntity,
  ClassEnrollmentEntity,
  ClassSessionEntity,
];

describeDb('ACD-001 academic entities ↔ schema', () => {
  beforeAll(async () => {
    await AppDataSource.initialize();
  });
  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it.each(ENTITIES.map((e) => [e.name, e]))('%s: cột + nullable khớp DB', async (_name, entity) => {
    const meta = AppDataSource.getMetadata(entity);
    const dbCols: Array<{ column_name: string; is_nullable: 'YES' | 'NO' }> = await AppDataSource.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [meta.tableName],
    );
    const fromDb = Object.fromEntries(dbCols.map((c) => [c.column_name, c.is_nullable === 'YES']));
    const fromEntity = Object.fromEntries(meta.columns.map((c) => [c.databaseName, c.isNullable]));
    expect(fromEntity).toEqual(fromDb);
  });

  it('date/time đọc qua repository là string (không lệch múi giờ)', async () => {
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const repo = qr.manager.getRepository(SemesterEntity);
      const saved = await repo.save(
        repo.create({
          semesterCode: `E2E-${Date.now()}`,
          semesterName: 'Entity test',
          startDate: '2026-09-07',
          endDate: '2026-12-20',
        }),
      );
      const found = await repo.findOneByOrFail({ id: saved.id });
      expect(found.startDate).toBe('2026-09-07');
      expect(found.status).toBe('upcoming');

      const shift = await qr.manager.getRepository(StudyShiftEntity).findOneByOrFail({ shiftCode: 'SLOT1' });
      expect(shift.startTime).toBe('07:30:00');
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `RUN_DB_TESTS=1 npx jest --config ./test/jest-e2e.json test/academic/academic-entities --runInBand`
Expected: FAIL — `Cannot find module '../../src/modules/academic/entities/semester.entity'`.

- [ ] **Step 3: Viết 7 entity**

```ts
// src/modules/academic/entities/semester.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum SemesterStatus {
  UPCOMING = 'upcoming',
  ONGOING = 'ongoing',
  CLOSED = 'closed',
}

/**
 * Học kỳ (ACD-001). Báo cáo chuyên cần theo học kỳ (docx §2.7).
 * `semester_code` partial unique WHERE deleted_at IS NULL (R3) — khoá đồng bộ hệ thống đào tạo.
 * `start_date`/`end_date` kiểu `date` → string 'YYYY-MM-DD' (tránh lệch múi giờ).
 */
@Entity('semesters')
export class SemesterEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'semester_code', type: 'varchar', length: 30 })
  semesterCode: string;

  @Column({ name: 'semester_name', type: 'varchar', length: 150 })
  semesterName: string;

  @Column({ name: 'academic_year', type: 'varchar', length: 20, nullable: true })
  academicYear: string | null;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({ type: 'varchar', length: 20, default: SemesterStatus.UPCOMING })
  status: SemesterStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
```

```ts
// src/modules/academic/entities/subject.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { DepartmentEntity } from '../../accounts/entities/department.entity.js';

/**
 * Môn học (ACD-001). Báo cáo chuyên cần theo môn (docx §2.7).
 * `subject_code` partial unique WHERE deleted_at IS NULL (R3). `department_id` → SET NULL (R9).
 */
@Entity('subjects')
export class SubjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subject_code', type: 'varchar', length: 30 })
  subjectCode: string;

  @Column({ name: 'subject_name', type: 'varchar', length: 255 })
  subjectName: string;

  @Column({ type: 'smallint', nullable: true })
  credits: number | null;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => DepartmentEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  department: DepartmentEntity | null;
}
```

```ts
// src/modules/academic/entities/study-shift.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Ca học — khung giờ cố định, giờ địa phương VN (ACD-001 D4). Seed SLOT1..SLOT6 (R10).
 * `start_time`/`end_time` kiểu `time` → string 'HH:mm:ss'. Giờ thực của 1 buổi học
 * được snapshot vào class_sessions.start_time/end_time (D5) qua buildSessionTimes().
 */
@Entity('study_shifts')
export class StudyShiftEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'shift_code', type: 'varchar', length: 20 })
  shiftCode: string;

  @Column({ name: 'shift_name', type: 'varchar', length: 100 })
  shiftName: string;

  @Column({ name: 'shift_order', type: 'smallint' })
  shiftOrder: number;

  @Column({ name: 'start_time', type: 'time' })
  startTime: string;

  @Column({ name: 'end_time', type: 'time' })
  endTime: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
```

```ts
// src/modules/academic/entities/student.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { DepartmentEntity } from '../../accounts/entities/department.entity.js';

export enum StudentStudyStatus {
  STUDYING = 'studying',
  SUSPENDED = 'suspended',
  GRADUATED = 'graduated',
  DROPPED_OUT = 'dropped_out',
}

/**
 * Sinh viên (ACD-001 D3): hồ sơ học vụ 1-1 với `users` (user_id NOT NULL, partial unique)
 * → camera nhận diện user qua face_profiles có sẵn, tra ra sinh viên. KHÔNG sửa UserEntity.
 */
@Entity('students')
export class StudentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'student_code', type: 'varchar', length: 30 })
  studentCode: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cohort: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  major: string | null;

  @Column({ name: 'administrative_class', type: 'varchar', length: 50, nullable: true })
  administrativeClass: string | null;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({
    name: 'study_status',
    type: 'varchar',
    length: 20,
    default: StudentStudyStatus.STUDYING,
  })
  studyStatus: StudentStudyStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @ManyToOne(() => DepartmentEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  department: DepartmentEntity | null;
}
```

```ts
// src/modules/academic/entities/class-section.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import { SemesterEntity } from './semester.entity.js';
import { SubjectEntity } from './subject.entity.js';

export enum ClassSectionStatus {
  PLANNED = 'planned',
  OPEN = 'open',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
}

/**
 * Lớp học = lớp học phần (ACD-001 D1): môn × học kỳ × mã lớp — đơn vị điểm danh.
 * (semester_id, subject_id, class_code) partial unique (R3) — khoá đồng bộ.
 * lecturer_user_id / default_room_id → SET NULL (R9).
 */
@Entity('class_sections')
export class ClassSectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'class_code', type: 'varchar', length: 50 })
  classCode: string;

  @Column({ name: 'semester_id', type: 'uuid' })
  semesterId: string;

  @Column({ name: 'subject_id', type: 'uuid' })
  subjectId: string;

  @Column({ name: 'lecturer_user_id', type: 'uuid', nullable: true })
  lecturerUserId: string | null;

  @Column({ name: 'default_room_id', type: 'uuid', nullable: true })
  defaultRoomId: string | null;

  @Column({ name: 'max_students', type: 'integer', nullable: true })
  maxStudents: number | null;

  @Column({ type: 'varchar', length: 20, default: ClassSectionStatus.PLANNED })
  status: ClassSectionStatus;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => SemesterEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'semester_id' })
  semester: SemesterEntity;

  @ManyToOne(() => SubjectEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subject_id' })
  subject: SubjectEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'lecturer_user_id' })
  lecturer: UserEntity | null;

  @ManyToOne(() => RoomEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'default_room_id' })
  defaultRoom: RoomEntity | null;
}
```

```ts
// src/modules/academic/entities/class-enrollment.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ClassSectionEntity } from './class-section.entity.js';
import { StudentEntity } from './student.entity.js';

export enum ClassEnrollmentStatus {
  ACTIVE = 'active',
  DROPPED = 'dropped',
}

/**
 * Danh sách lớp (ACD-001). Unique (class_section_id, student_id) (R6).
 * Rút lớp = status 'dropped', KHÔNG xoá — giữ lịch sử chuyên cần (D6, tiền lệ ADR-008).
 */
@Entity('class_enrollments')
export class ClassEnrollmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'class_section_id', type: 'uuid' })
  classSectionId: string;

  @Column({ name: 'student_id', type: 'uuid' })
  studentId: string;

  @Column({ name: 'enrolled_at', type: 'timestamptz', default: () => 'now()' })
  enrolledAt: Date;

  @Column({ type: 'varchar', length: 20, default: ClassEnrollmentStatus.ACTIVE })
  status: ClassEnrollmentStatus;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => ClassSectionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'class_section_id' })
  classSection: ClassSectionEntity;

  @ManyToOne(() => StudentEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'student_id' })
  student: StudentEntity;
}
```

```ts
// src/modules/academic/entities/class-session.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import { ClassSectionEntity } from './class-section.entity.js';
import { StudyShiftEntity } from './study-shift.entity.js';

export enum ClassSessionStatus {
  SCHEDULED = 'scheduled',
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

/**
 * Buổi học (ACD-001 D2) — cầu nối camera → phòng → thời điểm → lớp cho điểm danh (#23).
 * start_time/end_time: snapshot session_date + giờ ca (VN), tính bằng buildSessionTimes() (D5).
 * Unique (lớp, ngày, ca) (R7); unique (phòng, ngày, ca) khi chưa cancelled (R8).
 * Huỷ buổi = status 'cancelled', KHÔNG xoá (D6).
 */
@Entity('class_sessions')
export class ClassSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'class_section_id', type: 'uuid' })
  classSectionId: string;

  @Column({ name: 'session_no', type: 'smallint', nullable: true })
  sessionNo: number | null;

  @Column({ name: 'session_date', type: 'date' })
  sessionDate: string;

  @Column({ name: 'shift_id', type: 'uuid' })
  shiftId: string;

  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @Column({ name: 'start_time', type: 'timestamptz' })
  startTime: Date;

  @Column({ name: 'end_time', type: 'timestamptz' })
  endTime: Date;

  @Column({ type: 'varchar', length: 20, default: ClassSessionStatus.SCHEDULED })
  status: ClassSessionStatus;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => ClassSectionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'class_section_id' })
  classSection: ClassSectionEntity;

  @ManyToOne(() => StudyShiftEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shift_id' })
  shift: StudyShiftEntity;

  @ManyToOne(() => RoomEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'room_id' })
  room: RoomEntity;
}
```

- [ ] **Step 4: Viết module + đăng ký**

```ts
// src/modules/academic/academic.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SemesterEntity } from './entities/semester.entity.js';
import { SubjectEntity } from './entities/subject.entity.js';
import { StudyShiftEntity } from './entities/study-shift.entity.js';
import { StudentEntity } from './entities/student.entity.js';
import { ClassSectionEntity } from './entities/class-section.entity.js';
import { ClassEnrollmentEntity } from './entities/class-enrollment.entity.js';
import { ClassSessionEntity } from './entities/class-session.entity.js';

/**
 * AcademicModule (ACD-001) — SCHEMA-ONLY: chỉ đăng ký entity Học vụ (R13, R14).
 * KHÔNG controller/provider — nghiệp vụ (CRUD/import, điểm danh theo ca #23) làm ở task sau.
 * Mirror ZonesModule. Module khác dùng entity Học vụ thì import AcademicModule (ADR-003).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SemesterEntity,
      SubjectEntity,
      StudyShiftEntity,
      StudentEntity,
      ClassSectionEntity,
      ClassEnrollmentEntity,
      ClassSessionEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class AcademicModule {}
```

`src/app.module.ts` — thêm import cạnh `ZonesModule` (dòng ~43) và vào mảng `imports` ngay sau `ZonesModule,` (dòng ~124):

```ts
import { AcademicModule } from './modules/academic/academic.module';
```
```ts
    ZonesModule, // schema-only: đăng ký entity scope Zone (SAVP)
    AcademicModule, // schema-only: đăng ký entity Học vụ (ACD-001, nền điểm danh phòng học #23)
```

`src/database/entities/index.ts` — thêm cuối file:

```ts
// Group: Academic (Học vụ — ACD-001)
export {
  SemesterEntity,
  SemesterStatus,
} from '../../modules/academic/entities/semester.entity.js';
export { SubjectEntity } from '../../modules/academic/entities/subject.entity.js';
export { StudyShiftEntity } from '../../modules/academic/entities/study-shift.entity.js';
export {
  StudentEntity,
  StudentStudyStatus,
} from '../../modules/academic/entities/student.entity.js';
export {
  ClassSectionEntity,
  ClassSectionStatus,
} from '../../modules/academic/entities/class-section.entity.js';
export {
  ClassEnrollmentEntity,
  ClassEnrollmentStatus,
} from '../../modules/academic/entities/class-enrollment.entity.js';
export {
  ClassSessionEntity,
  ClassSessionStatus,
} from '../../modules/academic/entities/class-session.entity.js';
```

- [ ] **Step 5: Test PASS + build**

Run: `RUN_DB_TESTS=1 npx jest --config ./test/jest-e2e.json test/academic --runInBand` → Expected: PASS toàn bộ.
Run: `npx nest build` → Expected: không lỗi TypeScript.
(Nếu test "cột + nullable" fail: sửa ENTITY cho khớp migration, không sửa migration — DDL là nguồn sự thật đã kiểm ở Task 1.)

- [ ] **Step 6: Báo thay đổi (không commit)** — `git status --short`

---

### Task 4: Util thời điểm buổi học + script seed demo

**Files:**
- Create: `src/modules/academic/utils/session-time.util.ts`
- Test: `src/modules/academic/utils/session-time.util.spec.ts`
- Create: `scripts/academic-demo/seed-academic-demo.ts`
- Create: `scripts/seed-academic-demo.ts`
- Test: `test/academic/academic-demo-seed.e2e-spec.ts`

**Interfaces:**
- Consumes: 7 bảng + 6 ca `SLOT1..SLOT6` (Task 1–2).
- Produces:
  - `buildSessionTimes(sessionDate: string, shiftStart: string, shiftEnd: string): { startTime: Date; endTime: Date }` — `sessionDate` `'YYYY-MM-DD'`, giờ `'HH:mm'` hoặc `'HH:mm:ss'`; ném `Error` nếu sai định dạng. Dùng lại ở #23.
  - `seedAcademicDemo(runner: QueryRunner): Promise<void>` — idempotent, không tự mở/commit transaction.
  - Hằng `DEMO_PASSWORD_HASH` (bcrypt của `Abcd1234@`, copy từ `20260720000003-SeedDemoUsers.ts`).

- [ ] **Step 1: Viết unit test util (fail)**

```ts
// src/modules/academic/utils/session-time.util.spec.ts
import { buildSessionTimes } from './session-time.util.js';

describe('buildSessionTimes (ACD-001 D5, R12)', () => {
  it('ngày + ca giờ VN → UTC đúng (07:30 VN = 00:30Z)', () => {
    const { startTime, endTime } = buildSessionTimes('2026-09-07', '07:30:00', '09:50:00');
    expect(startTime.toISOString()).toBe('2026-09-07T00:30:00.000Z');
    expect(endTime.toISOString()).toBe('2026-09-07T02:50:00.000Z');
  });

  it('nhận giờ dạng HH:mm', () => {
    expect(buildSessionTimes('2026-09-07', '20:30', '22:50').endTime.toISOString()).toBe(
      '2026-09-07T15:50:00.000Z',
    );
  });

  it.each([
    ['07/09/2026', '07:30', '09:50'],
    ['2026-09-07', '7:30', '09:50'],
    ['2026-02-30', '07:30', '09:50'],
  ])('sai định dạng/ngày không tồn tại → throw (%s %s)', (d, s, e) => {
    expect(() => buildSessionTimes(d, s, e)).toThrow();
  });

  it('giờ kết thúc <= giờ bắt đầu → throw', () => {
    expect(() => buildSessionTimes('2026-09-07', '09:50', '07:30')).toThrow();
  });
});
```

- [ ] **Step 2: Chạy, xác nhận FAIL**

Run: `npx jest src/modules/academic/utils/session-time.util.spec.ts`
Expected: FAIL — `Cannot find module './session-time.util.js'`.

- [ ] **Step 3: Viết util**

```ts
// src/modules/academic/utils/session-time.util.ts
/**
 * ACD-001 D5/R12 — tính thời điểm thực của 1 buổi học = ngày học + giờ ca (giờ địa phương VN).
 * Việt Nam cố định UTC+07:00, không DST → ghép offset trực tiếp, không cần thư viện múi giờ.
 * Kết quả ghi vào class_sessions.start_time/end_time (snapshot). Dùng lại ở #23.
 */
const VN_OFFSET = '+07:00';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function toInstant(sessionDate: string, time: string): Date {
  if (!DATE_RE.test(sessionDate)) throw new Error(`Ngày học không hợp lệ: ${sessionDate}`);
  if (!TIME_RE.test(time)) throw new Error(`Giờ ca không hợp lệ: ${time}`);
  const hhmmss = time.length === 5 ? `${time}:00` : time;
  const instant = new Date(`${sessionDate}T${hhmmss}${VN_OFFSET}`);
  // Chặn ngày không tồn tại (vd 2026-02-30 bị Date tự cuộn sang tháng 3).
  const vnDate = new Date(instant.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  if (Number.isNaN(instant.getTime()) || vnDate !== sessionDate) {
    throw new Error(`Ngày học không tồn tại: ${sessionDate}`);
  }
  return instant;
}

export function buildSessionTimes(
  sessionDate: string,
  shiftStart: string,
  shiftEnd: string,
): { startTime: Date; endTime: Date } {
  const startTime = toInstant(sessionDate, shiftStart);
  const endTime = toInstant(sessionDate, shiftEnd);
  if (endTime <= startTime) {
    throw new Error(`Giờ kết thúc ca (${shiftEnd}) phải sau giờ bắt đầu (${shiftStart})`);
  }
  return { startTime, endTime };
}
```

- [ ] **Step 4: Unit test PASS**

Run: `npx jest src/modules/academic/utils/session-time.util.spec.ts` → Expected: PASS (6 test).

- [ ] **Step 5: Viết e2e test seed demo (fail)**

```ts
// test/academic/academic-demo-seed.e2e-spec.ts
import { AppDataSource } from '../../src/database/data-source';
import { seedAcademicDemo } from '../../scripts/academic-demo/seed-academic-demo';

/** ACD-001 R11/R12 — demo idempotent + truy vấn khớp camera §4.1 trả đúng 1 buổi. */
const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

const COUNT_SQL = `SELECT
  (SELECT count(*) FROM semesters WHERE semester_code = 'FA26')::int AS semesters,
  (SELECT count(*) FROM subjects WHERE subject_code IN ('PRN211','SWP391','MAE101'))::int AS subjects,
  (SELECT count(*) FROM students WHERE student_code LIKE 'HE1800%')::int AS students,
  (SELECT count(*) FROM class_sections cs JOIN semesters s ON s.id = cs.semester_id WHERE s.semester_code = 'FA26')::int AS sections,
  (SELECT count(*) FROM class_enrollments ce JOIN students st ON st.id = ce.student_id WHERE st.student_code LIKE 'HE1800%')::int AS enrollments,
  (SELECT count(*) FROM class_sessions cs JOIN class_sections c ON c.id = cs.class_section_id
     JOIN semesters s ON s.id = c.semester_id WHERE s.semester_code = 'FA26')::int AS sessions`;

describeDb('ACD-001 academic demo seed', () => {
  beforeAll(async () => {
    await AppDataSource.initialize();
  });
  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it('chạy 2 lần → số bản ghi không đổi; §4.1 khớp đúng 1 buổi', async () => {
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await seedAcademicDemo(qr);
      const [first] = await qr.query(COUNT_SQL);
      expect(first).toEqual({ semesters: 1, subjects: 3, students: 10, sections: 2, enrollments: 12, sessions: 8 });

      await seedAcademicDemo(qr);
      const [second] = await qr.query(COUNT_SQL);
      expect(second).toEqual(first);

      // §4.1: camera phòng ACD-R101, 07:35 VN ngày 2026-09-07, SV HE180001 → buổi SE1801 PRN211
      const rows: Array<{ class_code: string; session_date: string }> = await qr.query(
        `SELECT c.class_code, cs.session_date::text AS session_date
           FROM class_sessions cs
           JOIN class_sections c ON c.id = cs.class_section_id
           JOIN class_enrollments ce ON ce.class_section_id = cs.class_section_id AND ce.status = 'active'
           JOIN students s ON s.id = ce.student_id AND s.deleted_at IS NULL
           JOIN rooms r ON r.id = cs.room_id
          WHERE r.room_code = 'ACD-R101'
            AND cs.status <> 'cancelled'
            AND $1::timestamptz BETWEEN cs.start_time - interval '15 minutes' AND cs.end_time
            AND s.student_code = 'HE180001'`,
        ['2026-09-07T07:35:00+07:00'],
      );
      expect(rows).toEqual([{ class_code: 'SE1801', session_date: '2026-09-07' }]);
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  });
});
```

Kỳ vọng số liệu: SE1801 có SV 1–6, SE1802 có SV 5–10 → 12 enrollments; mỗi lớp 4 buổi (2 tuần × 2 buổi) → 8 sessions.

- [ ] **Step 6: Chạy, xác nhận FAIL**

Run: `RUN_DB_TESTS=1 npx jest --config ./test/jest-e2e.json test/academic/academic-demo-seed --runInBand`
Expected: FAIL — `Cannot find module '../../scripts/academic-demo/seed-academic-demo'`.

- [ ] **Step 7: Viết hàm seed demo**

```ts
// scripts/academic-demo/seed-academic-demo.ts
import { QueryRunner } from 'typeorm';
import { buildSessionTimes } from '../../src/modules/academic/utils/session-time.util.js';

/**
 * ACD-001 R11/R12 — dữ liệu DEMO Học vụ (KHÔNG phải migration, D10). Idempotent: mọi INSERT có
 * WHERE NOT EXISTS theo mã tự nhiên → chạy lại không nhân đôi. Không tự mở transaction —
 * caller (runner CLI hoặc test) quản lý.
 *
 * Dữ liệu: học kỳ FA26; môn PRN211/SWP391/MAE101; GV gv.demo; SV HE180001..HE180010;
 * phòng ACD-R101/ACD-R102 (training_room); lớp SE1801 (PRN211, R101, T2/T4 SLOT1, SV 1-6)
 * và SE1802 (SWP391, R102, T3/T5 SLOT2, SV 5-10); buổi học 2 tuần đầu kỳ.
 * Mật khẩu demo chung "Abcd1234@" (cùng hash với 20260720000003-SeedDemoUsers.ts).
 */
export const DEMO_PASSWORD_HASH =
  '$2b$10$szGAzI6OAO0nxSI4OSsCuuwQVvan0AJW2XjzvMlHb2VeNGgBusgm6';

async function idOf(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows: Array<{ id: string }> = await runner.query(sql, params);
  if (!rows[0]) throw new Error(`Không tìm thấy bản ghi: ${sql} ${JSON.stringify(params)}`);
  return rows[0].id;
}

async function ensureUser(runner: QueryRunner, username: string, fullName: string, position: string): Promise<string> {
  const email = `${username}@demo.savp.edu.vn`;
  await runner.query(
    `INSERT INTO users (username, email, password_hash, full_name, position_title,
                        employment_status, account_status, must_change_password)
     SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::varchar, 'active', 'active', false
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($2))`,
    [username, email, DEMO_PASSWORD_HASH, fullName, position],
  );
  return idOf(runner, `SELECT id FROM users WHERE lower(username) = lower($1) AND deleted_at IS NULL`, [username]);
}

async function ensureRoom(runner: QueryRunner, code: string, name: string): Promise<string> {
  await runner.query(
    `INSERT INTO rooms (room_code, room_name, capacity, room_type, site_name)
     SELECT $1::varchar, $2::varchar, 40, 'training_room', 'Demo Học vụ'
     WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE room_code = $1 AND deleted_at IS NULL)`,
    [code, name],
  );
  return idOf(runner, `SELECT id FROM rooms WHERE room_code = $1 AND deleted_at IS NULL`, [code]);
}

const SUBJECTS: Array<[code: string, name: string, credits: number]> = [
  ['PRN211', 'Basic Cross-Platform Application Programming With .NET', 3],
  ['SWP391', 'Software development project', 3],
  ['MAE101', 'Mathematics for Engineering', 3],
];

const STUDENT_NAMES = [
  'Nguyễn Văn An', 'Trần Thị Bình', 'Lê Hoàng Cường', 'Phạm Thu Dung', 'Hoàng Minh Đức',
  'Vũ Ngọc Hà', 'Đặng Quốc Huy', 'Bùi Thanh Lan', 'Đỗ Gia Long', 'Ngô Bảo Ngọc',
];

interface SectionPlan {
  classCode: string;
  subjectCode: string;
  roomCode: string;
  shiftCode: string;
  dates: string[];
  studentNos: number[];
}

const SECTIONS: SectionPlan[] = [
  {
    classCode: 'SE1801',
    subjectCode: 'PRN211',
    roomCode: 'ACD-R101',
    shiftCode: 'SLOT1',
    dates: ['2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16'], // T2, T4
    studentNos: [1, 2, 3, 4, 5, 6],
  },
  {
    classCode: 'SE1802',
    subjectCode: 'SWP391',
    roomCode: 'ACD-R102',
    shiftCode: 'SLOT2',
    dates: ['2026-09-08', '2026-09-10', '2026-09-15', '2026-09-17'], // T3, T5
    studentNos: [5, 6, 7, 8, 9, 10],
  },
];

export async function seedAcademicDemo(runner: QueryRunner): Promise<void> {
  // Học kỳ
  await runner.query(
    `INSERT INTO semesters (semester_code, semester_name, academic_year, start_date, end_date, status)
     SELECT 'FA26', 'Fall 2026', '2026-2027', '2026-09-07', '2026-12-20', 'ongoing'
     WHERE NOT EXISTS (SELECT 1 FROM semesters WHERE semester_code = 'FA26' AND deleted_at IS NULL)`,
  );
  const semesterId = await idOf(
    runner,
    `SELECT id FROM semesters WHERE semester_code = 'FA26' AND deleted_at IS NULL`,
    [],
  );

  // Môn học
  for (const [code, name, credits] of SUBJECTS) {
    await runner.query(
      `INSERT INTO subjects (subject_code, subject_name, credits)
       SELECT $1::varchar, $2::varchar, $3::smallint
       WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE subject_code = $1 AND deleted_at IS NULL)`,
      [code, name, credits],
    );
  }

  // Giảng viên + sinh viên (mỗi SV 1 tài khoản users — D3)
  const lecturerId = await ensureUser(runner, 'gv.demo', 'Giảng viên Demo', 'Giảng viên');
  const studentIds = new Map<number, string>();
  for (let i = 1; i <= 10; i++) {
    const code = `HE18${String(i).padStart(4, '0')}`; // HE180001..HE180010
    const userId = await ensureUser(runner, code.toLowerCase(), STUDENT_NAMES[i - 1], 'Sinh viên');
    await runner.query(
      `INSERT INTO students (user_id, student_code, cohort, major, administrative_class)
       SELECT $1::uuid, $2::varchar, 'K18', 'Kỹ thuật phần mềm', 'SE18'
       WHERE NOT EXISTS (SELECT 1 FROM students WHERE student_code = $2 AND deleted_at IS NULL)`,
      [userId, code],
    );
    studentIds.set(
      i,
      await idOf(runner, `SELECT id FROM students WHERE student_code = $1 AND deleted_at IS NULL`, [code]),
    );
  }

  // Lớp học phần + danh sách lớp + buổi học
  for (const plan of SECTIONS) {
    const roomId = await ensureRoom(runner, plan.roomCode, `Phòng học ${plan.roomCode.slice(4)}`);
    const subjectId = await idOf(
      runner,
      `SELECT id FROM subjects WHERE subject_code = $1 AND deleted_at IS NULL`,
      [plan.subjectCode],
    );
    await runner.query(
      `INSERT INTO class_sections (class_code, semester_id, subject_id, lecturer_user_id, default_room_id, max_students, status)
       SELECT $1::varchar, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 30, 'open'
       WHERE NOT EXISTS (
         SELECT 1 FROM class_sections
          WHERE semester_id = $2 AND subject_id = $3 AND class_code = $1 AND deleted_at IS NULL)`,
      [plan.classCode, semesterId, subjectId, lecturerId, roomId],
    );
    const sectionId = await idOf(
      runner,
      `SELECT id FROM class_sections
        WHERE semester_id = $1 AND subject_id = $2 AND class_code = $3 AND deleted_at IS NULL`,
      [semesterId, subjectId, plan.classCode],
    );

    for (const no of plan.studentNos) {
      await runner.query(
        `INSERT INTO class_enrollments (class_section_id, student_id)
         VALUES ($1, $2) ON CONFLICT ("class_section_id", "student_id") DO NOTHING`,
        [sectionId, studentIds.get(no)],
      );
    }

    const [shift]: Array<{ id: string; start_time: string; end_time: string }> = await runner.query(
      `SELECT id, start_time::text AS start_time, end_time::text AS end_time
         FROM study_shifts WHERE shift_code = $1 AND deleted_at IS NULL`,
      [plan.shiftCode],
    );
    if (!shift) throw new Error(`Thiếu ca ${plan.shiftCode} — chạy migration SeedStudyShifts trước`);

    for (const [idx, date] of plan.dates.entries()) {
      const { startTime, endTime } = buildSessionTimes(date, shift.start_time, shift.end_time);
      await runner.query(
        `INSERT INTO class_sessions (class_section_id, session_no, session_date, shift_id, room_id, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ("class_section_id", "session_date", "shift_id") DO NOTHING`,
        [sectionId, idx + 1, date, shift.id, roomId, startTime, endTime],
      );
    }
  }
}
```

```ts
// scripts/seed-academic-demo.ts
import { AppDataSource } from '../src/database/data-source.js';
import { seedAcademicDemo } from './academic-demo/seed-academic-demo.js';

/**
 * Nạp dữ liệu DEMO Học vụ (ACD-001 R11). Idempotent, 1 transaction.
 * Yêu cầu: đã chạy migration CreateAcademicTables + SeedStudyShifts.
 * Thực thi: npx tsx scripts/seed-academic-demo.ts
 */
async function main(): Promise<void> {
  await AppDataSource.initialize();
  const runner = AppDataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await seedAcademicDemo(runner);
    await runner.commitTransaction();
    console.log('✅ Đã nạp demo Học vụ: FA26, 3 môn, 10 SV (HE180001..10), 2 lớp, 8 buổi học.');
    console.log('   Tài khoản SV: he180001..he180010 / GV: gv.demo — mật khẩu Abcd1234@');
  } catch (err) {
    await runner.rollbackTransaction();
    throw err;
  } finally {
    await runner.release();
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 8: e2e PASS**

Run: `RUN_DB_TESTS=1 npx jest --config ./test/jest-e2e.json test/academic --runInBand`
Expected: PASS toàn bộ (schema + entities + demo).

- [ ] **Step 9: Chạy script thật 2 lần trên DB local**

Run: `npx tsx scripts/seed-academic-demo.ts && npx tsx scripts/seed-academic-demo.ts`
Expected: 2 lần đều in `✅ Đã nạp demo Học vụ...`, không lỗi. Kiểm:
```bash
set -a; . ./.env; set +a
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_DATABASE" -tAc \
  "SELECT (SELECT count(*) FROM students), (SELECT count(*) FROM class_enrollments), (SELECT count(*) FROM class_sessions)"
```
Expected: `10|12|8`.

- [ ] **Step 10: Báo thay đổi (không commit)** — `git status --short`

---

### Task 5: Cập nhật tài liệu + kiểm chứng toàn bộ

**Files:**
- Modify: `docs/SAVP_USE_CASE_TONG_HOP_2026-07-29.md` (bảng §C.2, dòng "Điểm danh phòng học" ~349)
- Modify: `docs/CAM_AI_GAP_ANALYSIS_300_CAMERAS.md` (dòng #22 ~95; phân hệ 2.7 ~119)
- Modify: `docs/ARCHITECTURE_DECISIONS.md` (ADR-004 "Bảng áp dụng soft delete")

- [ ] **Step 1: Sửa §C.2** — thay dòng:
```
| Điểm danh phòng học | Không khác phòng họp → không tạo giá trị kỹ thuật mới. |
```
bằng:
```
| ~~Điểm danh phòng học~~ | **Mở lại 2026-10-05** — triển khai theo gap analysis #22–#24. Nền schema: ACD-001 (`spec/features/academic/feat-academic-db-schema/`). |
```

- [ ] **Step 2: Sửa gap analysis** — dòng #22 thành:
```
| 22 | DB schema Học vụ | ✅ | ACD-001: 7 bảng `semesters`, `subjects`, `study_shifts`, `students`, `class_sections`, `class_enrollments`, `class_sessions` + seed 6 ca + script demo (`scripts/seed-academic-demo.ts`). Spec: `spec/features/academic/feat-academic-db-schema/`. |
```
và dòng phân hệ 2.7 thành:
```
| 2.7 Phòng học | Schema Học vụ (#22): học kỳ, môn, ca, SV, lớp học phần, danh sách lớp, buổi học | Điểm danh theo ca (#23), đồng bộ SIS (#24), báo cáo chuyên cần SV |
```

- [ ] **Step 3: Sửa ADR-004** — thêm vào CHANGELOG đầu file:
```
| 2026-10-05 | ADR-004: thêm 5 bảng Học vụ (ACD-001) vào danh sách soft delete | ADR-004 |
```
và nối vào danh sách "Bảng áp dụng soft delete":
```
, `semesters`, `subjects`, `study_shifts`, `students`, `class_sections` (ACD-001; `class_enrollments`/`class_sessions` dùng status, không soft delete — tiền lệ ADR-008)
```

- [ ] **Step 4: Kiểm chứng toàn bộ (spec §7)**

```bash
npx nest build                                                    # 1. build
npx eslint "src/modules/academic/**/*.ts" "src/database/migrations/2026100600000*.ts" "scripts/academic-demo/*.ts" "scripts/seed-academic-demo.ts" "scripts/revert-migration.ts" "test/academic/*.ts"  # 1. lint file mới
npx tsx scripts/revert-migration.ts && npx tsx scripts/revert-migration.ts  # 2. revert (sau khi xoá demo, xem ghi chú)
npx tsx scripts/run-migrations.ts                                 # 2. apply lại
RUN_DB_TESTS=1 npx jest --config ./test/jest-e2e.json test/academic --runInBand  # 3,4,6
npx jest                                                          # 5. toàn bộ unit test — không regression
```
Expected: build OK; lint không lỗi; revert/apply sạch; test academic PASS; `npx jest` số test fail **bằng đúng** số fail trước khi bắt đầu (ghi lại baseline bằng `npx jest 2>&1 | tail -5` trước Task 1).

Ghi chú revert khi đã có dữ liệu demo: `down()` của `CreateAcademicTables` DROP bảng nên vẫn chạy được; `down()` của `SeedStudyShifts` chỉ xoá ca chưa được tham chiếu (DROP bảng ở bước sau xử lý phần còn lại). User/room demo (`he1800xx`, `gv.demo`, `ACD-R10x`) KHÔNG bị xoá bởi revert — chạy lại script demo sau khi apply để có lại dữ liệu học vụ.

- [ ] **Step 5: Báo thay đổi (không commit)** — `git status --short`, liệt kê file cho người dùng.

---

## Spec coverage

| Spec | Task |
|---|---|
| R1, R2 | Task 1 (migration, chỉ CREATE) + Task 5 revert/apply |
| R3–R9 | Task 1 test + DDL |
| R10 | Task 2 |
| R11, R12 | Task 4 |
| R13, R14 | Task 3 |
| §7 kiểm chứng 1–6 | Task 5 Step 4 |
| §8 tài liệu | Task 5 Step 1–3 |
