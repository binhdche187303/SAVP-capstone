/**
 * HgvisionClient — gọi API tích hợp HGVision (docs/hgvision/openapi-1.0.0.json).
 *
 * Xác thực OAuth client credentials (POST /api/oauth/token), tự lấy token mới khi
 * sắp hết hạn và thử lại MỘT lần khi gặp 401. HGVision KHÔNG có webhook ⇒ sự kiện
 * lấy bằng cách poll GET /api/history (xem HgvisionPollerService).
 * SEC-01: KHÔNG log client_secret / access token.
 */

export interface HgvisionClientDeps {
  baseUrl: string; // vd http://192.168.1.10:8113
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
}

/** HistoryObject (OpenAPI) — chỉ các field SAVP dùng. Thời gian = epoch GIÂY. */
export interface HgvisionHistoryObject {
  object_id: string;
  camera_id: string; // tên camera
  object_type?: string;
  face_ident_text?: string;
  face_image_path?: string;
  lp_text?: string;
  lp_image_path?: string;
  object_image_path?: string;
  first_timestamp?: number;
  last_timestamp?: number;
  confidence?: number;
}

export interface HgvisionHistoryPage {
  total: number;
  page: number;
  page_size: number;
  data: HgvisionHistoryObject[];
}

export interface HgvisionHistoryQuery {
  startTime: number; // epoch giây
  endTime: number; // epoch giây
  hasFace?: boolean;
  page?: number;
  pageSize?: number;
}

export class HgvisionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HgvisionError';
  }
}

/** Làm mới token sớm hơn hạn thật để tránh dùng token vừa hết hạn giữa chừng. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export class HgvisionClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private scopes: string[] = [];

  constructor(private readonly deps: HgvisionClientDeps) {}

  get grantedScopes(): readonly string[] {
    return this.scopes;
  }

  searchHistory(q: HgvisionHistoryQuery): Promise<HgvisionHistoryPage> {
    const params = new URLSearchParams({
      start_time: String(q.startTime),
      end_time: String(q.endTime),
      page: String(q.page ?? 1),
      page_size: String(q.pageSize ?? 100),
    });
    if (q.hasFace !== undefined) params.set('has_face', String(q.hasFace));
    return this.get<HgvisionHistoryPage>(`/api/history?${params.toString()}`);
  }

  /**
   * Tải ảnh `*_image_path` qua GET /api/media/images/{image_path} → base64 (không kèm
   * tiền tố data URL). Giữ nguyên dấu `/` trong path, chỉ encode từng đoạn.
   */
  async fetchImageBase64(imagePath: string): Promise<string> {
    const encoded = imagePath
      .replace(/^\/+/, '')
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    const res = await this.authedGet(`/api/media/images/${encoded}`, 'image/*');
    if (!res.ok) throw await this.toError(res);
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.authedGet(path, 'application/json');
    if (!res.ok) throw await this.toError(res);
    return (await res.json()) as T;
  }

  private async authedGet(path: string, accept: string): Promise<Response> {
    let res = await this.send(path, await this.accessToken(), accept);
    if (res.status === 401) {
      // Token bị thu hồi/hết hạn sớm → lấy token mới, thử lại đúng 1 lần.
      this.token = null;
      res = await this.send(path, await this.accessToken(), accept);
    }
    return res;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;

    const res = await this.fetchWithTimeout('/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.deps.clientId,
        client_secret: this.deps.clientSecret,
      }),
    });
    if (!res.ok) throw await this.toError(res);

    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
      scope?: string;
    };
    this.token = body.access_token;
    this.tokenExpiresAt =
      Date.now() + body.expires_in * 1000 - TOKEN_REFRESH_MARGIN_MS;
    this.scopes = (body.scope ?? '').split(' ').filter(Boolean);
    return this.token;
  }

  private send(path: string, token: string, accept: string): Promise<Response> {
    return this.fetchWithTimeout(path, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: accept },
    });
  }

  private async fetchWithTimeout(
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    if (!this.deps.baseUrl) {
      throw new HgvisionError('HGVISION_BASE_URL chưa cấu hình.', 0);
    }
    try {
      return await fetch(new URL(path, this.deps.baseUrl), {
        ...init,
        signal: AbortSignal.timeout(this.deps.timeoutMs),
      });
    } catch (e) {
      throw new HgvisionError(
        `Không kết nối được HGVision: ${e instanceof Error ? e.message : 'unknown'}`,
        0,
      );
    }
  }

  /** Lỗi HGVision: {error} hoặc OAuth {error, error_description}. */
  private async toError(res: Response): Promise<HgvisionError> {
    let detail = '';
    try {
      const body = (await res.json()) as {
        error?: string;
        error_description?: string;
      };
      detail = body.error_description ?? body.error ?? '';
    } catch {
      // body không phải JSON — chỉ dùng status.
    }
    return new HgvisionError(
      `HGVision HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
      res.status,
    );
  }
}
