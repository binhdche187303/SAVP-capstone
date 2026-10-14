import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthzReadRepository } from '../repositories/authz-read.repository.js';
import {
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from '../decorators/require-permissions.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authzRepo: AuthzReadRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const anyPermissions = this.reflector.getAllAndOverride<string[]>(
      ANY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const hasRequiredList =
      Array.isArray(requiredPermissions) && requiredPermissions.length > 0;
    const hasAnyList =
      Array.isArray(anyPermissions) && anyPermissions.length > 0;

    if (!hasRequiredList && !hasAnyList) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request['user'] as { userId?: string } | undefined;

    if (!user || !user.userId) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền thực hiện hành động này.',
        error: {
          code: 'FORBIDDEN',
          details: {},
        },
      });
    }

    const { permissions } =
      await this.authzRepo.getEffectiveRolesAndPermissions(user.userId);

    const hasAllPermissions =
      !hasRequiredList ||
      requiredPermissions.every((permission) =>
        permissions.includes(permission),
      );
    const hasAnyPermission =
      !hasAnyList ||
      anyPermissions.some((permission) => permissions.includes(permission));

    if (!hasAllPermissions || !hasAnyPermission) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền thực hiện hành động này.',
        error: {
          code: 'FORBIDDEN',
          details: {},
        },
      });
    }

    return true;
  }
}
