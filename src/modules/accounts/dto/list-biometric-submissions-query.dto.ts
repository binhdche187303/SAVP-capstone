import type { FilterSelection } from '../../../common/utils/filter-selection.js';
import {
  IsIn,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsUUID,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

const SORT_BY_WHITELIST = [
  'submittedAt',
  'userFullName',
  'employeeCode',
  'departmentName',
  'status',
  'qualityScore',
] as const;
// [2026-11-23] Hậu kiểm: thêm 'revoked' (Bị gỡ) và 'all' (mọi hồ sơ).
const STATUS_FILTER_VALUES = [
  'pending_review',
  'rejected',
  'active',
  'revoked',
  'all',
] as const;
const ROLE_FILTER_VALUES = [
  'SYSTEM_ADMIN',
  'BUSINESS_ADMIN',
  'MANAGER',
  'EMPLOYEE',
  'TEACHER',
  'STUDENT',
  'GUARD',
] as const;

export class ListBiometricSubmissionsQueryDto {
  @IsOptional()
  @IsIn(STATUS_FILTER_VALUES, {
    each: true,
    message:
      'status must be one of: pending_review, rejected, active, revoked, all',
  })
  status?: FilterSelection<string>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100, {
    message: 'limit must not exceed 100',
  })
  limit?: number = 20;

  @IsOptional()
  @IsIn(SORT_BY_WHITELIST, {
    message:
      'sortBy must be one of: submittedAt, userFullName, employeeCode, departmentName, status, qualityScore',
  })
  sortBy?: string;

  @IsOptional()
  @Matches(/^(asc|desc)$/i, {
    message: 'sortOrder must be asc or desc',
  })
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, {
    message: 'search query must be at least 2 characters',
  })
  @MaxLength(100, {
    message: 'search query must not exceed 100 characters',
  })
  q?: string;

  @IsOptional()
  @IsUUID('4', {
    each: true,
    message: 'departmentId must be a valid UUID',
  })
  departmentId?: FilterSelection<string>;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(ROLE_FILTER_VALUES, {
    each: true,
    message:
      'role must be one of: SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER, EMPLOYEE, TEACHER, STUDENT, GUARD',
  })
  role?: FilterSelection<string>;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(100, {
    each: true,
    message: 'classId must not exceed 100 characters',
  })
  classId?: FilterSelection<string>;

  /** [2026-11-23] Lọc theo ngày đăng ký (enrolled_at), YYYY-MM-DD, bao gồm 2 đầu. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate?: string;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'toDate must be YYYY-MM-DD' })
  toDate?: string;
}
