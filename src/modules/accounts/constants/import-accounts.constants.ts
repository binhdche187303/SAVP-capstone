/**
 * Constants cho tính năng Tạo tài khoản nhân viên bằng import Excel.
 * Feature: ACCT-IMPORT-ACCOUNT-001 (UC-AM-02)
 */

export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024; // 2MB

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Sinh trắc học kèm import hàng loạt (tùy chọn) — mỗi ảnh khớp theo tên file =
 * employee_code (không phân biệt hoa/thường, bỏ phần đuôi mở rộng).
 * Giới hạn kích thước giống luồng tự nộp (`biometric-submission.service.ts`).
 */
export const MAX_BIOMETRIC_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Ảnh sinh trắc học kèm import cũng có thể gửi gộp trong 1 file .zip (thay vì
 * nhiều file rời) — mỗi entry trong zip khớp theo tên (không phần đuôi) y hệt
 * luồng `photos[]`. Giới hạn riêng cho zip (khác MAX_IMPORT_FILE_BYTES của .xlsx).
 */
export const MAX_PHOTOS_ZIP_BYTES = 100 * 1024 * 1024; // 100MB (nén)
export const MAX_PHOTOS_ZIP_TOTAL_UNCOMPRESSED_BYTES = 250 * 1024 * 1024; // chặn zip bomb

export const ROLE_CODES_SEPARATOR = ';';

/**
 * Header chuẩn của template (đúng thứ tự cột trong sheet đầu tiên).
 * `license_plate` (VPT-IMPORT-001): tùy chọn — biển số xe của nhân viên.
 */
export const IMPORT_ACCOUNTS_HEADERS = [
  'full_name',
  'email',
  'department_code',
  'role_codes',
  'employee_code',
  'phone_number',
  'position_title',
  'direct_manager_email',
  'license_plate',
] as const;

export enum ImportAccountMode {
  PREVIEW = 'preview',
  COMMIT = 'commit',
}

export enum ImportAccountRowStatus {
  VALID = 'valid',
  INVALID = 'invalid',
  SUCCESS = 'success',
  FAILED = 'failed',
}

/**
 * Mã lỗi cấp dòng.
 */
export enum ImportAccountRowReason {
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_EMAIL = 'INVALID_EMAIL',
  DUPLICATE_IN_FILE = 'DUPLICATE_IN_FILE',
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  EMPLOYEE_CODE_ALREADY_EXISTS = 'EMPLOYEE_CODE_ALREADY_EXISTS',
  DEPARTMENT_NOT_FOUND = 'DEPARTMENT_NOT_FOUND',
  ROLE_NOT_FOUND = 'ROLE_NOT_FOUND',
  MANAGER_NOT_FOUND = 'MANAGER_NOT_FOUND',
}

/**
 * Mã lỗi cấp request (toàn file).
 */
export enum ImportAccountRequestError {
  INVALID_FILE_FORMAT = 'INVALID_FILE_FORMAT',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_TEMPLATE = 'INVALID_TEMPLATE',
  IMPORT_ROW_LIMIT_EXCEEDED = 'IMPORT_ROW_LIMIT_EXCEEDED',
  BIOMETRIC_CONSENT_REQUIRED = 'BIOMETRIC_CONSENT_REQUIRED',
  INVALID_PHOTOS_ZIP = 'INVALID_PHOTOS_ZIP',
}

/**
 * Kết quả xử lý ảnh sinh trắc học kèm theo cho từng dòng import (chỉ có ý nghĩa
 * khi request có gửi kèm ảnh — nếu không dùng tính năng này thì field bỏ trống).
 */
export enum ImportAccountBiometricStatus {
  /** Có gửi ảnh nhưng không tìm thấy file khớp employee_code của dòng này. */
  NOT_PROVIDED = 'not_provided',
  /** Preview mode: đã khớp được ảnh, sẽ upload thật khi commit=true. */
  PENDING_COMMIT = 'pending_commit',
  /** Đã upload + qua kiểm tra tự động → face_profiles active (tự duyệt, 2026-11-23). */
  ATTACHED = 'attached',
  /** Role của tài khoản không cần sinh trắc học (BUSINESS_ADMIN/SYSTEM_ADMIN) — bỏ qua. */
  ROLE_EXEMPT = 'role_exempt',
  /** File khớp tên nhưng không phải ảnh JPEG/PNG/WEBP hợp lệ (magic bytes). */
  INVALID_IMAGE = 'invalid_image',
  /** File khớp tên nhưng vượt quá MAX_BIOMETRIC_PHOTO_BYTES. */
  FILE_TOO_LARGE = 'file_too_large',
  /** Lỗi upload Cloudinary hoặc ghi DB — tài khoản vẫn được tạo thành công. */
  UPLOAD_FAILED = 'upload_failed',
  /** [2026-11-23] Ảnh không qua kiểm tra tự động (không thấy mặt / nhiều mặt). */
  FACE_CHECK_FAILED = 'face_check_failed',
  /** [2026-11-23] Đã lưu nhưng trùng định danh người khác → "Cần kiểm tra". */
  FLAGGED = 'flagged',
}

/**
 * Kết quả xử lý biển số xe (tùy chọn, cột `license_plate`) kèm theo cho từng dòng
 * import. Best-effort — mirror `ImportAccountBiometricStatus`: KHÔNG bao giờ làm
 * fail dòng tài khoản, tài khoản vẫn tạo thành công dù đăng ký biển thất bại.
 */
export enum ImportAccountVehiclePlateStatus {
  /** Preview: định dạng biển hợp lệ, sẽ đăng ký thật khi commit=true. */
  PENDING_COMMIT = 'pending_commit',
  /** Đã tạo `vehicle_registrations` cho user thành công. */
  ATTACHED = 'attached',
  /** Biển không đúng định dạng (6–10 ký tự chữ-số, có cả chữ và số). */
  INVALID_PLATE = 'invalid_plate',
  /** Biển đã được đăng ký bởi user khác (đang active). */
  DUPLICATE_PLATE = 'duplicate_plate',
  /** Lỗi khác khi ghi DB — tài khoản vẫn được tạo thành công. */
  ATTACH_FAILED = 'attach_failed',
}
