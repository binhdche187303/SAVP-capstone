import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClassAttendanceRecordsAndSeedDemo20261011000002
  implements MigrationInterface
{
  name = 'CreateClassAttendanceRecordsAndSeedDemo20261011000002';

  private readonly demoPasswordHash =
    '$2b$10$szGAzI6OAO0nxSI4OSsCuuwQVvan0AJW2XjzvMlHb2VeNGgBusgm6';

  private readonly demoStudents = [
    ['SV001', 'student.demo', 'student@meetingsys.vn', 'Le Minh Sinh'],
    ['SV002', 'nam.nguyen', 'nam.nguyen@smartracking.edu.vn', 'Nguyen Hoang Nam'],
    ['SV003', 'lan.ngo', 'lan.ngo@smartracking.edu.vn', 'Ngo Thi Lan'],
    ['SV004', 'huy.do', 'huy.do@smartracking.edu.vn', 'Do Gia Huy'],
    ['SV005', 'mai.tran', 'mai.tran@smartracking.edu.vn', 'Tran Ngoc Mai'],
    ['SV006', 'anh.pham', 'anh.pham@smartracking.edu.vn', 'Pham Duc Anh'],
    ['SV007', 'thao.vo', 'thao.vo@smartracking.edu.vn', 'Vo Minh Thao'],
    ['SV008', 'khoa.le', 'khoa.le@smartracking.edu.vn', 'Le Dang Khoa'],
  ];

  private readonly classes = [
    {
      code: 'WEB101',
      subjectCode: 'WEB101',
      subjectName: 'Lap trinh Web',
      scheduleWeekday: 1,
      scheduleText: 'Thu 2, 08:00 - 10:30',
      roomText: 'Phong hoc A101',
      studentCodes: ['SV001', 'SV002', 'SV003', 'SV004', 'SV005', 'SV006', 'SV007'],
    },
    {
      code: 'AI202',
      subjectCode: 'AI202',
      subjectName: 'Tri tue nhan tao ung dung',
      scheduleWeekday: 3,
      scheduleText: 'Thu 4, 13:30 - 16:00',
      roomText: 'Phong hoc A102',
      studentCodes: ['SV001', 'SV002', 'SV003', 'SV005', 'SV006', 'SV008'],
    },
    {
      code: 'DB303',
      subjectCode: 'DB303',
      subjectName: 'Co so du lieu nang cao',
      scheduleWeekday: 5,
      scheduleText: 'Thu 6, 09:00 - 11:30',
      roomText: 'Phong hoc B203',
      studentCodes: ['SV001', 'SV003', 'SV004', 'SV005', 'SV007'],
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "class_attendance_records" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "class_section_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "attendance_date" date NOT NULL,
        "check_in_at" timestamptz,
        "check_out_at" timestamptz,
        "status" varchar(20) NOT NULL DEFAULT 'absent',
        "confidence" integer,
        "evidence_image" text,
        "source" varchar(50) NOT NULL DEFAULT 'manual',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_class_attendance_records_id" PRIMARY KEY ("id"),
        CONSTRAINT "CK_class_attendance_records_status"
          CHECK ("status" IN ('on_time', 'late', 'left', 'absent')),
        CONSTRAINT "CK_class_attendance_records_confidence"
          CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 100)),
        CONSTRAINT "FK_class_attendance_records_section" FOREIGN KEY ("class_section_id")
          REFERENCES "class_sections" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_class_attendance_records_student" FOREIGN KEY ("student_id")
          REFERENCES "students" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_class_attendance_section_student_date"
        ON "class_attendance_records" ("class_section_id", "student_id", "attendance_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_class_attendance_section_date"
        ON "class_attendance_records" ("class_section_id", "attendance_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_class_attendance_student_date"
        ON "class_attendance_records" ("student_id", "attendance_date")
    `);

    await this.seedDemoAcademicData(queryRunner);
  }

  private async seedDemoAcademicData(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO semesters (semester_code, semester_name, academic_year, start_date, end_date, status)
       SELECT 'HK1-2026-2027', 'HK1 2026-2027', '2026-2027', '2026-09-01', '2027-01-15', 'ongoing'
       WHERE NOT EXISTS (SELECT 1 FROM semesters WHERE semester_code = 'HK1-2026-2027' AND deleted_at IS NULL);`,
    );

    for (const klass of this.classes) {
      await queryRunner.query(
        `INSERT INTO subjects (subject_code, subject_name, credits, is_active)
         SELECT $1::varchar, $2::varchar, 3, true
         WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE subject_code = $1::varchar AND deleted_at IS NULL);`,
        [klass.subjectCode, klass.subjectName],
      );
    }

    for (const [code, username, email, fullName] of this.demoStudents) {
      await queryRunner.query(
        `INSERT INTO users (
           employee_code, username, email, password_hash, full_name, position_title,
           department_id, direct_manager_id, employment_status, account_status,
           must_change_password
         )
         SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::varchar, 'Sinh vien',
                COALESCE(
                  (SELECT id FROM departments WHERE department_code = 'IT'),
                  (SELECT id FROM departments ORDER BY id ASC LIMIT 1)
                ),
                NULL, 'active', 'active', false
         WHERE NOT EXISTS (
           SELECT 1 FROM users
           WHERE lower(username) = lower($2::varchar)
              OR lower(email) = lower($3::varchar)
              OR employee_code = $1::varchar
         );`,
        [code, username, email, this.demoPasswordHash, fullName],
      );

      await queryRunner.query(
        `INSERT INTO students (user_id, student_code, major, administrative_class, department_id, study_status)
         SELECT u.id, $1::varchar, 'Cong nghe thong tin', 'DHTH2026',
                COALESCE(
                  (SELECT id FROM departments WHERE department_code = 'IT'),
                  (SELECT id FROM departments ORDER BY id ASC LIMIT 1)
                ),
                'studying'
           FROM users u
          WHERE lower(u.username) = lower($2::varchar)
            AND NOT EXISTS (SELECT 1 FROM students s WHERE s.student_code = $1::varchar AND s.deleted_at IS NULL);`,
        [code, username],
      );

      await queryRunner.query(
        `INSERT INTO user_roles (user_id, role_id, assigned_by, is_active)
         SELECT u.id, r.id, NULL, true
           FROM users u, roles r
          WHERE lower(u.username) = lower($1::varchar)
            AND r.role_code = 'STUDENT'
            AND NOT EXISTS (
              SELECT 1 FROM user_roles ur
               WHERE ur.user_id = u.id AND ur.role_id = r.id AND ur.is_active = true
            );`,
        [username],
      );
    }

    for (const klass of this.classes) {
      await queryRunner.query(
        `INSERT INTO class_sections (
           class_code, semester_id, subject_id, lecturer_user_id,
           default_room_id, max_students, status, note
         )
         SELECT $1::varchar, sem.id, subj.id, teacher.id, NULL, 50, 'open', $3::text
           FROM semesters sem, subjects subj
           LEFT JOIN users teacher ON lower(teacher.username) = 'teacher.demo'
          WHERE sem.semester_code = 'HK1-2026-2027'
            AND subj.subject_code = $2::varchar
            AND NOT EXISTS (
              SELECT 1 FROM class_sections cs
               WHERE cs.class_code = $1::varchar
                 AND cs.semester_id = sem.id
                 AND cs.subject_id = subj.id
                 AND cs.deleted_at IS NULL
            );`,
        [klass.code, klass.subjectCode, `${klass.scheduleText} | ${klass.roomText}`],
      );

      for (const studentCode of klass.studentCodes) {
        await queryRunner.query(
          `INSERT INTO class_enrollments (class_section_id, student_id, status)
           SELECT cs.id, st.id, 'active'
             FROM class_sections cs
             JOIN subjects subj ON subj.id = cs.subject_id
             JOIN students st ON st.student_code = $3::varchar AND st.deleted_at IS NULL
            WHERE cs.class_code = $1::varchar
              AND subj.subject_code = $2::varchar
              AND cs.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM class_enrollments ce
                 WHERE ce.class_section_id = cs.id AND ce.student_id = st.id
              );`,
          [klass.code, klass.subjectCode, studentCode],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "class_attendance_records"`);
  }
}
