import {
  IsString,
  IsUUID,
  IsOptional,
  IsDateString,
  MaxLength,
  Matches,
  IsBoolean,
  IsIn,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * UC-09 — Cập nhật thông tin tài khoản nhân sự (partial update).
 *
 * Chỉ 5 trường hồ sơ được phép cập nhật: fullName, employeeCode, phoneNumber,
 * positionTitle, departmentId. Tất cả optional (chỉ gửi trường muốn đổi).
 *
 * KHÔNG có: email (bất biến), directManagerId, roleIds, accountStatus, username,
 * avatarUrl — các trường này thuộc UC/luồng khác. Controller áp
 * whitelist + forbidNonWhitelisted nên trường ngoài danh sách -> HTTP 400.
 */
export class UpdateUserDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString({ message: 'Họ tên phải là chuỗi ký tự' })
  @MaxLength(255, { message: 'Họ tên không được vượt quá 255 ký tự' })
  fullName?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString({ message: 'Mã nhân viên phải là chuỗi ký tự' })
  @MaxLength(50, { message: 'Mã nhân viên không được vượt quá 50 ký tự' })
  employeeCode?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự' })
  @Matches(/^[\d\s+\-()]*$/, {
    message:
      'Số điện thoại chỉ được chứa chữ số, khoảng trắng, dấu cộng, dấu gạch ngang và dấu ngoặc đơn',
  })
  @MaxLength(30, { message: 'Số điện thoại không được vượt quá 30 ký tự' })
  phoneNumber?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString({ message: 'Chức danh phải là chuỗi ký tự' })
  @MaxLength(150, { message: 'Chức danh không được vượt quá 150 ký tự' })
  positionTitle?: string;

  @IsOptional()
  @IsUUID('4', { message: 'ID phòng ban phải là định dạng UUID' })
  departmentId?: string;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'accountExpiresAt phải là thời điểm hợp lệ (ISO 8601)' },
  )
  accountExpiresAt?: string;

  /** Lịch tuần UEL: văn thư của đơn vị (cần quyền meeting.calendar_role.manage). */
  @IsOptional()
  @IsBoolean({ message: 'isUnitClerk phải là true/false' })
  isUnitClerk?: boolean;

  /** Lịch tuần UEL: chức danh Ban Giám hiệu; null = gỡ (cần quyền meeting.calendar_role.manage). */
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsIn(['HIEU_TRUONG', 'PHO_HIEU_TRUONG', 'BI_THU', 'PHO_BI_THU'], {
    message: 'Chức danh lãnh đạo không hợp lệ',
  })
  leadershipTitle?: string | null;
}
