/**
 * isSimilarPlate / levenshteinDistance (OCR-MERGE, recon 2026-08-08) — đo độ giống giữa
 * 2 chuỗi biển số ĐÃ NORMALIZE, dùng làm tín hiệu PHỤ để quyết định "có phải cùng 1 lượt
 * xe" khi gộp nhiều lần đọc OCR liên tiếp (channel+direction giống, cách nhau ngắn).
 *
 * ⚠ KHÔNG phải normalizePlate() — đây là heuristic RIÊNG cho quyết định gộp (không phải
 * tra cứu DB). Xem normalize-plate.ts cho chuẩn hoá tra cứu.
 *
 * Bug thật phát hiện qua test phần cứng 2026-08-08: bridge camera ANPR thuần
 * (handleTrafficJunction) luôn set eventAction="seen" cố định → direction KHÔNG BAO GIỜ
 * phân biệt được 2 xe khác nhau đi qua cùng channel trong cửa sổ gộp. Cần thêm tín hiệu
 * plateNumber để phân biệt.
 *
 * 2 lớp kiểm tra (lớp 1 trước, rơi xuống lớp 2 nếu lớp 1 không khớp):
 * 1) Substring-containment: chuỗi NGẮN HƠN là substring LIÊN TỤC của chuỗi dài hơn.
 *    Xử lý đúng lỗi OCR đọc THIẾU/THỪA cả cụm ký tự đầu/cuối (đọc được 1 phần biển) — case
 *    log thật: "699" → "30G699" → "G69946" (cùng 1 xe, plateNumber gốc "699" là substring
 *    của cả 2 lần đọc sau). Levenshtein thuần KHÔNG xử lý được case này (lệch độ dài lớn
 *    → distance vượt ngưỡng dù rõ ràng cùng 1 xe).
 * 2) Levenshtein distance <= ngưỡng theo minLen: xử lý lỗi OCR thay/chèn/xóa vài ký tự
 *    GIỮA chuỗi ở 2 lần đọc có độ dài xấp xỉ nhau (không phải quan hệ substring).
 *
 * Ngưỡng theo minLen (đã chốt cùng user 2026-08-08, KHÔNG đổi số):
 *   minLen ≤ 4  → distance ≤ 1
 *   minLen 5-6  → distance ≤ 2
 *   minLen ≥ 7  → distance ≤ 3
 */

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev: number[] = new Array<number>(n + 1);
  let curr: number[] = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // xóa
        curr[j - 1] + 1, // chèn
        prev[j - 1] + cost, // thay
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Ngưỡng khoảng cách tối đa cho phép để coi 2 biển là "cùng 1 xe", theo độ dài chuỗi NGẮN HƠN. */
export function maxAllowedDistance(minLen: number): number {
  if (minLen <= 4) return 1;
  if (minLen <= 6) return 2;
  return 3;
}

/**
 * true nếu 2 chuỗi biển đủ giống để coi là cùng 1 xe (OCR đọc lệch/thiếu/thừa),
 * theo 2 lớp kiểm tra mô tả ở đầu file. Chuỗi rỗng ở 1 trong 2 bên → luôn false
 * (không đủ căn cứ để gộp).
 */
export function isSimilarPlate(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.includes(shorter)) return true;

  const minLen = shorter.length;
  return levenshteinDistance(a, b) <= maxAllowedDistance(minLen);
}
