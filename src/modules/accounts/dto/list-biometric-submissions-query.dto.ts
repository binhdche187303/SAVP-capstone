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

const STATUS_FILTER_VALUES = ['pending_review', 'rejected', 'active'] as const;
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
    message: 'status must be one of: pending_review, rejected, active',
  })
  status?: string;

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
    message: 'departmentId must be a valid UUID',
  })
  departmentId?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(ROLE_FILTER_VALUES, {
    message:
      'role must be one of: SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER, EMPLOYEE, TEACHER, STUDENT, GUARD',
  })
  role?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(100, {
    message: 'classId must not exceed 100 characters',
  })
  classId?: string;
}
