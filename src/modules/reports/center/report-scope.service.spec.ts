import { ForbiddenException } from '@nestjs/common';
import { REPORT_DEFINITIONS } from './report-definition.registry.js';
import { ReportScopeService } from './report-scope.service.js';

const make = (roles: string[], managed: string[] = [], staffDept: string | null = null) => {
  const authz = { getEffectiveRolesAndPermissions: jest.fn().mockResolvedValue({ roles, permissions: [] }) };
  const ds = {
    query: jest.fn(async (sql: string) => {
      if (/manager_user_id/.test(sql)) return managed.map((id) => ({ id }));
      if (/FROM users/.test(sql)) return [{ department_id: staffDept }];
      return [];
    }),
  };
  return new ReportScopeService(ds as never, authz as never);
};
const code = (e: unknown) => (e as ForbiddenException).getResponse() as { error: { code: string } };

describe('ReportScopeService', () => {
  it('quản trị → không giới hạn', async () => {
    for (const role of ['SYSTEM_ADMIN', 'BUSINESS_ADMIN']) {
      await expect(make([role]).resolve('u', REPORT_DEFINITIONS.vehicle, { from: 'a', to: 'b' })).resolves.toEqual({ unrestricted: true, departmentIds: null });
    }
  });

  it('MANAGER không chọn đơn vị → toàn bộ đơn vị mình quản lý', async () => {
    const r = await make(['MANAGER'], ['d1', 'd2']).resolve('u', REPORT_DEFINITIONS['staff-attendance'], { from: 'a', to: 'b' });
    expect(r).toEqual({ unrestricted: false, departmentIds: ['d1', 'd2'] });
  });

  it('MANAGER chọn đơn vị trong phạm vi → chỉ đơn vị đó', async () => {
    const r = await make(['MANAGER'], ['d1', 'd2']).resolve('u', REPORT_DEFINITIONS['staff-attendance'], { from: 'a', to: 'b', departmentId: 'd2' });
    expect(r.departmentIds).toEqual(['d2']);
  });

  it('MANAGER chọn đơn vị ngoài phạm vi → 403 DEPARTMENT_OUT_OF_SCOPE', async () => {
    const p = make(['MANAGER'], ['d1']).resolve('u', REPORT_DEFINITIONS['staff-attendance'], { from: 'a', to: 'b', departmentId: 'dx' });
    await expect(p).rejects.toBeInstanceOf(ForbiddenException);
    await p.catch((e) => expect(code(e).error.code).toBe('DEPARTMENT_OUT_OF_SCOPE'));
  });

  it('MANAGER chọn cán bộ ngoài phạm vi → 403 DEPARTMENT_OUT_OF_SCOPE', async () => {
    const p = make(['MANAGER'], ['d1'], 'dx').resolve('u', REPORT_DEFINITIONS['staff-attendance'], { from: 'a', to: 'b', staffId: 's1' });
    await p.catch((e) => expect(code(e).error.code).toBe('DEPARTMENT_OUT_OF_SCOPE'));
    await expect(p).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('MANAGER xin loại không có chiều đơn vị → 403 REPORT_OUT_OF_SCOPE', async () => {
    for (const type of ['vehicle', 'security-alert'] as const) {
      const p = make(['MANAGER'], ['d1']).resolve('u', REPORT_DEFINITIONS[type], { from: 'a', to: 'b' });
      await p.catch((e) => expect(code(e).error.code).toBe('REPORT_OUT_OF_SCOPE'));
      await expect(p).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('MANAGER không quản lý đơn vị nào → phạm vi rỗng (không có dữ liệu), không phải toàn bộ', async () => {
    const r = await make(['MANAGER'], []).resolve('u', REPORT_DEFINITIONS['staff-attendance'], { from: 'a', to: 'b' });
    expect(r).toEqual({ unrestricted: false, departmentIds: [] });
  });

  it('vai trò khác → 403 PERMISSION_DENIED', async () => {
    const p = make(['EMPLOYEE']).resolve('u', REPORT_DEFINITIONS['staff-attendance'], { from: 'a', to: 'b' });
    await p.catch((e) => expect(code(e).error.code).toBe('PERMISSION_DENIED'));
    await expect(p).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('unavailableReason — danh mục báo cáo theo vai trò', () => {
    it('quản trị: mọi loại đều dùng được', async () => {
      for (const role of ['SYSTEM_ADMIN', 'BUSINESS_ADMIN']) {
        for (const def of Object.values(REPORT_DEFINITIONS)) {
          await expect(make([role]).unavailableReason('u', def)).resolves.toBeNull();
        }
      }
    });

    it('MANAGER: loại có chiều đơn vị dùng được, loại không có thì có lý do để ẩn khỏi danh mục', async () => {
      await expect(make(['MANAGER'], ['d1']).unavailableReason('u', REPORT_DEFINITIONS['staff-attendance'])).resolves.toBeNull();
      for (const type of ['vehicle', 'security-alert'] as const) {
        await expect(make(['MANAGER'], ['d1']).unavailableReason('u', REPORT_DEFINITIONS[type])).resolves.toBe(
          'Báo cáo này không có phạm vi theo đơn vị của bạn.',
        );
      }
    });

    it('vai trò khác: không loại nào dùng được', async () => {
      await expect(make(['EMPLOYEE']).unavailableReason('u', REPORT_DEFINITIONS.visitor)).resolves.toBe('Bạn không có quyền xem báo cáo này.');
    });

    it('khớp với resolve(): cùng điều kiện thì resolve ném, unavailableReason trả lý do', async () => {
      const svc = make(['MANAGER'], ['d1']);
      await expect(svc.resolve('u', REPORT_DEFINITIONS.vehicle, { from: 'a', to: 'b' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.unavailableReason('u', REPORT_DEFINITIONS.vehicle)).resolves.not.toBeNull();
    });
  });
});
