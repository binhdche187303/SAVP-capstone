import { buildSessionTimes } from './session-time.util.js';

describe('buildSessionTimes (ACD-001 D5, R12)', () => {
  it('ngày + ca giờ VN → UTC đúng (07:30 VN = 00:30Z)', () => {
    const { startTime, endTime } = buildSessionTimes(
      '2026-09-07',
      '07:30:00',
      '09:50:00',
    );
    expect(startTime.toISOString()).toBe('2026-09-07T00:30:00.000Z');
    expect(endTime.toISOString()).toBe('2026-09-07T02:50:00.000Z');
  });

  it('nhận giờ dạng HH:mm', () => {
    expect(
      buildSessionTimes('2026-09-07', '20:30', '22:50').endTime.toISOString(),
    ).toBe('2026-09-07T15:50:00.000Z');
  });

  it.each([
    ['07/09/2026', '07:30', '09:50'],
    ['2026-09-07', '7:30', '09:50'],
    ['2026-02-30', '07:30', '09:50'],
  ])('sai định dạng/ngày không tồn tại → throw (%s %s)', (d, s, e) => {
    expect(() => buildSessionTimes(d, s, e)).toThrow();
  });

  it('giờ kết thúc <= giờ bắt đầu → throw', () => {
    expect(() => buildSessionTimes('2026-09-07', '09:50', '07:30')).toThrow();
  });
});
