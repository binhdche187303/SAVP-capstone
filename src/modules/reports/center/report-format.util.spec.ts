import { formatCell, toExcelValue } from './report-format.util.js';

describe('report-format.util', () => {
  it.each([
    [1234, 'number', '1.234'],
    [92.5, 'percent', '92,5%'],
    [7.5, 'hours', '7,5 giờ'],
    [35, 'minutes', '35 phút'],
    [8100, 'duration', '2g 15p'],
    [900, 'duration', '15p'],
    [null, 'number', '—'],
    ['', 'text', '—'],
    ['Phòng A', 'text', 'Phòng A'],
  ])('%p (%s) → %p', (value, format, expected) => {
    expect(formatCell(value, format as never)).toBe(expected);
  });

  it('datetime luôn theo giờ Việt Nam bất kể TZ máy chủ: 17:30Z → 00:30 hôm sau', () => {
    expect(formatCell('2026-10-07T17:30:00Z', 'datetime')).toBe('08/10/2026 00:30');
    expect(formatCell(new Date('2026-10-07T01:15:00Z'), 'datetime')).toBe('07/10/2026 08:15');
  });

  it('datetime không hợp lệ hoặc rỗng → —', () => {
    expect(formatCell('không phải ngày', 'datetime')).toBe('—');
    expect(formatCell(null, 'datetime')).toBe('—');
  });

  it('toExcelValue: số là số, ngày giờ là Date đã dời sang giờ VN, rỗng là null', () => {
    expect(toExcelValue('12', 'number')).toBe(12);
    expect(toExcelValue('abc', 'number')).toBeNull();
    expect(toExcelValue(null, 'text')).toBeNull();
    expect(toExcelValue('2026-10-07T17:30:00Z', 'datetime')).toEqual(new Date('2026-10-08T00:30:00Z'));
    expect(toExcelValue(8100, 'duration')).toBe(8100);
    expect(toExcelValue('Tiếng Việt', 'text')).toBe('Tiếng Việt');
  });
});
