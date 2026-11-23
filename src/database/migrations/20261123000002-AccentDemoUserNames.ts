import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccentDemoUserNames20261123000002 implements MigrationInterface {
  name = 'AccentDemoUserNames20261123000002';

  private readonly names = [
    ['manager.it', 'Nguyen Hoang Nam', 'Nguyễn Hoàng Nam'],
    ['manager.hr', 'Do Thi Hong', 'Đỗ Thị Hồng'],
    ['manager.sales', 'Vu Anh Tuan', 'Vũ Anh Tuấn'],
    ['emp.it1', 'Bui Van Long', 'Bùi Văn Long'],
    ['emp.it2', 'Ngo Thi Lan', 'Ngô Thị Lan'],
    ['emp.hr1', 'Hoang Thi Mai', 'Hoàng Thị Mai'],
    ['emp.hr2', 'Dang Van Kien', 'Đặng Văn Kiên'],
    ['emp.sales1', 'Trinh Thi Thu', 'Trịnh Thị Thu'],
    ['emp.sales2', 'Phan Van Dat', 'Phan Văn Đạt'],
    ['emp.admin1', 'Ly Thi Ngoc', 'Lý Thị Ngọc'],
    ['emp.facility1', 'Dinh Van Hung', 'Đinh Văn Hùng'],
    ['teacher.demo', 'Nguyen Thi Giang', 'Nguyễn Thị Giang'],
    ['student.demo', 'Le Minh Sinh', 'Lê Minh Sinh'],
    ['guard.demo', 'Nguyen Van Bao Ve', 'Nguyễn Văn Bảo Vệ'],
  ];

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [username, previous, accented] of this.names) {
      await queryRunner.query(
        'UPDATE users SET full_name = $1 WHERE username = $2 AND full_name = $3',
        [accented, username, previous],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [username, previous, accented] of this.names) {
      await queryRunner.query(
        'UPDATE users SET full_name = $1 WHERE username = $2 AND full_name = $3',
        [previous, username, accented],
      );
    }
  }
}
