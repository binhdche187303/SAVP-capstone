import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { UsersService } from '../../accounts/services/users.service.js';
import { normalizeVnPhone } from '../domain/phone.util.js';

export interface VisitorIdentityInput {
  fullName: string;
  idNumber?: string | null;
  phone: string;
  email?: string | null;
  organization?: string | null;
}

interface VisitorRow {
  id: string;
  user_id: string;
}

/**
 * VisitorIdentityService — một con người = một dòng `visitors` + một tài khoản ẩn trong `users`.
 * Định danh: trùng CCCD (nếu có), không thì trùng số điện thoại. Chống tranh chấp bằng unique + đọc lại khi 23505.
 */
@Injectable()
export class VisitorIdentityService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
  ) {}

  async resolve(input: VisitorIdentityInput, manager?: EntityManager): Promise<{ visitorId: string; userId: string; created: boolean }> {
    if (manager) return this.resolveIn(manager, input);
    return this.dataSource.transaction((m) => this.resolveIn(m, input));
  }

  private async resolveIn(manager: EntityManager, input: VisitorIdentityInput) {
    const idNumber = input.idNumber?.trim() || null;
    const phone = normalizeVnPhone(input.phone);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const existing = await this.find(manager, idNumber, phone);
      if (existing) {
        await manager.query(
          `UPDATE visitors SET full_name = $2, phone_number = $3, email = COALESCE($4, email),
                  organization = COALESCE($5, organization), id_number = COALESCE(id_number, $6), updated_at = now()
            WHERE id = $1`,
          [existing.id, input.fullName.trim(), phone, input.email?.trim() || null, input.organization?.trim() || null, idNumber],
        );
        return { visitorId: existing.id, userId: existing.user_id, created: false };
      }
      const visitorId = randomUUID();
      // SAVEPOINT để bắt 23505 mà không làm hỏng transaction của người gọi.
      await manager.query('SAVEPOINT visitor_identity_insert');
      try {
        const { userId } = await this.usersService.createVisitorShadowUser(manager, { visitorId, fullName: input.fullName.trim() });
        await manager.query(
          `INSERT INTO visitors (id, user_id, full_name, id_number, phone_number, email, organization)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [visitorId, userId, input.fullName.trim(), idNumber, phone, input.email?.trim() || null, input.organization?.trim() || null],
        );
        await manager.query('RELEASE SAVEPOINT visitor_identity_insert');
        return { visitorId, userId, created: true };
      } catch (e) {
        await manager.query('ROLLBACK TO SAVEPOINT visitor_identity_insert');
        if ((e as { code?: string }).code !== '23505') throw e;
        // Người khác vừa tạo cùng khách: vòng lặp sau sẽ đọc lại.
      }
    }
    throw new Error('Không định danh được khách sau khi thử lại');
  }

  private async find(manager: EntityManager, idNumber: string | null, phone: string): Promise<VisitorRow | null> {
    if (idNumber) {
      const byId: VisitorRow[] = await manager.query(
        `SELECT id, user_id FROM visitors WHERE id_number = $1 AND deleted_at IS NULL LIMIT 1`,
        [idNumber],
      );
      if (byId[0]) return byId[0];
    }
    const byPhone: VisitorRow[] = await manager.query(
      `SELECT id, user_id FROM visitors WHERE phone_number = $1 AND ($2::varchar IS NULL OR id_number IS NULL) AND deleted_at IS NULL LIMIT 1`,
      [phone, idNumber],
    );
    return byPhone[0] ?? null;
  }
}
