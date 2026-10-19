import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthzReadRepository } from '../repositories/authz-read.repository.js';

export interface GetMeResponseDto {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  accountStatus: string;
  mustChangePassword: boolean;
  departmentId: string | null;
  departmentName: string | null;
  isUnitClerk: boolean;
  leadershipTitle: string | null;
  roles: Array<{ id: string; roleCode: string; roleName: string }>;
  permissions: string[];
}

@Injectable()
export class GetMeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authzReadRepository: AuthzReadRepository,
  ) {}

  async getMe(userId: string): Promise<GetMeResponseDto> {
    const rows = await this.dataSource.query(
      `
      SELECT
        u.id, u.email, u.full_name, u.avatar_url, u.account_status,
        u.must_change_password, u.department_id, u.is_unit_clerk, u.leadership_title,
        d.department_name,
        r.id AS role_id, r.role_code, r.role_name
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id AND d.deleted_at IS NULL
      LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = $1 AND u.deleted_at IS NULL
      `,
      [userId],
    );

    if (!rows || rows.length === 0) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy tài khoản.',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    const first = rows[0];
    const roles = rows
      .filter((row: Record<string, unknown>) => row.role_id)
      .map((row: Record<string, unknown>) => ({
        id: row.role_id as string,
        roleCode: row.role_code as string,
        roleName: row.role_name as string,
      }));

    const { permissions } =
      await this.authzReadRepository.getEffectiveRolesAndPermissions(userId);

    return {
      id: first.id as string,
      email: first.email as string,
      fullName: first.full_name as string,
      avatarUrl: (first.avatar_url as string) ?? null,
      accountStatus: first.account_status as string,
      mustChangePassword: !!first.must_change_password,
      departmentId: (first.department_id as string) ?? null,
      departmentName: (first.department_name as string) ?? null,
      isUnitClerk: !!first.is_unit_clerk,
      leadershipTitle: (first.leadership_title as string) ?? null,
      roles,
      permissions,
    };
  }
}
