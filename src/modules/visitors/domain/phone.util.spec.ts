import { normalizeVnPhone, isValidVnPhone } from './phone.util.js';

describe('phone.util', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['+84912345678', '0912345678'],
    ['84912345678', '0912345678'],
    ['091 234 5678', '0912345678'],
    ['091.234.5678', '0912345678'],
    ['(+84) 912-345-678', '0912345678'],
  ])('chuẩn hóa %s', (raw, expected) => expect(normalizeVnPhone(raw)).toBe(expected));
  it('hợp lệ: 10 số bắt đầu 0', () => {
    expect(isValidVnPhone('0912345678')).toBe(true);
    expect(isValidVnPhone('12345')).toBe(false);
    expect(isValidVnPhone('')).toBe(false);
  });
});
