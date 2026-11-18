import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Validate,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { NoEmojiOrControlConstraint } from '../validators/no-emoji-or-control.validator.js';

/**
 * UpdateDepartmentDto (BE-08) — PATCH /departments/:id.
 *
 * KHÔNG cho sửa `departmentCode` (mã định danh) — nếu team muốn cho sửa thì
 * phải là UC riêng, có cân nhắc ảnh hưởng tới các bảng tham chiếu bằng mã.
 *
 * KHÔNG dùng `@Validate(IsDepartmentNameUniqueConstraint)` ở đây (khác
 * `CreateDepartmentDto`): validator đó không loại trừ được chính bản ghi
 * đang sửa, nên PATCH gửi lại đúng tên hiện tại (không đổi) sẽ bị từ chối
 * nhầm là trùng. Tính duy nhất tên khi update được kiểm tra trong
 * `DepartmentsService.updateDepartment()` với điều kiện loại trừ `id` hiện tại.
 *
 * BREAKING CHANGE (2026-08-12, ACCT-DEPT-DEACTIVATE-001):
 * Field `isActive` đã bị XÓA khỏi DTO này. Việc bật/tắt phòng ban nay
 * được thực hiện qua POST /departments/:id/deactivate và /reactivate.
 * Gửi `isActive` trong PATCH body sẽ nhận 400 (forbidNonWhitelisted).
 */
export class UpdateDepartmentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString({ message: 'Tên phòng ban phải là chuỗi ký tự' })
  @Length(2, 150, { message: 'Tên phòng ban phải từ 2 đến 150 ký tự' })
  @Validate(NoEmojiOrControlConstraint, {
    message: 'Tên phòng ban chứa ký tự không hợp lệ (emoji, ký tự điều khiển)',
  })
  departmentName?: string;

  @IsOptional()
  @IsUUID('4', { message: 'ID phòng ban cha phải là định dạng UUID' })
  parentDepartmentId?: string | null;

  @IsOptional()
  @IsUUID('4', { message: 'ID người quản lý phải là định dạng UUID' })
  managerUserId?: string | null;

  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }
    return value;
  })
  @IsOptional()
  @IsString({ message: 'Mô tả phòng ban phải là chuỗi ký tự' })
  description?: string | null;
}
