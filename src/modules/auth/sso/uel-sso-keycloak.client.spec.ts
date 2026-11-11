import { ConfigService } from '@nestjs/config';
import { UelKeycloakClient } from './uel-sso-keycloak.client';
import { readUelSsoSettings } from './uel-sso.config';

const REALM = 'https://kc.test/realms/UEL';
const discovery = {
  issuer: REALM,
  authorization_endpoint: `${REALM}/protocol/openid-connect/auth`,
  token_endpoint: `${REALM}/protocol/openid-connect/token`,
  userinfo_endpoint: `${REALM}/protocol/openid-connect/userinfo`,
};
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function build(routes: Record<string, () => Promise<Response>>) {
  const fetchFn = jest.fn<Promise<Response>, [string, RequestInit?]>((url) => {
    const handler = routes[url];
    return handler ? handler() : json({ error: 'not_found' }, 404);
  });
  const client = new UelKeycloakClient({
    realmUrl: REALM,
    clientId: 'uel-app',
    clientSecret: 's3cr:et',
    timeoutMs: 1000,
    fetchFn,
  });
  return { client, fetchFn };
}

describe('UelKeycloakClient', () => {
  const wk = `${REALM}/.well-known/openid-configuration`;

  it('authorize URL lấy từ discovery của realm, có PKCE S256; discovery được cache', async () => {
    const { client, fetchFn } = build({ [wk]: () => json(discovery) });
    const params = {
      redirectUri: 'http://localhost:3000/api/v1/auth/sso/callback',
      scope: 'openid profile email',
      state: 'st',
      codeChallenge: 'ch',
    };
    const u = new URL(await client.buildAuthorizeUrl(params));
    await client.buildAuthorizeUrl(params);
    expect(`${u.origin}${u.pathname}`).toBe(discovery.authorization_endpoint);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'uel-app',
      redirect_uri: params.redirectUri,
      scope: params.scope,
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('đổi code: form-urlencoded, Basic auth (đã encode), có code_verifier', async () => {
    const { client, fetchFn } = build({
      [wk]: () => json(discovery),
      [discovery.token_endpoint]: () =>
        json({ access_token: 'at', id_token: 'it', expires_in: 300 }),
    });
    await expect(
      client.exchangeCode('code1', 'http://be/cb', 'ver1'),
    ).resolves.toEqual({ accessToken: 'at', idToken: 'it', expiresIn: 300 });
    const [url, init] = fetchFn.mock.calls[1] as unknown as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe(discovery.token_endpoint);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('uel-app:s3cr%3Aet').toString('base64')}`,
    );
    expect(
      Object.fromEntries(new URLSearchParams(init.body as string)),
    ).toEqual({
      grant_type: 'authorization_code',
      code: 'code1',
      redirect_uri: 'http://be/cb',
      code_verifier: 'ver1',
    });
  });

  it('lỗi token: báo mã lỗi OAuth, không lộ body', async () => {
    const { client } = build({
      [wk]: () => json(discovery),
      [discovery.token_endpoint]: () =>
        json(
          { error: 'invalid_grant', error_description: 'Code not valid' },
          400,
        ),
    });
    const call = client.exchangeCode('bad', 'http://be/cb', 'v');
    await expect(call).rejects.toMatchObject({
      status: 400,
      code: 'SSO_HTTP_ERROR',
    });
    await expect(call).rejects.toThrow(/invalid_grant/);
  });

  it('userinfo: Bearer token, bắt buộc có sub', async () => {
    const { client, fetchFn } = build({
      [wk]: () => json(discovery),
      [discovery.userinfo_endpoint]: () =>
        json({ sub: 'u1', preferred_username: 'NS003' }),
    });
    await expect(client.userinfo('at')).resolves.toMatchObject({ sub: 'u1' });
    const init = fetchFn.mock.calls[1][1] as unknown as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe('Bearer at');
  });

  it('discovery thiếu endpoint ⇒ SSO_DISCOVERY_INVALID', async () => {
    const { client } = build({
      [wk]: () => json({ authorization_endpoint: 'x' }),
    });
    await expect(client.discovery()).rejects.toMatchObject({
      code: 'SSO_DISCOVERY_INVALID',
    });
  });
});

describe('readUelSsoSettings — chọn chế độ', () => {
  const cfg = (env: Record<string, string>) =>
    ({
      get: (k: string, d?: unknown) => env[k] ?? d,
    }) as unknown as ConfigService;

  it('auto: URL realm ⇒ keycloak, URL khác ⇒ psc; UEL_SSO_MODE ép được', () => {
    expect(
      readUelSsoSettings(
        cfg({ UEL_SSO_BASE_URL: 'https://sso.uel.edu.vn/realms/UEL/' }),
      ).mode,
    ).toBe('keycloak');
    expect(
      readUelSsoSettings(cfg({ UEL_SSO_BASE_URL: 'https://apps.uel.edu.vn' }))
        .mode,
    ).toBe('psc');
    expect(
      readUelSsoSettings(
        cfg({
          UEL_SSO_BASE_URL: 'https://sso.uel.edu.vn/realms/UEL',
          UEL_SSO_MODE: 'psc',
        }),
      ).mode,
    ).toBe('psc');
  });
});
