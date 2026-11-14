import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoginMethod } from '../types/login.types';

@Injectable()
export class AuthAuditRepository {
  constructor(private readonly dataSource: DataSource) {}

  async logLoginSuccess(params: {
    userId: string;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
    jti: string;
    method?: LoginMethod;
  }): Promise<void> {
    await this.dataSource.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, ip_address, user_agent, request_id, severity, metadata_json)
        VALUES ($1, 'login', 'users', $2, $3, $4, $5, 'info', $6::jsonb)
      `,
      [
        params.userId,
        params.userId,
        params.ipAddress ?? null,
        params.userAgent ?? null,
        params.requestId ?? null,
        JSON.stringify(
          params.method && params.method !== 'password'
            ? { jti: params.jti, method: params.method }
            : { jti: params.jti },
        ),
      ],
    );
  }

  async logLogoutSuccess(params: {
    userId: string;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
    jti: string;
  }): Promise<void> {
    await this.dataSource.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, ip_address, user_agent, request_id, severity, metadata_json)
        VALUES ($1, 'logout', 'users', $2, $3, $4, $5, 'info', $6::jsonb)
      `,
      [
        params.userId,
        params.userId,
        params.ipAddress ?? null,
        params.userAgent ?? null,
        params.requestId ?? null,
        JSON.stringify({ jti: params.jti, method: 'manual' }),
      ],
    );
  }
}
