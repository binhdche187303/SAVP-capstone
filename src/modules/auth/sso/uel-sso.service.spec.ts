import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { UelSsoService, SSO_ERROR_CODES } from './uel-sso.service';
import type { UelSsoSettings } from './uel-sso.config';
import { UelSsoClient, UelSsoError } from './uel-sso.client';

const settings: UelSsoSettings = {
  enabled: true,
  usable: true,
  baseUrl: 'http://sso.test',
  clientId: 'cid',
  clientSecret: 'secret',
  redirectUri: 'http://be.test/api/v1/auth/sso/callback',
  feCallbackUrl: 'http://fe.test/sso/callback',
  scopes: 'openid profile email',
  timeoutMs: 1000,
};

const user = {
  id: 'u1',
  email: 'a@uel.test',
  passwordHash: null,
  fullName: 'A',
  avatarUrl: null,
  departmentId: null,
  accountStatus: 'active',
  accountExpiresAt: null,
};

function build(overrides: Partial<UelSsoSettings> = {}) {
  const states = new Map<string, unknown>();
  const tickets = new Map<string, unknown>();
  const take = (m: Map<string, unknown>, k: string) => {
    const v = m.get(k) ?? null;
    m.delete(k);
    return Promise.resolve(v);
  };
  const stateStore = {
    saveState: jest.fn((k: string, v: unknown) => {
      states.set(k, v);
      return Promise.resolve();
    }),
    takeState: jest.fn((k: string) => take(states, k)),
    saveTicket: jest.fn((k: string, v: unknown) => {
      tickets.set(k, v);
      return Promise.resolve();
    }),
    takeTicket: jest.fn((k: string) => take(tickets, k)),
  };
  const client = {
    buildAuthorizeUrl: jest.fn((p: { state: string; codeChallenge: string }) =>
      Promise.resolve(
        `http://sso.test/authorize?state=${p.state}&code_challenge=${p.codeChallenge}`,
      ),
    ),
    exchangeCode: jest.fn().mockResolvedValue({ accessToken: 'at' }),
    profile: jest
      .fn()
      .mockResolvedValue({ id: 'x', userName: 'a', email: 'a@uel.test' }),
    assignments: jest
      .fn()
      .mockResolvedValue({ studentId: 'K1', status: 'active' }),
    verify: jest.fn().mockResolvedValue({ active: true, username: 'a' }),
  };
  const keycloak = {
    buildAuthorizeUrl: jest.fn((p: { state: string }) =>
      Promise.resolve(
        `https://kc.test/realms/UEL/protocol/openid-connect/auth?state=${p.state}`,
      ),
    ),
    exchangeCode: jest.fn().mockResolvedValue({ accessToken: 'kc-at' }),
    userinfo: jest.fn().mockResolvedValue({
      sub: 'kc-sub',
      preferred_username: 'NS003',
      email: 'gv@uel.edu.vn',
      email_verified: true,
    }),
  };
  const accountRepository = {
    findLinkedUser: jest.fn().mockResolvedValue({
      kind: 'linked',
      userId: 'u1',
      matchedBy: 'student_code',
    }),
  };
  const usersAuthRepository = { findById: jest.fn().mockResolvedValue(user) };
  const loginService = {
    assertAccountUsable: jest.fn(),
    issueSession: jest.fn().mockResolvedValue({
      jti: 'j',
      result: {
        accessToken: 'jwt',
        refreshToken: 'r',
        expiresIn: 900,
        user: {},
      },
    }),
  };
  const service = new UelSsoService(
    { ...settings, ...overrides },
    client as unknown as UelSsoClient,
    keycloak as never,
    stateStore as never,
    accountRepository as never,
    usersAuthRepository as never,
    loginService as never,
  );
  return {
    service,
    client,
    keycloak,
    accountRepository,
    loginService,
    usersAuthRepository,
    states,
  };
}

const errorOf = (url: string) => new URL(url).searchParams.get('error');
const ticketOf = (url: string) => new URL(url).searchParams.get('ticket');

describe('UelSsoService', () => {
  it('start: tạo state + PKCE S256 hợp lệ và lưu verifier', async () => {
    const { service, client, states } = build();
    const { url, state } = await service.start();
    const saved = states.get(state) as { verifier: string };
    expect(saved.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const challenge = createHash('sha256')
      .update(saved.verifier)
      .digest('base64url');
    expect(client.buildAuthorizeUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        codeChallenge: challenge,
        redirectUri: settings.redirectUri,
      }),
    );
    expect(url).toContain(state);
  });

  it('luồng thành công: callback → ticket → redeem cấp JWT với method uel_sso', async () => {
    const { service, client, loginService } = build();
    const { state } = await service.start();
    const target = await service.handleCallback({ code: 'c1', state }, state);
    expect(target.startsWith(settings.feCallbackUrl)).toBe(true);
    expect(client.exchangeCode).toHaveBeenCalledWith(
      'c1',
      settings.redirectUri,
    );
    const ticket = ticketOf(target)!;
    expect(ticket).toBeTruthy();

    const result = await service.redeem(ticket, { ipAddress: '1.1.1.1' });
    expect(result.accessToken).toBe('jwt');
    expect(loginService.issueSession).toHaveBeenCalledWith(
      user,
      { ipAddress: '1.1.1.1' },
      'uel_sso',
    );
    // ticket dùng 1 lần
    await expect(service.redeem(ticket, {})).rejects.toMatchObject({
      response: { code: SSO_ERROR_CODES.SSO_TICKET_INVALID },
    });
  });

  it('state không khớp cookie ⇒ SSO_STATE_INVALID, không gọi PSC', async () => {
    const { service, client } = build();
    const { state } = await service.start();
    const target = await service.handleCallback({ code: 'c', state }, 'other');
    expect(errorOf(target)).toBe(SSO_ERROR_CODES.SSO_STATE_INVALID);
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });

  it('state dùng lại lần 2 ⇒ SSO_STATE_INVALID', async () => {
    const { service } = build();
    const { state } = await service.start();
    await service.handleCallback({ code: 'c', state }, state);
    const again = await service.handleCallback({ code: 'c', state }, state);
    expect(errorOf(again)).toBe(SSO_ERROR_CODES.SSO_STATE_INVALID);
  });

  it('người dùng bấm hủy ⇒ SSO_CANCELLED', async () => {
    const { service } = build();
    const { state } = await service.start();
    const t = await service.handleCallback(
      { error: 'access_denied', state },
      state,
    );
    expect(errorOf(t)).toBe(SSO_ERROR_CODES.SSO_CANCELLED);
  });

  it('PSC lỗi khi đổi code ⇒ SSO_PROVIDER_ERROR', async () => {
    const { service, client } = build();
    client.exchangeCode.mockRejectedValueOnce(
      new UelSsoError('x', 400, 'SSO_HTTP_ERROR'),
    );
    const { state } = await service.start();
    const t = await service.handleCallback({ code: 'c', state }, state);
    expect(errorOf(t)).toBe(SSO_ERROR_CODES.SSO_PROVIDER_ERROR);
  });

  it('tài khoản UEL bị khóa ⇒ SSO_ACCOUNT_INACTIVE', async () => {
    const { service, client } = build();
    client.assignments.mockResolvedValueOnce({
      studentId: 'K1',
      status: 'inactive',
    });
    const { state } = await service.start();
    const t = await service.handleCallback({ code: 'c', state }, state);
    expect(errorOf(t)).toBe(SSO_ERROR_CODES.SSO_ACCOUNT_INACTIVE);
  });

  it('không tìm thấy / trùng tài khoản nội bộ', async () => {
    const { service, accountRepository } = build();
    accountRepository.findLinkedUser.mockResolvedValueOnce({
      kind: 'not_found',
    });
    let { state } = await service.start();
    expect(
      errorOf(await service.handleCallback({ code: 'c', state }, state)),
    ).toBe(SSO_ERROR_CODES.SSO_ACCOUNT_NOT_LINKED);
    accountRepository.findLinkedUser.mockResolvedValueOnce({
      kind: 'ambiguous',
      matchedBy: 'email',
    });
    ({ state } = await service.start());
    expect(
      errorOf(await service.handleCallback({ code: 'c', state }, state)),
    ).toBe(SSO_ERROR_CODES.SSO_ACCOUNT_AMBIGUOUS);
  });

  it('tài khoản nội bộ inactive ⇒ trả đúng mã AUTH_* của đăng nhập thường', async () => {
    const { service, loginService } = build();
    loginService.assertAccountUsable.mockImplementationOnce(() => {
      throw new ForbiddenException({ code: 'AUTH_ACCOUNT_INACTIVE' });
    });
    const { state } = await service.start();
    const t = await service.handleCallback({ code: 'c', state }, state);
    expect(errorOf(t)).toBe('AUTH_ACCOUNT_INACTIVE');
  });

  it('truyền đúng mã SV / mã cán bộ / email sang bước liên kết', async () => {
    const { service, client, accountRepository } = build();
    client.profile.mockResolvedValueOnce({
      id: 'x',
      userName: 'gv',
      email: 'GV@uel.test',
      emailVerified: true,
    });
    client.assignments.mockResolvedValueOnce({
      publicServantNumber: 'NS003',
      status: 'active',
    });
    const { state } = await service.start();
    await service.handleCallback({ code: 'c', state }, state);
    expect(accountRepository.findLinkedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        publicServantNumber: 'NS003',
        email: 'GV@uel.test',
        emailVerified: true,
      }),
    );
  });

  it('verify báo token không active ⇒ SSO_PROVIDER_ERROR', async () => {
    const { service, client, accountRepository } = build();
    client.verify.mockResolvedValueOnce({ active: false });
    const { state } = await service.start();
    const t = await service.handleCallback({ code: 'c', state }, state);
    expect(errorOf(t)).toBe(SSO_ERROR_CODES.SSO_PROVIDER_ERROR);
    expect(accountRepository.findLinkedUser).not.toHaveBeenCalled();
  });

  it('chỉ có verify (profile/assignments lỗi) ⇒ vẫn liên kết theo username', async () => {
    const { service, client, accountRepository } = build();
    client.profile.mockRejectedValueOnce(
      new UelSsoError('x', 404, 'SSO_HTTP_ERROR'),
    );
    client.assignments.mockRejectedValueOnce(
      new UelSsoError('x', 404, 'SSO_HTTP_ERROR'),
    );
    client.verify.mockResolvedValueOnce({
      active: true,
      username: 'nguyenvana',
      preferredUsername: 'NS003',
      emailVerified: true,
    });
    const { state } = await service.start();
    const t = await service.handleCallback({ code: 'c', state }, state);
    expect(ticketOf(t)).toBeTruthy();
    expect(accountRepository.findLinkedUser).toHaveBeenCalledWith(
      expect.objectContaining({ userName: 'NS003', emailVerified: true }),
    );
  });

  it('cả 3 API PSC đều lỗi ⇒ SSO_PROVIDER_ERROR', async () => {
    const { service, client } = build();
    const err = new UelSsoError('x', 500, 'SSO_HTTP_ERROR');
    client.profile.mockRejectedValueOnce(err);
    client.assignments.mockRejectedValueOnce(err);
    client.verify.mockRejectedValueOnce(err);
    const { state } = await service.start();
    const t = await service.handleCallback({ code: 'c', state }, state);
    expect(errorOf(t)).toBe(SSO_ERROR_CODES.SSO_PROVIDER_ERROR);
  });

  describe('chế độ keycloak', () => {
    it('authorize qua Keycloak, đổi code kèm code_verifier, liên kết theo preferred_username', async () => {
      const { service, client, keycloak, accountRepository, states } = build({
        mode: 'keycloak',
      });
      const { url, state } = await service.start();
      expect(url).toContain('https://kc.test/realms/UEL');
      expect(client.buildAuthorizeUrl).not.toHaveBeenCalled();
      const verifier = (states.get(state) as { verifier: string }).verifier;

      const t = await service.handleCallback({ code: 'kc-code', state }, state);
      expect(ticketOf(t)).toBeTruthy();
      expect(keycloak.exchangeCode).toHaveBeenCalledWith(
        'kc-code',
        settings.redirectUri,
        verifier,
      );
      expect(keycloak.userinfo).toHaveBeenCalledWith('kc-at');
      expect(client.exchangeCode).not.toHaveBeenCalled();
      expect(accountRepository.findLinkedUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userName: 'NS003',
          email: 'gv@uel.edu.vn',
          emailVerified: true,
        }),
      );
    });

    it('đọc mã SV từ claim tùy biến nếu realm có mapper', async () => {
      const { service, keycloak, accountRepository } = build({
        mode: 'keycloak',
      });
      keycloak.userinfo.mockResolvedValueOnce({
        sub: 's',
        preferred_username: 'abc',
        student_id: ' K254061001 ',
      });
      const { state } = await service.start();
      await service.handleCallback({ code: 'c', state }, state);
      expect(accountRepository.findLinkedUser).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: 'K254061001', userName: 'abc' }),
      );
    });

    it('Keycloak từ chối đổi code ⇒ SSO_PROVIDER_ERROR', async () => {
      const { service, keycloak } = build({ mode: 'keycloak' });
      keycloak.exchangeCode.mockRejectedValueOnce(
        new UelSsoError('x', 400, 'SSO_HTTP_ERROR'),
      );
      const { state } = await service.start();
      const t = await service.handleCallback({ code: 'c', state }, state);
      expect(errorOf(t)).toBe(SSO_ERROR_CODES.SSO_PROVIDER_ERROR);
    });
  });
});

describe('UelSsoClient', () => {
  const okJson = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  it('đổi code: Basic auth + body đúng tài liệu PSC', async () => {
    const fetchFn = jest
      .fn()
      .mockImplementation(() =>
        okJson({ accessToken: 'at', expiresIn: 60, tokenType: 'Bearer' }),
      );
    const c = new UelSsoClient({
      baseUrl: 'http://sso.test',
      clientId: 'cid',
      clientSecret: 'sec',
      timeoutMs: 1000,
      fetchFn,
    });
    await c.exchangeCode('code1', 'http://be/cb');
    const [url, init] = fetchFn.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('http://sso.test/api/auth/tokens/authorization-code');
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('cid:sec').toString('base64')}`,
    );
    expect(JSON.parse(init.body)).toEqual({
      clientUrl: 'http://be/cb',
      authCode: 'code1',
      allowOfflineAccess: false,
    });
  });

  it('authorize URL lấy từ discovery, có PKCE S256; discovery được cache', async () => {
    const fetchFn = jest.fn().mockImplementation(() =>
      okJson({
        authorization_endpoint: 'http://sso.test/api/psc-sso/authorize',
      }),
    );
    const c = new UelSsoClient({
      baseUrl: 'http://sso.test',
      clientId: 'cid',
      clientSecret: 's',
      timeoutMs: 1000,
      fetchFn,
    });
    const u1 = new URL(
      await c.buildAuthorizeUrl({
        redirectUri: 'http://be/cb',
        scope: 'openid',
        state: 'st',
        codeChallenge: 'ch',
      }),
    );
    await c.buildAuthorizeUrl({
      redirectUri: 'http://be/cb',
      scope: 'openid',
      state: 'st2',
      codeChallenge: 'ch',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(u1.pathname).toBe('/api/psc-sso/authorize');
    expect(Object.fromEntries(u1.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cid',
      redirect_uri: 'http://be/cb',
      scope: 'openid',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });

  it('chấp nhận envelope { data } và báo lỗi HTTP', async () => {
    const fetchFn = jest
      .fn()
      .mockImplementationOnce(() =>
        okJson({ data: { id: '1', userName: 'u' } }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(new Response('no', { status: 401 })),
      );
    const c = new UelSsoClient({
      baseUrl: 'http://sso.test',
      clientId: 'c',
      clientSecret: 's',
      timeoutMs: 1000,
      fetchFn,
    });
    await expect(c.profile('at')).resolves.toEqual({ id: '1', userName: 'u' });
    await expect(c.assignments('at')).rejects.toMatchObject({
      status: 401,
      code: 'SSO_HTTP_ERROR',
    });
  });
});
