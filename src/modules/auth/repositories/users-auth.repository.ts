import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthenticatedUserRecord } from '../types/login.types';

@Injectable()
export class UsersAuthRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findByNormalizedEmail(
    email: string,
  ): Promise<AuthenticatedUserRecord | null> {
    const row = await this.dataSource.query(
      `
        SELECT id, email, password_hash, full_name, avatar_url, department_id, account_status, account_expires_at, must_change_password
        FROM users
        WHERE email = $1 AND deleted_at IS NULL
        LIMIT 1
      `,
      [email],
    );

    if (!row[0]) {
      return null;
    }

    return {
      id: row[0].id,
      email: row[0].email,
      passwordHash: row[0].password_hash,
      fullName: row[0].full_name,
      avatarUrl: row[0].avatar_url ?? null,
      departmentId: row[0].department_id ?? null,
      accountExpiresAt: row[0].account_expires_at
        ? new Date(row[0].account_expires_at)
        : null,
      accountStatus: row[0].account_status,
      mustChangePassword: row[0].must_change_password === true,
    };
  }

  async findById(userId: string): Promise<AuthenticatedUserRecord | null> {
    const row = await this.dataSource.query(
      `
        SELECT id, email, password_hash, full_name, avatar_url, department_id, account_status, account_expires_at, must_change_password
        FROM users
        WHERE id = $1 AND deleted_at IS NULL
        LIMIT 1
      `,
      [userId],
    );

    if (!row[0]) {
      return null;
    }

    return {
      id: row[0].id,
      email: row[0].email,
      passwordHash: row[0].password_hash,
      fullName: row[0].full_name,
      avatarUrl: row[0].avatar_url ?? null,
      departmentId: row[0].department_id ?? null,
      accountExpiresAt: row[0].account_expires_at
        ? new Date(row[0].account_expires_at)
        : null,
      accountStatus: row[0].account_status,
      mustChangePassword: row[0].must_change_password === true,
    };
  }

  async updateLastLoginAt(userId: string, loggedAt: Date): Promise<void> {
    await this.dataSource.query(
      `UPDATE users SET last_login_at = $2, updated_at = now() WHERE id = $1`,
      [userId, loggedAt.toISOString()],
    );
  }
}
