/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { BadRequestException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  AutoAuditInterceptor,
  actionFromRoute,
  sanitize,
} from './auto-audit.interceptor.js';

/** [2026-11-27] Nhật ký tự động cho mọi thao tác thay đổi dữ liệu. */
describe('AutoAuditInterceptor', () => {
  let audit: { logAction: jest.Mock };
  let query: jest.Mock;
  let interceptor: AutoAuditInterceptor;
  const ID = '11111111-1111-1111-1111-111111111111';

  const ctx = (over: any = {}) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/api/v1/camera-groups',
          originalUrl: '/api/v1/camera-groups',
          route: { path: '/api/v1/camera-groups' },
          params: {},
          body: { name: 'Nhóm A', password: 'x' },
          headers: { 'user-agent': 'UA' },
          ip: '1.2.3.4',
          user: { userId: 'u1' },
          ...over,
        }),
      }),
    }) as any;
  const flush = () => new Promise((r) => setImmediate(r));

  beforeEach(() => {
    audit = { logAction: jest.fn().mockResolvedValue(undefined) };
    query = jest.fn().mockResolvedValue([]);
    interceptor = new AutoAuditInterceptor(audit as any, { query } as any);
  });

  it('actionFromRoute: bỏ tham số, nối nhánh + động từ', () => {
    expect(actionFromRoute('POST', '/api/v1/camera-groups')).toEqual({
      actionType: 'camera_groups_create',
      entityType: 'camera_groups',
    });
    expect(
      actionFromRoute('DELETE', 'api/v1/camera-groups/:id/members/:cameraId'),
    ).toEqual({
      actionType: 'camera_groups_members_delete',
      entityType: 'camera_groups',
    });
    expect(
      actionFromRoute('PATCH', '/anpr/admin/vehicles/:id').actionType,
    ).toBe('anpr_admin_vehicles_update');
  });

  it('sanitize: ẩn mật khẩu/OTP/ảnh, cắt chuỗi dài', () => {
    const out: any = sanitize(
      { password: 'p', otp: '1', imageBase64: 'x', note: 'a'.repeat(300) },
      0,
    );
    expect(out.password).toBe('[ẩn]');
    expect(out.otp).toBe('[ẩn]');
    expect(out.imageBase64).toBe('[ẩn]');
    expect(out.note.length).toBeLessThan(210);
  });

  it('thành công, service chưa tự ghi → ghi log tự động (id lấy từ kết quả)', async () => {
    await lastValueFrom(
      interceptor.intercept(ctx(), { handle: () => of({ data: { id: ID } }) }),
    );
    await flush();
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        actionType: 'camera_groups_create',
        entityType: 'camera_groups',
        entityId: ID,
        severity: 'info',
        metadataJson: expect.objectContaining({
          auto: true,
          status: 200,
          body: { name: 'Nhóm A', password: '[ẩn]' },
        }),
      }),
    );
  });

  it('service đã tự ghi trong request → không ghi trùng', async () => {
    query.mockResolvedValue([1]);
    await lastValueFrom(interceptor.intercept(ctx(), { handle: () => of({}) }));
    await flush();
    expect(audit.logAction).not.toHaveBeenCalled();
  });

  it('lỗi 4xx → vẫn ghi, mức warning kèm thông báo lỗi', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(ctx(), {
          handle: () => throwError(() => new BadRequestException('Trùng mã')),
        }),
      ),
    ).rejects.toThrow();
    await flush();
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        metadataJson: expect.objectContaining({
          status: 400,
          error: 'Trùng mã',
        }),
      }),
    );
  });

  it('GET, ẩn danh, hoặc /auth → không ghi', async () => {
    for (const over of [
      { method: 'GET' },
      { user: undefined },
      { route: { path: '/api/v1/auth/refresh' } },
    ]) {
      await lastValueFrom(
        interceptor.intercept(ctx(over), { handle: () => of({}) }),
      );
    }
    await flush();
    expect(audit.logAction).not.toHaveBeenCalled();
  });
});
