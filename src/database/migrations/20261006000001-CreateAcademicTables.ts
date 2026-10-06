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
