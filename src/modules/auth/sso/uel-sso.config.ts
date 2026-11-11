import { ConfigService } from '@nestjs/config';

export const UEL_SSO_SETTINGS = Symbol('UEL_SSO_SETTINGS');
export const UEL_SSO_CLIENT = Symbol('UEL_SSO_CLIENT');
export const UEL_SSO_KEYCLOAK_CLIENT = Symbol('UEL_SSO_KEYCLOAK_CLIENT');

/**
 * psc: đi qua API PSC (apps.uel.edu.vn/sso-docs).
 * keycloak: nối thẳng Keycloak bằng chuẩn OIDC (base URL = URL realm, vd https://sso.uel.edu.vn/realms/UEL).
 */
export type UelSsoMode = 'psc' | 'keycloak';

/** Cấu hình đăng nhập một lần UEL (PSC SSO) — toàn bộ lấy từ .env (UEL_SSO_*). */
export interface UelSsoSettings {
  enabled: boolean;
  /** Mặc định 'psc'. UEL_SSO_MODE=auto (mặc định .env) ⇒ base URL có /realms/ thì là keycloak. */
  mode?: UelSsoMode;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Callback của BE — phải trùng redirect_uri đã đăng ký với PSC, cũng là `clientUrl` khi đổi code. */
  redirectUri: string;
  /** Trang /sso/callback của FE — BE chuyển trình duyệt về đây kèm ?ticket= hoặc ?error=. */
  feCallbackUrl: string;
  scopes: string;
  timeoutMs: number;
  /** true chỉ khi enabled và đủ mọi giá trị bắt buộc. */
  usable: boolean;
}

export function readUelSsoSettings(config: ConfigService): UelSsoSettings {
  const rawEnabled = config.get<boolean | string>('UEL_SSO_ENABLED', false);
  const enabled = rawEnabled === true || rawEnabled === 'true';
  const baseUrl = (config.get<string>('UEL_SSO_BASE_URL', '') ?? '').replace(
    /\/+$/,
    '',
  );
  const rawMode = (config.get<string>('UEL_SSO_MODE', 'auto') ?? 'auto')
    .trim()
    .toLowerCase();
  const mode: UelSsoMode =
    rawMode === 'psc' || rawMode === 'keycloak'
      ? rawMode
      : /\/realms\/[^/]+$/.test(baseUrl)
        ? 'keycloak'
        : 'psc';
  const settings = {
    enabled,
    mode,
    baseUrl,
    clientId: config.get<string>('UEL_SSO_CLIENT_ID', '') ?? '',
    clientSecret: config.get<string>('UEL_SSO_CLIENT_SECRET', '') ?? '',
    redirectUri: config.get<string>('UEL_SSO_REDIRECT_URI', '') ?? '',
    feCallbackUrl: config.get<string>('UEL_SSO_FE_CALLBACK_URL', '') ?? '',
    scopes:
      config.get<string>('UEL_SSO_SCOPES', 'openid profile email') ??
      'openid profile email',
    timeoutMs: Number(config.get<number>('UEL_SSO_TIMEOUT_MS', 10000)),
  };
  const usable =
    enabled &&
    !!settings.baseUrl &&
    !!settings.clientId &&
    !!settings.clientSecret &&
    !!settings.redirectUri &&
    !!settings.feCallbackUrl;
  return { ...settings, usable };
}
