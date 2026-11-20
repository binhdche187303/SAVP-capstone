import { parseReportTypes } from './report-template.service.js';

describe('parseReportTypes', () => {
  it('nhận mảng nhiều loại, bỏ trùng', () => {
    expect(parseReportTypes({ reportTypes: ['vehicle', 'gate-access', 'vehicle'] })).toEqual(['vehicle', 'gate-access']);
  });
  it('mảng rỗng = mọi loại', () => {
    expect(parseReportTypes({ reportTypes: [] })).toEqual([]);
  });
  it('vẫn nhận reportType đơn của client cũ', () => {
    expect(parseReportTypes({ reportType: 'visitor' })).toEqual(['visitor']);
    expect(parseReportTypes({ reportType: null })).toEqual([]);
  });
  it('không gửi gì → undefined (giữ nguyên khi sửa)', () => {
    expect(parseReportTypes({ name: 'x' })).toBeUndefined();
  });
  it('chặn loại lạ hoặc sai kiểu', () => {
    expect(() => parseReportTypes({ reportTypes: ['nope'] })).toThrow();
    expect(() => parseReportTypes({ reportTypes: 'vehicle' })).toThrow();
  });
});
