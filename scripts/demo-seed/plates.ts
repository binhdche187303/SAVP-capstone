/**
 * Biển số của dữ liệu seed (part3) — tách riêng (không import DB) để generate-images.ts vẽ ảnh
 * ĐÚNG từng biển. Tất cả cố định theo index → chạy lại vẫn ra cùng danh sách.
 */

const PROVINCES = ['29', '30', '51', '59', '43', '88', '99'];
const UNKNOWN_SERIES = ['C', 'D', 'F', 'G'];

/** Số người dùng demo của part1. */
export const DEMO_USER_COUNT = 30;

export function plate(i: number, series = 'A'): string {
  return `${PROVINCES[i % PROVINCES.length]}${series}${String(10000 + ((i * 7331) % 89999)).padStart(5, '0')}`;
}

/** 30A12345 → 30A-123.45 (dạng hiển thị như camera đọc). */
export const plateRaw = (p: string) =>
  `${p.slice(0, 3)}-${p.slice(3, 6)}.${p.slice(6)}`;

/** Xe đăng ký: 2/3 người dùng có xe, vài người thêm 1 ô tô biển K. */
export function registeredPlates(): Array<{
  userIdx: number;
  plate: string;
  type: string;
}> {
  const regs: Array<{ userIdx: number; plate: string; type: string }> = [];
  for (let i = 0; i < DEMO_USER_COUNT; i++) {
    if (i % 3 === 2) continue;
    regs.push({
      userIdx: i,
      plate: plate(i),
      type: i % 4 === 0 ? 'car' : 'motorbike',
    });
    if (i % 7 === 0)
      regs.push({ userIdx: i, plate: plate(i + 100, 'K'), type: 'car' });
  }
  return regs;
}

export const controlPlate = (i: number) => plate(500 + i, 'X');

export const UNKNOWN_PLATES = Array.from({ length: 25 }, (_, i) =>
  plate(900 + i, UNKNOWN_SERIES[i % UNKNOWN_SERIES.length]),
);

/** Mọi biển số xuất hiện trong dữ liệu seed. */
export function allSeedPlates(): string[] {
  return [
    ...registeredPlates().map((r) => r.plate),
    ...Array.from({ length: 6 }, (_, i) => controlPlate(i)),
    ...UNKNOWN_PLATES,
  ];
}
