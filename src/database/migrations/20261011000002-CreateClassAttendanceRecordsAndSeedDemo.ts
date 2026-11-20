import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClassAttendanceRecordsAndSeedDemo20261011000002 implements MigrationInterface {
  name = 'CreateClassAttendanceRecordsAndSeedDemo20261011000002';

  private readonly demoPasswordHash =
    '$2b$10$szGAzI6OAO0nxSI4OSsCuuwQVvan0AJW2XjzvMlHb2VeNGgBusgm6';

  private readonly demoStudents = [
    ['SV001', 'student.demo', 'student@meetingsys.vn', 'Lê Minh Sinh'],
    [
      'SV002',
      'nam.nguyen',
      'nam.nguyen@smartracking.edu.vn',
      'Nguyễn Hoàng Nam',
    ],
    ['SV003', 'lan.ngo', 'lan.ngo@smartracking.edu.vn', 'Ngô Thị Lan'],
    ['SV004', 'huy.do', 'huy.do@smartracking.edu.vn', 'Đỗ Gia Huy'],
    ['SV005', 'mai.tran', 'mai.tran@smartracking.edu.vn', 'Trần Ngọc Mai'],
    ['SV006', 'anh.pham', 'anh.pham@smartracking.edu.vn', 'Phạm Đức Anh'],
    ['SV007', 'thao.vo', 'thao.vo@smartracking.edu.vn', 'Võ Minh Thảo'],
    ['SV008', 'khoa.le', 'khoa.le@smartracking.edu.vn', 'Lê Đăng Khoa'],
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

    await this.seedDemoStudentAccounts(queryRunner);
  }

  /** Chỉ giữ tài khoản SV demo; lớp/môn/học kỳ demo đã gỡ (dùng dữ liệu UEL). */
  private async seedDemoStudentAccounts(queryRunner: QueryRunner): Promise<void> {
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "class_attendance_records"`);
  }
}
