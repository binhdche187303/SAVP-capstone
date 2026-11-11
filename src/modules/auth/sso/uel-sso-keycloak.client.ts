import { UelSsoError } from './uel-sso.client';

/**
 * Client kết nối THẲNG Keycloak của UEL (https://sso.uel.edu.vn/realms/UEL) theo chuẩn
 * OpenID Connect: discovery → authorize (PKCE S256) → token (authorization_code) → userinfo.
 * Chỉ chạy phía BE — client_secret không bao giờ ra trình duyệt; không log token.
 *
 * Danh tính lấy từ userinfo (gọi trực tiếp Keycloak qua TLS bằng access token vừa đổi ở
 * back-channel) nên không cần tự kiểm chữ ký id_token.
 */

export interface KeycloakDiscovery {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  [key: string]: unknown;
}

export interface KeycloakTokens {
  accessToken: string;
  idToken?: string;
  expiresIn?: number;
}

/** Claims từ userinfo — Keycloak luôn có `sub`; các trường khác tùy mapper của realm. */
export interface KeycloakUserInfo {
  sub: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  [key: string]: unknown;
}

export interface UelKeycloakClientDeps {
  /** URL realm, vd https://sso.uel.edu.vn/realms/UEL (không có dấu / cuối). */
  realmUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
  now?: () => number;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export class UelKeycloakClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private discoveryCache: { value: KeycloakDiscovery; at: number } | null =
    null;

  constructor(private readonly deps: UelKeycloakClientDeps) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.now = deps.now ?? Date.now;
  }

  async discovery(): Promise<KeycloakDiscovery> {
    const cached = this.discoveryCache;
    if (cached && this.now() - cached.at < DISCOVERY_TTL_MS) {
      return cached.value;
    }
    const doc = await this.request<KeycloakDiscovery>(
      `${this.deps.realmUrl}/.well-known/openid-configuration`,
      { method: 'GET' },
    );
    if (
      !doc?.authorization_endpoint ||
      !doc.token_endpoint ||
      !doc.userinfo_endpoint
    ) {
      throw new UelSsoError(
        'Discovery Keycloak thiếu authorization/token/userinfo endpoint',
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
    const url = new URL(authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.deps.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('scope', params.scope);
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /** Đổi code lấy token — client_secret_basic + code_verifier (PKCE). */
  async exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<KeycloakTokens> {
    const { token_endpoint } = await this.discovery();
    // RFC 6749 §2.3.1: client_id/secret phải form-urlencode trước khi ghép Basic.
    const basic = Buffer.from(
      `${encodeURIComponent(this.deps.clientId)}:${encodeURIComponent(this.deps.clientSecret)}`,
    ).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    const res = await this.request<{
      access_token?: string;
      id_token?: string;
      expires_in?: number;
    }>(token_endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res?.access_token) {
      throw new UelSsoError(
        'Phản hồi token Keycloak thiếu access_token',
        null,
        'SSO_TOKEN_INVALID',
      );
    }
    return {
      accessToken: res.access_token,
      idToken: res.id_token,
      expiresIn: res.expires_in,
    };
  }

  async userinfo(accessToken: string): Promise<KeycloakUserInfo> {
    const { userinfo_endpoint } = await this.discovery();
    const info = await this.request<KeycloakUserInfo>(userinfo_endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!info?.sub) {
      throw new UelSsoError(
        'Userinfo Keycloak thiếu sub',
        null,
        'SSO_BAD_RESPONSE',
      );
    }
    return info;
  }

  private async request<T>(
    url: string,
    init: {
      method: 'GET' | 'POST';
      headers?: Record<string, string>;
      body?: string;
    },
  ): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: init.method,
        headers: { Accept: 'application/json', ...init.headers },
        body: init.body,
        signal: AbortSignal.timeout(this.deps.timeoutMs),
      });
    } catch (error) {
      throw new UelSsoError(
        `Không kết nối được Keycloak UEL (${init.method} ${pathOf(url)}): ${(error as Error).message}`,
        null,
        'SSO_UNREACHABLE',
      );
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = null;
    }
    if (!res.ok) {
      // Chỉ lấy mã lỗi OAuth (vd invalid_grant, invalid_client) — không log body.
      const oauthError =
        json && typeof json === 'object' && 'error' in json
          ? String(json.error)
          : '';
      throw new UelSsoError(
        `Keycloak UEL trả HTTP ${res.status}${oauthError ? ` (${oauthError})` : ''} cho ${init.method} ${pathOf(url)}`,
        res.status,
        'SSO_HTTP_ERROR',
      );
    }
    if (json === null) {
      throw new UelSsoError(
        `Keycloak UEL trả dữ liệu không phải JSON cho ${init.method} ${pathOf(url)}`,
        res.status,
        'SSO_BAD_RESPONSE',
      );
    }
    return json as T;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
