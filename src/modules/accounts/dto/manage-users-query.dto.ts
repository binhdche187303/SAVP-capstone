import type { FilterSelection } from '../../../common/utils/filter-selection.js';
import {
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * UC-14 — Query lọc danh sách tài khoản (endpoint quản trị GET /users/manage).
 *
 * Tất cả filter optional, kết hợp AND. sortBy dùng allowlist @IsIn (chống inject
 * field); service map sang cột thật qua SORT_MAP. KHÔNG dùng cho GET /users (autocomplete).
 */
export class ManageUsersQueryDto {
  @IsOptional()
  @IsUUID('4', { each: true, message: 'departmentId phải là định dạng UUID' })
  departmentId?: FilterSelection<string>;

  @IsOptional()
  @IsUUID('4', { each: true, message: 'roleId phải là định dạng UUID' })
  roleId?: FilterSelection<string>;

  @IsOptional()
  @IsIn(['staff', 'student'], { each: true,
    message: 'accountType chỉ được là staff hoặc student',
  })
  accountType?: FilterSelection<'staff' | 'student'>;

  @IsOptional()
  @IsString({ each: true, message: 'classId phải là chuỗi ký tự' })
  @MaxLength(100, { each: true, message: 'classId không được vượt quá 100 ký tự' })
  classId?: FilterSelection<string>;

  // 'expired' là giá trị filter ảo (không phải giá trị DB thật của account_status):
  // tài khoản đối tác accountStatus='active' nhưng accountExpiresAt đã qua — xem
  // listUsersForManagement().
  @IsOptional()
  @IsIn(['active', 'inactive', 'locked', 'pending_reset', 'expired'], { each: true,
    message:
      'accountStatus chỉ được là active, inactive, locked, pending_reset hoặc expired',
  })
  accountStatus?: FilterSelection<string>;

  @IsOptional()
  @IsString({ message: 'search phải là chuỗi ký tự' })
  search?: string;

  @IsOptional()
  @IsIn(['fullName', 'email', 'employeeCode', 'accountStatus', 'createdAt'], {
    message:
      'sortBy chỉ được là fullName, email, employeeCode, accountStatus hoặc createdAt',
  })
  sortBy?: string = 'fullName';

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sortOrder chỉ được là asc hoặc desc' })
  sortOrder?: 'asc' | 'desc' = 'asc';

  @Type(() => Number)
  @IsOptional()
  @Min(1, { message: 'page phải lớn hơn hoặc bằng 1' })
  page?: number = 1;

  @Type(() => Number)
  @IsOptional()
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng 1' })
  @Max(100, { message: 'limit không được vượt quá 100' })
  limit?: number = 20;
}
