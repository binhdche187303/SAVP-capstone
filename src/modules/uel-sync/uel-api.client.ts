/**
 * UelApiClient — gọi API Đào tạo UEL (tai-lieu-api-uelapi-20261102_v1.docx).
 *
 * - Mọi API: POST {baseUrl}/gw/v1/{project}/{subsystem}/{api}, header X-Api-Key, body JSON phẳng.
 * - Thành công: { items, total, page, limit, totalPages }. Lỗi: { error: { code, message }, traceId }.
 * - 429 → chờ Retry-After (mặc định 60s) rồi thử lại; 502/503/504 → backoff rồi thử lại.
 * SEC: KHÔNG log API key.
 */

export interface UelApiClientDeps {
  baseUrl: string; // https://api.uel.edu.vn
  projectCode: string; // uelapi
  apiKey: string;
  timeoutMs: number;
  /** Số lần thử lại tối đa cho 429/5xx. */
  maxRetries?: number;
  /** Cho phép test thay fetch / sleep. */
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface UelPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type UelFilter = Record<string, string | number | boolean | null>;

export class UelApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    readonly traceId: string | null = null,
  ) {
    super(message);
    this.name = 'UelApiError';
  }
}

/** limit tối đa mọi API theo tài liệu. */
export const UEL_MAX_LIMIT = 1000;
/** Số lượt tải lại toàn bộ trang khi UEL trả trùng/sót giữa các trang. */
export const UEL_PAGE_ROUNDS = 5;
const RETRYABLE = new Set([429, 502, 503, 504]);

export class UelApiClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(private readonly deps: UelApiClientDeps) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.sleep =
      deps.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = deps.maxRetries ?? 3;
  }

  get configured(): boolean {
    return !!this.deps.baseUrl && !!this.deps.apiKey;
  }

  /** Gọi 1 trang. `api` dạng `subsystem/api_name`, vd `nhansu/ds_nhansu`. */
  async page<T>(
    api: string,
    filter: UelFilter = {},
    page = 1,
    limit = UEL_MAX_LIMIT,
  ): Promise<UelPage<T>> {
    const body = JSON.stringify({ ...filter, page, limit });
    for (let attempt = 0; ; attempt++) {
      const res = await this.post(api, body);
      if (res.ok) {
        const data = (await res.json()) as UelPage<T>;
        if (
          !Array.isArray(data.items) ||
          data.page !== page ||
          !Number.isInteger(data.totalPages) ||
          data.totalPages < 0 ||
          !Number.isInteger(data.total) ||
          data.total < 0 ||
          (data.total > 0 && data.totalPages < page)
        ) {
          throw new UelApiError(
            'UEL API trả phân trang không hợp lệ; dừng đồng bộ để bảo vệ dữ liệu.',
            200,
          );
        }
        return data;
      }

      // 404 Data.NotFound = "không có dữ liệu theo điều kiện" → coi như trang rỗng.
      const err = await this.toError(res);
      if (res.status === 404 && err.code === 'Data.NotFound') {
        return { items: [], total: 0, page, limit, totalPages: 0 };
      }
      if (!RETRYABLE.has(res.status) || attempt >= this.maxRetries) throw err;

      const retryAfter = Number(res.headers.get('Retry-After'));
      const waitMs =
        res.status === 429
          ? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60) *
            1000
          : 2000 * 2 ** attempt;
      await this.sleep(waitMs);
    }
  }

  /**
   * Gọi hết các trang (page = 1..totalPages, cùng limit).
   * UEL sắp xếp không ổn định giữa các trang (lớp HP ~2.900 SV: 67 dòng lặp, 67 dòng sót) ⇒
   * gom theo bản ghi, thiếu thì tải lại cả lượt trang tới khi đủ `total` (tối đa UEL_PAGE_ROUNDS lượt).
   * UEL còn trả dòng trùng y hệt ngay trong 1 trang (lớp ghép chung mã lịch học) và `total` đếm
   * cả các dòng đó ⇒ số dòng thật của 1 bản ghi = số lần xuất hiện nhiều nhất trong 1 trang.
   * Kết quả trả về đã bỏ dòng trùng y hệt.
   */
  async all<T>(api: string, filter: UelFilter = {}): Promise<T[]> {
    const first = await this.page<T>(api, filter, 1);
    const seen = new Map<string, { item: T; n: number }>();
    let count = 0; // tổng số dòng đã thấy, tính cả dòng trùng trong cùng trang
    const add = (items: T[]) => {
      const inPage = new Map<string, number>();
      for (const it of items) {
        const k = JSON.stringify(it);
        const n = (inPage.get(k) ?? 0) + 1;
        inPage.set(k, n);
        const prev = seen.get(k);
        if (!prev) {
          seen.set(k, { item: it, n });
          count++;
        } else if (n > prev.n) {
          prev.n = n;
          count++;
        }
      }
    };
    add(first.items);
    for (let round = 0; round < UEL_PAGE_ROUNDS; round++) {
      for (let p = round === 0 ? 2 : 1; p <= first.totalPages; p++) {
        const next = await this.page<T>(api, filter, p);
        if (
          next.totalPages !== first.totalPages ||
          next.total !== first.total ||
          !next.items.length
        ) {
          throw new UelApiError(
            'Dữ liệu phân trang UEL thay đổi hoặc thiếu; cần chạy lại đồng bộ.',
            200,
          );
        }
        add(next.items);
      }
      if (count >= first.total || first.totalPages <= 1) break;
    }
    if (count < first.total) {
      throw new UelApiError(
        `UEL API trả thiếu dữ liệu so với tổng số bản ghi (${count}/${first.total} sau ${UEL_PAGE_ROUNDS} lượt tải).`,
        200,
      );
    }
    return [...seen.values()].map((v) => v.item);
  }

  private async post(api: string, body: string): Promise<Response> {
    if (!this.configured) {
      throw new UelApiError('UEL_API_BASE_URL / UEL_API_KEY chưa cấu hình.', 0);
    }
    const url = `${this.deps.baseUrl.replace(/\/+$/, '')}/gw/v1/${this.deps.projectCode}/${api}`;
    try {
      return await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'X-Api-Key': this.deps.apiKey,
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json',
        },
        body,
        signal: AbortSignal.timeout(this.deps.timeoutMs),
      });
    } catch (e) {
      throw new UelApiError(
        `Không kết nối được API UEL (${api}): ${e instanceof Error ? e.message : 'unknown'}`,
        0,
      );
    }
  }

  private async toError(res: Response): Promise<UelApiError> {
    let code: string | null = null;
    let message = '';
    let traceId = res.headers.get('X-Trace-Id');
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
        traceId?: string;
      };
      code = body.error?.code ?? null;
      message = body.error?.message ?? '';
      traceId = body.traceId ?? traceId;
    } catch {
      // 405/429 không có body.
    }
    return new UelApiError(
      `UEL API HTTP ${res.status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}${traceId ? ` (traceId ${traceId})` : ''}`,
      res.status,
      code,
      traceId,
    );
  }
}
