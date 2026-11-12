import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PartnerAccountRestrictionGuard } from './partner-account-restriction.guard.js';
import { PARTNER_DEPARTMENT_ID } from '../../../common/utils/partner-account.util.js';

describe('PartnerAccountRestrictionGuard', () => {
  const makeContext = (request: { user?: { userId: string } }) => {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  };

  const createGuard = (options: {
    departmentId: string | null;
    allowed?: boolean;
  }) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(options.allowed),
    };
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValue([{ department_code: options.departmentId === PARTNER_DEPARTMENT_ID ? 'PARTNER' : 'OTHER' }]),
    } as any;
    return new PartnerAccountRestrictionGuard(reflector as any, dataSource);
  };

  it('returns true immediately for non-partner users and does not read Reflector', async () => {
    const reflector = { getAllAndOverride: jest.fn() };
    const dataSource = {
      query: jest.fn().mockResolvedValue([{ department_id: 'other-dept' }]),
    } as any;
    const guard = new PartnerAccountRestrictionGuard(
      reflector as any,
      dataSource,
    );
    const result = await guard.canActivate(
      makeContext({ user: { userId: 'u1' } }),
    );
    expect(result).toBe(true);
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
  });

  it('allows partner accounts on decorated endpoints', async () => {
    const guard = createGuard({
      departmentId: PARTNER_DEPARTMENT_ID,
      allowed: true,
    });
    await expect(
      guard.canActivate(makeContext({ user: { userId: 'partner-1' } })),
    ).resolves.toBe(true);
  });

  it('blocks partner accounts on endpoints without the decorator', async () => {
    const guard = createGuard({
      departmentId: PARTNER_DEPARTMENT_ID,
      allowed: undefined,
    });
    await expect(
      guard.canActivate(makeContext({ user: { userId: 'partner-1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(makeContext({ user: { userId: 'partner-1' } })),
    ).rejects.toMatchObject({
      response: { error: { code: 'PARTNER_ACCOUNT_RESTRICTED' } },
    });
  });

  it('fails closed (503) when the DB lookup throws, instead of granting access', async () => {
    const reflector = { getAllAndOverride: jest.fn() };
    const dataSource = {
      query: jest.fn().mockRejectedValue(new Error('DB unavailable')),
    } as any;
    const guard = new PartnerAccountRestrictionGuard(
      reflector as any,
      dataSource,
    );

    await expect(
      guard.canActivate(makeContext({ user: { userId: 'u1' } })),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    // Không được im lặng cấp quyền khi không xác định được tài khoản có phải đối tác hay không.
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
  });
});
