import { ApiProperty } from '@nestjs/swagger';

/**
 * UC-14 — Item trong danh sách tài khoản (endpoint quản trị GET /users/manage).
 * Giàu hơn UserListItemDto (autocomplete): kèm trạng thái, phòng ban, vai trò.
 */
export class ManageUserItemDto {
  @ApiProperty({ description: 'UUID người dùng' })
  id: string;

  @ApiProperty({ description: 'Họ tên đầy đủ' })
  fullName: string;

  @ApiProperty({ description: 'Email' })
  email: string;

  @ApiProperty({ description: 'Mã nhân viên', nullable: true })
  employeeCode: string | null;

  @ApiProperty({ description: 'Mã sinh viên', required: false, nullable: true })
  studentCode?: string | null;

  @ApiProperty({ description: 'Lớp hành chính', required: false, nullable: true })
  administrativeClass?: string | null;

  @ApiProperty({ description: 'Trạng thái tài khoản' })
  accountStatus: string;

  @ApiProperty({ description: 'UUID phòng ban', nullable: true })
  departmentId: string | null;

  @ApiProperty({
    description: 'Danh sách mã vai trò (roleCode) đang active',
    type: [String],
  })
  roles: string[];

  @ApiProperty({
    description: 'Đường dẫn ảnh đại diện của người dùng',
    example: 'https://storage.example.com/avatars/user.jpg',
    required: false,
    nullable: true,
  })
  avatarUrl?: string | null;

  @ApiProperty({
    description: 'Số điện thoại của người dùng',
    example: '0901234567',
    required: false,
    nullable: true,
  })
  phoneNumber?: string | null;

  @ApiProperty({
    description:
      'Hạn sử dụng tài khoản (chỉ có giá trị với tài khoản đối tác/khách, ISO 8601)',
    required: false,
    nullable: true,
  })
  accountExpiresAt?: string | null;

  @ApiProperty({ description: 'Chức danh Ban Giám hiệu (nếu có)', required: false, nullable: true })
  leadershipTitle?: string | null;
}
