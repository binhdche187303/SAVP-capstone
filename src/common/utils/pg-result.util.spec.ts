import { returnedRows } from './pg-result.util.js';

describe('returnedRows', () => {
  it('UPDATE … RETURNING dạng [rows, count] → rows', () => {
    expect(returnedRows([[{ id: 'a' }], 1])).toEqual([{ id: 'a' }]);
    expect(returnedRows([[], 0])).toEqual([]);
  });
  it('SELECT/INSERT … RETURNING dạng mảng dòng → giữ nguyên', () => {
    expect(returnedRows([{ id: 'a' }, { id: 'b' }])).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(returnedRows([])).toEqual([]);
  });
  it('hai dòng không bị nhầm với cặp [rows, count]', () => {
    expect(returnedRows([{ id: 'a' }, { id: 'b' }])).toHaveLength(2);
  });
  it('giá trị lạ → mảng rỗng', () => {
    expect(returnedRows(undefined)).toEqual([]);
  });
});
