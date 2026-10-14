import { ValidateBy, type ValidationOptions } from 'class-validator';
import { normalizePlate } from './normalize-plate.js';

/**
 * Quy tắc định dạng biển số dùng chung (BUG-004) — KHÔNG phụ thuộc loại xe.
 *
 * 1. Ký tự cho phép trên giá trị GỐC: chữ Latin không dấu, chữ số, dấu cách, `-`, `.`.
 * 2. Sau normalizePlate: dài 5–10, có ≥1 chữ cái và ≥4 chữ số.
 *
 * Đủ rộng cho biển dân sự (30F-256.58, 29A-1234), quân đội (TM-12-34), ngoại giao
 * (80-NG-123-45); chặn giá trị rác ("1", "QA TEST", "<b>@@##</b>"). Cố ý không kiểm tra
 * chặt theo từng loại biển — sai một quy tắc là từ chối nhầm biển thật ở danh sách đen.
 * FE (VehicleControlList.jsx) giữ bản sao y hệt để báo lỗi sớm.
 */
export const PLATE_ALLOWED_CHARS = /^[A-Za-z0-9 .-]+$/;
export const PLATE_MIN_LENGTH = 5;
export const PLATE_MAX_LENGTH = 10;

export const PLATE_CHARS_MESSAGE =
  'Biển số chỉ được chứa chữ, số, dấu cách, dấu gạch ngang (-) hoặc dấu chấm (.)';
export const PLATE_FORMAT_MESSAGE =
  'Biển số không đúng định dạng (ví dụ: 30F-256.58)';

/** Kiểm tra cấu trúc trên biển đã chuẩn hóa (chỉ gọi sau khi đã qua PLATE_ALLOWED_CHARS). */
export function isPlateStructureValid(raw: string): boolean {
  const plate = normalizePlate(raw);
  if (plate.length < PLATE_MIN_LENGTH || plate.length > PLATE_MAX_LENGTH) {
    return false;
  }
  const digits = plate.replace(/[^0-9]/g, '').length;
  return /[A-Z]/.test(plate) && digits >= 4;
}

/** Decorator class-validator cho cấu trúc biển số (dùng kèm @Matches(PLATE_ALLOWED_CHARS)). */
export function IsPlateStructure(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isPlateStructure',
      validator: {
        // Ký tự lạ ⇒ để @Matches báo (1 lỗi rõ nguyên nhân thay vì 2 lỗi chồng nhau).
        validate: (value: unknown): boolean =>
          typeof value === 'string' &&
          (!PLATE_ALLOWED_CHARS.test(value) || isPlateStructureValid(value)),
        defaultMessage: () => PLATE_FORMAT_MESSAGE,
      },
    },
    options,
  );
}
