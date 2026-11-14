import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

export const SSO_STATE_TTL_SECONDS = 600;
const TICKET_TTL_SECONDS = 60;

export interface SsoPendingState {
  verifier: string;
  createdAt: number;
}

/** Ticket dùng 1 lần FE đổi lấy JWT. KHÔNG chứa token — JWT chỉ được cấp lúc đổi ticket. */
export interface SsoTicket {
  userId: string;
  matchedBy: string;
}

@Injectable()
export class UelSsoStateStore {
  constructor(private readonly redis: RedisService) {}

  saveState(state: string, value: SsoPendingState): Promise<void> {
    return this.redis.setJsonWithTtl(
      `sso:state:${state}`,
      value,
      SSO_STATE_TTL_SECONDS,
    );
  }

  takeState(state: string): Promise<SsoPendingState | null> {
    return this.redis.takeJson<SsoPendingState>(`sso:state:${state}`);
  }

  saveTicket(ticket: string, value: SsoTicket): Promise<void> {
    return this.redis.setJsonWithTtl(
      `sso:ticket:${ticket}`,
      value,
      TICKET_TTL_SECONDS,
    );
  }

  takeTicket(ticket: string): Promise<SsoTicket | null> {
    return this.redis.takeJson<SsoTicket>(`sso:ticket:${ticket}`);
  }
}
