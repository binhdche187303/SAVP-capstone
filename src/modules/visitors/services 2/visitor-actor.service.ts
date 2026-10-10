import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import type { Actor } from './visit.service.js';

/** Dựng `Actor` (id + toàn bộ quyền hiệu lực) từ người dùng đã xác thực, và kiểm quyền "một trong". */
@Injectable()
export class VisitorActorService {
  constructor(private readonly authz: AuthzReadRepository) {}

  async resolve(user: { userId?: string } | undefined): Promise<Actor> {
    if (!user?.userId) throw this.forbidden();
    const { permissions } = await this.authz.getEffectiveRolesAndPermissions(user.userId);
    return { userId: user.userId, permissions };
  }

  requireAny(actor: Actor, ...permissions: string[]): void {
    if (!permissions.some((p) => actor.permissions.includes(p))) throw this.forbidden();
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({ success: false, message: 'Bạn không có quyền thực hiện hành động này.', error: { code: 'FORBIDDEN', details: {} } });
  }
}
