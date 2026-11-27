/** Biển số dùng trong demo — mỗi biển có sẵn ảnh images/plates/<BIỂN>.png (generate-images.ts). */
export const BLOCKED_PLATE = '51A99999';
export const WATCH_PLATE = '30K88888';

/** Biển "lạ" (chưa đăng ký) — kịch bản vehicle-unknown chọn ngẫu nhiên trong danh sách này. */
export const UNKNOWN_PLATES = [
  '29A12345',
  '30E67890',
  '51F24680',
  '59C13579',
  '43A55123',
  '30H90876',
  '29C45612',
  '51G78034',
  '92A11223',
  '15B26789',
] as const;

export const DEMO_PLATES = [BLOCKED_PLATE, WATCH_PLATE, ...UNKNOWN_PLATES];
