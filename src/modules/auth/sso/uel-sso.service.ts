import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { UsersAuthRepository } from '../repositories/users-auth.repository';
import { LoginService } from '../services/login.service';
import { LoginSuccessData, RequestContextInfo } from '../types/login.types';
import { UelSsoAccountRepository } from './uel-sso-account.repository';
import { UelSsoClient, UelSsoError } from './uel-sso.client';
import { KeycloakUserInfo, UelKeycloakClient } from './uel-sso-keycloak.client';
import {
  UEL_SSO_CLIENT,
  UEL_SSO_KEYCLOAK_CLIENT,
  UEL_SSO_SETTINGS,
} from './uel-sso.config';
import type { UelSsoSettings } from './uel-sso.config';
import { UelSsoStateStore } from './uel-sso-state.store';

/** Mã lỗi BE trả về FE qua /sso/callback?error=... */
export const SSO_ERROR_CODES = {
  SSO_DISABLED: 'SSO_DISABLED',
  SSO_CANCELLED: 'SSO_CANCELLED',
  SSO_PROVIDER_ERROR: 'SSO_PROVIDER_ERROR',
  SSO_INVALID_CALLBACK: 'SSO_INVALID_CALLBACK',
  SSO_STATE_INVALID: 'SSO_STATE_INVALID',
  SSO_ACCOUNT_INACTIVE: 'SSO_ACCOUNT_INACTIVE',
  SSO_ACCOUNT_NOT_LINKED: 'SSO_ACCOUNT_NOT_LINKED',
  SSO_ACCOUNT_AMBIGUOUS: 'SSO_ACCOUNT_AMBIGUOUS',
  SSO_TICKET_INVALID: 'SSO_TICKET_INVALID',
} as const;

export interface SsoCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

interface SsoResolvedIdentity {
  studentId?: string;
  publicServantNumber?: string;
  /** Tên đăng nhập UEL — có thể là mã SV / mã cán bộ / email tùy cách trường cấp. */
  userName?: string;
  email?: string;
  emailVerified?: boolean;
  enabled?: boolean;
  status?: string;
}

const base64url = (buf: Buffer) => buf.toString('base64url');

@Injectable()
export class UelSsoService {
  private readonly logger = new Logger(UelSsoService.name);

  constructor(
    @Inject(UEL_SSO_SETTINGS) private readonly settings: UelSsoSettings,
    @Inject(UEL_SSO_CLIENT) private readonly client: UelSsoClient,
    @Inject(UEL_SSO_KEYCLOAK_CLIENT)
    private readonly keycloak: UelKeycloakClient,
    private readonly stateStore: UelSsoStateStore,
    private readonly accountRepository: UelSsoAccountRepository,
    private readonly usersAuthRepository: UsersAuthRepository,
    private readonly loginService: LoginService,
  ) {}

  get enabled(): boolean {
    return this.settings.usable;
  }

  private get useKeycloak(): boolean {
    return this.settings.mode === 'keycloak';
  }

  get feCallbackUrl(): string {
    return this.settings.feCallbackUrl;
  }

  /** URL FE kèm lỗi — dùng cả khi SSO tắt. */
  feErrorUrl(code: string): string {
    return this.withQuery({ error: code });
  }

  /** Bước 1: tạo state + PKCE, trả URL authorize (PSC hoặc Keycloak). */
  async start(): Promise<{ url: string; state: string }> {
    const verifier = base64url(randomBytes(32));
    const codeChallenge = base64url(
      createHash('sha256').update(verifier).digest(),
    );
    const state = base64url(randomBytes(24));
    await this.stateStore.saveState(state, { verifier, createdAt: Date.now() });
    const provider = this.useKeycloak ? this.keycloak : this.client;
    const url = await provider.buildAuthorizeUrl({
      redirectUri: this.settings.redirectUri,
      scope: this.settings.scopes,
      state,
      codeChallenge,
    });
    return { url, state };
  }

  /**
   * Bước 2: PSC redirect về callback. Luôn trả URL FE (?ticket= hoặc ?error=) —
   * không ném lỗi ra trình duyệt.
   */
  async handleCallback(
    query: SsoCallbackQuery,
    cookieState: string | undefined,
  ): Promise<string> {
    if (query.error) {
      // Vẫn tiêu state để không dùng lại được.
      if (query.state) await this.stateStore.takeState(query.state);
      return this.feErrorUrl(
        query.error === 'access_denied'
          ? SSO_ERROR_CODES.SSO_CANCELLED
          : SSO_ERROR_CODES.SSO_PROVIDER_ERROR,
      );
    }
    if (!query.code || !query.state) {
      return this.feErrorUrl(SSO_ERROR_CODES.SSO_INVALID_CALLBACK);
    }

    const pending = await this.stateStore.takeState(query.state);
    // State phải còn trong Redis VÀ trùng cookie của chính trình duyệt đã bấm đăng nhập (chống login-CSRF).
    if (!pending || !cookieState || cookieState !== query.state) {
      return this.feErrorUrl(SSO_ERROR_CODES.SSO_STATE_INVALID);
    }

    let identity: SsoResolvedIdentity;
    try {
      if (this.useKeycloak) {
        identity = await this.keycloakIdentity(query.code, pending.verifier);
      } else {
        const tokens = await this.client.exchangeCode(
          query.code,
          this.settings.redirectUri,
        );
        identity = await this.collectIdentity(tokens.accessToken);
      }
    } catch (error) {
      this.logger.warn(
        `SSO UEL lỗi khi đổi code/lấy hồ sơ: ${
          error instanceof UelSsoError
            ? `${error.code} ${error.message}`
            : (error as Error).message
        }`,
      );
      return this.feErrorUrl(SSO_ERROR_CODES.SSO_PROVIDER_ERROR);
    }

    if (
      identity.enabled === false ||
      (identity.status && identity.status.toLowerCase() !== 'active')
    ) {
      return this.feErrorUrl(SSO_ERROR_CODES.SSO_ACCOUNT_INACTIVE);
    }

    const link = await this.accountRepository.findLinkedUser(identity);
    if (link.kind !== 'linked') {
      this.logger.warn(
        `SSO UEL: không liên kết được tài khoản (userName=${identity.userName ?? '?'}, ${link.kind}${
          link.kind === 'ambiguous' ? ` theo ${link.matchedBy}` : ''
        })`,
      );
      return this.feErrorUrl(
        link.kind === 'ambiguous'
          ? SSO_ERROR_CODES.SSO_ACCOUNT_AMBIGUOUS
          : SSO_ERROR_CODES.SSO_ACCOUNT_NOT_LINKED,
      );
    }

    const failCode = await this.checkUsable(link.userId);
    if (failCode) return this.feErrorUrl(failCode);

    const ticket = base64url(randomBytes(32));
    await this.stateStore.saveTicket(ticket, {
      userId: link.userId,
      matchedBy: link.matchedBy,
    });
    return this.withQuery({ ticket });
  }

  /** Bước 3: FE đổi ticket (dùng 1 lần, 60 giây) lấy JWT của hệ thống. */
  async redeem(
    ticket: string,
    ctx: RequestContextInfo,
  ): Promise<LoginSuccessData> {
    const data = await this.stateStore.takeTicket(ticket);
    const user = data
      ? await this.usersAuthRepository.findById(data.userId)
      : null;
    if (!data || !user) {
      throw new UnauthorizedException({
        code: SSO_ERROR_CODES.SSO_TICKET_INVALID,
        message: 'Phiên đăng nhập SSO không hợp lệ hoặc đã hết hạn.',
      });
    }
    // Trạng thái có thể đổi giữa callback và lúc đổi ticket.
    this.loginService.assertAccountUsable(user);
    const { result } = await this.loginService.issueSession(
      user,
      ctx,
      'uel_sso',
    );
    return result;
  }

  /**
   * Gom danh tính từ 3 API của PSC (profile / assignments / verify), gọi song song.
   * API nào lỗi thì bỏ qua API đó — chỉ thất bại khi cả 3 đều lỗi hoặc token không còn active.
   * Chỉ log TÊN trường mỗi API trả về (không log giá trị) để đối chiếu khi chạy với SSO thật.
   */
  private async collectIdentity(
    accessToken: string,
  ): Promise<SsoResolvedIdentity> {
    const [p, a, v] = await Promise.allSettled([
      this.client.profile(accessToken),
      this.client.assignments(accessToken),
      this.client.verify(accessToken),
    ]);
    const profile = p.status === 'fulfilled' ? p.value : null;
    const assignments = a.status === 'fulfilled' ? a.value : null;
    const info = v.status === 'fulfilled' ? v.value : null;

    const describe = (name: string, r: PromiseSettledResult<object>): string =>
      r.status === 'fulfilled'
        ? `${name}[${Object.keys(r.value).join(',')}]`
        : `${name}=lỗi(${r.reason instanceof UelSsoError ? (r.reason.status ?? r.reason.code) : 'unknown'})`;
    this.logger.log(
      `SSO UEL trả về: ${describe('profile', p)} ${describe('assignments', a)} ${describe('verify', v)}`,
    );

    if (!profile && !assignments && !info) {
      throw p.status === 'rejected'
        ? p.reason
        : new Error('SSO UEL: không lấy được danh tính');
    }
    if (info?.active === false) {
      throw new UelSsoError(
        'Access token SSO không còn hiệu lực',
        null,
        'SSO_TOKEN_INVALID',
      );
    }

    const userName =
      info?.preferredUsername ??
      info?.username ??
      profile?.userName ??
      assignments?.userName;
    return {
      studentId: assignments?.studentId,
      publicServantNumber: assignments?.publicServantNumber,
      userName,
      email: profile?.email,
      emailVerified: profile?.emailVerified ?? info?.emailVerified,
      enabled: profile?.enabled,
      status: assignments?.status,
    };
  }

  /**
   * Chế độ Keycloak: đổi code (kèm code_verifier) rồi đọc userinfo.
   * Keycloak tự chặn tài khoản bị khóa ở bước đăng nhập nên không cần cờ enabled/status.
   * Mã SV / mã cán bộ chỉ có nếu realm UEL có mapper — đọc vài tên claim thường gặp.
   */
  private async keycloakIdentity(
    code: string,
    codeVerifier: string,
  ): Promise<SsoResolvedIdentity> {
    const tokens = await this.keycloak.exchangeCode(
      code,
      this.settings.redirectUri,
      codeVerifier,
    );
    const claims = await this.keycloak.userinfo(tokens.accessToken);
    this.logger.log(
      `SSO UEL (Keycloak) userinfo[${Object.keys(claims).join(',')}]`,
    );
    return {
      userName: claimStr(claims, 'preferred_username'),
      email: claimStr(claims, 'email'),
      emailVerified:
        typeof claims.email_verified === 'boolean'
          ? claims.email_verified
          : undefined,
      studentId: claimStr(claims, 'studentId', 'student_id', 'ma_sinh_vien'),
      publicServantNumber: claimStr(
        claims,
        'publicServantNumber',
        'public_servant_number',
        'employee_code',
        'ma_nhan_su',
      ),
    };
  }

  private async checkUsable(userId: string): Promise<string | null> {
    const user = await this.usersAuthRepository.findById(userId);
    if (!user) return SSO_ERROR_CODES.SSO_ACCOUNT_NOT_LINKED;
    try {
      this.loginService.assertAccountUsable(user);
      return null;
    } catch (error) {
      if (error instanceof HttpException) {
        const res = error.getResponse() as { code?: string };
        if (res && typeof res === 'object' && res.code) return res.code;
      }
      throw error;
    }
  }

  private withQuery(params: Record<string, string>): string {
    const url = new URL(this.settings.feCallbackUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  }
}

/** Claim chuỗi đầu tiên có giá trị (đã trim) trong các tên cho trước. */
function claimStr(
  claims: KeycloakUserInfo,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const v = claims[name];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}
