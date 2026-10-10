import { validateVisitPayload, VisitPayload, VisitValidationError } from './visit-validators.js';

const NOW = new Date('2026-10-12T03:00:00Z');
const HOUR = 3_600_000;
const base = (over: Partial<VisitPayload> = {}): VisitPayload => ({
  visitor: { fullName: 'Trần Thị Demo', phone: '0912345678', email: 'demo@example.com', photo: 'data:image/png;base64,AAAA' },
  hostId: 'host-1',
  purpose: 'Làm việc với đơn vị',
  scheduledFrom: new Date(NOW.getTime() + HOUR).toISOString(),
  scheduledTo: new Date(NOW.getTime() + 3 * HOUR).toISOString(),
  consent: true,
  ...over,
});
const run = (p: VisitPayload, channel: 'online' | 'walk_in' | 'host_invite' = 'online', hostExists = true) =>
  validateVisitPayload(p, channel, NOW, { maxVisitDays: 7 }, hostExists);

describe('validateVisitPayload', () => {
  it('hợp lệ không ném', () => expect(() => run(base())).not.toThrow());

  it.each<[string, Partial<VisitPayload>, string]>([
    ['thiếu họ tên', { visitor: { ...base().visitor, fullName: '' } }, 'Vui lòng nhập họ tên khách'],
    ['điện thoại sai', { visitor: { ...base().visitor, phone: '12345' } }, 'Số điện thoại không hợp lệ'],
    ['email sai', { visitor: { ...base().visitor, email: 'sai' } }, 'Vui lòng nhập email hợp lệ để nhận kết quả'],
    ['thiếu mục đích', { purpose: ' ' }, 'Vui lòng chọn mục đích'],
    ['bắt đầu ở quá khứ', { scheduledFrom: new Date(NOW.getTime() - 2 * HOUR).toISOString() }, 'Thời gian bắt đầu không được ở quá khứ'],
    ['kết thúc không sau bắt đầu', { scheduledTo: new Date(NOW.getTime() + HOUR).toISOString() }, 'Thời gian kết thúc phải sau thời gian bắt đầu'],
    ['dài hơn 7 ngày', { scheduledTo: new Date(NOW.getTime() + 9 * 24 * HOUR).toISOString() }, 'Khung giờ hẹn tối đa 7 ngày'],
    ['thiếu ảnh', { visitor: { ...base().visitor, photo: null } }, 'Vui lòng chụp hoặc tải ảnh khuôn mặt'],
    ['thiếu đồng ý', { consent: false }, 'Cần đồng ý xử lý dữ liệu sinh trắc để tiếp tục'],
  ])('%s', (_name, over, message) => {
    expect(() => run(base(over))).toThrow(new VisitValidationError(message));
  });

  it('người gặp không tồn tại', () => {
    expect(() => run(base(), 'online', false)).toThrow('Vui lòng chọn người cần gặp');
  });
  it('thiếu hostId', () => {
    expect(() => run(base({ hostId: undefined }))).toThrow('Vui lòng chọn người cần gặp');
  });
  it('email chỉ bắt buộc với kênh online', () => {
    expect(() => run(base({ visitor: { ...base().visitor, email: '' } }), 'walk_in')).not.toThrow();
  });
  it('host_invite không cần ảnh và không cần đồng ý', () => {
    expect(() => run(base({ visitor: { ...base().visitor, photo: null }, consent: false }), 'host_invite')).not.toThrow();
  });
  it('cho phép lệch 5 phút ở quá khứ', () => {
    expect(() => run(base({ scheduledFrom: new Date(NOW.getTime() - 4 * 60_000).toISOString() }))).not.toThrow();
  });
  it('maxVisitDays lấy từ cấu hình', () => {
    const p = base({ scheduledTo: new Date(NOW.getTime() + 4 * 24 * HOUR).toISOString() });
    expect(() => validateVisitPayload(p, 'online', NOW, { maxVisitDays: 3 }, true)).toThrow('Khung giờ hẹn tối đa 3 ngày');
  });
});
