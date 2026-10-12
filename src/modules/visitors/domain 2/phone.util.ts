/** Chuẩn hóa số điện thoại Việt Nam về dạng `0xxxxxxxxx` (bỏ khoảng trắng, dấu chấm, gạch, +84/84). */
export function normalizeVnPhone(raw: string): string {
  let digits = String(raw ?? '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('84') && digits.length === 11) digits = `0${digits.slice(2)}`;
  return digits.replace(/\D/g, '');
}

export const isValidVnPhone = (normalized: string): boolean => /^0\d{9}$/.test(normalized);
