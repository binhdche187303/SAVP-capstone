import { MigrationInterface, QueryRunner } from 'typeorm';

export class LocalizeGuardRoleName20261008000001
  implements MigrationInterface
{
  name = 'LocalizeGuardRoleName20261008000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE roles
       SET role_name = 'Bảo vệ',
           description = 'Vai trò bảo vệ dùng cho dashboard trực cổng và xử lý cảnh báo ra vào.'
       WHERE role_code = 'GUARD';`,
    );

    await queryRunner.query(
      `UPDATE users
       SET full_name = 'Nguyễn Văn Bảo Vệ',
           position_title = 'Nhân viên bảo vệ'
       WHERE username = 'guard.demo';`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE users
       SET full_name = 'Nguyen Van Bao Ve',
           position_title = 'Nhan vien bao ve'
       WHERE username = 'guard.demo';`,
    );

    await queryRunner.query(
      `UPDATE roles
       SET role_name = 'Bao ve',
           description = 'Vai tro bao ve dung cho dashboard truc cong va xu ly canh bao ra vao.'
       WHERE role_code = 'GUARD';`,
    );
  }
}
