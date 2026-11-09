import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Shape of the user row returned by SELECT FOR UPDATE.
 * Fields are mapped from snake_case DB columns to camelCase.
 */
export interface UserChangePasswordRecord {
  id: string;
  passwordHash: string | null;
  accountStatus: string;
  mustChangePassword: boolean;
  deletedAt: Date | null;
}

@Injectable()
export class UsersChangePasswordRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Reads the user row with a row-level lock (SELECT ... FOR UPDATE).
   * MUST be called inside an active TypeORM transaction.
   *
   * Returns null if no user found with the given id.
   */
  async findByIdForUpdate(
    userId: string,
    transactionalEntityManager: EntityManager,
  ): Promise<UserChangePasswordRecord | null> {
    const rows: Array<{
      id: string;
      password_hash: string;
      account_status: string;
      must_change_password: boolean;
      deleted_at: Date | null;
    }> = await transactionalEntityManager.query(
      `
        SELECT id, password_hash, account_status, must_change_password, deleted_at
        FROM users
        WHERE id = $1
        FOR UPDATE
      `,
      [userId],
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      passwordHash: row.password_hash,
      accountStatus: row.account_status,
      mustChangePassword: row.must_change_password,
      deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    };
  }

  /**
   * Updates password_hash, password_updated_at, must_change_password=false and updated_at.
   * MUST be called inside the same transaction as findByIdForUpdate.
   * Includes `deleted_at IS NULL` guard to avoid updating soft-deleted accounts.
   */
  async updatePassword(
    transactionalEntityManager: EntityManager,
    userId: string,
    newPasswordHash: string,
  ): Promise<void> {
    await transactionalEntityManager.query(
      `
        UPDATE users
        SET password_hash        = $2,
            password_updated_at  = NOW(),
            must_change_password = false,
            updated_at           = NOW()
        WHERE id         = $1
          AND deleted_at IS NULL
      `,
      [userId, newPasswordHash],
    );
  }

  /**
   * Reads only must_change_password for the MustChangePasswordGuard.
   * Uses the shared DataSource (NOT transactional) — read-only, fast lookup.
   *
   * Returns null if user not found or soft-deleted.
   */
  async findMustChangePassword(
    userId: string,
  ): Promise<{ mustChangePassword: boolean } | null> {
    const rows: Array<{ must_change_password: boolean }> =
      await this.dataSource.query(
        `
          SELECT must_change_password
          FROM users
          WHERE id         = $1
            AND deleted_at IS NULL
          LIMIT 1
        `,
        [userId],
      );

    if (!rows || rows.length === 0) {
      return null;
    }

    return { mustChangePassword: rows[0].must_change_password };
  }
}
