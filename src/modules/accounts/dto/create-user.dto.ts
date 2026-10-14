import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsUUID,
  IsArray,
  ArrayNotEmpty,
  IsOptional,
  IsIn,
  IsDateString,
  ValidateIf,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateUserDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  @IsString({ message: 'Họ tên phải là chuỗi ký tự' })
  @MaxLength(255, { message: 'Họ tên không được vượt quá 255 ký tự' })
  fullName: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  @MaxLength(255, { message: 'Email không được vượt quá 255 ký tự' })
  email: string;

  // departmentId vẫn BẮT BUỘC cho tài khoản nhân viên thường (accountType mặc định/'employee').
  // Chỉ bỏ qua khi tạo tài khoản đối tác (accountType='partner') — server luôn override
  // bằng PARTNER_DEPARTMENT_ID bất kể client gửi gì (xem UsersService.createUser()).
  @ValidateIf(
    (o: CreateUserDto) =>
      o.accountType !== 'partner' && o.accountType !== 'student',
  )
  @IsNotEmpty({ message: 'ID phòng ban không được để trống' })
  @IsUUID('4', { message: 'ID phòng ban phải là định dạng UUID' })
  departmentId?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((o: CreateUserDto) => o.accountType === 'student')
  @IsNotEmpty({ message: 'Lớp hành chính không được để trống' })
  @IsString({ message: 'Lớp hành chính phải là chuỗi ký tự' })
  @MaxLength(50, { message: 'Lớp hành chính không được vượt quá 50 ký tự' })
  administrativeClass?: string;

  // roleIds vẫn BẮT BUỘC cho tài khoản nhân viên thường. Bỏ qua khi tạo tài
  // khoản đối tác (accountType='partner') — server luôn ép role EMPLOYEE bất
  // kể client gửi gì (xem UsersService.createUser()), vì FE không (và không
  // nên) hiển thị ô chọn role cho form tạo đối tác.
  @ValidateIf((o: CreateUserDto) => o.accountType !== 'partner')
  @IsNotEmpty({ message: 'Danh sách vai trò không được để trống' })
  @IsArray({ message: 'Danh sách vai trò phải là mảng' })
  @ArrayNotEmpty({ message: 'Danh sách vai trò không được rỗng' })
  @IsUUID('4', {
    each: true,
    message: 'Mỗi vai trò trong danh sách phải là định dạng UUID',
  })
  roleIds?: string[];

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

  @IsOptional()
  @IsString({ message: 'Chức danh phải là chuỗi ký tự' })
  @MaxLength(150, { message: 'Chức danh không được vượt quá 150 ký tự' })
  positionTitle?: string;

  @IsOptional()
  @IsUUID('4', { message: 'ID người quản lý phải là định dạng UUID' })
  directManagerId?: string;

  @IsOptional()
  @IsIn(['employee', 'student', 'partner'], {
    message: 'Loại tài khoản phải là employee, student hoặc partner',
  })
  accountType?: 'employee' | 'student' | 'partner';

  @IsOptional()
  @IsDateString(
    {},
    { message: 'accountExpiresAt phải là thời điểm hợp lệ (ISO 8601)' },
  )
  accountExpiresAt?: string;
}
