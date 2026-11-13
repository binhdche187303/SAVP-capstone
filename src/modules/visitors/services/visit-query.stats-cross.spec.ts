import { parseStatsCross } from './visit-query.service.js';

describe('parseStatsCross (lọc chéo Thống kê khách)', () => {
  it('rỗng hoặc không có giá trị → không lọc', () => {
    expect(parseStatsCross(undefined, 'week')).toBeUndefined();
    expect(parseStatsCross('', 'week')).toBeUndefined();
    expect(parseStatsCross(JSON.stringify({ dim: 'purpose', values: [] }), 'week')).toBeUndefined();
  });

  it('đọc được nhiều giá trị và kèm đơn vị kỳ', () => {
    expect(parseStatsCross(JSON.stringify({ dim: 'purpose', values: ['Họp, đối tác', 'Giao hồ sơ'] }), 'month'))
      .toEqual({ dim: 'purpose', values: ['Họp, đối tác', 'Giao hồ sơ'], unit: 'month' });
    expect(parseStatsCross(JSON.stringify({ dim: 'hour', values: ['7', '13'] }), 'day'))
      .toEqual({ dim: 'hour', values: ['7', '13'], unit: 'day' });
    expect(parseStatsCross(JSON.stringify({ dim: 'period', values: ['2026-10-05'] }), 'week'))
      .toEqual({ dim: 'period', values: ['2026-10-05'], unit: 'week' });
  });

  it.each([
    'không phải json',
    JSON.stringify({ dim: 'drop table', values: ['x'] }),
    JSON.stringify({ dim: 'purpose', values: 'x' }),
    JSON.stringify({ dim: 'purpose', values: [1] }),
    JSON.stringify({ dim: 'hour', values: ['7h'] }),
    JSON.stringify({ dim: 'period', values: ['05/10'] }),
    JSON.stringify({ dim: 'purpose', values: Array.from({ length: 51 }, (_, i) => String(i)) }),
  ])('từ chối tham số sai: %s', (raw) => {
    expect(() => parseStatsCross(raw, 'week')).toThrow();
  });
});
