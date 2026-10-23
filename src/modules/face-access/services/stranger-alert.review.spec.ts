/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StrangerAlertService } from './stranger-alert.service.js';

const ACTOR = '33333333-3333-4333-8333-333333333333';
const TARGET = '44444444-4444-4444-8444-444444444444';
const EVENT = '55555555-5555-4555-8555-555555555555';

describe('StrangerAlertService — hậu kiểm AI nhận sai (họp 20/10)', () => {
  let service: StrangerAlertService;
  let query: jest.Mock;
  let captured: Array<{ sql: string; params: any[] }>;
  let roles: string[];
  let targetUser: any[];
  let inScope: any[];
  let updated: any[];

  beforeEach(() => {
    captured = [];
    roles = ['SYSTEM_ADMIN'];
    targetUser = [{ id: TARGET, full_name: 'Bùi Văn Long' }];
    inScope = [{ ok: 1 }];
    updated = [{ id: EVENT }];
    query = jest.fn().mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM users WHERE id')) return Promise.resolve(targetUser);
      if (sql.includes('FROM user_roles')) return Promise.resolve(roles.map((role_code) => ({ role_code })));
      if (sql.includes('JOIN users c')) return Promise.resolve(inScope);
      if (sql.includes('UPDATE iot_device_events')) return Promise.resolve(updated);
      return Promise.resolve([]);
    });
    service = new StrangerAlertService({ manager: { query } } as any, { get: jest.fn() } as any, {} as any, {} as any, {} as any);
  });

  it('xác nhận: đánh dấu reviewedAt/By/UserId trên đúng event face_stranger chưa xử lý, rồi ghi audit', async () => {
    const r = await service.review({ eventIds: [EVENT], userId: TARGET, note: 'Đeo khẩu trang' }, ACTOR);
    expect(r).toEqual({ reviewed: 1, userId: TARGET, fullName: 'Bùi Văn Long' });
    const upd = captured.find((c) => c.sql.includes('UPDATE iot_device_events'))!;
    expect(upd.sql).toContain("event_type = 'face_stranger'");
    expect(upd.sql).toContain("? 'reviewedAt'"); // không ghi đè event đã xử lý
    expect(upd.params).toEqual([[EVENT], ACTOR, TARGET, null, 'Đeo khẩu trang']);
    expect(captured.some((c) => c.sql.includes('INSERT INTO audit_logs') && c.params[0] === ACTOR)).toBe(true);
  });

  it('người được xác nhận không tồn tại → 404, không cập nhật gì', async () => {
    targetUser = [];
    await expect(service.review({ eventIds: [EVENT], userId: TARGET }, ACTOR)).rejects.toThrow(NotFoundException);
    expect(captured.some((c) => c.sql.includes('UPDATE iot_device_events'))).toBe(false);
  });

  it('role không phải admin và người được xác nhận ngoài phòng ban → 403, không cập nhật', async () => {
    roles = ['MANAGER'];
    inScope = [];
    await expect(service.review({ eventIds: [EVENT], userId: TARGET }, ACTOR)).rejects.toThrow(ForbiddenException);
    expect(captured.some((c) => c.sql.includes('UPDATE iot_device_events'))).toBe(false);
  });

  it('MANAGER xác nhận người cùng phòng ban → được phép', async () => {
    roles = ['MANAGER'];
    await expect(service.review({ eventIds: [EVENT], userId: TARGET }, ACTOR)).resolves.toMatchObject({ reviewed: 1 });
  });

  it('tất cả event đã được xử lý/không tồn tại → 404', async () => {
    updated = [];
    await expect(service.review({ eventIds: [EVENT], userId: TARGET }, ACTOR)).rejects.toThrow(NotFoundException);
  });

  it('hàng chờ người lạ loại trừ event đã hậu kiểm', async () => {
    await service.list({ page: 1, limit: 20 } as any);
    expect(captured.some((c) => c.sql.includes("NOT (e.payload_json ? 'reviewedAt')"))).toBe(true);
  });

  describe('đóng / mở lại cảnh báo (thay "Bỏ qua" cục bộ)', () => {
    it('đóng: ghi dismissedAt/By/Reason lên event còn chờ + audit, không đụng event đã hậu kiểm/đã đóng', async () => {
      const r = await service.dismiss({ eventIds: [EVENT], reason: 'legit_visitor' } as any, ACTOR);
      expect(r).toEqual({ dismissed: 1 });
      const upd = captured.find((c) => c.sql.includes("'dismissedAt'") && c.sql.includes('UPDATE'))!;
      expect(upd.sql).toContain("event_type = 'face_stranger'");
      expect(upd.sql).toContain("? 'reviewedAt'");
      expect(upd.sql).toContain("? 'dismissedAt'");
      expect(upd.params).toEqual([[EVENT], ACTOR, 'legit_visitor', null]);
      const audit = captured.find((c) => c.sql.includes('INSERT INTO audit_logs'))!;
      expect(audit.params[0]).toBe(ACTOR);
      expect(audit.params[1]).toBe('face.stranger.dismiss');
    });

    it('lý do "Khác" bắt buộc ghi chú ≥5 ký tự → 400, không cập nhật', async () => {
      await expect(service.dismiss({ eventIds: [EVENT], reason: 'other' } as any, ACTOR)).rejects.toThrow(BadRequestException);
      await expect(service.dismiss({ eventIds: [EVENT], reason: 'other', note: 'ab' } as any, ACTOR)).rejects.toThrow(BadRequestException);
      expect(captured.some((c) => c.sql.includes('UPDATE iot_device_events'))).toBe(false);
    });

    it('không còn event nào để đóng → 404', async () => {
      updated = [];
      await expect(service.dismiss({ eventIds: [EVENT], reason: 'ai_false_positive' } as any, ACTOR)).rejects.toThrow(NotFoundException);
    });

    it('mở lại: gỡ các khóa dismissed* + audit', async () => {
      const r = await service.reopen({ eventIds: [EVENT] } as any, ACTOR);
      expect(r).toEqual({ reopened: 1 });
      const upd = captured.find((c) => c.sql.includes("- 'dismissedAt'"))!;
      expect(upd.sql).toContain("? 'dismissedAt'");
      expect(captured.some((c) => c.sql.includes('INSERT INTO audit_logs') && c.params[1] === 'face.stranger.reopen')).toBe(true);
    });

    it('list mặc định chỉ lấy hàng chờ; status=dismissed chỉ lấy đã đóng; all không lọc', async () => {
      await service.list({ page: 1, limit: 20 } as any);
      await service.list({ page: 1, limit: 20, status: 'dismissed' } as any);
      await service.list({ page: 1, limit: 20, status: 'all' } as any);
      const lists = captured.filter((c) => c.sql.includes('GROUP BY e.device_id, stranger_id'));
      expect(lists[0].sql).toContain("NOT (e.payload_json ? 'dismissedAt')");
      expect(lists[1].sql).toContain("AND (e.payload_json ? 'dismissedAt')");
      expect(lists[2].sql).not.toContain("AND NOT (e.payload_json ? 'dismissedAt')");
      expect(lists[2].sql).not.toContain("AND (e.payload_json ? 'dismissedAt')");
    });
  });
});
