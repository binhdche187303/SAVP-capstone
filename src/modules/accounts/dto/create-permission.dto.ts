import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { MODULE_CODE_ALLOWLIST } from '../constants/permission-module-allowlist.constant.js';

const PERMISSION_CODE_REGEX = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

export class CreatePermissionDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString({ message: 'permissionCode phải là chuỗi ký tự' })
  @Matches(PERMISSION_CODE_REGEX, {
    message:
      'permissionCode không đúng định dạng: chỉ chấp nhận chữ thường, số, underscore, dấu chấm và có ít nhất một dấu chấm',
  })
  @MaxLength(120, { message: 'permissionCode không được vượt quá 120 ký tự' })
  permissionCode: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty()
  @IsString({ message: 'permissionName phải là chuỗi ký tự' })
  @MaxLength(150, { message: 'permissionName không được vượt quá 150 ký tự' })
  permissionName: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString({ message: 'moduleCode phải là chuỗi ký tự' })
  @MaxLength(80, { message: 'moduleCode không được vượt quá 80 ký tự' })
  @IsIn(MODULE_CODE_ALLOWLIST, {
    message: 'moduleCode không hợp lệ hoặc chưa được hỗ trợ',
  })
  moduleCode: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsNotEmpty()
  @IsString({ message: 'actionCode phải là chuỗi ký tự' })
  @MaxLength(80, { message: 'actionCode không được vượt quá 80 ký tự' })
  actionCode: string;

  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }
    return value ?? null;
  })
  @IsOptional()
  @IsString({ message: 'description phải là chuỗi ký tự' })
  description?: string | null;
}
