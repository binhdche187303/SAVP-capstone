/**
 * TypeORM (driver postgres) trả `UPDATE/DELETE … RETURNING` dưới dạng `[rows, affectedCount]`, còn SELECT/INSERT … RETURNING
 * trả thẳng mảng dòng. Dùng hàm này cho mọi câu UPDATE/DELETE có RETURNING để `.length` / `[0]` luôn nói về DÒNG, không phải về cặp.
 * (Bỏ qua bước này thì "0 dòng bị đổi" vẫn có length 2 → kiểm tra tranh chấp trạng thái không bao giờ kích hoạt.)
 */
export function returnedRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') return result[0] as T[];
  return (Array.isArray(result) ? result : []) as T[];
}
