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
      if (res.ok) return (await res.json()) as UelPage<T>;

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

  /** Gọi hết các trang (page = 1..totalPages, cùng limit). */
  async all<T>(api: string, filter: UelFilter = {}): Promise<T[]> {
    const first = await this.page<T>(api, filter, 1);
    const out = [...first.items];
    for (let p = 2; p <= first.totalPages; p++) {
      out.push(...(await this.page<T>(api, filter, p)).items);
    }
    return out;
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
