import { BadRequestException } from '@nestjs/common';
import { ReportScheduleService, type SchedulePayload } from './report-schedule.service.js';

const svc = new ReportScheduleService({ query: jest.fn() } as never, { logAction: jest.fn() } as never);
const valid = (over: SchedulePayload = {}): SchedulePayload => ({
  name: 'Báo cáo khách hằng tuần', reportType: 'visitor', filters: {}, period: 'last_week', frequency: 'weekly', time: '08:00', dayOfWeek: 1,
  formats: ['pdf'], recipients: [{ type: 'email', value: 'ban.giam.hieu@savp.edu.vn', label: 'BGH' }], subject: '', message: 'Xin chào', enabled: true, ...over,
});
const messageOf = (p: SchedulePayload): string | null => {
  try { svc.validate(p); return null; } catch (e) { return ((e as BadRequestException).getResponse() as { message: string }).message; }
};

describe('ReportScheduleService.validate — độ dài và dữ liệu người nhận (trước đây quá cột DB → HTTP 500)', () => {
  it('payload hợp lệ không ném', () => expect(messageOf(valid())).toBeNull());

  it('tên tối đa 150 ký tự (cột varchar(150))', () => {
    expect(messageOf(valid({ name: 'A'.repeat(150) }))).toBeNull();
    expect(messageOf(valid({ name: 'A'.repeat(151) }))).toBe('Tên lịch gửi tối đa 150 ký tự');
  });

  it('tiêu đề email tối đa 200 ký tự (cột varchar(200))', () => {
    expect(messageOf(valid({ subject: 'S'.repeat(200) }))).toBeNull();
    expect(messageOf(valid({ subject: 'S'.repeat(201) }))).toBe('Tiêu đề email tối đa 200 ký tự');
  });

  it('nội dung email tối đa 5000 ký tự', () => {
    expect(messageOf(valid({ message: 'M'.repeat(5000) }))).toBeNull();
    expect(messageOf(valid({ message: 'M'.repeat(5001) }))).toBe('Nội dung email tối đa 5000 ký tự');
  });

  it('enabled phải là boolean, không nhận chuỗi "yes"', () => {
    expect(messageOf(valid({ enabled: 'yes' }))).toBe('Trạng thái bật/tắt không hợp lệ');
    expect(messageOf(valid({ enabled: false }))).toBeNull();
  });

  it.each(['<b>x</b>@a.com', 'a b@c.com', 'abc', 'a@b', '"quoted"@a.com'])('email người nhận "%s" không hợp lệ', (value) => {
    expect(messageOf(valid({ recipients: [{ type: 'email', value, label: value }] }))).toBe(`Email không hợp lệ: ${value}`);
  });

  it('email bình thường có dấu chấm, gạch, cộng vẫn qua', () => {
    expect(messageOf(valid({ recipients: [{ type: 'email', value: 'nguyen.van-a+bc@truong.edu.vn', label: 'x' }] }))).toBeNull();
  });

  it('người nhận loại user phải có id dạng UUID (id rác từng làm lỗi 500 khi tra DB)', () => {
    expect(messageOf(valid({ recipients: [{ type: 'user', value: 'not-a-uuid', label: 'x' }] }))).toBe('Người nhận không hợp lệ: not-a-uuid');
    expect(messageOf(valid({ recipients: [{ type: 'user', value: '11111111-1111-4111-8111-111111111111', label: 'x' }] }))).toBeNull();
  });
});

describe('ReportScheduleService.create — người nhận', () => {
  const make = (existingUserIds: string[]) => {
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (/FROM users/i.test(sql)) return (params?.[0] as string[]).filter((id) => existingUserIds.includes(id)).map((id) => ({ id }));
      if (/INSERT INTO report_schedules/i.test(sql)) return [{ id: '22222222-2222-4222-8222-222222222222' }];
      return [{ id: '22222222-2222-4222-8222-222222222222', name: 'x', report_type: 'visitor', filters_json: {}, period: 'last_week', frequency: 'weekly', time: '08:00', day_of_week: 1, day_of_month: null, last_day_of_month: false, formats: ['pdf'], recipients_json: [], subject: null, message: null, enabled: true, next_run_at: null, last_run_at: null, created_at: new Date(), owner_user_id: 'u' }];
    });
    return { service: new ReportScheduleService({ query } as never, { logAction: jest.fn().mockResolvedValue(undefined) } as never), query };
  };
  const GHOST = '33333333-3333-4333-8333-333333333333';

  it('người nhận loại user không tồn tại → 400 (không lưu lịch gửi cho người không có thật)', async () => {
    const { service } = make([]);
    const p = service.create(valid({ recipients: [{ type: 'user', value: GHOST, label: 'Ma' }] }), 'u');
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await p.catch((e) => expect((e as BadRequestException).getResponse()).toMatchObject({ message: 'Người nhận không tồn tại hoặc đã bị khóa: Ma' }));
  });

  it('người nhận trùng nhau chỉ lưu một lần (email so sánh không phân biệt hoa/thường)', async () => {
    const { service, query } = make([]);
    await service.create(valid({ recipients: [
      { type: 'email', value: 'A@example.com', label: 'A' },
      { type: 'email', value: 'a@example.com', label: 'a' },
      { type: 'email', value: 'b@example.com', label: 'b' },
    ] }), 'u');
    const insert = query.mock.calls.find(([sql]) => /INSERT INTO report_schedules/i.test(String(sql)));
    const saved = JSON.parse((insert as [string, unknown[]])[1][10] as string);
    expect(saved).toHaveLength(2);
  });
});
