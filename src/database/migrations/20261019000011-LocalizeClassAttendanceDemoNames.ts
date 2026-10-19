import { MigrationInterface, QueryRunner } from 'typeorm';

export class LocalizeClassAttendanceDemoNames20261019000011 implements MigrationInterface {
  name = 'LocalizeClassAttendanceDemoNames20261019000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE subjects
         SET subject_name = CASE subject_code
           WHEN 'WEB101' THEN 'Lập trình Web'
           WHEN 'AI202' THEN 'Trí tuệ nhân tạo ứng dụng'
           WHEN 'DB303' THEN 'Cơ sở dữ liệu nâng cao'
           ELSE subject_name
         END
       WHERE subject_code IN ('WEB101', 'AI202', 'DB303')
         AND deleted_at IS NULL
    `);

    await queryRunner.query(`
      UPDATE class_sections
         SET note = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(note,
           'Thu 2', 'Thứ 2'), 'Thu 4', 'Thứ 4'), 'Thu 6', 'Thứ 6'),
           'Phong hoc A101', 'Phòng học A101'), 'Phong hoc A102', 'Phòng học A102'),
           'Phong hoc B203', 'Phòng học B203')
       WHERE class_code IN ('WEB101-01', 'AI202-01', 'DB303-01')
         AND deleted_at IS NULL
    `);

    await queryRunner.query(`
      UPDATE users
         SET full_name = CASE lower(username)
           WHEN 'student.demo' THEN 'Lê Minh Sinh'
           WHEN 'nam.nguyen' THEN 'Nguyễn Hoàng Nam'
           WHEN 'lan.ngo' THEN 'Ngô Thị Lan'
           WHEN 'huy.do' THEN 'Đỗ Gia Huy'
           WHEN 'mai.tran' THEN 'Trần Ngọc Mai'
           WHEN 'anh.pham' THEN 'Phạm Đức Anh'
           WHEN 'thao.vo' THEN 'Võ Minh Thảo'
           WHEN 'khoa.le' THEN 'Lê Đăng Khoa'
           ELSE full_name
         END
       WHERE lower(username) IN ('student.demo', 'nam.nguyen', 'lan.ngo', 'huy.do', 'mai.tran', 'anh.pham', 'thao.vo', 'khoa.le')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE subjects
         SET subject_name = CASE subject_code
           WHEN 'WEB101' THEN 'Lap trinh Web'
           WHEN 'AI202' THEN 'Tri tue nhan tao ung dung'
           WHEN 'DB303' THEN 'Co so du lieu nang cao'
           ELSE subject_name
         END
       WHERE subject_code IN ('WEB101', 'AI202', 'DB303')
         AND deleted_at IS NULL
    `);
  }
}
