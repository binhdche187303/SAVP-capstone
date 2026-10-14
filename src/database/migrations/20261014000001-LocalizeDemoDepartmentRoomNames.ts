import { MigrationInterface, QueryRunner } from 'typeorm';

export class LocalizeDemoDepartmentRoomNames20261014000001
  implements MigrationInterface
{
  name = 'LocalizeDemoDepartmentRoomNames20261014000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const departments: Array<[string, string, string]> = [
      ['BOD', 'Ban Giám đốc', 'Ban điều hành công ty (demo seed data)'],
      [
        'IT',
        'Phòng Công nghệ thông tin',
        'Phát triển và vận hành hệ thống (demo seed data)',
      ],
      ['HR', 'Phòng Nhân sự', 'Tuyển dụng và quản lý nhân sự (demo seed data)'],
      [
        'SALES',
        'Phòng Kinh doanh',
        'Kinh doanh và chăm sóc khách hàng (demo seed data)',
      ],
      [
        'ADM',
        'Phòng Hành chính - Lễ tân',
        'Hành chính văn phòng, lễ tân (demo seed data)',
      ],
      [
        'FAC',
        'Phòng Vận hành - Cơ sở vật chất',
        'Quản lý phòng họp, thiết bị, cơ sở vật chất (demo seed data)',
      ],
    ];

    for (const [code, name, description] of departments) {
      await queryRunner.query(
        `UPDATE departments
         SET department_name = $2, description = $3
         WHERE department_code = $1;`,
        [code, name, description],
      );
    }

    const rooms: Array<[string, string, string, string]> = [
      ['RM-A101', 'Phòng họp A101', 'Tòa nhà A', 'Tầng 1'],
      ['RM-A102', 'Phòng họp A102', 'Tòa nhà A', 'Tầng 1'],
      ['RM-A201', 'Phòng đào tạo A201', 'Tòa nhà A', 'Tầng 2'],
      ['RM-B301', 'Phòng họp Ban Giám đốc B301', 'Tòa nhà B', 'Tầng 3'],
      ['RM-B302', 'Phòng họp nhỏ B302', 'Tòa nhà B', 'Tầng 3'],
      ['RM-C401', 'Phòng họp C401', 'Tòa nhà C', 'Tầng 4'],
    ];

    for (const [code, name, site, area] of rooms) {
      await queryRunner.query(
        `UPDATE rooms
         SET room_name = $2, site_name = $3, area_name = $4
         WHERE room_code = $1;`,
        [code, name, site, area],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const departments: Array<[string, string, string]> = [
      ['BOD', 'Ban Giam doc', 'Ban dieu hanh cong ty (demo seed data)'],
      [
        'IT',
        'Phong Cong nghe thong tin',
        'Phat trien va van hanh he thong (demo seed data)',
      ],
      ['HR', 'Phong Nhan su', 'Tuyen dung va quan ly nhan su (demo seed data)'],
      [
        'SALES',
        'Phong Kinh doanh',
        'Kinh doanh va cham soc khach hang (demo seed data)',
      ],
      [
        'ADM',
        'Phong Hanh chinh - Le tan',
        'Hanh chinh van phong, le tan (demo seed data)',
      ],
      [
        'FAC',
        'Phong Van hanh - Co so vat chat',
        'Quan ly phong hop, thiet bi, co so vat chat (demo seed data)',
      ],
    ];

    for (const [code, name, description] of departments) {
      await queryRunner.query(
        `UPDATE departments
         SET department_name = $2, description = $3
         WHERE department_code = $1;`,
        [code, name, description],
      );
    }

    const rooms: Array<[string, string, string, string]> = [
      ['RM-A101', 'Phong hop A101', 'Toa nha A', 'Tang 1'],
      ['RM-A102', 'Phong hop A102', 'Toa nha A', 'Tang 1'],
      ['RM-A201', 'Phong dao tao A201', 'Toa nha A', 'Tang 2'],
      ['RM-B301', 'Phong hop Ban Giam doc B301', 'Toa nha B', 'Tang 3'],
      ['RM-B302', 'Phong hop nho B302', 'Toa nha B', 'Tang 3'],
      ['RM-C401', 'Phong hop C401', 'Toa nha C', 'Tang 4'],
    ];

    for (const [code, name, site, area] of rooms) {
      await queryRunner.query(
        `UPDATE rooms
         SET room_name = $2, site_name = $3, area_name = $4
         WHERE room_code = $1;`,
        [code, name, site, area],
      );
    }
  }
}
