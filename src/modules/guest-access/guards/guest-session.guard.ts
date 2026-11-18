import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { GuestSessionService } from '../services/guest-session.service.js';
import { GuestAccessCacheService } from '../services/guest-access-cache.service.js';
import { GUEST_ACCESS_ERROR_CODES } from '../constants/guest-access-error.constant.js';
import { GuestRequestContext } from '../types/guest-jwt-payload.type.js';

/**
 * GuestSessionGuard — xác thực token phiên khách.
 *
 * Gán `request.guest` — **KHÔNG BAO GIỜ** gán `request.user`. Nhờ đó, nếu
 * guest token lỡ được gửi tới bất kỳ controller nội bộ nào đọc
 * `request['user'].userId`, request đó tự động thất bại (undefined access)
 * thay vì được xử lý như một user hợp lệ — fail-closed theo thiết kế
 * (spec FR-GLA-021).
 *
 * Đặt TRƯỚC `GuestMeetingScopeGuard` trong `@UseGuards(...)`.
 */
@Injectable()
export class GuestSessionGuard implements CanActivate {
  constructor(
    private readonly guestSessionService: GuestSessionService,
    private readonly cache: GuestAccessCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw this.invalidSession();
    }

    let payload;
    try {
      payload = await this.guestSessionService.verifyGuestToken(token);
    } catch {
      throw this.invalidSession();
    }

    const isRevoked = await this.cache.isSessionRevoked(payload.jti);
    if (isRevoked) {
      throw this.invalidSession();
    }

    const invalidAfter = await this.cache.getInviteInvalidAfter(payload.sub);
    if (invalidAfter !== null && payload.iat * 1000 < invalidAfter) {
      throw this.invalidSession();
    }

    const guestContext: GuestRequestContext = {
      externalParticipantId: payload.sub,
      meetingId: payload.mid,
      jti: payload.jti,
    };
    (request as unknown as { guest: GuestRequestContext }).guest = guestContext;

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private invalidSession(): UnauthorizedException {
    return new UnauthorizedException({
      success: false,
      message: 'Phiên truy cập không hợp lệ hoặc đã hết hạn.',
      error: {
        code: GUEST_ACCESS_ERROR_CODES.GUEST_SESSION_INVALID,
        details: {},
      },
    });
  }
}
