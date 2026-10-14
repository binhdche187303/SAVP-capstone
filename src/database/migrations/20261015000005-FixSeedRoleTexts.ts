import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tên/mô tả 4 vai trò lõi được seed không dấu và kèm chú thích "(demo seed data)"
 * (xem 20260720000002-SeedCoreRoles.ts) — hiển thị thẳng ở trang Vai trò & Phân quyền.
 * Chỉ cập nhật khi giá trị vẫn đúng như bản seed cũ để không ghi đè chỉnh sửa của người dùng.
 */
export class FixSeedRoleTexts20261015000005 implements MigrationInterface {
  name = 'FixSeedRoleTexts20261015000005';

  private readonly roles: Array<{
    code: string;
    oldName: string;
    oldDescription: string;
    name: string;
    description: string;
  }> = [
    {
      code: 'SYSTEM_ADMIN',
      oldName: 'Quan tri he thong',
      oldDescription:
        'Toan quyen tren toan bo he thong, khong gioi han theo phong ban (demo seed data)',
      name: 'Quản trị hệ thống',
      description:
        'Toàn quyền trên toàn bộ hệ thống, không giới hạn theo phòng ban',
    },
    {
      code: 'BUSINESS_ADMIN',
      oldName: 'Quan tri nghiep vu',
      oldDescription:
        'Quan tri trong pham vi phong ban duoc giao (demo seed data)',
      name: 'Quản trị nghiệp vụ',
      description: 'Quản trị trong phạm vi phòng ban được giao',
    },
    {
      code: 'MANAGER',
      oldName: 'Truong nhom / Quan ly',
      oldDescription:
        'Quan ly nhan su truc thuoc, duyet yeu cau, xem bao cao (demo seed data)',
      name: 'Trưởng nhóm / Quản lý',
      description: 'Quản lý nhân sự trực thuộc, duyệt yêu cầu, xem báo cáo',
    },
    {
      code: 'EMPLOYEE',
      oldName: 'Nhan vien',
      oldDescription:
        'Nguoi dung noi bo thong thuong, tao va tham gia cuoc hop (demo seed data)',
      name: 'Nhân viên',
      description: 'Người dùng nội bộ thông thường, tạo và tham gia cuộc họp',
    },
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const r of this.roles) {
      await q.query(
        `UPDATE roles SET role_name = $2 WHERE role_code = $1 AND role_name = $3;`,
        [r.code, r.name, r.oldName],
      );
      await q.query(
        `UPDATE roles SET description = $2 WHERE role_code = $1 AND description = $3;`,
        [r.code, r.description, r.oldDescription],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const r of this.roles) {
      await q.query(
        `UPDATE roles SET role_name = $2 WHERE role_code = $1 AND role_name = $3;`,
        [r.code, r.oldName, r.name],
      );
      await q.query(
        `UPDATE roles SET description = $2 WHERE role_code = $1 AND description = $3;`,
        [r.code, r.oldDescription, r.description],
      );
    }
  }
}
