import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { LoginResponsePresenter } from '../presenters/login-response.presenter';
import { SsoExchangeDto } from './dto/sso-exchange.dto';
import { SSO_STATE_TTL_SECONDS } from './uel-sso-state.store';
import {
  SSO_ERROR_CODES,
  UelSsoService,
  type SsoCallbackQuery,
} from './uel-sso.service';

const STATE_COOKIE = 'uel_sso_state';
const COOKIE_PATH = '/api/v1/auth/sso';

/**
 * Đăng nhập một lần UEL (PSC SSO).
 *  1. FE chuyển trình duyệt tới GET /auth/sso/login → 302 sang trang đăng nhập UEL.
 *  2. UEL redirect về GET /auth/sso/callback → BE đổi code, tìm tài khoản, 302 về FE /sso/callback?ticket=...
 *  3. FE gọi POST /auth/sso/exchange { ticket } → nhận JWT như đăng nhập thường.
 */
@ApiTags('Authentication')
@Controller('auth/sso')
export class UelSsoController {
  private readonly logger = new Logger(UelSsoController.name);

  constructor(
    private readonly sso: UelSsoService,
    private readonly presenter: LoginResponsePresenter,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'FE hỏi có hiển thị nút đăng nhập UEL không' })
  config() {
    return {
      success: true,
      message: 'OK',
      data: { enabled: this.sso.enabled },
      meta: {},
    };
  }

  @Get('login')
  @ApiOperation({ summary: 'Bắt đầu đăng nhập UEL — redirect sang PSC SSO' })
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.sso.enabled) {
      this.redirectDisabled(res);
      return;
    }
    try {
      const { url, state } = await this.sso.start();
      res.cookie(STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps(req),
        path: COOKIE_PATH,
        maxAge: SSO_STATE_TTL_SECONDS * 1000,
      });
      res.redirect(HttpStatus.FOUND, url);
    } catch (error) {
      this.logger.warn(
        `Không khởi tạo được đăng nhập UEL: ${(error as Error).message}`,
      );
      res.redirect(
        HttpStatus.FOUND,
        this.sso.feErrorUrl(SSO_ERROR_CODES.SSO_PROVIDER_ERROR),
      );
    }
  }

  @Get('callback')
  @ApiOperation({ summary: 'PSC SSO redirect về đây (redirect_uri)' })
  async callback(
    @Query() query: SsoCallbackQuery,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.sso.enabled) {
      this.redirectDisabled(res);
      return;
    }
    const cookieState = readCookie(req, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { path: COOKIE_PATH });
    let target: string;
    try {
      target = await this.sso.handleCallback(
        {
          code: str(query.code),
          state: str(query.state),
          error: str(query.error),
        },
        cookieState,
      );
    } catch (error) {
      this.logger.error(
        `Lỗi xử lý callback SSO UEL: ${(error as Error).message}`,
        (error as Error).stack,
      );
      target = this.sso.feErrorUrl(SSO_ERROR_CODES.SSO_PROVIDER_ERROR);
    }
    res.redirect(HttpStatus.FOUND, target);
  }

  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Đổi ticket dùng 1 lần lấy access/refresh token' })
  async exchange(
    @Body() dto: SsoExchangeDto,
    @Ip() ipAddress: string,
    @Headers('x-request-id') requestId?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const result = await this.sso.redeem(dto.ticket, {
      ipAddress,
      requestId,
      userAgent,
    });
    return this.presenter.success(result);
  }

  private redirectDisabled(res: Response): void {
    if (this.sso.feCallbackUrl) {
      res.redirect(
        HttpStatus.FOUND,
        this.sso.feErrorUrl(SSO_ERROR_CODES.SSO_DISABLED),
      );
      return;
    }
    res.status(HttpStatus.NOT_FOUND).json({
      success: false,
      message: 'Đăng nhập UEL chưa được bật.',
      error: { code: SSO_ERROR_CODES.SSO_DISABLED, details: {} },
    });
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function isHttps(req: Request): boolean {
  return (
    req.secure ||
    String(req.headers['x-forwarded-proto'] ?? '')
      .split(',')[0]
      .trim() === 'https'
  );
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
