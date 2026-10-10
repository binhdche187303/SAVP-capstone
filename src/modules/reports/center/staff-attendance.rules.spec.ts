import { classifyDay, DEFAULT_STAFF_ATTENDANCE_RULES as R, workdaysInRange } from './staff-attendance.rules.js';

// Giờ VN = UTC+7. 2026-10-05 là thứ Hai.
const vn = (ymd: string, hhmm: string, ss = '00') => new Date(`${ymd}T${hhmm}:${ss}+07:00`);
const day = (a: string, b: string, ymd = '2026-10-05') => ({ firstSeen: vn(ymd, a), lastSeen: vn(ymd, b) });
const LATER = vn('2026-10-20', '09:00'); // "bây giờ" sau ngày đang xét

describe('classifyDay', () => {
  it('vào 08:15 → đúng giờ; 08:16 → muộn', () => {
    expect(classifyDay(day('08:15', '17:30'), '2026-10-05', R, LATER).status).toBe('on_time');
    expect(classifyDay(day('08:16', '17:30'), '2026-10-05', R, LATER).status).toBe('late');
  });

  it('08:15:59 vẫn tính đúng giờ (so theo phút)', () => {
    expect(classifyDay({ firstSeen: vn('2026-10-05', '08:15', '59'), lastSeen: vn('2026-10-05', '17:30') }, '2026-10-05', R, LATER).status).toBe('on_time');
  });

  it('ra 16:59 → về sớm; 17:00 → đúng', () => {
    expect(classifyDay(day('07:50', '16:59'), '2026-10-05', R, LATER).status).toBe('early_leave');
    expect(classifyDay(day('07:50', '17:00'), '2026-10-05', R, LATER).status).toBe('on_time');
  });

  it('muộn và về sớm cùng ngày', () => {
    expect(classifyDay(day('09:00', '16:00'), '2026-10-05', R, LATER).status).toBe('late_and_early');
  });

  it('giờ hiện diện = lần cuối − lần đầu', () => {
    expect(classifyDay(day('08:00', '17:30'), '2026-10-05', R, LATER).hours).toBe(9.5);
  });

  it('không có lần thấy nào → vắng', () => {
    expect(classifyDay(null, '2026-10-05', R, LATER)).toEqual({ status: 'absent', hours: 0 });
  });

  it('thứ Bảy / Chủ nhật không tính', () => {
    expect(classifyDay(null, '2026-10-10', R, LATER).status).toBe('off');
    expect(classifyDay(day('08:00', '17:00', '2026-10-11'), '2026-10-11', R, LATER).status).toBe('off');
    expect(workdaysInRange('2026-10-05', '2026-10-11', R, LATER)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  });

  it('hôm nay 10:00 chưa thấy ai → pending, không phải vắng', () => {
    expect(classifyDay(null, '2026-10-05', R, vn('2026-10-05', '10:00')).status).toBe('pending');
    expect(classifyDay(null, '2026-10-05', R, vn('2026-10-05', '17:30')).status).toBe('absent');
  });

  it('hôm nay đã vào chưa ra (chưa hết giờ làm) → không tính về sớm', () => {
    expect(classifyDay(day('08:00', '11:00'), '2026-10-05', R, vn('2026-10-05', '11:30')).status).toBe('on_time');
    expect(classifyDay(day('08:00', '11:00'), '2026-10-05', R, vn('2026-10-05', '18:00')).status).toBe('early_leave');
  });

  it('cấu hình workStart=07:30 đổi kết quả', () => {
    const strict = { ...R, workStart: '07:30' };
    expect(classifyDay(day('08:00', '17:30'), '2026-10-05', R, LATER).status).toBe('on_time');
    expect(classifyDay(day('08:00', '17:30'), '2026-10-05', strict, LATER).status).toBe('late');
  });

  it('sự kiện 23:30 UTC thuộc ngày hôm sau theo giờ VN (07:00 +1 ngày → đúng giờ của ngày 06/10)', () => {
    const first = new Date('2026-10-05T23:30:00Z'); // = 06/10 06:30 VN
    const r = classifyDay({ firstSeen: first, lastSeen: new Date('2026-10-06T10:00:00Z') }, '2026-10-06', R, LATER);
    expect(r.status).toBe('on_time');
  });

  it('workdaysInRange cắt ngày tương lai', () => {
    expect(workdaysInRange('2026-10-05', '2026-10-09', R, vn('2026-10-07', '12:00'))).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });
});
