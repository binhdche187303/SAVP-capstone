/**
 * Client gọi PSC SSO của UEL (https://apps.uel.edu.vn/sso-docs).
 * Chỉ chạy phía BE — client_secret không bao giờ ra trình duyệt.
 *
 * Tài liệu PSC trả JSON phẳng (không envelope); vẫn chấp nhận { data: ... } phòng khi gateway bọc.
 */

export class UelSsoError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string,
  ) {
    super(message);
    this.name = 'UelSsoError';
  }
}

export interface UelSsoDiscovery {
  authorization_endpoint: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  [key: string]: unknown;
}

export interface UelSsoTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  refreshExpiresIn?: number;
  idToken?: string;
  tokenType: string;
}

/** POST /api/accounts/profile */
export interface UelSsoProfile {
  id: string;
  userName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  emailVerified?: boolean;
  enabled?: boolean;
  [key: string]: unknown;
}

/** GET /api/auth/tokens/assignments */
export interface UelSsoAssignments {
  userName?: string;
  /** Mã sinh viên — chỉ có với sinh viên. */
  studentId?: string;
  /** Mã công chức/viên chức — chỉ có với cán bộ. */
  publicServantNumber?: string;
  status?: string;
  assignments?: Array<{
    assignment?: string;
    unit?: string;
    lastDepartment?: string;
    departmentsToken?: string;
    position?: string;
  }>;
}

/** POST /api/auth/tokens/verify — kiểm tra access token, trả danh tính rút gọn. */
export interface UelSsoTokenInfo {
  active?: boolean;
  sub?: string;
  username?: string;
  preferredUsername?: string;
  sid?: string;
  scope?: string;
  clientId?: string;
  emailVerified?: boolean;
  isPsc?: boolean;
  [key: string]: unknown;
}

export interface UelSsoClientDeps {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
  now?: () => number;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export class UelSsoClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private discoveryCache: { value: UelSsoDiscovery; at: number } | null = null;

  constructor(private readonly deps: UelSsoClientDeps) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.now = deps.now ?? Date.now;
  }

  async discovery(): Promise<UelSsoDiscovery> {
    const cached = this.discoveryCache;
    if (cached && this.now() - cached.at < DISCOVERY_TTL_MS) {
      return cached.value;
    }
    const doc = await this.request<UelSsoDiscovery>(
      'GET',
      '/api/psc-sso/.well-known/openid-configuration',
    );
    if (!doc?.authorization_endpoint) {
      throw new UelSsoError(
        'Discovery thiếu authorization_endpoint',
        null,
        'SSO_DISCOVERY_INVALID',
      );
    }
    this.discoveryCache = { value: doc, at: this.now() };
    return doc;
  }

  async buildAuthorizeUrl(params: {
    redirectUri: string;
    scope: string;
    state: string;
    codeChallenge: string;
  }): Promise<string> {
    const { authorization_endpoint } = await this.discovery();
    const url = new URL(authorization_endpoint, this.deps.baseUrl + '/');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.deps.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('scope', params.scope);
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /**
   * Đổi authorization code lấy token. Tài liệu PSC không có code_verifier trong body —
   * cần hỏi lại PSC; hiện bám đúng tài liệu.
   */
  async exchangeCode(code: string, clientUrl: string): Promise<UelSsoTokens> {
    const basic = Buffer.from(
      `${this.deps.clientId}:${this.deps.clientSecret}`,
    ).toString('base64');
    const tokens = await this.request<UelSsoTokens>(
      'POST',
      '/api/auth/tokens/authorization-code',
      {
        headers: { Authorization: `Basic ${basic}` },
        body: { clientUrl, authCode: code, allowOfflineAccess: false },
      },
    );
    if (!tokens?.accessToken) {
      throw new UelSsoError(
        'Phản hồi đổi code thiếu accessToken',
        null,
        'SSO_TOKEN_INVALID',
      );
    }
    return tokens;
  }

  profile(accessToken: string): Promise<UelSsoProfile> {
    return this.request<UelSsoProfile>('POST', '/api/accounts/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  verify(accessToken: string): Promise<UelSsoTokenInfo> {
    return this.request<UelSsoTokenInfo>('POST', '/api/auth/tokens/verify', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  assignments(accessToken: string): Promise<UelSsoAssignments> {
    return this.request<UelSsoAssignments>(
      'GET',
      '/api/auth/tokens/assignments',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: { headers?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const url = this.deps.baseUrl + path;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined,
        signal: AbortSignal.timeout(this.deps.timeoutMs),
      });
    } catch (error) {
      throw new UelSsoError(
        `Không kết nối được SSO UEL (${method} ${path}): ${(error as Error).message}`,
        null,
        'SSO_UNREACHABLE',
      );
    }
    const text = await res.text();
    if (!res.ok) {
      // Không log body — có thể chứa token.
      throw new UelSsoError(
        `SSO UEL trả HTTP ${res.status} cho ${method} ${path}`,
        res.status,
        'SSO_HTTP_ERROR',
      );
    }
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new UelSsoError(
        `SSO UEL trả dữ liệu không phải JSON cho ${method} ${path}`,
        res.status,
        'SSO_BAD_RESPONSE',
      );
    }
    return unwrap<T>(json);
  }
}

function unwrap<T>(json: unknown): T {
  if (json && typeof json === 'object' && 'data' in json) {
    const data = json.data;
    if (data && typeof data === 'object') return data as T;
  }
  return json as T;
}
